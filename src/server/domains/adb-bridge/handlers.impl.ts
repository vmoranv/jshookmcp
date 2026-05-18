import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ToolError } from '@errors/ToolError';
import { probeCommand } from '@modules/external/ToolProbe';
import {
  argString,
  argStringRequired,
  argNumber,
  argBool,
} from '@server/domains/shared/parse-args';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolResponse } from '@server/types';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function serialArgs(serial: string): string[] {
  return serial ? ['-s', serial] : [];
}

async function execAdb(adb: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(adb, args, { encoding: 'utf8', windowsHide: true }, (err, out, errOut) => {
      if (err) reject(err);
      else resolve({ stdout: out ?? '', stderr: errOut ?? '' });
    });
  });
}

/** Discover WebView devtools sockets on device via /proc/net/unix. */
async function discoverWebviewSockets(adb: string, serial: string): Promise<string[]> {
  const { stdout } = await execAdb(adb, [...serialArgs(serial), 'shell', 'cat /proc/net/unix']);
  const sockets: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.includes('@webview_devtools_remote')) {
      const match = trimmed.match(/@webview_devtools_remote\S+/);
      if (match) sockets.push(match[0]);
    }
  }
  return sockets;
}

function normalizeRemoteDir(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function parseNativeLibraryDirs(
  stdout: string,
  packageName: string,
  includeSystemLibs: boolean,
): string[] {
  const dirs = new Set<string>();
  const matchers = [
    /nativeLibraryDir=([^\s]+)/g,
    /legacyNativeLibraryDir=([^\s]+)/g,
    /secondaryNativeLibraryDir=([^\s]+)/g,
  ];

  for (const matcher of matchers) {
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(stdout)) !== null) {
      const dir = normalizeRemoteDir(match[1] ?? '');
      if (!dir) continue;
      if (!includeSystemLibs && !dir.includes(packageName)) continue;
      dirs.add(dir);
    }
  }

  return [...dirs];
}

export class ADBBridgeHandlers {
  private cachedAdb?: string;

  private async resolveAdb(): Promise<string> {
    if (this.cachedAdb) return this.cachedAdb;
    const probe = await probeCommand('adb');
    if (!probe.available) {
      throw new ToolError(
        'PREREQUISITE',
        probe.reason ?? 'adb not found in PATH. Install Android Platform Tools.',
        { toolName: 'adb-bridge' },
      );
    }
    this.cachedAdb = probe.path ?? 'adb';
    return this.cachedAdb;
  }

  private async run(_toolName: string, action: () => Promise<unknown>): Promise<ToolResponse> {
    try {
      return asJsonResponse(await action());
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw new ToolError('RUNTIME', getErrorMessage(error), { toolName: _toolName });
    }
  }

  async handleDeviceList(_args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_device_list', async () => {
      const adb = await this.resolveAdb();
      const { stdout } = await execAdb(adb, ['devices', '-l']);

      const devices: Array<Record<string, string>> = [];
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('List of devices')) continue;
        const parts = trimmed.split(/\s+/);
        const serial = parts[0];
        if (!serial) continue;

        const meta: Record<string, string> = {};
        for (let i = 2; i < parts.length; i++) {
          const part = parts[i];
          if (!part) continue;
          const colonIdx = part.indexOf(':');
          if (colonIdx > 0) {
            const k = part.slice(0, colonIdx);
            const v = part.slice(colonIdx + 1);
            if (k && v) meta[k] = v;
          }
        }
        devices.push({
          serial,
          state: parts[1] ?? '',
          model: meta['model'] ?? '',
          product: meta['product'] ?? '',
        });
      }
      return { success: true, count: devices.length, devices };
    });
  }

  async handleShell(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_shell', async () => {
      const serial = argStringRequired(args, 'serial');
      const command = argStringRequired(args, 'command');
      const adb = await this.resolveAdb();
      const { stdout, stderr } = await execAdb(adb, [...serialArgs(serial), 'shell', command]);
      return { success: true, serial, command, stdout, stderr: stderr || '' };
    });
  }

  async handleApkPull(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_apk_pull', async () => {
      const serial = argStringRequired(args, 'serial');
      const packageName = argString(args, 'packageName');
      const outputPath = argString(args, 'outputPath') ?? '.';
      if (!packageName) return { success: false, error: 'packageName is required' };

      const adb = await this.resolveAdb();
      const { stdout: pathOut } = await execAdb(adb, [
        ...serialArgs(serial),
        'shell',
        `pm path ${packageName}`,
      ]);
      const match = pathOut.match(/package:([\w./]+)/);
      const remotePath = match?.[1];
      if (!remotePath) {
        return { success: false, error: `APK not found for ${packageName}`, raw: pathOut };
      }

      const destPath = join(outputPath, `${packageName}.apk`).replace(/\\/g, '/');
      await execAdb(adb, [...serialArgs(serial), 'pull', remotePath, destPath]);
      return { success: true, serial, packageName, remotePath, localPath: destPath };
    });
  }

  async handleAnalyzeApk(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_apk_analyze', async () => {
      const serial = argStringRequired(args, 'serial');
      const packageName = argStringRequired(args, 'packageName');
      const adb = await this.resolveAdb();
      const { stdout } = await execAdb(adb, [
        ...serialArgs(serial),
        'shell',
        `dumpsys package ${packageName}`,
      ]);

      const info: Record<string, unknown> = { packageName };

      const versionNameMatch = stdout.match(/versionName=([^\s]+)/);
      if (versionNameMatch?.[1]) info.versionName = versionNameMatch[1];
      const versionCodeMatch = stdout.match(/versionCode=(\d+)/);
      if (versionCodeMatch?.[1]) info.versionCode = versionCodeMatch[1];
      const minSdkMatch = stdout.match(/minSdk=(\d+)/);
      if (minSdkMatch?.[1]) info.minSdk = minSdkMatch[1];
      const targetSdkMatch = stdout.match(/targetSdk=(\d+)/);
      if (targetSdkMatch?.[1]) info.targetSdk = targetSdkMatch[1];

      const permissions: string[] = [];
      const activities: string[] = [];
      const services: string[] = [];
      const receivers: string[] = [];
      let currentSection = '';

      for (const line of stdout.split(/\r?\n/)) {
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
        const firstToken = trimmed.split(' ')[0];

        if (currentSection === 'permissions') {
          if (firstToken && trimmed.startsWith('android.permission.')) {
            permissions.push(firstToken);
          }
        } else if (currentSection === 'activities' && trimmed.includes(packageName)) {
          if (firstToken) activities.push(firstToken);
        } else if (currentSection === 'services' && trimmed.includes(packageName)) {
          if (firstToken) services.push(firstToken);
        } else if (currentSection === 'receivers' && trimmed.includes(packageName)) {
          if (firstToken) receivers.push(firstToken);
        }
      }

      info.permissions = [...new Set(permissions)];
      info.activities = [...new Set(activities)];
      info.services = [...new Set(services)];
      info.receivers = [...new Set(receivers)];
      return { success: true, serial, ...info };
    });
  }

  async handlePullNativeLibs(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_pull_native_libs', async () => {
      const serial = argStringRequired(args, 'serial');
      const packageName = argStringRequired(args, 'packageName');
      const outputPath = argString(args, 'outputPath') ?? '.';
      const includeSystemLibs = argBool(args, 'includeSystemLibs') ?? false;
      const adb = await this.resolveAdb();

      const { stdout } = await execAdb(adb, [
        ...serialArgs(serial),
        'shell',
        `dumpsys package ${packageName}`,
      ]);
      const remoteDirs = parseNativeLibraryDirs(stdout, packageName, includeSystemLibs);
      if (remoteDirs.length === 0) {
        return {
          success: false,
          serial,
          packageName,
          error: `No native library directories found for ${packageName}`,
        };
      }

      const baseOutputDir = join(outputPath, `${packageName}-native-libs`).replace(/\\/g, '/');
      await mkdir(baseOutputDir, { recursive: true });

      const pulled: Array<{ remoteDir: string; localPath: string }> = [];
      for (const remoteDir of remoteDirs) {
        const lastSegment = remoteDir.split('/').filter(Boolean).pop() ?? 'lib';
        const localPath = join(baseOutputDir, lastSegment).replace(/\\/g, '/');
        await mkdir(localPath, { recursive: true });
        await execAdb(adb, [...serialArgs(serial), 'pull', remoteDir, localPath]);
        pulled.push({ remoteDir, localPath });
      }

      return {
        success: true,
        serial,
        packageName,
        includeSystemLibs,
        count: pulled.length,
        outputPath: baseOutputDir,
        libraries: pulled,
      };
    });
  }

  async handleWebViewList(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_webview_list', async () => {
      const serial = argStringRequired(args, 'serial');
      const hostPort = argNumber(args, 'hostPort') ?? 9222;
      const adb = await this.resolveAdb();

      const sockets = await discoverWebviewSockets(adb, serial);
      if (sockets.length === 0) {
        return { success: true, serial, hostPort, webviews: [], count: 0 };
      }

      // Forward the first discovered socket
      const targetSocket = sockets[0]!;
      await execAdb(adb, [
        ...serialArgs(serial),
        'forward',
        `tcp:${hostPort}`,
        `localabstract:${targetSocket}`,
      ]);

      const http = await import('node:http');
      const targets = await new Promise<
        Array<{ id: string; title: string; url: string; webSocketDebuggerUrl: string }>
      >((resolve) => {
        http
          .get(`http://localhost:${hostPort}/json/list`, (res) => {
            let body = '';
            res.on('data', (chunk) => {
              body += chunk;
            });
            res.on('end', () => {
              try {
                resolve(JSON.parse(body));
              } catch {
                resolve([]);
              }
            });
          })
          .on('error', () => resolve([]));
      });

      return {
        success: true,
        serial,
        hostPort,
        webviews: targets.map((t) => ({
          id: t.id,
          url: t.url,
          title: t.title,
          webSocketDebuggerUrl: t.webSocketDebuggerUrl,
        })),
        count: targets.length,
      };
    });
  }

  async handleWebViewAttach(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_webview_attach', async () => {
      const serial = argStringRequired(args, 'serial');
      const targetId = argStringRequired(args, 'targetId');
      const hostPort = argNumber(args, 'hostPort') ?? 9222;
      const adb = await this.resolveAdb();

      const sockets = await discoverWebviewSockets(adb, serial);
      if (sockets.length === 0) {
        return { success: false, error: 'No WebView devtools sockets found on device' };
      }

      const targetSocket = sockets[0]!;
      await execAdb(adb, [
        ...serialArgs(serial),
        'forward',
        `tcp:${hostPort}`,
        `localabstract:${targetSocket}`,
      ]);

      const http = await import('node:http');
      const wsUrl = await new Promise<string | undefined>((resolve) => {
        http
          .get(`http://localhost:${hostPort}/json`, (res) => {
            let body = '';
            res.on('data', (chunk) => {
              body += chunk;
            });
            res.on('end', () => {
              try {
                const entries = JSON.parse(body) as Array<{
                  webSocketDebuggerUrl: string;
                  id: string;
                }>;
                const target = entries.find((e) => e.id === targetId);
                resolve(target?.webSocketDebuggerUrl);
              } catch {
                resolve(undefined);
              }
            });
          })
          .on('error', () => resolve(undefined));
      });

      if (!wsUrl) {
        return { success: false, error: `Target ${targetId} not found` };
      }

      return {
        success: true,
        serial,
        targetId,
        hostPort,
        webSocketDebuggerUrl: wsUrl,
        attached: true,
      };
    });
  }
}
