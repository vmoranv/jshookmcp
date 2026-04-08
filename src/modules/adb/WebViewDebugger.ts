import { createServer } from 'node:net';
import { ToolError } from '@errors/ToolError';
import { ADBClient } from './ADBClient';

interface DevToolsTargetInfo {
  id: string;
  title: string;
  url: string;
  type?: string;
  webSocketDebuggerUrl?: string;
}

export interface WebViewInfo {
  id: string;
  url: string;
  title: string;
  processId: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readCapture(match: RegExpMatchArray | null, index: number): string | null {
  if (!match) {
    return null;
  }

  const value = match[index];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isDevToolsTargetInfo(value: unknown): value is DevToolsTargetInfo {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' && typeof value.title === 'string' && typeof value.url === 'string'
  );
}

function normalizeSocketName(socketName: string): string {
  return socketName.startsWith('@') ? socketName.slice(1) : socketName;
}

export class WebViewDebugger {
  private readonly forwardedPorts = new Map<string, number>();

  constructor(private readonly adbClient: ADBClient = new ADBClient()) {}

  private getPortKey(deviceId: string, webviewId: string): string {
    return `${deviceId}:${webviewId}`;
  }

  private async getFreePort(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = createServer();

      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();

        if (!address || typeof address === 'string') {
          server.close();
          reject(
            new ToolError('RUNTIME', 'Failed to allocate a local TCP port for WebView debugging.'),
          );
          return;
        }

        const { port } = address;
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(port);
        });
      });
    });
  }

  private async discoverSockets(deviceId: string): Promise<string[]> {
    const unixSockets = await this.adbClient.shell(deviceId, 'cat /proc/net/unix');
    const sockets = new Set<string>();

    for (const line of unixSockets.split(/\r?\n/)) {
      const socketName = readCapture(line.match(/(@[^\s]*devtools_remote[^\s]*)$/), 1);
      if (!socketName) {
        continue;
      }

      const normalized = normalizeSocketName(socketName);
      if (normalized === 'chrome_devtools_remote') {
        continue;
      }

      sockets.add(normalized);
    }

    return [...sockets];
  }

  private async ensureForward(deviceId: string, webviewId: string): Promise<number> {
    const key = this.getPortKey(deviceId, webviewId);
    const existingPort = this.forwardedPorts.get(key);
    if (typeof existingPort === 'number') {
      return existingPort;
    }

    const port = await this.getFreePort();
    await this.adbClient.forward(deviceId, `tcp:${port}`, `localabstract:${webviewId}`);
    this.forwardedPorts.set(key, port);
    return port;
  }

  private async fetchTargets(port: number): Promise<DevToolsTargetInfo[]> {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new ToolError(
        'CONNECTION',
        `Failed to fetch WebView target list on forwarded port ${port}.`,
        {
          toolName: 'adb_webview',
          details: {
            status: response.status,
          },
        },
      );
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new ToolError(
        'RUNTIME',
        'Unexpected WebView target payload. Expected an array response.',
        {
          toolName: 'adb_webview',
        },
      );
    }

    return payload.filter(isDevToolsTargetInfo);
  }

  private async resolveProcessId(deviceId: string, webviewId: string): Promise<number> {
    const embeddedPid = readCapture(webviewId.match(/(?:webview_)?devtools_remote_(\d+)/), 1);
    if (embeddedPid) {
      const parsed = Number.parseInt(embeddedPid, 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    const packageName = readCapture(webviewId.match(/^(.*)_devtools_remote$/), 1);
    if (!packageName) {
      return 0;
    }

    try {
      const output = await this.adbClient.shell(deviceId, `pidof -s ${packageName}`);
      const pidValue = output.split(/\s+/)[0];
      if (typeof pidValue !== 'string') {
        return 0;
      }

      const parsed = Number.parseInt(pidValue, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    } catch {
      return 0;
    }
  }

  private async getPrimaryTarget(deviceId: string, webviewId: string): Promise<DevToolsTargetInfo> {
    const port = await this.ensureForward(deviceId, webviewId);
    const targets = await this.fetchTargets(port);
    const primaryTarget = targets.find((target) => target.type === 'page') ?? targets[0];

    if (!primaryTarget) {
      throw new ToolError('NOT_FOUND', `No debuggable targets found for WebView ${webviewId}.`, {
        toolName: 'adb_webview',
        details: {
          deviceId,
          webviewId,
        },
      });
    }

    return primaryTarget;
  }

  private async evaluateViaCdp(wsUrl: string, script: string): Promise<unknown> {
    const WebSocketClass = globalThis.WebSocket;
    if (!WebSocketClass) {
      throw new ToolError(
        'PREREQUISITE',
        'WebSocket API is not available in this Node runtime. Use Node.js 22+ to debug Android WebViews.',
        {
          toolName: 'adb_webview',
        },
      );
    }

    return new Promise<unknown>((resolve, reject) => {
      const socket = new WebSocketClass(wsUrl);
      const timeout = setTimeout(() => {
        socket.close();
        reject(
          new ToolError(
            'TIMEOUT',
            'Timed out while evaluating script inside the Android WebView.',
            {
              toolName: 'adb_webview',
            },
          ),
        );
      }, 10_000);

      const finish = (callback: () => void) => {
        clearTimeout(timeout);
        callback();
        socket.close();
      };

      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
              expression: script,
              returnByValue: true,
              awaitPromise: true,
            },
          }),
        );
      });

      socket.addEventListener('message', (event: MessageEvent) => {
        let payload: unknown;

        try {
          payload = JSON.parse(String(event.data));
        } catch (error) {
          finish(() => {
            reject(
              new ToolError('RUNTIME', `Failed to parse WebView CDP response: ${String(error)}`, {
                toolName: 'adb_webview',
              }),
            );
          });
          return;
        }

        if (!isRecord(payload) || payload.id !== 1) {
          return;
        }

        if (isRecord(payload.error)) {
          const message = getStringValue(payload.error.message) ?? 'Unknown CDP error';
          finish(() => {
            reject(
              new ToolError('RUNTIME', message, {
                toolName: 'adb_webview',
              }),
            );
          });
          return;
        }

        if (!isRecord(payload.result)) {
          finish(() => {
            resolve(null);
          });
          return;
        }

        if (isRecord(payload.result.exceptionDetails)) {
          const text =
            getStringValue(payload.result.exceptionDetails.text) ??
            getStringValue(payload.result.exceptionDetails.description) ??
            'Script execution failed inside the Android WebView.';

          finish(() => {
            reject(
              new ToolError('RUNTIME', text, {
                toolName: 'adb_webview',
              }),
            );
          });
          return;
        }

        if (!isRecord(payload.result.result)) {
          finish(() => {
            resolve(null);
          });
          return;
        }

        const runtimeResult = payload.result.result;
        if ('value' in runtimeResult) {
          finish(() => {
            resolve(runtimeResult.value);
          });
          return;
        }

        const description = getStringValue(runtimeResult.description);
        finish(() => {
          resolve(description);
        });
      });

      socket.addEventListener('error', () => {
        finish(() => {
          reject(
            new ToolError(
              'CONNECTION',
              'WebView DevTools socket reported an error while executing script.',
              {
                toolName: 'adb_webview',
              },
            ),
          );
        });
      });
    });
  }

  async listWebViews(deviceId: string): Promise<WebViewInfo[]> {
    const sockets = await this.discoverSockets(deviceId);
    const webviews: WebViewInfo[] = [];

    for (const socketName of sockets) {
      try {
        const target = await this.getPrimaryTarget(deviceId, socketName);
        webviews.push({
          id: socketName,
          url: target.url,
          title: target.title,
          processId: await this.resolveProcessId(deviceId, socketName),
        });
      } catch {
        webviews.push({
          id: socketName,
          url: '',
          title: '',
          processId: await this.resolveProcessId(deviceId, socketName),
        });
      }
    }

    return webviews;
  }

  async attachWebView(deviceId: string, webviewId: string): Promise<void> {
    const availableSockets = await this.discoverSockets(deviceId);
    if (!availableSockets.includes(webviewId)) {
      throw new ToolError(
        'NOT_FOUND',
        `WebView ${webviewId} was not found on device ${deviceId}.`,
        {
          toolName: 'adb_webview',
        },
      );
    }

    await this.getPrimaryTarget(deviceId, webviewId);
  }

  async executeScript(deviceId: string, webviewId: string, script: string): Promise<unknown> {
    await this.attachWebView(deviceId, webviewId);
    const target = await this.getPrimaryTarget(deviceId, webviewId);

    if (
      typeof target.webSocketDebuggerUrl !== 'string' ||
      target.webSocketDebuggerUrl.length === 0
    ) {
      throw new ToolError(
        'CONNECTION',
        `WebView ${webviewId} does not expose a WebSocket debugger endpoint.`,
        {
          toolName: 'adb_webview',
        },
      );
    }

    return this.evaluateViaCdp(target.webSocketDebuggerUrl, script);
  }
}
