import { createPrivateKey } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@utils/logger';
import { R, handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import {
  argNumber,
  argBool,
  argStringRequired,
  argString,
} from '@server/domains/shared/parse-args';
import {
  PROXY_ADB_MAX_BUFFER_BYTES,
  PROXY_ADB_TIMEOUT_MS,
  PROXY_CAPTURE_BUFFER_MAX,
  PROXY_CAPTURE_RETURN_LIMIT,
} from '@src/constants';
import { ensureMockttpCaCompatibilityPatched } from '@server/domains/proxy/mockttp-ca-compat';

const ResponseBuilder = {
  success: (data: Record<string, unknown>) => R.ok().merge(data).json(),
  error: (msg: string) => R.fail(msg).mcpError().json(),
};

interface CaptureEntry {
  type: 'request' | 'response';
  id: string;
  method?: string;
  url?: string;
  status?: number;
  headers?: Record<string, string>;
  timestamp: number;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function compileUrlPattern(urlPattern: string): RegExp {
  const trimmed = urlPattern.trim();
  const regexLiteral = /^\/(.+)\/([a-z]*)$/.exec(trimmed);
  if (regexLiteral && regexLiteral[1] !== undefined) {
    const source = regexLiteral[1];
    const flags = regexLiteral[2] ?? '';
    return new RegExp(source, flags);
  }
  return new RegExp(trimmed);
}

export class ProxyHandlers {
  private server: unknown = null;
  private readonly caPathDir: string;
  private currentPort: number | null = null;
  private captureBuffer: CaptureEntry[] = [];
  private mockttpModule: typeof import('mockttp') | null = null;
  private caReady = false;

  constructor() {
    // Resolve CA dir without touching disk — actual mkdir happens lazily in ensureCa().
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
    this.caPathDir = path.join(home, '.jshookmcp', 'ca');
  }

  async handleProxyStartTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyStart(args));
  }

  async handleProxyStopTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyStop(args));
  }

  async handleProxyStatusTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyStatus(args));
  }

  async handleProxyExportCaTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyExportCa(args));
  }

  async handleProxyAddRuleTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyAddRule(args));
  }

  async handleProxyGetRequestsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyGetRequests(args));
  }

  async handleProxyClearLogsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyClearLogs(args));
  }

  async handleProxySetupAdbDeviceTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxySetupAdbDevice(args));
  }

  /** Push capture entry with bounded buffer (FIFO). */
  private appendCapture(entry: CaptureEntry): void {
    this.captureBuffer.push(entry);
    if (this.captureBuffer.length > PROXY_CAPTURE_BUFFER_MAX) {
      this.captureBuffer.shift();
    }
  }

  /** Lazily ensure CA dir + key/cert exist. Idempotent, async. */
  private async ensureCa(
    mockttp: typeof import('mockttp'),
  ): Promise<{ key: string; cert: string; certPath: string }> {
    const keyPath = path.join(this.caPathDir, 'ca.key');
    const certPath = path.join(this.caPathDir, 'ca.pem');

    if (!this.caReady) {
      await mkdir(this.caPathDir, { recursive: true });
      this.caReady = true;
    }

    const hasKey = await pathExists(keyPath);
    const hasCert = await pathExists(certPath);

    if (!hasKey || !hasCert) {
      logger.info('[proxy] generating new CA certificates');
      const ca = await mockttp.generateCACertificate();

      // Normalize to PKCS#8 for cross-platform compatibility (asn1.js schema
      // resolution can fail on some Linux CI environments).
      try {
        const keyObj = createPrivateKey(ca.key);
        ca.key = keyObj.export({ type: 'pkcs8', format: 'pem' }).toString();
      } catch {
        // Keep the original PEM if Node crypto can't parse it.
      }

      await writeFile(keyPath, ca.key, { mode: 0o600 });
      await writeFile(certPath, ca.cert);
    }

    const key = await readFile(keyPath, 'utf8');
    const cert = await readFile(certPath, 'utf8');
    return { key, cert, certPath };
  }

  async handleProxyStart(args: Record<string, unknown>) {
    const port = argNumber(args, 'port') || 8080;
    const useHttps = argBool(args, 'useHttps') ?? true;

    if (this.server) {
      return ResponseBuilder.error(`Proxy is already running on port ${this.currentPort}`);
    }

    try {
      const mockttp = this.mockttpModule ?? (await import('mockttp'));
      this.mockttpModule = mockttp;

      let caCertPath: string | null = null;
      let server: ReturnType<typeof mockttp.getLocal>;
      if (useHttps) {
        await ensureMockttpCaCompatibilityPatched();
        const { key, cert, certPath } = await this.ensureCa(mockttp);
        caCertPath = certPath;
        server = mockttp.getLocal({ https: { key, cert }, cors: true });
      } else {
        server = mockttp.getLocal();
      }

      // mockttp types only declare 'rule-event' for .on(); 'request'/'response' are
      // actually emitted at runtime but missing from the .d.ts. Cast to a wider event API.
      const eventEmitter = server as unknown as {
        on(event: string, handler: (payload: unknown) => void): void;
      };
      eventEmitter.on('request', (raw) => {
        const req = raw as {
          id: string;
          method: string;
          url: string;
          headers: Record<string, string>;
        };
        this.appendCapture({
          type: 'request',
          id: req.id,
          method: req.method,
          url: req.url,
          headers: req.headers,
          timestamp: Date.now(),
        });
      });
      eventEmitter.on('response', (raw) => {
        const res = raw as { id: string; statusCode: number; headers: Record<string, string> };
        this.appendCapture({
          type: 'response',
          id: res.id,
          status: res.statusCode,
          headers: res.headers,
          timestamp: Date.now(),
        });
      });

      await server.start(port);
      this.server = server;
      this.currentPort = port;

      return ResponseBuilder.success({
        message: 'Proxy started.',
        port: this.currentPort,
        caCertPath,
      });
    } catch (e) {
      this.server = null;
      const message = e instanceof Error ? e.message : String(e);
      return ResponseBuilder.error(`Failed to start proxy: ${message}`);
    }
  }

  async handleProxyStop(_args: Record<string, unknown>) {
    if (!this.server) {
      return ResponseBuilder.error('Proxy is not running.');
    }
    await (this.server as { stop: () => Promise<void> }).stop();
    this.server = null;
    this.currentPort = null;
    return ResponseBuilder.success({ message: 'Proxy stopped successfully' });
  }

  async handleProxyStatus(_args: Record<string, unknown>) {
    return ResponseBuilder.success({
      running: !!this.server,
      port: this.currentPort,
      caDir: this.caPathDir,
      caCertPath: path.join(this.caPathDir, 'ca.pem'),
    });
  }

  async handleProxyExportCa(_args: Record<string, unknown>) {
    const certPath = path.join(this.caPathDir, 'ca.pem');
    if (!(await pathExists(certPath))) {
      return ResponseBuilder.error(
        'CA certificate not found. Start the proxy with HTTPS enabled first.',
      );
    }
    const certContent = await readFile(certPath, 'utf8');
    return ResponseBuilder.success({
      path: certPath,
      content: certContent,
    });
  }

  async handleProxyAddRule(args: Record<string, unknown>) {
    if (!this.server) {
      return ResponseBuilder.error('Proxy must be running to add rules.');
    }

    const action = argStringRequired(args, 'action');
    const method = (argString(args, 'method') || 'GET').toUpperCase();
    const urlPattern = argString(args, 'urlPattern') || '.*';

    try {
      const matcher = compileUrlPattern(urlPattern);
      const server = this.server as {
        forGet: (m: RegExp) => unknown;
        forPost: (m: RegExp) => unknown;
        forPut: (m: RegExp) => unknown;
        forDelete: (m: RegExp) => unknown;
        forAnyRequest: () => unknown;
      };
      let builder: {
        thenPassThrough: () => Promise<{ id: string }>;
        thenCloseConnection: () => Promise<{ id: string }>;
        thenReply: (status: number, body: string) => Promise<{ id: string }>;
      };
      if (method === 'GET') builder = server.forGet(matcher) as typeof builder;
      else if (method === 'POST') builder = server.forPost(matcher) as typeof builder;
      else if (method === 'PUT') builder = server.forPut(matcher) as typeof builder;
      else if (method === 'DELETE') builder = server.forDelete(matcher) as typeof builder;
      else builder = server.forAnyRequest() as typeof builder;

      let endpoint: { id: string };
      if (action === 'forward') {
        endpoint = await builder.thenPassThrough();
      } else if (action === 'block') {
        endpoint = await builder.thenCloseConnection();
      } else if (action === 'mock_response') {
        const mockStatus = argNumber(args, 'mockStatus') || 200;
        const mockBody = argString(args, 'mockBody') || '';
        endpoint = await builder.thenReply(mockStatus, mockBody);
      } else {
        return ResponseBuilder.error(`Unknown action: ${action}`);
      }

      return ResponseBuilder.success({
        message: 'Rule added successfully',
        endpointId: endpoint.id,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return ResponseBuilder.error(`Failed to add rule: ${message}`);
    }
  }

  async handleProxyGetRequests(args: Record<string, unknown>) {
    const urlFilter = argString(args, 'urlFilter');
    let results: CaptureEntry[] = this.captureBuffer;
    if (urlFilter) {
      results = results.filter((r) => r.url !== undefined && r.url.includes(urlFilter));
    }
    return ResponseBuilder.success({
      count: results.length,
      logs: results.slice(-PROXY_CAPTURE_RETURN_LIMIT),
    });
  }

  async handleProxyClearLogs(_args: Record<string, unknown>) {
    this.captureBuffer = [];
    return ResponseBuilder.success({ message: 'Captured proxy logs cleared.' });
  }

  async handleProxySetupAdbDevice(args: Record<string, unknown>) {
    const port = this.currentPort;
    if (!port) {
      return ResponseBuilder.error(
        'Proxy must be running locally to setup ADB device reverse tethering.',
      );
    }
    const certPath = path.join(this.caPathDir, 'ca.pem');
    if (!(await pathExists(certPath))) {
      return ResponseBuilder.error(
        'CA certificate not found. Start the proxy with HTTPS enabled first.',
      );
    }

    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    const deviceSerial = argString(args, 'deviceSerial');
    const deviceArgs = deviceSerial ? ['-s', deviceSerial] : [];
    const runAdb = async (extraArgs: string[]) =>
      execFileAsync('adb', [...deviceArgs, ...extraArgs], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: PROXY_ADB_TIMEOUT_MS,
        maxBuffer: PROXY_ADB_MAX_BUFFER_BYTES,
      });

    try {
      try {
        await execFileAsync('adb', ['version'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: PROXY_ADB_TIMEOUT_MS,
          maxBuffer: PROXY_ADB_MAX_BUFFER_BYTES,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return R.fail(`ADB binary not available: ${message}`)
          .merge({
            available: false,
            capability: 'adb_binary',
            status: 'unavailable',
            fix: 'Install Android Platform Tools and ensure `adb` is available on PATH.',
          })
          .json();
      }

      // 1. Verify adb is available
      await runAdb(['get-state']);

      // 2. Push CA Certificate
      await runAdb(['push', certPath, '/data/local/tmp/ca.pem']);

      // 3. Reverse tether port so device can reach localhost proxy
      await runAdb(['reverse', `tcp:${port}`, `tcp:${port}`]);

      // 4. Set global HTTP proxy on the device
      await runAdb(['shell', 'settings', 'put', 'global', 'http_proxy', `127.0.0.1:${port}`]);

      const instructions =
        `ADB Configuration Applied Automatically:\n- Verified device connection.\n- Pushed CA to ` +
        `/data/local/tmp/ca.pem\n- Reversed forwarded tcp:${port} -> tcp:${port}\n- Set global http_proxy ` +
        `to 127.0.0.1:` +
        `${port}\n\nNote: For HTTPS decryption, manually install the CA cert from ` +
        `/data/local/tmp/ca.pem in Android Settings. Android does not allow system CA ` +
        `installation through normal ADB permissions.`;

      return ResponseBuilder.success({
        message: 'ADB device successfully configured.',
        deviceId: deviceSerial || 'default',
        instructions,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return ResponseBuilder.error(`Failed to configure ADB device: ${message}`);
    }
  }
}
