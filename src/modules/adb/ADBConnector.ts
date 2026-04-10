/**
 * ADB Connector — wraps @devicefarmer/adbkit for device management,
 * shell commands, APK pull/analysis, and WebView CDP debugging.
 *
 * Uses adbkit v3 API: Client.getDevice(serial) → DeviceClient for all operations.
 *
 * Graceful degradation: if ADB server binary or adbkit is unavailable,
 * all methods return actionable errors.
 */

import { execSync, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import type { Duplex, Readable } from 'node:stream';
import type { ADBDevice, ADBForwardEntry, APKInfo, ADBShellResult, CDPTarget } from './types.js';

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
  throw new Error(
    'ADB server binary not found in PATH. Install Android Platform Tools: https://developer.android.com/studio/command-line/adb',
  );
}

function sdkUnavailableError(): never {
  throw new Error('@devicefarmer/adbkit is not installed. Run: npm install @devicefarmer/adbkit');
}

/** Check if ADB binary is accessible. */
function checkADBBinary(): boolean {
  try {
    execSync('adb version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Get or create an adbkit Client instance. */
let _clientCache: InstanceType<typeof import('@devicefarmer/adbkit').Client> | null = null;
async function getClient(): Promise<InstanceType<typeof import('@devicefarmer/adbkit').Client>> {
  if (_clientCache) return _clientCache;
  const sdk = await loadAdbkit();
  if (!sdk) sdkUnavailableError();
  _clientCache = new sdk.Client();
  return _clientCache;
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
   * Verify ADB server binary is in PATH.
   * @returns true if ADB is available, false otherwise
   */
  checkADBAvailable(): boolean {
    return checkADBBinary();
  }

  /**
   * List all connected Android devices.
   * @returns array of ADBDevice with serial, model, product, state, sdkVersion, abi
   */
  async listDevices(): Promise<ADBDevice[]> {
    if (!checkADBBinary()) adbUnavailableError();

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
        transportId: d.transportId,
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
    if (!checkADBBinary()) adbUnavailableError();

    const client = await getClient();
    const deviceClient = client.getDevice(serial);
    const socket = await deviceClient.shell(command);
    const output = await readStreamAll(socket);
    const stdout = output.toString('utf8').trimEnd();

    return {
      stdout,
      stderr: '',
      exitCode: 0,
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
    if (!checkADBBinary()) adbUnavailableError();

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
    if (!checkADBBinary()) adbUnavailableError();

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
    if (!checkADBBinary()) adbUnavailableError();

    // Validate serial to prevent command injection
    if (!/^[a-zA-Z0-9._:@-]+$/.test(serial)) {
      throw new Error(`Invalid device serial format: ${serial}`);
    }

    // Use execFileSync with argument array to prevent shell injection
    try {
      execFileSync('adb', ['-s', serial, 'forward', '--remove', `tcp:${localPort}`], {
        stdio: 'pipe',
        timeout: 5000,
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
    if (!checkADBBinary()) adbUnavailableError();

    // First get the APK path on device
    const { stdout } = await this.shellCommand(serial, `pm path ${packageName}`);

    // Parse "package:/data/app/~~xxx/base.apk" format
    const match = stdout.match(/package:(.+)/);
    if (!match) {
      throw new Error(`Package "${packageName}" not found on device ${serial}`);
    }
    const apkPath = match[1] as string;

    // Pull the file via DeviceClient
    const client = await getClient();
    const deviceClient = client.getDevice(serial);
    const transfer = await deviceClient.pull(apkPath);
    const writeStream = createWriteStream(outputPath);
    (transfer as unknown as Readable).pipe(writeStream);

    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
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
    if (!checkADBBinary()) adbUnavailableError();

    const { stdout } = await this.shellCommand(serial, `dumpsys package ${packageName}`);

    return this._parseDumpsysOutput(stdout, packageName);
  }

  /**
   * List WebView targets on a device via ADB port forwarding to Chrome DevTools.
   * @param serial device serial
   * @param hostPort local port to use for forwarding (default: 9222)
   * @returns array of debuggable WebView targets
   */
  async listWebViewTargets(serial: string, hostPort = 9222): Promise<CDPTarget[]> {
    if (!checkADBBinary()) adbUnavailableError();

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
      throw new Error(
        `Failed to fetch WebView targets: ${err instanceof Error ? err.message : String(err)}. Ensure the app has android:debuggable="true".`,
        { cause: err },
      );
    }
  }

  // ── Internal helpers ──

  /** Parse `dumpsys package` output into APKInfo. */
  private _parseDumpsysOutput(output: string, packageName: string): APKInfo {
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
    const sections = output.split('\n');
    let currentSection = '';

    for (const line of sections) {
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
            info.permissions.push(perm);
          } else if (!currentSection) {
            // Requested permissions appear in main section
            info.permissions.push(perm);
          }
        }
      }

      if (currentSection === 'activities' && trimmed.includes(packageName)) {
        const activityMatch = trimmed.match(/(\S+)/);
        if (activityMatch) info.activities.push(activityMatch[1] as string);
      }
      if (currentSection === 'services' && trimmed.includes(packageName)) {
        const serviceMatch = trimmed.match(/(\S+)/);
        if (serviceMatch) info.services.push(serviceMatch[1] as string);
      }
      if (currentSection === 'receivers' && trimmed.includes(packageName)) {
        const receiverMatch = trimmed.match(/(\S+)/);
        if (receiverMatch) info.receivers.push(receiverMatch[1] as string);
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
