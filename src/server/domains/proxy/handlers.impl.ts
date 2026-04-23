import * as fs from 'fs';
import * as path from 'path';
import { R } from '@server/domains/shared/ResponseBuilder';
const ResponseBuilder = {
  success: (data: any) => R.ok().merge(data).json(),
  error: (msg: string) => R.fail(msg).mcpError().json(),
};
import {
  argNumber,
  argBool,
  argStringRequired,
  argString,
} from '@server/domains/shared/parse-args';

export class ProxyHandlers {
  private server: any = null;
  private caPathDir: string;
  private currentPort: number | null = null;
  private captureBuffer: any[] = [];
  private mockttpModule: any = null;

  constructor() {
    // Store CA in OS tmp dir or user dir
    // For convenience we'll try to put it in <home>/.jshookmcp/ca
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
    this.caPathDir = path.join(home, '.jshookmcp', 'ca');
    fs.mkdirSync(this.caPathDir, { recursive: true });
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

      if (useHttps) {
        const keyPath = path.join(this.caPathDir, 'ca.key');
        const certPath = path.join(this.caPathDir, 'ca.pem');

        if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
          console.log('[Proxy] generating new CA certificates...');
          const ca = await mockttp.generateCACertificate();
          fs.writeFileSync(keyPath, ca.key);
          fs.writeFileSync(certPath, ca.cert);
        }

        this.server = mockttp.getLocal({
          https: { keyPath, certPath },
          cors: true,
        });
      } else {
        this.server = mockttp.getLocal();
      }

      this.server.on('request', (req: any) => {
        this.captureBuffer.push({
          type: 'request',
          id: req.id,
          method: req.method,
          url: req.url,
          headers: req.headers,
          timestamp: Date.now(),
        });
        // limit buffer
        if (this.captureBuffer.length > 5000) this.captureBuffer.shift();
      });

      this.server.on('response', (res: any) => {
        this.captureBuffer.push({
          type: 'response',
          id: res.id,
          status: res.statusCode,
          headers: res.headers,
          timestamp: Date.now(),
        });
      });

      await this.server.start(port);
      this.currentPort = port;

      return ResponseBuilder.success({
        message: `Proxy started.`,
        port: this.currentPort,
        caCertPath: useHttps ? path.join(this.caPathDir, 'ca.pem') : null,
      });
    } catch (e: any) {
      this.server = null;
      return ResponseBuilder.error(`Failed to start proxy: ${e.message}`);
    }
  }

  async handleProxyStop(_args: Record<string, unknown>) {
    if (!this.server) {
      return ResponseBuilder.error('Proxy is not running.');
    }
    await this.server.stop();
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
    if (!fs.existsSync(certPath)) {
      return ResponseBuilder.error(
        'CA certificate not found. Start the proxy with HTTPS enabled first.',
      );
    }
    const certContent = fs.readFileSync(certPath, 'utf8');
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
      let builder: any;
      if (method === 'GET') builder = this.server.forGet(new RegExp(urlPattern));
      else if (method === 'POST') builder = this.server.forPost(new RegExp(urlPattern));
      else if (method === 'PUT') builder = this.server.forPut(new RegExp(urlPattern));
      else if (method === 'DELETE') builder = this.server.forDelete(new RegExp(urlPattern));
      else builder = this.server.forAnyRequest();

      // mockttp builders are immutable-ish, we chain depending on action
      let endpoint;
      if (action === 'forward') {
        endpoint = await builder.thenForward();
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
    } catch (e: any) {
      return ResponseBuilder.error(`Failed to add rule: ${e.message}`);
    }
  }

  async handleProxyGetRequests(args: Record<string, unknown>) {
    const urlFilter = argString(args, 'urlFilter');
    let results = this.captureBuffer;
    if (urlFilter) {
      results = results.filter((r) => r.url && r.url.includes(urlFilter));
    }
    return ResponseBuilder.success({
      count: results.length,
      logs: results.slice(-100), // return last 100 max
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
    if (!fs.existsSync(certPath)) {
      return ResponseBuilder.error(
        'CA certificate not found. Start the proxy with HTTPS enabled first.',
      );
    }

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const deviceSerial = argString(args, 'deviceSerial');
    const deviceFlag = deviceSerial ? `-s ${deviceSerial}` : '';

    try {
      // 1. Verify adb is available
      await execAsync(`adb ${deviceFlag} get-state`);

      // 2. Push CA Certificate
      await execAsync(`adb ${deviceFlag} push "${certPath}" /data/local/tmp/ca.pem`);

      // 3. Reverse tether port so device can reach localhost proxy
      await execAsync(`adb ${deviceFlag} reverse tcp:${port} tcp:${port}`);

      // 4. Set global HTTP proxy on the device
      await execAsync(`adb ${deviceFlag} shell settings put global http_proxy 127.0.0.1:${port}`);

      const instructions = `ADB Configuration Applied Automatically:\n- Verified device connection.\n- Pushed CA to /data/local/tmp/ca.pem\n- Reversed forwarded tcp:${port} -> tcp:${port}\n- Set global http_proxy to 127.0.0.1:${port}\n\nNote: For HTTPS decryption, you still need to manually install the CA cert from /data/local/tmp/ca.pem in Android Settings (due to security restrictions) unless device is rooted.`;

      return ResponseBuilder.success({
        message: 'ADB device successfully configured.',
        deviceId: deviceSerial || 'default',
        instructions,
      });
    } catch (e: any) {
      return ResponseBuilder.error(`Failed to configure ADB device: ${e.message}`);
    }
  }
}
