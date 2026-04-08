import { asJsonResponse, toolErrorToResponse } from '@server/domains/shared/response';

export class ADBBridgeHandlers {
  async handleDeviceList(args: Record<string, unknown>) {
    try {
      const deviceHandlers = await import('@server/domains/adb-bridge/handlers/device');
      return asJsonResponse(await deviceHandlers.handleListDevices(args));
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleShell(args: Record<string, unknown>) {
    try {
      const deviceHandlers = await import('@server/domains/adb-bridge/handlers/device');
      return asJsonResponse(await deviceHandlers.handleShell({}, args));
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handlePullApk(args: Record<string, unknown>) {
    try {
      const apkHandlers = await import('@server/domains/adb-bridge/handlers/apk');
      return asJsonResponse(await apkHandlers.handlePullApk(args));
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleAnalyzeApk(args: Record<string, unknown>) {
    try {
      const apkHandlers = await import('@server/domains/adb-bridge/handlers/apk');
      return asJsonResponse(await apkHandlers.handleAnalyzeApk(args));
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleWebViewList(args: Record<string, unknown>) {
    try {
      const webviewHandlers = await import('@server/domains/adb-bridge/handlers/webview');
      return asJsonResponse(await webviewHandlers.handleWebViewList(args));
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleWebViewAttach(args: Record<string, unknown>) {
    try {
      const webviewHandlers = await import('@server/domains/adb-bridge/handlers/webview');
      return asJsonResponse(await webviewHandlers.handleWebViewAttach(args));
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }
}
