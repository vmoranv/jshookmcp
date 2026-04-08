import { ToolError } from '@errors/ToolError';
import { ADBClient, WebViewDebugger } from '@modules/adb';
import {
  argNumber,
  argString,
  argStringRequired,
} from '@server/domains/shared/parse-args';
import { asJsonResponse, toolErrorToResponse } from '@server/domains/shared/response';
import type { ToolResponse } from '@server/types';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function readPackagePath(output: string): string | null {
  const packagePaths: string[] = [];

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('package:')) {
      continue;
    }

    const candidate = trimmed.slice('package:'.length);
    if (candidate.length > 0) {
      packagePaths.push(candidate);
    }
  }

  if (packagePaths.length === 0) {
    return null;
  }

  return packagePaths.find((path) => path.endsWith('/base.apk')) ?? packagePaths[0] ?? null;
}

export class ADBBridgeHandlers {
  constructor(
    private adbClient?: ADBClient,
    private webviewDbg?: WebViewDebugger,
  ) {}

  private getADBClient(): ADBClient {
    if (!this.adbClient) {
      this.adbClient = new ADBClient();
    }

    return this.adbClient;
  }

  private getWebViewDebugger(): WebViewDebugger {
    if (!this.webviewDbg) {
      this.webviewDbg = new WebViewDebugger(this.getADBClient());
    }

    return this.webviewDbg;
  }

  private async run(
    _toolName: string,
    action: () => Promise<unknown>,
  ): Promise<ToolResponse> {
    try {
      return asJsonResponse(await action());
    } catch (error) {
      if (error instanceof ToolError) {
        return toolErrorToResponse(error);
      }

      return toolErrorToResponse(
        new ToolError('RUNTIME', getErrorMessage(error), {
          toolName: _toolName,
        }),
      );
    }
  }

  async handleDeviceList(_args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_device_list', async () => ({
      success: true,
      devices: await this.getADBClient().listDevices(),
    }));
  }

  async handleShell(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_shell', async () => {
      const serial = argStringRequired(args, 'serial');
      const command = argStringRequired(args, 'command');

      return {
        success: true,
        serial,
        command,
        output: await this.getADBClient().shell(serial, command),
      };
    });
  }

  async handlePullApk(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_apk_pull', async () => {
      const serial = argStringRequired(args, 'serial');
      const packageName = argStringRequired(args, 'packageName');
      const outputPath = argString(args, 'outputPath') ?? `/tmp/${packageName}.apk`;

      const remotePathOutput = await this.getADBClient().shell(serial, `pm path ${packageName}`);
      const remotePath = readPackagePath(remotePathOutput);

      if (!remotePath) {
        throw new ToolError(
          'NOT_FOUND',
          `Package ${packageName} was not found on device ${serial}.`,
          {
            toolName: 'adb_apk_pull',
          },
        );
      }

      await this.getADBClient().pull(serial, remotePath, outputPath);

      return {
        success: true,
        serial,
        packageName,
        remotePath,
        outputPath,
      };
    });
  }

  async handleAnalyzeApk(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_apk_analyze', async () => {
      const serial = argStringRequired(args, 'serial');
      const packageName = argStringRequired(args, 'packageName');

      const output = await this.getADBClient().shell(serial, `dumpsys package ${packageName}`);

      const info: Record<string, unknown> = { packageName };

      const versionNameMatch = output.match(/versionName=([^\s]+)/);
      if (versionNameMatch) info.versionName = versionNameMatch[1];

      const versionCodeMatch = output.match(/versionCode=(\d+)/);
      if (versionCodeMatch) info.versionCode = versionCodeMatch[1];

      const minSdkMatch = output.match(/minSdk=(\d+)/);
      if (minSdkMatch) info.minSdk = minSdkMatch[1];

      const targetSdkMatch = output.match(/targetSdk=(\d+)/);
      if (targetSdkMatch) info.targetSdk = targetSdkMatch[1];

      const permissions: string[] = [];
      const activities: string[] = [];
      const services: string[] = [];
      const receivers: string[] = [];

      let currentSection = '';
      for (const line of output.split(/\r?\n/)) {
        if (line.includes('requested permissions:') || line.includes('install permissions:')) {
          currentSection = 'permissions';
          continue;
        }
        if (line.includes('Activity Resolver Table') || line.includes('activities:')) {
          currentSection = 'activities';
          continue;
        }
        if (line.includes('Service Resolver Table') || line.includes('services:')) {
          currentSection = 'services';
          continue;
        }
        if (line.includes('Receiver Resolver Table') || line.includes('receivers:')) {
          currentSection = 'receivers';
          continue;
        }

        const trimmed = line.trim();
        if (trimmed.startsWith('android.permission.') || trimmed.startsWith('com.')) {
          const perm = trimmed.split(' ')[0];
          if (perm) {
            if (currentSection === 'permissions') {
              permissions.push(perm);
            } else if (!currentSection) {
              permissions.push(perm);
            }
          }
        }

        if (currentSection === 'activities' && trimmed.includes(packageName)) {
          const activityMatch = trimmed.match(/(\S+)/);
          if (activityMatch) activities.push(activityMatch[1] as string);
        }
        if (currentSection === 'services' && trimmed.includes(packageName)) {
          const serviceMatch = trimmed.match(/(\S+)/);
          if (serviceMatch) services.push(serviceMatch[1] as string);
        }
        if (currentSection === 'receivers' && trimmed.includes(packageName)) {
          const receiverMatch = trimmed.match(/(\S+)/);
          if (receiverMatch) receivers.push(receiverMatch[1] as string);
        }
      }

      info.permissions = [...new Set(permissions)];
      info.activities = [...new Set(activities)];
      info.services = [...new Set(services)];
      info.receivers = [...new Set(receivers)];

      return {
        success: true,
        serial,
        ...info,
      };
    });
  }

  async handleWebViewList(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_webview_list', async () => {
      const serial = argStringRequired(args, 'serial');
      const hostPort = argNumber(args, 'hostPort') ?? 9222;

      const webviewVersion = await this.getADBClient().getWebViewVersion(serial);
      const webviews = await this.getWebViewDebugger().listWebViews(serial);

      return {
        success: true,
        serial,
        webViewVersion: webviewVersion,
        hostPort,
        webviews: webviews.map((wv) => ({
          id: wv.id,
          url: wv.url,
          title: wv.title,
          processId: wv.processId,
        })),
      };
    });
  }

  async handleWebViewAttach(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_webview_attach', async () => {
      const serial = argStringRequired(args, 'serial');
      const targetId = argStringRequired(args, 'targetId');
      const hostPort = argNumber(args, 'hostPort') ?? 9222;

      await this.getWebViewDebugger().attachWebView(serial, targetId);
      const snapshot = await this.getWebViewDebugger().executeScript(
        serial,
        targetId,
        '(() => ({ title: document.title, url: location.href, readyState: document.readyState }))()',
      );

      return {
        success: true,
        serial,
        targetId,
        hostPort,
        attached: true,
        snapshot,
      };
    });
  }
}
