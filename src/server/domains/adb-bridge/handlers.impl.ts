import { execFile } from 'node:child_process';
import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
  ADB_GETPROP_MAX_PROPERTIES,
  ADB_SHELL_TIMEOUT_MS,
  ADB_WEBVIEW_HOST_PORT_DEFAULT,
  APK_ZIP_MAGIC_HEX_HEADERS,
} from '@src/constants';
import {
  argString,
  argStringRequired,
  argNumber,
  argNumberRequired,
  argBool,
  argEnum,
  argStringArray,
} from '@server/domains/shared/parse-args';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolResponse } from '@server/types';
import { captureAdbLogcat } from './logcat';
import { parseLogcatLine, parsePriorityArg, priorityPredicate } from './logcat-parser';
import { buildFingerprintSummary, parseGetprop } from './getprop-parser';

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

async function execAdbBuffer(
  adb: string,
  args: string[],
  options: AdbExecOptions = {},
): Promise<{ stdout: Buffer; stderr: string; exitCode: number; signal?: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      adb,
      args,
      {
        encoding: 'buffer',
        windowsHide: true,
        timeout: options.timeoutMs ?? ADB_DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBufferBytes ?? ADB_MAX_BUFFER_BYTES,
      },
      (err, out, errOut) => {
        const result = {
          stdout: Buffer.isBuffer(out) ? out : Buffer.from(out ?? ''),
          stderr: Buffer.isBuffer(errOut)
            ? errOut.toString('utf8')
            : typeof errOut === 'string'
              ? errOut
              : '',
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

function parseProcMaps(stdout: string): Array<Record<string, string>> {
  const modules: Array<Record<string, string>> = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(
      /^([0-9a-fA-F]+)-([0-9a-fA-F]+)\s+(\S+)\s+([0-9a-fA-F]+)\s+(\S+)\s+(\d+)\s*(.*)$/,
    );
    if (!match) continue;
    const [, start, end, perms, offset, dev, inode, pathname] = match;
    modules.push({
      start: `0x${(start ?? '').toLowerCase()}`,
      end: `0x${(end ?? '').toLowerCase()}`,
      perms: perms ?? '',
      offset: `0x${(offset ?? '').toLowerCase()}`,
      dev: dev ?? '',
      inode: inode ?? '',
      pathname: pathname?.trim() ?? '',
    });
  }
  return modules;
}

function encodeInputText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/\s/g, '%s')
    .replace(/(["'`$&|;<>(){}[\]*?~!])/g, '\\$1');
}

const PORT_MAPPING_ACTIONS = new Set(['add', 'remove', 'remove_all', 'list'] as const);
const PORT_MAPPING_DIRECTIONS = new Set(['forward', 'reverse'] as const);

type PortMappingDirection = typeof PORT_MAPPING_DIRECTIONS extends Set<infer T> ? T : never;
type PortMappingAction = typeof PORT_MAPPING_ACTIONS extends Set<infer T> ? T : never;

function requirePortMappingAction(args: Record<string, unknown>): PortMappingAction {
  const action = argEnum(args, 'action', PORT_MAPPING_ACTIONS);
  if (!action) {
    throw new Error('Missing required port mapping action: add, remove, remove_all, or list');
  }
  return action;
}

function requirePortMappingDirection(args: Record<string, unknown>): PortMappingDirection {
  const direction = argEnum(args, 'direction', PORT_MAPPING_DIRECTIONS);
  if (!direction) {
    throw new Error('Missing required port mapping direction: forward or reverse');
  }
  return direction;
}

function parseAdbPortMappings(
  stdout: string,
  direction: PortMappingDirection,
): Array<{ serial: string; local: string; remote: string }> {
  const mappings: Array<{ serial: string; local: string; remote: string }> = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [serial, first, second] = line.trim().split(/\s+/);
    if (!serial || !first || !second) continue;
    mappings.push(
      direction === 'forward'
        ? { serial, local: first, remote: second }
        : { serial, local: second, remote: first },
    );
  }
  return mappings;
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

  async handleInstallTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleInstall(args));
  }

  async handleUninstallTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleUninstall(args));
  }

  async handleInputTapTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleInputTap(args));
  }

  async handleInputSwipeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleInputSwipe(args));
  }

  async handleInputKeyeventTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleInputKeyevent(args));
  }

  async handleInputTextTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleInputText(args));
  }

  async handleProcMapsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProcMaps(args));
  }

  async handleRootCheckTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleRootCheck(args));
  }

  async handleGetpropTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleGetprop(args));
  }

  async handleScreenshotTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleScreenshot(args));
  }

  async handleScreenrecordTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleScreenrecord(args));
  }

  async handlePortForwardTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handlePortForward(args));
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

  async handleInstall(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_install', async () => {
      const serial = argStringRequired(args, 'serial');
      const apkPath = argString(args, 'apkPath');
      const apkPaths = [...(apkPath ? [apkPath] : []), ...argStringArray(args, 'apkPaths')];
      if (apkPaths.length === 0) {
        return { success: false, serial, error: 'apkPath or apkPaths is required' };
      }

      const reinstall = argBool(args, 'reinstall') ?? true;
      const allowDowngrade = argBool(args, 'allowDowngrade') ?? false;
      const grantPermissions = argBool(args, 'grantPermissions') ?? false;
      const allowTestOnly = argBool(args, 'allowTestOnly') ?? true;
      const installSplit = argBool(args, 'installSplit') ?? apkPaths.length > 1;
      const user = argString(args, 'user');
      const adb = await this.resolveAdb();
      const installArgs = [
        ...serialArgs(serial),
        installSplit || apkPaths.length > 1 ? 'install-multiple' : 'install',
      ];
      if (reinstall) installArgs.push('-r');
      if (allowDowngrade) installArgs.push('-d');
      if (grantPermissions) installArgs.push('-g');
      if (allowTestOnly) installArgs.push('-t');
      if (user) installArgs.push('--user', user);
      installArgs.push(...apkPaths);

      const result = await execAdb(adb, installArgs, {
        allowNonZero: true,
        timeoutMs: ADB_FILE_TRANSFER_TIMEOUT_MS,
        maxBufferBytes: ADB_MAX_BUFFER_BYTES,
      });
      const combined = `${result.stdout}\n${result.stderr}`;
      return {
        success: result.exitCode === 0 && /Success/i.test(combined),
        serial,
        command: installArgs,
        apkPaths,
        installSplit: installSplit || apkPaths.length > 1,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    });
  }

  async handleUninstall(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_uninstall', async () => {
      const serial = argStringRequired(args, 'serial');
      const packageName = argStringRequired(args, 'packageName');
      const keepData = argBool(args, 'keepData') ?? false;
      const adb = await this.resolveAdb();
      const uninstallArgs = [...serialArgs(serial), 'uninstall'];
      if (keepData) uninstallArgs.push('-k');
      uninstallArgs.push(packageName);
      const result = await execAdb(adb, uninstallArgs, {
        allowNonZero: true,
        timeoutMs: ADB_FILE_TRANSFER_TIMEOUT_MS,
      });
      const combined = `${result.stdout}\n${result.stderr}`;
      return {
        success: result.exitCode === 0 && /Success/i.test(combined),
        serial,
        packageName,
        keepData,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    });
  }

  async handleInputTap(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_input_tap', async () => {
      const serial = argStringRequired(args, 'serial');
      const x = argNumberRequired(args, 'x');
      const y = argNumberRequired(args, 'y');
      const adb = await this.resolveAdb();
      const result = await execAdb(
        adb,
        [...serialArgs(serial), 'shell', 'input', 'tap', `${x}`, `${y}`],
        {
          allowNonZero: true,
          timeoutMs: ADB_SHELL_TIMEOUT_MS,
        },
      );
      return { success: result.exitCode === 0, serial, x, y, ...result };
    });
  }

  async handleInputSwipe(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_input_swipe', async () => {
      const serial = argStringRequired(args, 'serial');
      const x1 = argNumberRequired(args, 'x1');
      const y1 = argNumberRequired(args, 'y1');
      const x2 = argNumberRequired(args, 'x2');
      const y2 = argNumberRequired(args, 'y2');
      const durationMs = argNumber(args, 'durationMs');
      const adb = await this.resolveAdb();
      const shellArgs = [
        ...serialArgs(serial),
        'shell',
        'input',
        'swipe',
        `${x1}`,
        `${y1}`,
        `${x2}`,
        `${y2}`,
      ];
      if (durationMs !== undefined) shellArgs.push(`${durationMs}`);
      const result = await execAdb(adb, shellArgs, {
        allowNonZero: true,
        timeoutMs: ADB_SHELL_TIMEOUT_MS,
      });
      return { success: result.exitCode === 0, serial, x1, y1, x2, y2, durationMs, ...result };
    });
  }

  async handleInputKeyevent(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_input_keyevent', async () => {
      const serial = argStringRequired(args, 'serial');
      const keyCode = argStringRequired(args, 'keyCode');
      const adb = await this.resolveAdb();
      const result = await execAdb(
        adb,
        [...serialArgs(serial), 'shell', 'input', 'keyevent', keyCode],
        { allowNonZero: true, timeoutMs: ADB_SHELL_TIMEOUT_MS },
      );
      return { success: result.exitCode === 0, serial, keyCode, ...result };
    });
  }

  async handleInputText(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_input_text', async () => {
      const serial = argStringRequired(args, 'serial');
      const text = argStringRequired(args, 'text');
      const encodedText = encodeInputText(text);
      const adb = await this.resolveAdb();
      const result = await execAdb(
        adb,
        [...serialArgs(serial), 'shell', 'input', 'text', encodedText],
        { allowNonZero: true, timeoutMs: ADB_SHELL_TIMEOUT_MS },
      );
      return {
        success: result.exitCode === 0,
        serial,
        textLength: text.length,
        encodedText,
        ...result,
      };
    });
  }

  async handleProcMaps(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_proc_maps', async () => {
      const serial = argStringRequired(args, 'serial');
      const packageName = argString(args, 'packageName');
      let pid = argString(args, 'pid');
      const includeRaw = argBool(args, 'includeRaw') ?? false;
      const localPath = argString(args, 'localPath');
      if (!pid && packageName) {
        pid = await this.resolvePackagePid(serial, packageName);
      }
      if (!pid) {
        return {
          success: false,
          serial,
          packageName,
          error: 'pid or resolvable packageName is required',
        };
      }

      const adb = await this.resolveAdb();
      const { stdout, stderr, exitCode } = await execAdb(
        adb,
        [...serialArgs(serial), 'shell', `cat /proc/${pid}/maps`],
        {
          allowNonZero: true,
          timeoutMs: ADB_SHELL_TIMEOUT_MS,
          maxBufferBytes: ADB_LARGE_OUTPUT_MAX_BUFFER_BYTES,
        },
      );
      if (localPath) {
        await mkdir(dirname(localPath), { recursive: true });
        await writeFile(localPath, stdout, 'utf8');
      }
      const modules = parseProcMaps(stdout);
      return {
        success: exitCode === 0,
        serial,
        packageName,
        pid,
        count: modules.length,
        modules,
        localPath,
        stderr,
        exitCode,
        ...(includeRaw ? { raw: stdout } : {}),
      };
    });
  }

  async handleRootCheck(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_root_check', async () => {
      const serial = argStringRequired(args, 'serial');
      const adb = await this.resolveAdb();
      const runShellProbe = async (command: string) =>
        await execAdb(adb, [...serialArgs(serial), 'shell', command], {
          allowNonZero: true,
          timeoutMs: ADB_SHELL_TIMEOUT_MS,
          maxBufferBytes: ADB_MAX_BUFFER_BYTES,
        });

      const [su, magisk, buildTags, selinux, id] = await Promise.all([
        runShellProbe('which su'),
        runShellProbe('pm list packages com.topjohnwu.magisk'),
        runShellProbe('getprop ro.build.tags'),
        runShellProbe('getenforce'),
        runShellProbe('id'),
      ]);
      const indicators: Array<{
        name: string;
        evidence: string;
        severity: 'low' | 'medium' | 'high';
      }> = [];
      if (su.exitCode === 0 && su.stdout.trim()) {
        indicators.push({ name: 'su-binary', evidence: su.stdout.trim(), severity: 'high' });
      }
      if (magisk.stdout.includes('com.topjohnwu.magisk')) {
        indicators.push({
          name: 'magisk-package',
          evidence: magisk.stdout.trim(),
          severity: 'high',
        });
      }
      if (buildTags.stdout.includes('test-keys')) {
        indicators.push({
          name: 'test-keys',
          evidence: buildTags.stdout.trim(),
          severity: 'medium',
        });
      }
      if (/permissive/i.test(selinux.stdout)) {
        indicators.push({
          name: 'selinux-permissive',
          evidence: selinux.stdout.trim(),
          severity: 'medium',
        });
      }
      if (/\buid=0\b/.test(id.stdout)) {
        indicators.push({ name: 'adbd-root-shell', evidence: id.stdout.trim(), severity: 'high' });
      }
      const high = indicators.filter((indicator) => indicator.severity === 'high').length;
      const confidence = Math.min(1, high * 0.4 + (indicators.length - high) * 0.2);
      return {
        success: true,
        serial,
        rooted: indicators.length > 0,
        confidence,
        indicators,
      };
    });
  }

  async handleGetprop(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_getprop', async () => {
      const serial = argStringRequired(args, 'serial');
      const pattern = argString(args, 'pattern');
      const adb = await this.resolveAdb();
      const { stdout, stderr, exitCode } = await execAdb(
        adb,
        [...serialArgs(serial), 'shell', 'getprop'],
        {
          allowNonZero: true,
          timeoutMs: ADB_SHELL_TIMEOUT_MS,
          maxBufferBytes: ADB_LARGE_OUTPUT_MAX_BUFFER_BYTES,
        },
      );

      const allEntries = parseGetprop(stdout);
      const regex = pattern ? new RegExp(pattern, 'i') : undefined;
      const filteredEntries = regex
        ? allEntries.filter((entry) => regex.test(entry.key))
        : allEntries;
      const capped = filteredEntries.slice(0, ADB_GETPROP_MAX_PROPERTIES);
      const properties: Record<string, string> = {};
      for (const entry of capped) {
        properties[entry.key] = entry.value;
      }
      // Fingerprint is always curated from the full dump so it stays complete
      // even when a key-pattern filter narrows the returned properties map.
      const fullMap: Record<string, string> = {};
      for (const entry of allEntries) {
        fullMap[entry.key] = entry.value;
      }
      const fingerprint = buildFingerprintSummary(fullMap);
      return {
        success: exitCode === 0,
        serial,
        ...(pattern ? { pattern } : {}),
        count: capped.length,
        truncated: filteredEntries.length > capped.length,
        properties,
        fingerprint,
        stderr,
        exitCode,
      };
    });
  }

  async handleScreenshot(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_screenshot', async () => {
      const serial = argStringRequired(args, 'serial');
      const localPath =
        argString(args, 'localPath') ??
        join(tmpdir(), `jshook-adb-screenshot-${sanitizeLocalName(serial)}-${Date.now()}.png`);
      const adb = await this.resolveAdb();
      const result = await execAdbBuffer(
        adb,
        [...serialArgs(serial), 'exec-out', 'screencap', '-p'],
        {
          allowNonZero: true,
          timeoutMs: ADB_SHELL_TIMEOUT_MS,
          maxBufferBytes: ADB_LARGE_OUTPUT_MAX_BUFFER_BYTES,
        },
      );
      if (result.exitCode !== 0) {
        return {
          success: false,
          serial,
          localPath,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      }

      await mkdir(dirname(localPath), { recursive: true });
      await writeFile(localPath, result.stdout);
      const localStat = await stat(localPath);
      return {
        success: true,
        serial,
        localPath,
        size: localStat.size,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    });
  }

  async handleScreenrecord(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_screenrecord', async () => {
      const serial = argStringRequired(args, 'serial');
      const localPath =
        argString(args, 'localPath') ??
        join(tmpdir(), `jshook-adb-screenrecord-${sanitizeLocalName(serial)}-${Date.now()}.mp4`);
      const remotePath =
        argString(args, 'remotePath') ??
        `/sdcard/Download/jshook-screenrecord-${sanitizeLocalName(serial)}-${Date.now()}.mp4`;
      const durationSec = Math.max(
        1,
        Math.min(180, Math.floor(argNumber(args, 'durationSec') ?? 10)),
      );
      const bitRateMbps = argNumber(args, 'bitRateMbps');
      const size = argString(args, 'size');
      const adb = await this.resolveAdb();

      const recordArgs = [
        ...serialArgs(serial),
        'shell',
        'screenrecord',
        '--time-limit',
        `${durationSec}`,
      ];
      if (bitRateMbps !== undefined) {
        const bitRate = Math.max(1, Math.floor(bitRateMbps * 1_000_000));
        recordArgs.push('--bit-rate', `${bitRate}`);
      }
      if (size) recordArgs.push('--size', size);
      recordArgs.push(remotePath);

      const recordResult = await execAdb(adb, recordArgs, {
        allowNonZero: true,
        timeoutMs: (durationSec + 10) * 1000,
        maxBufferBytes: ADB_MAX_BUFFER_BYTES,
      });
      if (recordResult.exitCode !== 0) {
        return {
          success: false,
          serial,
          localPath,
          remotePath,
          durationSec,
          stdout: recordResult.stdout,
          stderr: recordResult.stderr,
          exitCode: recordResult.exitCode,
        };
      }

      await mkdir(dirname(localPath), { recursive: true });
      const pullResult = await execAdb(
        adb,
        [...serialArgs(serial), 'pull', remotePath, localPath],
        {
          allowNonZero: true,
          timeoutMs: ADB_FILE_TRANSFER_TIMEOUT_MS,
          maxBufferBytes: ADB_MAX_BUFFER_BYTES,
        },
      );
      const cleanupResult = await execAdb(
        adb,
        [...serialArgs(serial), 'shell', 'rm', '-f', remotePath],
        {
          allowNonZero: true,
          timeoutMs: ADB_SHELL_TIMEOUT_MS,
        },
      );
      if (pullResult.exitCode !== 0) {
        return {
          success: false,
          serial,
          localPath,
          remotePath,
          durationSec,
          record: recordResult,
          pull: pullResult,
          cleanupExitCode: cleanupResult.exitCode,
        };
      }

      const localStat = await stat(localPath);
      return {
        success: true,
        serial,
        localPath,
        remotePath,
        durationSec,
        size: localStat.size,
        record: recordResult,
        pull: pullResult,
        cleanupExitCode: cleanupResult.exitCode,
      };
    });
  }

  async handlePortForward(args: Record<string, unknown>): Promise<ToolResponse> {
    return this.run('adb_port_forward', async () => {
      const serial = argStringRequired(args, 'serial');
      const action = requirePortMappingAction(args);
      const direction = requirePortMappingDirection(args);
      const adb = await this.resolveAdb();

      if (action === 'list') {
        const result = await execAdb(adb, [...serialArgs(serial), direction, '--list'], {
          allowNonZero: true,
          timeoutMs: ADB_SHELL_TIMEOUT_MS,
        });
        const mappings = parseAdbPortMappings(result.stdout, direction);
        return {
          success: result.exitCode === 0,
          serial,
          action,
          direction,
          count: mappings.length,
          mappings,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      }

      if (action === 'remove_all') {
        const result = await execAdb(adb, [...serialArgs(serial), direction, '--remove-all'], {
          allowNonZero: true,
          timeoutMs: ADB_SHELL_TIMEOUT_MS,
        });
        return {
          success: result.exitCode === 0,
          serial,
          action,
          direction,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      }

      if (action === 'remove') {
        const endpoint =
          direction === 'forward'
            ? argStringRequired(args, 'local')
            : argStringRequired(args, 'remote');
        const result = await execAdb(
          adb,
          [...serialArgs(serial), direction, '--remove', endpoint],
          {
            allowNonZero: true,
            timeoutMs: ADB_SHELL_TIMEOUT_MS,
          },
        );
        return {
          success: result.exitCode === 0,
          serial,
          action,
          direction,
          local: direction === 'forward' ? endpoint : argString(args, 'local'),
          remote: direction === 'reverse' ? endpoint : argString(args, 'remote'),
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      }

      const local = argStringRequired(args, 'local');
      const remote = argStringRequired(args, 'remote');
      const commandArgs =
        direction === 'forward'
          ? [...serialArgs(serial), 'forward', local, remote]
          : [...serialArgs(serial), 'reverse', remote, local];
      const result = await execAdb(adb, commandArgs, {
        allowNonZero: true,
        timeoutMs: ADB_SHELL_TIMEOUT_MS,
      });
      return {
        success: result.exitCode === 0,
        serial,
        action,
        direction,
        local,
        remote,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
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
      const minPriority = parsePriorityArg(argString(args, 'minPriority'));
      const structured = argBool(args, 'structured') ?? false;
      const predicate = minPriority ? priorityPredicate(minPriority) : undefined;
      const logcat = await captureAdbLogcat({
        adb,
        args: [...serialArgs(serial), 'shell', `logcat -d -v threadtime -t ${tail}`],
        timeoutMs: ADB_SHELL_TIMEOUT_MS,
        pid,
        packageName,
        pattern: regex,
        ...(predicate ? { predicate } : {}),
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
        ...(minPriority ? { minPriority } : {}),
        lines: logcat.lines,
        ...(structured ? { parsedLines: logcat.lines.map(parseLogcatLine) } : {}),
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
