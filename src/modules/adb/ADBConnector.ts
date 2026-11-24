/**
 * ADB Connector — wraps @devicefarmer/adbkit for device management,
 * shell commands, APK pull/analysis, and WebView CDP debugging.
 *
 * Uses adbkit v3 API: Client.getDevice(serial) → DeviceClient for all operations.
 *
 * Graceful degradation: if ADB server binary or adbkit is unavailable,
 * all methods return actionable errors.
 */

import { execSync, execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ADB_VERSION_CHECK_TIMEOUT_MS, ADB_FILE_TRANSFER_TIMEOUT_MS } from '@src/constants';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { Duplex, Readable } from 'node:stream';
import type { ADBDevice, ADBForwardEntry, APKInfo, ADBShellResult, CDPTarget } from './types.js';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { ToolError } from '@errors/ToolError';
import { assertValidAndroidPackageName, assertValidDeviceSerial } from './validation.js';

const execFileAsync = promisify(execFile);
const ADB_AVAILABILITY_TTL_MS = 5 * 60_000;
let adbAvailabilityCache: { value: boolean; expiresAt: number } | null = null;

/**
 * Sentinel printed after the user command so the real device-side exit status
 * survives adbkit. adbkit's `shell()` exposes only the merged output stream
 * (its legacy shell service multiplexes stderr into stdout) and no exit code,
 * so `shellCommand()` would otherwise report every failure as exit 0.
 *
 * Trade-off: stderr cannot be separated from stdout on this transport, so
 * `ADBShellResult.stderr` stays empty and both streams are returned in
 * `stdout`. `shellCommand` already buffers the whole stream, so wrapping the
 * command does not cost streaming behaviour.
 */
const EXIT_STATUS_MARKER = '__JSHOOK_ADB_EXIT__';

function buildCommandWithExitStatus(command: string): string {
  // The subshell keeps an `exit`/`cd`/variable assignment inside the user
  // command from skipping the status line.
  return `(\n${command}\n)\n__jshook_adb_status=$?\nprintf '\\n${EXIT_STATUS_MARKER}:%d\\n' "$__jshook_adb_status"`;
}

interface ParsedShellOutput {
  stdout: string;
  exitCode: number;
}

/**
 * Remove the partially written local file after a failed pull. The stream may
 * still hold the handle on Windows, so a failed unlink is not surfaced: leaving
 * a truncated APK behind is worse, but it must not mask the original error.
 */
function discardPartialFile(outputPath: string): void {
  void unlink(outputPath).catch(() => {});
}

function parseShellOutput(raw: string): ParsedShellOutput {
  const match = raw.match(/\r?\n__JSHOOK_ADB_EXIT__:(\d+)\r?\n?$/);
  if (!match) {
    // No status line: the shell was killed or the connection dropped before the
    // command finished. Treat that as failure instead of inventing success.
    return { stdout: raw.replace(/\r?\n$/, ''), exitCode: 1 };
  }

  const exitCode = Number.parseInt(match[1] as string, 10);
  return {
    stdout: raw.slice(0, match.index).replace(/\r?\n$/, ''),
    exitCode: Number.isInteger(exitCode) ? exitCode : 1,
  };
}

/** Section a `dumpsys package` line belongs to; '' is the package body. */
type DumpsysSection = '' | 'permissions' | 'activities' | 'services' | 'receivers';

/**
 * Section header markers, checked in order — first match wins.
 *
 * The order matters only if a single line could carry two markers, which the
 * shipped `dumpsys` formats do not produce; the list preserves the original
 * if-chain order regardless so a future format change fails predictably.
 */
const DUMPSYS_SECTION_MARKERS: ReadonlyArray<{
  section: Exclude<DumpsysSection, ''>;
  needles: readonly string[];
}> = [
  { section: 'permissions', needles: ['requested permissions:', 'install permissions:'] },
  { section: 'activities', needles: ['Activity Resolver Table', 'activities:'] },
  { section: 'services', needles: ['Service Resolver Table', 'services:'] },
  { section: 'receivers', needles: ['Receiver Resolver Table', 'receivers:'] },
];

/**
 * Which APKInfo array a component section feeds.
 *
 * Section '' (the package body) has no entry: component lines outside a
 * recognised section are ignored, matching the original three if-blocks which
 * all required an explicit section.
 */
const COMPONENT_BUCKETS: Partial<Record<DumpsysSection, 'activities' | 'services' | 'receivers'>> =
  {
    activities: 'activities',
    services: 'services',
    receivers: 'receivers',
  };

// Lazy-load @devicefarmer/adbkit only when available (optional dependency).
type AdbkitModule = typeof import('@devicefarmer/adbkit');
let adbkit: AdbkitModule | null = null;
async function loadAdbkit(): Promise<AdbkitModule | null> {
  if (adbkit !== null) return adbkit;
  try {
    adbkit = (await import('@devicefarmer/adbkit')) as AdbkitModule;
  } catch {
    adbkit = null;
  }
  return adbkit;
}

function adbUnavailableError(): never {
  throw new PrerequisiteError(
    'ADB server binary not found in PATH. Install Android Platform Tools: ' +
      'https://developer.android.com/studio/command-line/adb',
  );
}

function sdkUnavailableError(): never {
  throw new PrerequisiteError(
    '@devicefarmer/adbkit is not installed. Run: npm install @devicefarmer/adbkit',
  );
}

/**
 * Synchronously check whether ADB binary is reachable. Kept for callers that
 * need a quick best-effort signal before any async work; prefer
 * `ensureAdbAvailable()` from handler hot paths.
 */
export function checkADBBinary(): boolean {
  try {
    execSync('adb version', { stdio: 'pipe', timeout: ADB_VERSION_CHECK_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/**
 * Async availability check with TTL cache. Use this in handler hot paths to avoid
 * blocking the event loop with execSync on every call.
 */
async function ensureAdbAvailable(): Promise<boolean> {
  const now = Date.now();
  if (adbAvailabilityCache && adbAvailabilityCache.expiresAt > now) {
    return adbAvailabilityCache.value;
  }
  try {
    await execFileAsync('adb', ['version'], { timeout: ADB_VERSION_CHECK_TIMEOUT_MS });
    adbAvailabilityCache = { value: true, expiresAt: now + ADB_AVAILABILITY_TTL_MS };
    return true;
  } catch {
    adbAvailabilityCache = { value: false, expiresAt: now + ADB_AVAILABILITY_TTL_MS };
    return false;
  }
}

/** Reset the availability cache. Test-only — not part of the public API. */
export function resetAdbAvailabilityCache(): void {
  adbAvailabilityCache = null;
}

/** Get or create an adbkit Client instance. */
let clientCache: InstanceType<typeof import('@devicefarmer/adbkit').Client> | null = null;
async function getClient(): Promise<InstanceType<typeof import('@devicefarmer/adbkit').Client>> {
  if (clientCache) return clientCache;
  const sdk = await loadAdbkit();
  if (!sdk) sdkUnavailableError();
  clientCache = new sdk.Client();
  return clientCache;
}

/** Read all data from a stream (adbkit v3 uses Duplex for shell output). */
async function readStreamAll(stream: Duplex | Readable): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk, 'utf8'));
    } else {
      chunks.push(new Uint8Array(chunk as ArrayBufferLike));
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

export class ADBConnector {
  /**
   * Verify ADB server binary is in PATH (uses async TTL-cached probe).
   * @returns true if ADB is available, false otherwise
   */
  async checkADBAvailable(): Promise<boolean> {
    return ensureAdbAvailable();
  }

  /**
   * List all connected Android devices.
   * @returns array of ADBDevice with serial, model, product, state, sdkVersion, abi
   */
  async listDevices(): Promise<ADBDevice[]> {
    if (!(await ensureAdbAvailable())) adbUnavailableError();

    const client = await getClient();
    const devices = await client.listDevices();

    const results: ADBDevice[] = [];
    for (const d of devices) {
      const device: ADBDevice = {
        serial: d.id,
        name: d.id,
        state: d.type as ADBDevice['state'],
        model: '',
        product: '',
        device: '',
        // adbkit's Device exposes only {id, type}; there is no transport id to
        // read, so the field stays absent rather than carrying an undefined
        // placeholder.
        sdkVersion: '',
        abi: '',
      };

      // Enrich with device properties via shell commands
      if (d.type === 'device') {
        try {
          const deviceClient = client.getDevice(d.id);
          const props = await deviceClient.getProperties();
          device.model = (props as Record<string, string>)['ro.product.model'] ?? '';
          device.name = (props as Record<string, string>)['ro.product.name'] || d.id;
          device.product = (props as Record<string, string>)['ro.product.name'] ?? '';
          device.device = (props as Record<string, string>)['ro.build.product'] ?? '';
          device.sdkVersion = (props as Record<string, string>)['ro.build.version.sdk'] ?? '';
          device.abi = (props as Record<string, string>)['ro.product.cpu.abi'] ?? '';
        } catch {
          // Properties unavailable, keep defaults
        }
      }

      results.push(device);
    }

    return results;
  }

  /**
   * Execute an ADB shell command on a specific device.
   * @param serial device serial
   * @param command shell command to run
   * @returns ADBShellResult with stdout, stderr, exitCode
   */
  async shellCommand(serial: string, command: string): Promise<ADBShellResult> {
    if (!(await ensureAdbAvailable())) adbUnavailableError();
    assertValidDeviceSerial(serial);

    const client = await getClient();
    const deviceClient = client.getDevice(serial);
    const socket = await deviceClient.shell(buildCommandWithExitStatus(command));
    const output = await readStreamAll(socket);
    const parsed = parseShellOutput(output.toString('utf8'));

    return {
      stdout: parsed.stdout,
      // adbd's legacy shell service merges stderr into the stream above; the
      // combined text is preserved in `stdout` rather than silently dropped.
      stderr: '',
      exitCode: parsed.exitCode,
      command,
    };
  }

  /**
   * Forward a local port to a remote port on the device.
   * @param serial device serial
   * @param localPort local port number
   * @param remotePort remote port number on device
   * @returns forwarding spec string
   */
  async forwardPort(serial: string, localPort: number, remotePort: number): Promise<string> {
    if (!(await ensureAdbAvailable())) adbUnavailableError();
    assertValidDeviceSerial(serial);

    const client = await getClient();
    const deviceClient = client.getDevice(serial);
    await deviceClient.forward(`tcp:${localPort}`, `tcp:${remotePort}`);
    return `tcp:${localPort} -> tcp:${remotePort}`;
  }

  /**
   * List active port forwards for a device.
   * @param serial device serial
   * @returns array of forward entries
   */
  async listForwards(serial: string): Promise<ADBForwardEntry[]> {
    if (!(await ensureAdbAvailable())) adbUnavailableError();
    assertValidDeviceSerial(serial);

    const client = await getClient();
    const deviceClient = client.getDevice(serial);
    const forwards = await deviceClient.listForwards();
    return forwards.map((f: { serial: string; local: string; remote: string }) => ({
      serial: f.serial,
      local: f.local,
      remote: f.remote,
    }));
  }

  /**
   * Remove a port forward by removing all forwards on the local port.
   * Note: adbkit v3 doesn't have a direct removeForward, so we use shell command.
   * @param serial device serial
   * @param localPort local port to remove
   */
  async removeForward(serial: string, localPort: number): Promise<void> {
    if (!(await ensureAdbAvailable())) adbUnavailableError();

    // Validate serial to prevent command injection
    assertValidDeviceSerial(serial);

    // Use execFileSync with argument array to prevent shell injection
    try {
      execFileSync('adb', ['-s', serial, 'forward', '--remove', `tcp:${localPort}`], {
        stdio: 'pipe',
        timeout: ADB_VERSION_CHECK_TIMEOUT_MS,
      });
    } catch {
      // Forward may already be removed, ignore error
    }
  }

  /**
   * Pull an APK file from the device.
   * @param serial device serial
   * @param packageName package name to pull
   * @param outputPath local file path to save the APK
   * @returns path to the saved APK file
   */
  async pullApk(serial: string, packageName: string, outputPath: string): Promise<string> {
    if (!(await ensureAdbAvailable())) adbUnavailableError();
    assertValidDeviceSerial(serial);
    assertValidAndroidPackageName(packageName);

    // First get the APK path on device
    const { stdout, exitCode } = await this.shellCommand(serial, `pm path ${packageName}`);

    // Parse "package:/data/app/~~xxx/base.apk" format
    const match = stdout.match(/package:(.+)/);
    if (!match) {
      const detail = exitCode === 0 ? '' : ` (pm path exited ${exitCode}: ${stdout.trim()})`;
      throw new ToolError(
        'NOT_FOUND',
        `Package "${packageName}" not found on device ${serial}${detail}`,
      );
    }
    const apkPath = match[1] as string;

    // Pull the file via DeviceClient
    const client = await getClient();
    const deviceClient = client.getDevice(serial);
    const transfer = await deviceClient.pull(apkPath);
    const writeStream = createWriteStream(outputPath);
    // adbkit 4.1+ emits "error" (then "close") on a failed pull instead of
    // "end". A truncated transfer can also emit "close" without "finish", and
    // a stalled device never emits anything at all — bound the transfer and
    // settle on every terminal path so the promise cannot hang.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let sourceEnded = false;
      const readable = transfer as unknown as Readable;

      const timer = setTimeout(() => {
        fail(
          new ToolError(
            'TIMEOUT',
            `Timed out after ${ADB_FILE_TRANSFER_TIMEOUT_MS} ms while pulling ${apkPath} from ${serial}.`,
            { toolName: 'adb' },
          ),
        );
      }, ADB_FILE_TRANSFER_TIMEOUT_MS);
      timer.unref?.();

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        readable.unpipe?.(writeStream);
        readable.destroy?.();
        writeStream.destroy();
        discardPartialFile(outputPath);
        reject(error);
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      transfer.once('error', fail);
      transfer.once('end', () => {
        sourceEnded = true;
      });
      transfer.once('close', () => {
        if (!settled && !sourceEnded) {
          fail(
            new ToolError(
              'CONNECTION',
              `APK pull from ${serial} closed before the transfer finished.`,
              { toolName: 'adb' },
            ),
          );
        }
      });
      writeStream.once('error', fail);
      writeStream.once('finish', finish);
      readable.pipe(writeStream);
    });

    return outputPath;
  }

  /**
   * Parse APK info from a device using dumpsys.
   * @param serial device serial
   * @param packageName package name to analyze
   * @returns APKInfo with manifest details
   */
  async parseApkInfo(serial: string, packageName: string): Promise<APKInfo> {
    if (!(await ensureAdbAvailable())) adbUnavailableError();
    assertValidDeviceSerial(serial);
    assertValidAndroidPackageName(packageName);

    const { stdout } = await this.shellCommand(serial, `dumpsys package ${packageName}`);

    // `dumpsys package <missing>` exits 0 and prints "Unable to find package".
    // Returning an empty APKInfo made callers treat a missing package as a
    // package with no metadata.
    if (/Unable to find package/i.test(stdout)) {
      throw new ToolError('NOT_FOUND', `Package "${packageName}" not found on device ${serial}`);
    }

    return this.parseDumpsysOutput(stdout, packageName);
  }

  /**
   * List WebView targets on a device via ADB port forwarding to Chrome DevTools.
   * @param serial device serial
   * @param hostPort local port to use for forwarding (default: 9222)
   * @returns array of debuggable WebView targets
   */
  async listWebViewTargets(serial: string, hostPort = 9222): Promise<CDPTarget[]> {
    if (!(await ensureAdbAvailable())) adbUnavailableError();

    // Forward port to the WebView devtools socket
    await this.forwardPort(serial, hostPort, 9222);

    try {
      const response = await fetch(`http://localhost:${hostPort}/json`, {
        signal: AbortSignal.timeout(5000),
      });
      const targets = (await response.json()) as CDPTarget[];
      return targets;
    } catch (err) {
      // Clean up forward on failure
      await this.removeForward(serial, hostPort).catch(() => {});
      throw new ToolError(
        'CONNECTION',
        `Failed to fetch WebView targets: ${err instanceof Error ? err.message : String(err)}. Ensure the app has ` +
          `android:debuggable="true".`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
  }

  // ── Internal helpers ──

  /** Parse `dumpsys package` output into APKInfo. */
  private parseDumpsysOutput(output: string, packageName: string): APKInfo {
    const info: APKInfo = {
      packageName,
      versionName: '',
      versionCode: '',
      permissions: [],
      activities: [],
      services: [],
      receivers: [],
    };

    // Version info
    const versionNameMatch = output.match(/versionName=([^\s]+)/);
    if (versionNameMatch) info.versionName = versionNameMatch[1] as string;

    const versionCodeMatch = output.match(/versionCode=(\d+)/);
    if (versionCodeMatch) info.versionCode = versionCodeMatch[1] as string;

    // SDK versions
    const minSdkMatch = output.match(/minSdk=(\d+)/);
    if (minSdkMatch) info.minSdk = minSdkMatch[1] as string;

    const targetSdkMatch = output.match(/targetSdk=(\d+)/);
    if (targetSdkMatch) info.targetSdk = targetSdkMatch[1] as string;

    // Parse components
    let currentSection: DumpsysSection = '';
    for (const line of output.split('\n')) {
      const nextSection = DUMPSYS_SECTION_MARKERS.find((marker) =>
        marker.needles.some((needle) => line.includes(needle)),
      );
      if (nextSection) {
        currentSection = nextSection.section;
        continue;
      }

      const trimmed = line.trim();

      // Permission lines appear both under an explicit section and in the main
      // body; the component sections never contribute permissions.
      if (trimmed.startsWith('android.permission.') || trimmed.startsWith('com.')) {
        const perm = trimmed.split(' ')[0];
        if (perm && (currentSection === 'permissions' || currentSection === '')) {
          info.permissions.push(perm);
        }
      }

      // Component lines carry the fully-qualified name as their first token.
      const componentBucket = COMPONENT_BUCKETS[currentSection];
      if (componentBucket && trimmed.includes(packageName)) {
        const nameMatch = trimmed.match(/(\S+)/);
        if (nameMatch) info[componentBucket].push(nameMatch[1] as string);
      }
    }

    // Deduplicate
    info.permissions = [...new Set(info.permissions)];
    info.activities = [...new Set(info.activities)];
    info.services = [...new Set(info.services)];
    info.receivers = [...new Set(info.receivers)];

    return info;
  }
}
