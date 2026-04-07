import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  device: {
    handleListDevices: vi.fn(async () => ({ deviceCount: 2, devices: [] })),
    handleShell: vi.fn(async () => ({ stdout: 'ok', exitCode: 0 })),
  },
  apk: {
    handlePullApk: vi.fn(async () => ({
      apkPath: '/tmp/test.apk',
      packageName: 'com.example.app',
    })),
    handleAnalyzeApk: vi.fn(async () => ({
      packageName: 'com.example.app',
      versionName: '1.0.0',
      permissions: ['android.permission.INTERNET'],
    })),
  },
  webview: {
    handleWebViewList: vi.fn(async () => ({ targetCount: 1, targets: [] })),
    handleWebViewAttach: vi.fn(async () => ({
      targetId: 'target-1',
      webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/target-1',
    })),
  },
}));

vi.mock('@server/domains/adb-bridge/handlers/device', () => ({
  handleListDevices: mocks.device.handleListDevices,
  handleShell: mocks.device.handleShell,
}));

vi.mock('@server/domains/adb-bridge/handlers/apk', () => ({
  handlePullApk: mocks.apk.handlePullApk,
  handleAnalyzeApk: mocks.apk.handleAnalyzeApk,
}));

vi.mock('@server/domains/adb-bridge/handlers/webview', () => ({
  handleWebViewList: mocks.webview.handleWebViewList,
  handleWebViewAttach: mocks.webview.handleWebViewAttach,
}));

import { ADBBridgeHandlers } from '@server/domains/adb-bridge/handlers/impl';

describe('ADBBridgeHandlers', () => {
  let handlers: ADBBridgeHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new ADBBridgeHandlers();
  });

  describe('handleDeviceList', () => {
    it('delegates to handleListDevices and returns json response', async () => {
      const result = await handlers.handleDeviceList({});
      expect(mocks.device.handleListDevices).toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
      expect(Array.isArray(result.content)).toBe(true);
    });

    it('handles errors and returns error response', async () => {
      mocks.device.handleListDevices.mockRejectedValueOnce(new Error('ADB not available'));
      const result = await handlers.handleDeviceList({});
      expect(result.isError).toBe(true);
    });
  });

  describe('handleShell', () => {
    it('delegates to handleShell and returns json response', async () => {
      const result = await handlers.handleShell({ serial: 'emulator-5554', command: 'ls' });
      expect(mocks.device.handleShell).toHaveBeenCalledWith(expect.anything(), {
        serial: 'emulator-5554',
        command: 'ls',
      });
      expect(result.isError).toBeUndefined();
    });

    it('handles errors and returns error response', async () => {
      mocks.device.handleShell.mockRejectedValueOnce(new Error('Shell failed'));
      const result = await handlers.handleShell({ serial: 'emulator-5554', command: 'ls' });
      expect(result.isError).toBe(true);
    });
  });

  describe('handlePullApk', () => {
    it('delegates to handlePullApk and returns response', async () => {
      const result = await handlers.handlePullApk({
        serial: 'emulator-5554',
        packageName: 'com.example.app',
      });
      expect(mocks.apk.handlePullApk).toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
    });

    it('handles errors and returns error response', async () => {
      mocks.apk.handlePullApk.mockRejectedValueOnce(new Error('Pull failed'));
      const result = await handlers.handlePullApk({
        serial: 'emulator-5554',
        packageName: 'com.example.app',
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleAnalyzeApk', () => {
    it('delegates to handleAnalyzeApk and returns response', async () => {
      const result = await handlers.handleAnalyzeApk({
        serial: 'emulator-5554',
        packageName: 'com.example.app',
      });
      expect(mocks.apk.handleAnalyzeApk).toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
    });

    it('handles errors and returns error response', async () => {
      mocks.apk.handleAnalyzeApk.mockRejectedValueOnce(new Error('Analyze failed'));
      const result = await handlers.handleAnalyzeApk({
        serial: 'emulator-5554',
        packageName: 'com.example.app',
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleWebViewList', () => {
    it('delegates to handleWebViewList and returns response', async () => {
      const result = await handlers.handleWebViewList({ serial: 'emulator-5554' });
      expect(mocks.webview.handleWebViewList).toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
    });

    it('handles errors and returns error response', async () => {
      mocks.webview.handleWebViewList.mockRejectedValueOnce(new Error('WebView list failed'));
      const result = await handlers.handleWebViewList({ serial: 'emulator-5554' });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleWebViewAttach', () => {
    it('delegates to handleWebViewAttach and returns response', async () => {
      const result = await handlers.handleWebViewAttach({
        serial: 'emulator-5554',
        targetId: 'target-1',
      });
      expect(mocks.webview.handleWebViewAttach).toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
    });

    it('handles errors and returns error response', async () => {
      mocks.webview.handleWebViewAttach.mockRejectedValueOnce(new Error('WebView attach failed'));
      const result = await handlers.handleWebViewAttach({
        serial: 'emulator-5554',
        targetId: 'target-1',
      });
      expect(result.isError).toBe(true);
    });
  });
});
