import { createPrivateKey } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@utils/logger';
import { R, handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { argNumber, argBool, argString } from '@server/domains/shared/parse-args';
import {
  PROXY_ADB_MAX_BUFFER_BYTES,
  PROXY_ADB_TIMEOUT_MS,
  PROXY_CAPTURE_BODY_PREVIEW_BYTES,
  PROXY_CAPTURE_BUFFER_MAX,
  PROXY_CAPTURE_RETURN_LIMIT,
} from '@src/constants';
import { ensureMockttpCaCompatibilityPatched } from '@server/domains/proxy/mockttp-ca-compat';

const ResponseBuilder = {
  success: (data: Record<string, unknown>) => R.ok().merge(data).json(),
  error: (msg: string) => R.fail(msg).mcpError().json(),
};

const PROXY_RULE_ACTIONS = new Set(['forward', 'mock_response', 'block'] as const);
const HTTP_METHOD_RE = /^[A-Z][A-Z0-9_-]*$|^\*$/;

type ProxyRuleAction = 'forward' | 'mock_response' | 'block';
type ParsedValue<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: string;
    };

interface CaptureEntry {
  type: 'request' | 'response';
  id: string;
  method?: string;
  url?: string;
  status?: number;
  headers?: Record<string, string>;
  bodyTextPreview?: string;
  bodyBytes?: number;
  bodyPreviewBytes?: number;
  bodyTruncated?: boolean;
  bodyEncoding?: 'utf8';
  bodyUnavailable?: string;
  remoteIpAddress?: string;
  remotePort?: number;
  timing?: CaptureTiming;
  timestamp: number;
}

interface ProxyRuleRecord {
  endpointId: string;
  action: string;
  method: string;
  urlPattern: string;
  mockStatus?: number;
  createdAt: string;
}

interface CaptureTiming {
  startedAt?: string;
  startTime?: number;
  bodyReceivedMs?: number;
  headersSentMs?: number;
  responseSentMs?: number;
  durationMs?: number;
}

interface CaptureBody {
  getText?: () => Promise<string | undefined>;
  asText?: () => Promise<string>;
  buffer?: Buffer;
}

interface CapturePayload {
  id: string;
  method?: string;
  url?: string;
  statusCode?: number;
  headers?: Record<string, unknown>;
  body?: CaptureBody;
  timingEvents?: {
    startTime?: number;
    startTimestamp?: number;
    bodyReceivedTimestamp?: number;
    headersSentTimestamp?: number;
    responseSentTimestamp?: number;
    abortedTimestamp?: number;
  };
  remoteIpAddress?: string;
  remotePort?: number;
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

function parseRuleAction(value: unknown): ParsedValue<ProxyRuleAction> {
  if (typeof value !== 'string' || !PROXY_RULE_ACTIONS.has(value as ProxyRuleAction)) {
    return {
      ok: false,
      error: 'action must be one of: forward, mock_response, block',
    };
  }
  return { ok: true, value: value as ProxyRuleAction };
}

function parseOptionalString(
  args: Record<string, unknown>,
  key: string,
  fallback: string,
): ParsedValue<string> {
  const value = args[key];
  if (value === undefined || value === null) {
    return { ok: true, value: fallback };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: `${key} must be a string when provided` };
  }
  return { ok: true, value };
}

function parseRuleMethod(args: Record<string, unknown>): ParsedValue<string> {
  const parsed = parseOptionalString(args, 'method', 'GET');
  if (!parsed.ok) return parsed;

  const method = parsed.value.trim().toUpperCase();
  if (!HTTP_METHOD_RE.test(method)) {
    return {
      ok: false,
      error: 'method must be a valid HTTP method token, ANY, ALL, or *',
    };
  }
  return { ok: true, value: method };
}

function parseMockStatus(args: Record<string, unknown>): ParsedValue<number> {
  const value = args['mockStatus'];
  if (value === undefined || value === null) {
    return { ok: true, value: 200 };
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 100 ||
    value > 599
  ) {
    return {
      ok: false,
      error: 'mockStatus must be an integer between 100 and 599 when provided',
    };
  }
  return { ok: true, value };
}

function normalizeHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (Array.isArray(value)) {
      normalized[key] = value.map((item) => String(item)).join(', ');
    } else if (value !== undefined) {
      normalized[key] = String(value);
    }
  }
  return normalized;
}

function millisFrom(base: number | undefined, value: number | undefined): number | undefined {
  if (typeof base !== 'number' || typeof value !== 'number') {
    return undefined;
  }
  return Math.max(0, Math.round((value - base) * 1000) / 1000);
}

function buildTiming(events: CapturePayload['timingEvents']): CaptureTiming | undefined {
  if (!events) {
    return undefined;
  }
  const base = events.startTimestamp;
  const bodyReceivedMs = millisFrom(base, events.bodyReceivedTimestamp);
  const headersSentMs = millisFrom(base, events.headersSentTimestamp);
  const responseSentMs = millisFrom(base, events.responseSentTimestamp);
  const abortedMs = millisFrom(base, events.abortedTimestamp);
  const durationMs = responseSentMs ?? headersSentMs ?? abortedMs ?? bodyReceivedMs;
  return {
    ...(typeof events.startTime === 'number'
      ? {
          startedAt: new Date(events.startTime).toISOString(),
          startTime: events.startTime,
        }
      : {}),
    ...(bodyReceivedMs !== undefined ? { bodyReceivedMs } : {}),
    ...(headersSentMs !== undefined ? { headersSentMs } : {}),
    ...(responseSentMs !== undefined ? { responseSentMs } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

function truncateUtf8(text: string): {
  bodyTextPreview: string;
  bodyBytes: number;
  bodyPreviewBytes: number;
  bodyTruncated: boolean;
  bodyEncoding: 'utf8';
} {
  const raw = Buffer.from(text, 'utf8');
  const preview = raw.subarray(0, PROXY_CAPTURE_BODY_PREVIEW_BYTES);
  return {
    bodyTextPreview: preview.toString('utf8'),
    bodyBytes: raw.length,
    bodyPreviewBytes: preview.length,
    bodyTruncated: raw.length > preview.length,
    bodyEncoding: 'utf8',
  };
}

async function readBodyPreview(body: CaptureBody | undefined): Promise<Partial<CaptureEntry>> {
  if (!body) {
    return {};
  }
  try {
    let text: string | undefined;
    if (typeof body.getText === 'function') {
      text = await body.getText();
    } else if (typeof body.asText === 'function') {
      text = await body.asText();
    } else if (Buffer.isBuffer(body.buffer)) {
      text = body.buffer.toString('utf8');
    }

    if (text === undefined) {
      return { bodyUnavailable: 'body could not be decoded as text' };
    }

    return truncateUtf8(text);
  } catch (error) {
    return { bodyUnavailable: error instanceof Error ? error.message : String(error) };
  }
}

export class ProxyHandlers {
  private server: unknown = null;
  private readonly caPathDir: string;
  private currentPort: number | null = null;
  private captureBuffer: CaptureEntry[] = [];
  private ruleRecords: ProxyRuleRecord[] = [];
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

  async handleProxyListRulesTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyListRules(args));
  }

  async handleProxyClearRulesTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyClearRules(args));
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

  private updateCapture(
    type: CaptureEntry['type'],
    id: string,
    patch: Partial<CaptureEntry>,
  ): void {
    const entry = this.captureBuffer.find((item) => item.type === type && item.id === id);
    if (entry) {
      Object.assign(entry, patch);
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
        const req = raw as CapturePayload;
        this.appendCapture({
          type: 'request',
          id: req.id,
          method: req.method,
          url: req.url,
          headers: normalizeHeaders(req.headers),
          remoteIpAddress: req.remoteIpAddress,
          remotePort: req.remotePort,
          timing: buildTiming(req.timingEvents),
          timestamp: Date.now(),
        });
        void readBodyPreview(req.body).then((body) => this.updateCapture('request', req.id, body));
      });
      eventEmitter.on('response', (raw) => {
        const res = raw as CapturePayload;
        const matchingRequest = this.captureBuffer.find(
          (entry) => entry.type === 'request' && entry.id === res.id,
        );
        this.appendCapture({
          type: 'response',
          id: res.id,
          method: matchingRequest?.method,
          url: matchingRequest?.url,
          status: res.statusCode,
          headers: normalizeHeaders(res.headers),
          remoteIpAddress: res.remoteIpAddress,
          remotePort: res.remotePort,
          timing: buildTiming(res.timingEvents),
          timestamp: Date.now(),
        });
        void readBodyPreview(res.body).then((body) => this.updateCapture('response', res.id, body));
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
    this.ruleRecords = [];
    return ResponseBuilder.success({ message: 'Proxy stopped successfully' });
  }

  async handleProxyStatus(_args: Record<string, unknown>) {
    return ResponseBuilder.success({
      running: !!this.server,
      port: this.currentPort,
      caDir: this.caPathDir,
      caCertPath: path.join(this.caPathDir, 'ca.pem'),
      ruleCount: this.ruleRecords.length,
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

    const parsedAction = parseRuleAction(args['action']);
    if (!parsedAction.ok) {
      return ResponseBuilder.error(parsedAction.error);
    }
    const action = parsedAction.value;

    const parsedMethod = parseRuleMethod(args);
    if (!parsedMethod.ok) {
      return ResponseBuilder.error(parsedMethod.error);
    }
    const method = parsedMethod.value;

    const parsedUrlPattern = parseOptionalString(args, 'urlPattern', '.*');
    if (!parsedUrlPattern.ok) {
      return ResponseBuilder.error(parsedUrlPattern.error);
    }
    const urlPattern = parsedUrlPattern.value;

    let mockStatus: number | undefined;
    let mockBody: string | undefined;
    if (action === 'mock_response') {
      const parsedMockStatus = parseMockStatus(args);
      if (!parsedMockStatus.ok) {
        return ResponseBuilder.error(parsedMockStatus.error);
      }
      mockStatus = parsedMockStatus.value;

      const parsedMockBody = parseOptionalString(args, 'mockBody', '');
      if (!parsedMockBody.ok) {
        return ResponseBuilder.error(parsedMockBody.error);
      }
      mockBody = parsedMockBody.value;
    }

    try {
      const matcher = compileUrlPattern(urlPattern);
      const server = this.server as {
        forGet: (m: RegExp) => unknown;
        forPost: (m: RegExp) => unknown;
        forPut: (m: RegExp) => unknown;
        forDelete: (m: RegExp) => unknown;
        forMethod?: (method: string, m: RegExp) => unknown;
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
      else if (method === 'ANY' || method === '*' || method === 'ALL') {
        builder = server.forAnyRequest() as typeof builder;
      } else if (typeof server.forMethod === 'function') {
        builder = server.forMethod(method, matcher) as typeof builder;
      } else {
        return ResponseBuilder.error(
          `Proxy server does not support method-specific rules for ${method}`,
        );
      }

      let endpoint: { id: string };
      switch (action) {
        case 'forward':
          endpoint = await builder.thenPassThrough();
          break;
        case 'block':
          endpoint = await builder.thenCloseConnection();
          break;
        case 'mock_response':
          endpoint = await builder.thenReply(mockStatus ?? 200, mockBody ?? '');
          break;
      }

      return ResponseBuilder.success({
        message: 'Rule added successfully',
        endpointId: endpoint.id,
        rule: this.recordRule({
          endpointId: endpoint.id,
          action,
          method,
          urlPattern,
          ...(action === 'mock_response' ? { mockStatus: mockStatus ?? 200 } : {}),
        }),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return ResponseBuilder.error(`Failed to add rule: ${message}`);
    }
  }

  async handleProxyListRules(_args: Record<string, unknown>) {
    return ResponseBuilder.success({
      count: this.ruleRecords.length,
      rules: this.ruleRecords.map((rule) => ({ ...rule })),
    });
  }

  async handleProxyClearRules(_args: Record<string, unknown>) {
    if (!this.server) {
      return ResponseBuilder.error('Proxy must be running to clear rules.');
    }

    const server = this.server as {
      setRequestRules?: (...rules: unknown[]) => Promise<unknown[]>;
    };
    if (typeof server.setRequestRules !== 'function') {
      return ResponseBuilder.error('Proxy server does not support clearing rules at runtime.');
    }

    await server.setRequestRules();
    const cleared = this.ruleRecords.length;
    this.ruleRecords = [];
    return ResponseBuilder.success({
      message: 'Proxy rules cleared.',
      cleared,
    });
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

  private recordRule(rule: Omit<ProxyRuleRecord, 'createdAt'>): ProxyRuleRecord {
    const record: ProxyRuleRecord = {
      ...rule,
      createdAt: new Date().toISOString(),
    };
    this.ruleRecords.push(record);
    return { ...record };
  }
}
