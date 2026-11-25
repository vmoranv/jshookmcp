import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebViewDebugger } from '@modules/adb/WebViewDebugger';
import { ToolError } from '@errors/ToolError';
import { TEST_HTTP_URLS } from '@tests/shared/test-urls';

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
  removeForward: vi.fn(),
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
    mockAdbClient.shell.mockReset();
    mockAdbClient.forward.mockReset();
    mockAdbClient.forward.mockResolvedValue(undefined);
    mockAdbClient.removeForward.mockReset();
    mockAdbClient.removeForward.mockResolvedValue(undefined);
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
          url: TEST_HTTP_URLS.root,
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
          url: TEST_HTTP_URLS.root,
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

  it('deduplicates concurrent forwards for the same webview', async () => {
    mockAdbClient.shell.mockResolvedValue('@webview_devtools_remote_12345\n');
    let releaseForward!: () => void;
    mockAdbClient.forward.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseForward = resolve;
        }),
    );
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'target1',
          title: 'Test Page',
          url: TEST_HTTP_URLS.root,
          type: 'page',
          webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/page/target1',
        },
      ],
    });

    const first = debuggerInstance.listWebViews('device_id');
    const second = debuggerInstance.listWebViews('device_id');
    await vi.waitFor(() => expect(mockAdbClient.forward).toHaveBeenCalled());
    releaseForward();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(mockAdbClient.forward).toHaveBeenCalledTimes(1);
    expect(firstResult).toHaveLength(1);
    expect(secondResult).toHaveLength(1);
  });

  it('retries a failed forward instead of caching the failure', async () => {
    mockAdbClient.shell.mockResolvedValue('@webview_devtools_remote_12345\n');
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'target1',
          title: 'Test Page',
          url: TEST_HTTP_URLS.root,
          type: 'page',
          webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/page/target1',
        },
      ],
    });
    mockAdbClient.forward.mockRejectedValueOnce(new Error('device offline'));

    const failed = await debuggerInstance.listWebViews('device_id');
    expect(failed[0]?.url).toBe('');

    await debuggerInstance.listWebViews('device_id');
    expect(mockAdbClient.forward).toHaveBeenCalledTimes(2);
  });

  it('removes the forward when the target fetch fails', async () => {
    mockAdbClient.shell.mockResolvedValue('@webview_devtools_remote_12345\n');
    (globalThis.fetch as any).mockResolvedValue({ ok: false, status: 503 });

    await debuggerInstance.listWebViews('device_id');

    expect(mockAdbClient.removeForward).toHaveBeenCalledWith('device_id', 'tcp:12345');
  });

  it('quotes the package name derived from a socket before pidof', async () => {
    mockAdbClient.shell.mockResolvedValue('@com.example.app_devtools_remote\n');
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'target1',
          title: 'Test Page',
          url: TEST_HTTP_URLS.root,
          type: 'page',
          webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/page/target1',
        },
      ],
    });

    await debuggerInstance.listWebViews('device_id');

    expect(mockAdbClient.shell).toHaveBeenCalledWith('device_id', "pidof -s 'com.example.app'");
  });

  it('never interpolates an untrusted socket-derived package into a shell command', async () => {
    mockAdbClient.shell.mockResolvedValue('@com.example.app;reboot_devtools_remote\n');
    (globalThis.fetch as any).mockResolvedValue({ ok: false, status: 503 });

    const webviews = await debuggerInstance.listWebViews('device_id');

    expect(webviews[0]?.processId).toBe(0);
    for (const call of mockAdbClient.shell.mock.calls) {
      expect(String(call[1])).not.toContain('pidof');
    }
  });
});
