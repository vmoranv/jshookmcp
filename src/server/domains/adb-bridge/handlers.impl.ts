import { execFile } from 'node:child_process';
import { mkdir, open, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ToolError } from '@errors/ToolError';
import { probeCommand } from '@modules/external/ToolProbe';
import {
  ADB_COLD_START_LOGCAT_TAIL_DEFAULT,
  ADB_COLD_START_LOGCAT_TAIL_MAX,
  ADB_COLD_START_LOGCAT_TAIL_MIN,
  ADB_COLD_START_TIMELINE_LIMIT,
  ADB_COLD_START_WAIT_MS_DEFAULT,
  ADB_COLD_START_WAIT_MS_MAX,
  ADB_DEFAULT_TIMEOUT_MS,
  ADB_FILE_TRANSFER_TIMEOUT_MS,
  ADB_LARGE_OUTPUT_MAX_BUFFER_BYTES,
  ADB_LOGCAT_MAX_LINES_DEFAULT,
  ADB_LOGCAT_MAX_LINES_MAX,
  ADB_LOGCAT_TAIL_DEFAULT,
  ADB_LOGCAT_TAIL_MAX,
  ADB_MAX_BUFFER_BYTES,
  ADB_PACKAGE_COMPONENT_LIMIT,
  ADB_SHELL_TIMEOUT_MS,
  ADB_WEBVIEW_HOST_PORT_DEFAULT,
  APK_ZIP_MAGIC_HEX_HEADERS,
} from '@src/constants';
import {
  argString,
  argStringRequired,
  argNumber,
  argBool,
  argStringArray,
} from '@server/domains/shared/parse-args';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolResponse } from '@server/types';
import { captureAdbLogcat } from './logcat';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function serialArgs(serial: string): string[] {
  return serial ? ['-s', serial] : [];
}

interface AdbExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
}

interface AdbExecOptions {
  allowNonZero?: boolean;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

async function execAdb(
  adb: string,
  args: string[],
  options: AdbExecOptions = {},
): Promise<AdbExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      adb,
      args,
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: options.timeoutMs ?? ADB_DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBufferBytes ?? ADB_MAX_BUFFER_BYTES,
      },
      (err, out, errOut) => {
        const result: AdbExecResult = {
          stdout: out ?? '',
          stderr: errOut ?? '',
          exitCode:
            typeof (err as { code?: unknown } | null)?.code === 'number'
              ? ((err as { code: number }).code ?? 1)
              : 0,
          signal:
            typeof (err as { signal?: unknown } | null)?.signal === 'string'
              ? ((err as { signal: string }).signal ?? undefined)
              : undefined,
        };
        if (err && !options.allowNonZero) {
          reject(err);
          return;
        }
        resolve(result);
      },
    );
  });
}

function parsePackagePaths(pathOut: string): string[] {
  const paths: string[] = [];
  for (const line of pathOut.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('package:')) continue;
    const remotePath = trimmed.slice('package:'.length).trim();
    if (remotePath) paths.push(remotePath);
  }
  return paths;
}

function sanitizeLocalName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file';
}

function parseLaunchTiming(stdout: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ['Status', 'LaunchState', 'Activity', 'ThisTime', 'TotalTime', 'WaitTime']) {
    const match = stdout.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    if (!match?.[1]) continue;
    const raw = match[1].trim();
    out[key.charAt(0).toLowerCase() + key.slice(1)] =
      key.endsWith('Time') && /^\d+$/.test(raw) ? Number(raw) : raw;
  }
  return out;
}

function extractUid(dumpsys: string): string | undefined {
  return (
    dumpsys.match(/\buserId=(\d+)/)?.[1] ??
    dumpsys.match(/\buid=(\d+)/)?.[1] ??
    dumpsys.match(/\bappId=(\d+)/)?.[1]
  );
}

async function validateLocalApk(path: string): Promise<{ size: number; zipLike: boolean }> {
  const fileStat = await stat(path);
  if (!fileStat.isFile()) {
    throw new Error(`Pulled APK path is not a regular file: ${path}`);
  }
  if (fileStat.size <= 0) {
    throw new Error(`Pulled APK is empty: ${path}`);
  }
  const handle = await open(path, 'r');
  const header = Buffer.alloc(4);
  try {
    await handle.read(header, 0, 4, 0);
  } finally {
    await handle.close();
  }
  const headerHex = header.toString('hex').toLowerCase();
  const zipLike = APK_ZIP_MAGIC_HEX_HEADERS.some((candidate) => candidate === headerHex);
  return { size: fileStat.size, zipLike };
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

  async handleDeviceListTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleDeviceList(args));
  }

  async handleShellTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleShell(args));
  }

  async handleApkPullTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleApkPull(args));
  }

  async handleAnalyzeApkTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleAnalyzeApk(args));
  }

  async handlePackageSummaryTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handlePackageSummary(args));
  }

  async handleLogcatQueryTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleLogcatQuery(args));
  }

  async handleAppColdStartTraceTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleAppColdStartTrace(args));
  }

  async handleFilePullTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleFilePull(args));
  }

  async handleFilePushTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleFilePush(args));
  }

  async handlePullNativeLibsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handlePullNativeLibs(args));
  }

  async handleWebViewListTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWebViewList(args));
  }

  async handleWebViewAttachTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWebViewAttach(args));
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
      const allowNonZero = argBool(args, 'allowNonZero') ?? true;
      const timeoutMs = argNumber(args, 'timeoutMs') ?? ADB_SHELL_TIMEOUT_MS;
      const maxBufferBytes = argNumber(args, 'maxBufferBytes');
      const adb = await this.resolveAdb();
      const { stdout, stderr, exitCode, signal } = await execAdb(
        adb,
        [...serialArgs(serial), 'shell', command],
        { allowNonZero, timeoutMs, maxBufferBytes },
      );
      return {
        success: exitCode === 0,
        serial,
        command,
        stdout,
        stderr: stderr || '',
        exitCode,
        ...(signal ? { signal } : {}),
      };
    });
  }

  async handleApkPull(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_apk_pull', async () => {
      const serial = argStringRequired(args, 'serial');
      const packageName = argString(args, 'packageName');
      const outputPath = argString(args, 'outputPath') ?? '.';
      const outputFile = argString(args, 'outputFile');
      const includeSplits = argBool(args, 'includeSplits') ?? false;
      const validateZip = argBool(args, 'validateZip') ?? true;
      if (!packageName) return { success: false, error: 'packageName is required' };
      if (includeSplits && outputFile) {
        return {
          success: false,
          error:
            'outputFile can only be used for a single base APK pull; omit it with includeSplits=true',
        };
      }

      const adb = await this.resolveAdb();
      const { stdout: pathOut } = await execAdb(adb, [
        ...serialArgs(serial),
        'shell',
        `pm path ${packageName}`,
      ]);
      const remotePaths = parsePackagePaths(pathOut);
      if (remotePaths.length === 0) {
        return { success: false, error: `APK not found for ${packageName}`, raw: pathOut };
      }

      const basePath =
        remotePaths.find((candidate) => /\/base\.apk$/i.test(candidate)) ?? remotePaths[0]!;
      const selectedRemotePaths = includeSplits ? remotePaths : [basePath];
      const pulled: Array<{
        remotePath: string;
        localPath: string;
        size: number;
        zipLike?: boolean;
        warning?: string;
      }> = [];

      for (const remotePath of selectedRemotePaths) {
        const remoteName = basename(remotePath) || 'base.apk';
        let destPath =
          outputFile ??
          join(
            outputPath,
            includeSplits
              ? `${packageName}-${sanitizeLocalName(remoteName)}`
              : `${packageName}.apk`,
          );
        destPath = destPath.replace(/\\/g, '/');
        await mkdir(dirname(destPath), { recursive: true });

        let warning: string | undefined;
        try {
          const existing = await stat(destPath);
          if (existing.isDirectory()) {
            const fallback = join(
              outputPath,
              `${packageName}-${sanitizeLocalName(remoteName)}`,
            ).replace(/\\/g, '/');
            warning = `Destination existed as a directory; wrote to ${fallback} instead.`;
            destPath = fallback;
            await mkdir(dirname(destPath), { recursive: true });
          }
        } catch {
          // Destination does not exist, which is fine.
        }

        await execAdb(adb, [...serialArgs(serial), 'pull', remotePath, destPath], {
          timeoutMs: ADB_FILE_TRANSFER_TIMEOUT_MS,
          maxBufferBytes: ADB_MAX_BUFFER_BYTES,
        });

        const validation = await validateLocalApk(destPath);
        if (validateZip && !validation.zipLike) {
          return {
            success: false,
            serial,
            packageName,
            remotePaths,
            error: `Pulled file does not look like a ZIP/APK: ${destPath}`,
            localPath: destPath,
            size: validation.size,
          };
        }

        pulled.push({
          remotePath,
          localPath: destPath,
          size: validation.size,
          zipLike: validation.zipLike,
          ...(warning ? { warning } : {}),
        });
      }

      return {
        success: true,
        serial,
        packageName,
        includeSplits,
        remotePaths,
        remotePath: pulled[0]?.remotePath,
        localPath: pulled[0]?.localPath,
        files: pulled,
      };
    });
  }

  async handleAnalyzeApk(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_apk_analyze', async () => {
      const serial = argStringRequired(args, 'serial');
      const packageName = argStringRequired(args, 'packageName');
      const summary = await this.buildPackageSummary(serial, packageName);
      return { success: true, serial, ...summary };
    });
  }

  async handlePackageSummary(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_package_summary', async () => {
      const serial = argStringRequired(args, 'serial');
      const packageName = argStringRequired(args, 'packageName');
      const summary = await this.buildPackageSummary(serial, packageName);
      return { success: true, serial, ...summary };
    });
  }

  private async buildPackageSummary(
    serial: string,
    packageName: string,
  ): Promise<Record<string, unknown>> {
    const adb = await this.resolveAdb();
    const { stdout } = await execAdb(
      adb,
      [...serialArgs(serial), 'shell', `dumpsys package ${packageName}`],
      { timeoutMs: ADB_SHELL_TIMEOUT_MS, maxBufferBytes: ADB_LARGE_OUTPUT_MAX_BUFFER_BYTES },
    );

    const info: Record<string, unknown> = { packageName };

    const versionNameMatch = stdout.match(/versionName=([^\s]+)/);
    if (versionNameMatch?.[1]) info.versionName = versionNameMatch[1];
    const versionCodeMatch = stdout.match(/versionCode=(\d+)/);
    if (versionCodeMatch?.[1]) info.versionCode = versionCodeMatch[1];
    const minSdkMatch = stdout.match(/minSdk=(\d+)/);
    if (minSdkMatch?.[1]) info.minSdk = minSdkMatch[1];
    const targetSdkMatch = stdout.match(/targetSdk=(\d+)/);
    if (targetSdkMatch?.[1]) info.targetSdk = targetSdkMatch[1];
    const uid = extractUid(stdout);
    if (uid) info.uid = uid;

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
      const firstToken = trimmed.split(/\s+/)[0];

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

    info.permissions = [...new Set(permissions)].slice(0, ADB_PACKAGE_COMPONENT_LIMIT);
    info.activities = [...new Set(activities)].slice(0, ADB_PACKAGE_COMPONENT_LIMIT);
    info.services = [...new Set(services)].slice(0, ADB_PACKAGE_COMPONENT_LIMIT);
    info.receivers = [...new Set(receivers)].slice(0, ADB_PACKAGE_COMPONENT_LIMIT);
    info.nativeLibraryDirs = parseNativeLibraryDirs(stdout, packageName, true);

    const launcher = await this.resolveLauncherActivity(serial, packageName);
    if (launcher) info.launcherActivity = launcher;
    return info;
  }

  private async resolveLauncherActivity(
    serial: string,
    packageName: string,
  ): Promise<string | undefined> {
    const adb = await this.resolveAdb();
    const { stdout } = await execAdb(
      adb,
      [
        ...serialArgs(serial),
        'shell',
        `cmd package resolve-activity --brief ${packageName} android.intent.action.MAIN`,
      ],
      { allowNonZero: true, timeoutMs: ADB_SHELL_TIMEOUT_MS },
    );
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.findLast((line) => line.includes('/'));
  }

  private async resolvePackagePid(
    serial: string,
    packageName: string,
  ): Promise<string | undefined> {
    const adb = await this.resolveAdb();
    const { stdout, exitCode } = await execAdb(
      adb,
      [...serialArgs(serial), 'shell', `pidof -s ${packageName}`],
      { allowNonZero: true, timeoutMs: ADB_SHELL_TIMEOUT_MS },
    );
    if (exitCode !== 0) return undefined;
    return stdout.trim().split(/\s+/)[0] || undefined;
  }

  async handleLogcatQuery(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_logcat_query', async () => {
      const serial = argStringRequired(args, 'serial');
      const packageName = argString(args, 'packageName');
      let pid = argString(args, 'pid');
      const pattern = argString(args, 'pattern');
      const tail = Math.max(
        1,
        Math.min(argNumber(args, 'tail') ?? ADB_LOGCAT_TAIL_DEFAULT, ADB_LOGCAT_TAIL_MAX),
      );
      const maxLines = Math.max(
        1,
        Math.min(
          argNumber(args, 'maxLines') ?? ADB_LOGCAT_MAX_LINES_DEFAULT,
          ADB_LOGCAT_MAX_LINES_MAX,
        ),
      );
      const clearBefore = argBool(args, 'clearBefore') ?? false;
      const adb = await this.resolveAdb();

      if (clearBefore) {
        await execAdb(adb, [...serialArgs(serial), 'shell', 'logcat -c'], {
          allowNonZero: true,
          timeoutMs: ADB_SHELL_TIMEOUT_MS,
        });
      }
      if (!pid && packageName) {
        pid = await this.resolvePackagePid(serial, packageName);
      }

      const regex = pattern ? new RegExp(pattern, 'i') : undefined;
      const logcat = await captureAdbLogcat({
        adb,
        args: [...serialArgs(serial), 'shell', `logcat -d -t ${tail}`],
        timeoutMs: ADB_SHELL_TIMEOUT_MS,
        pid,
        packageName,
        pattern: regex,
        maxLines,
      });

      return {
        success: logcat.exitCode === 0,
        serial,
        packageName,
        pid,
        pattern,
        tail,
        count: logcat.lines.length,
        lines: logcat.lines,
        stderr: logcat.stderr,
        exitCode: logcat.exitCode,
        ...(logcat.signal ? { signal: logcat.signal } : {}),
      };
    });
  }

  async handleAppColdStartTrace(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_app_cold_start_trace', async () => {
      const serial = argStringRequired(args, 'serial');
      const packageName = argStringRequired(args, 'packageName');
      const waitMs = Math.max(
        0,
        Math.min(
          argNumber(args, 'waitMs') ?? ADB_COLD_START_WAIT_MS_DEFAULT,
          ADB_COLD_START_WAIT_MS_MAX,
        ),
      );
      const logcatTail = Math.max(
        ADB_COLD_START_LOGCAT_TAIL_MIN,
        Math.min(
          argNumber(args, 'logcatTail') ?? ADB_COLD_START_LOGCAT_TAIL_DEFAULT,
          ADB_COLD_START_LOGCAT_TAIL_MAX,
        ),
      );
      const extraPatterns = argStringArray(args, 'extraPatterns');
      const adb = await this.resolveAdb();
      const activity =
        argString(args, 'activity') ?? (await this.resolveLauncherActivity(serial, packageName));
      if (!activity) {
        return {
          success: false,
          serial,
          packageName,
          error: 'Unable to resolve launcher activity',
        };
      }
      const component = this.normalizeActivityComponent(packageName, activity);

      await execAdb(adb, [...serialArgs(serial), 'shell', `am force-stop ${packageName}`], {
        allowNonZero: true,
        timeoutMs: ADB_SHELL_TIMEOUT_MS,
      });
      await execAdb(adb, [...serialArgs(serial), 'shell', 'logcat -c'], {
        allowNonZero: true,
        timeoutMs: ADB_SHELL_TIMEOUT_MS,
      });

      const startResult = await execAdb(
        adb,
        [...serialArgs(serial), 'shell', `am start -W -S ${component}`],
        {
          allowNonZero: true,
          timeoutMs: ADB_SHELL_TIMEOUT_MS,
          maxBufferBytes: ADB_MAX_BUFFER_BYTES,
        },
      );

      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      const pid = await this.resolvePackagePid(serial, packageName);
      const builtInPattern = new RegExp(
        [
          packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          'ActivityManager',
          'ActivityTaskManager',
          'Displayed',
          'Looper',
          'Choreographer',
          'skipped',
          'ANR',
          'bindApplication',
          'ClassLoader',
          'DexClassLoader',
          'PathClassLoader',
          'JNI',
          'dlopen',
          'permission',
          ...extraPatterns,
        ].join('|'),
        'i',
      );
      const logcatResult = await captureAdbLogcat({
        adb,
        args: [...serialArgs(serial), 'shell', `logcat -d -t ${logcatTail}`],
        timeoutMs: ADB_SHELL_TIMEOUT_MS,
        maxLines: ADB_COLD_START_TIMELINE_LIMIT,
        predicate: (line) => Boolean(pid && line.includes(` ${pid} `)) || builtInPattern.test(line),
      });
      const timeline = logcatResult.lines;
      const looperEvents = timeline
        .map((line) => {
          const latency = line.match(/\blatency=(\d+)ms/)?.[1];
          const wall = line.match(/\bwall=(\d+)ms/)?.[1];
          if (!latency && !wall) return undefined;
          return {
            latencyMs: latency ? Number(latency) : undefined,
            wallMs: wall ? Number(wall) : undefined,
            line,
          };
        })
        .filter(
          (
            event,
          ): event is { latencyMs: number | undefined; wallMs: number | undefined; line: string } =>
            event !== undefined,
        );

      return {
        success: startResult.exitCode === 0,
        serial,
        packageName,
        activity: component,
        pid,
        launch: {
          ...parseLaunchTiming(startResult.stdout),
          stdout: startResult.stdout,
          stderr: startResult.stderr,
          exitCode: startResult.exitCode,
        },
        logcat: {
          tail: logcatTail,
          exitCode: logcatResult.exitCode,
          count: timeline.length,
          timeline,
          looperEvents,
        },
      };
    });
  }

  private normalizeActivityComponent(packageName: string, activity: string): string {
    const trimmed = activity.trim();
    if (trimmed.includes('/')) return trimmed;
    if (trimmed.startsWith('.')) return `${packageName}/${trimmed}`;
    if (trimmed.startsWith(packageName)) return `${packageName}/${trimmed}`;
    return `${packageName}/${trimmed}`;
  }

  async handleFilePull(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_file_pull', async () => {
      const serial = argStringRequired(args, 'serial');
      const remotePath = argStringRequired(args, 'remotePath');
      const localPath = argStringRequired(args, 'localPath').replace(/\\/g, '/');
      const adb = await this.resolveAdb();
      await mkdir(dirname(localPath), { recursive: true });

      const pullResult = await execAdb(
        adb,
        [...serialArgs(serial), 'pull', remotePath, localPath],
        {
          timeoutMs: ADB_FILE_TRANSFER_TIMEOUT_MS,
          maxBufferBytes: ADB_MAX_BUFFER_BYTES,
        },
      );
      const localStat = await stat(localPath);
      return {
        success: true,
        serial,
        remotePath,
        localPath,
        size: localStat.size,
        stdout: pullResult.stdout,
        stderr: pullResult.stderr,
      };
    });
  }

  async handleFilePush(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_file_push', async () => {
      const serial = argStringRequired(args, 'serial');
      const localPath = argStringRequired(args, 'localPath').replace(/\\/g, '/');
      const remotePath = argStringRequired(args, 'remotePath');
      const adb = await this.resolveAdb();
      const localStat = await stat(localPath);
      if (!localStat.isFile()) {
        return { success: false, serial, localPath, remotePath, error: 'localPath is not a file' };
      }

      const pushResult = await execAdb(
        adb,
        [...serialArgs(serial), 'push', localPath, remotePath],
        {
          timeoutMs: ADB_FILE_TRANSFER_TIMEOUT_MS,
          maxBufferBytes: ADB_MAX_BUFFER_BYTES,
        },
      );
      return {
        success: true,
        serial,
        localPath,
        remotePath,
        size: localStat.size,
        stdout: pushResult.stdout,
        stderr: pushResult.stderr,
      };
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
        await execAdb(adb, [...serialArgs(serial), 'pull', remoteDir, localPath], {
          timeoutMs: ADB_FILE_TRANSFER_TIMEOUT_MS,
          maxBufferBytes: ADB_MAX_BUFFER_BYTES,
        });
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
      const hostPort = argNumber(args, 'hostPort') ?? ADB_WEBVIEW_HOST_PORT_DEFAULT;
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
      const hostPort = argNumber(args, 'hostPort') ?? ADB_WEBVIEW_HOST_PORT_DEFAULT;
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
