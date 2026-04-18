import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebViewDebugger } from '@modules/adb/WebViewDebugger';
import { ToolError } from '@errors/ToolError';

class MockWebSocket {
  url: string;
  onopen: any;
  onmessage: any;
  onerror: any;
  listeners: Record<string, any[]> = {};

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.listeners['open']?.forEach((cb) => cb());
    }, 10);
  }

  addEventListener(event: string, cb: any) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  send(_data: string) {
    setTimeout(() => {
      this.listeners['message']?.forEach((cb) =>
        cb({
          data: JSON.stringify({
            id: 1,
            result: { result: { value: 'mocked_result' } },
          }),
        }),
      );
    }, 10);
  }

  close() {}
}

// @ts-ignore
globalThis.WebSocket = MockWebSocket;

const mockAdbClient = {
  shell: vi.fn(),
  forward: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('node:net', () => ({
  createServer: vi.fn(() => ({
    once: vi.fn(),
    listen: vi.fn((_port, _host, cb) => cb()),
    address: vi.fn(() => ({ port: 12345 })),
    close: vi.fn((cb) => cb && cb()),
  })),
}));

globalThis.fetch = vi.fn() as any;

describe('WebViewDebugger', () => {
  let debuggerInstance: WebViewDebugger;

  beforeEach(() => {
    vi.clearAllMocks();
    debuggerInstance = new WebViewDebugger(mockAdbClient as any);
  });

  it('lists webviews correctly', async () => {
    mockAdbClient.shell.mockResolvedValueOnce(
      '@webview_devtools_remote_12345\n@chrome_devtools_remote\n@com.example.app_devtools_remote',
    );
    mockAdbClient.shell.mockResolvedValueOnce('12345 '); // pidof

    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'target1',
          title: 'Test Page',
          url: 'http://example.com',
          type: 'page',
          webSocketDebuggerUrl: 'ws://localhost:12345/devtools/page/target1',
        },
      ],
    });

    const webviews = await debuggerInstance.listWebViews('device_id');
    expect(webviews).toHaveLength(2);
    expect(mockAdbClient.forward).toHaveBeenCalledTimes(2);
  });

  it('executes script via CDP', async () => {
    mockAdbClient.shell.mockResolvedValueOnce('@webview_devtools_remote_12345');
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'target1',
          title: 'Test Page',
          url: 'http://example.com',
          type: 'page',
          webSocketDebuggerUrl: 'ws://localhost:12345/devtools/page/target1',
        },
      ],
    });

    const result = await debuggerInstance.executeScript(
      'device_id',
      'webview_devtools_remote_12345',
      '1 + 1',
    );
    expect(result).toBe('mocked_result');
  });

  it('handles missing websocket endpoints and fetch failures', async () => {
    mockAdbClient.shell.mockResolvedValueOnce('@webview_devtools_remote_12345');
    (globalThis.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(debuggerInstance.listWebViews('device_id')).resolves.toHaveLength(1); // falls back to empty

    mockAdbClient.shell.mockResolvedValueOnce('@webview_devtools_remote_12345');
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    await expect(
      debuggerInstance.executeScript('device_id', 'webview_devtools_remote_12345', '1+1'),
    ).rejects.toThrow(ToolError);
  });
});
