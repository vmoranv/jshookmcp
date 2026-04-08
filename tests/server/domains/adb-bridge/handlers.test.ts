import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolError } from '@errors/ToolError';
import { ADBBridgeHandlers } from '@server/domains/adb-bridge/handlers.impl';

describe('ADBBridgeHandlers', () => {
  let adbClient: {
    listDevices: ReturnType<typeof vi.fn>;
    shell: ReturnType<typeof vi.fn>;
    pull: ReturnType<typeof vi.fn>;
    getWebViewVersion: ReturnType<typeof vi.fn>;
  };
  let webviewDebugger: {
    listWebViews: ReturnType<typeof vi.fn>;
    attachWebView: ReturnType<typeof vi.fn>;
    executeScript: ReturnType<typeof vi.fn>;
  };
  let handlers: ADBBridgeHandlers;

  beforeEach(() => {
    adbClient = {
      listDevices: vi.fn().mockResolvedValue([{ serial: 'emulator-5554' }]),
      shell: vi.fn().mockResolvedValue('package:/data/app/base.apk'),
      pull: vi.fn().mockResolvedValue(undefined),
      getWebViewVersion: vi.fn().mockResolvedValue('120.0.0'),
    };
    webviewDebugger = {
      listWebViews: vi
        .fn()
        .mockResolvedValue([
          { id: 'target-1', url: 'https://example.com', title: 'Example', processId: 123 },
        ]),
      attachWebView: vi.fn().mockResolvedValue(undefined),
      executeScript: vi.fn().mockResolvedValue({
        title: 'Example',
        url: 'https://example.com',
        readyState: 'complete',
      }),
    };
    handlers = new ADBBridgeHandlers(adbClient as any, webviewDebugger as any);
  });

  it('lists devices through the injected ADB client', async () => {
    const result = await handlers.handleDeviceList({});
    expect(adbClient.listDevices).toHaveBeenCalledOnce();
    expect(result.isError).toBeUndefined();
  });

  it('returns tool error response when device listing fails', async () => {
    adbClient.listDevices.mockRejectedValueOnce(new ToolError('RUNTIME', 'ADB not available'));
    const result = await handlers.handleDeviceList({});
    expect(result.isError).toBe(true);
  });

  it('runs shell commands through the injected ADB client', async () => {
    const result = await handlers.handleShell({ serial: 'emulator-5554', command: 'ls' });
    expect(adbClient.shell).toHaveBeenCalledWith('emulator-5554', 'ls');
    expect(result.isError).toBeUndefined();
  });

  it('pulls an apk using the resolved remote package path', async () => {
    const result = await handlers.handlePullApk({
      serial: 'emulator-5554',
      packageName: 'com.example.app',
    });
    expect(adbClient.pull).toHaveBeenCalledWith(
      'emulator-5554',
      '/data/app/base.apk',
      '/tmp/com.example.app.apk',
    );
    expect(result.isError).toBeUndefined();
  });

  it('analyzes apk metadata from dumpsys output', async () => {
    adbClient.shell.mockResolvedValueOnce(
      [
        'versionName=1.0.0',
        'versionCode=42',
        'minSdk=24',
        'targetSdk=34',
        'requested permissions:',
        '  android.permission.INTERNET granted=true',
      ].join('\n'),
    );
    const result = await handlers.handleAnalyzeApk({
      serial: 'emulator-5554',
      packageName: 'com.example.app',
    });
    expect(result.isError).toBeUndefined();
  });

  it('lists webviews through the injected debugger', async () => {
    const result = await handlers.handleWebViewList({ serial: 'emulator-5554' });
    expect(webviewDebugger.listWebViews).toHaveBeenCalledWith('emulator-5554');
    expect(result.isError).toBeUndefined();
  });

  it('attaches to a webview through the injected debugger', async () => {
    const result = await handlers.handleWebViewAttach({
      serial: 'emulator-5554',
      targetId: 'target-1',
    });
    expect(webviewDebugger.attachWebView).toHaveBeenCalledWith('emulator-5554', 'target-1');
    expect(webviewDebugger.executeScript).toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
  });
});
