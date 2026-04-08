import { execFile } from 'node:child_process';
import type { ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { ToolError } from '@errors/ToolError';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_NETWORK_PORT = 5555;

const EXEC_OPTIONS: ExecFileOptionsWithStringEncoding = {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  windowsHide: true,
};

export interface ADBDeviceInfo {
  id: string;
  type: 'device' | 'emulator';
  product: string;
  model: string;
  transport: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getErrorOutput(error: unknown): string {
  if (!isRecord(error)) {
    return '';
  }

  const stdout = getStringValue(error.stdout);
  const stderr = getStringValue(error.stderr);
  return [stderr, stdout]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join('\n');
}

function getErrorCode(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }

  return getStringValue(error.code);
}

function readCapture(match: RegExpMatchArray | null, index: number): string | null {
  if (!match) {
    return null;
  }

  const value = match[index];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseVersionFromOutput(output: string): string | null {
  const webViewPackageVersion =
    readCapture(output.match(/Current WebView package.*\(([^()]+)\)/i), 1) ??
    readCapture(output.match(/versionName=([^\s]+)/i), 1);

  if (webViewPackageVersion) {
    return webViewPackageVersion.trim();
  }

  return null;
}

export class ADBClient {
  private connectedTarget: string | null = null;

  private async ensureLocalFileExists(filePath: string): Promise<void> {
    try {
      await access(filePath);
    } catch (error) {
      throw new ToolError('NOT_FOUND', `Local file not found: ${filePath}`, {
        toolName: 'adb-bridge',
        details: {
          filePath,
          reason: getErrorMessage(error),
        },
      });
    }
  }

  private normalizeError(args: string[], error: unknown): ToolError {
    if (error instanceof ToolError) {
      return error;
    }

    if (getErrorCode(error) === 'ENOENT') {
      return new ToolError(
        'PREREQUISITE',
        'ADB binary not found in PATH. Install Android Platform Tools and ensure `adb` is available.',
        {
          toolName: 'adb-bridge',
        },
      );
    }

    const output = getErrorOutput(error).trim();
    const message = output.length > 0 ? output : getErrorMessage(error);
    const lower = message.toLowerCase();

    if (
      lower.includes('device not found') ||
      lower.includes('no devices/emulators found') ||
      lower.includes('device offline') ||
      lower.includes('device unauthorized')
    ) {
      return new ToolError('NOT_FOUND', message, {
        toolName: 'adb-bridge',
        details: {
          command: ['adb', ...args].join(' '),
        },
      });
    }

    if (lower.includes('failed to connect') || lower.includes('unable to connect')) {
      return new ToolError('CONNECTION', message, {
        toolName: 'adb-bridge',
        details: {
          command: ['adb', ...args].join(' '),
        },
      });
    }

    return new ToolError('RUNTIME', message, {
      toolName: 'adb-bridge',
      details: {
        command: ['adb', ...args].join(' '),
      },
    });
  }

  private async runAdb(args: string[], timeout = DEFAULT_TIMEOUT_MS): Promise<string> {
    try {
      const adbPath = process.env['ADB_PATH'] ?? 'adb';
      const { stdout } = await execFileAsync(adbPath, args, {
        ...EXEC_OPTIONS,
        timeout,
      });
      return stdout;
    } catch (error) {
      throw this.normalizeError(args, error);
    }
  }

  async connect(host?: string, port?: number): Promise<void> {
    if (typeof host === 'string' && host.trim().length > 0) {
      const target = `${host.trim()}:${port ?? DEFAULT_NETWORK_PORT}`;
      const output = await this.runAdb(['connect', target]);

      if (/(failed|unable)/i.test(output)) {
        throw new ToolError('CONNECTION', output.trim(), {
          toolName: 'adb-bridge',
          details: {
            target,
          },
        });
      }

      this.connectedTarget = target;
      return;
    }

    await this.runAdb(['start-server']);
    this.connectedTarget = null;
  }

  async disconnect(): Promise<void> {
    if (this.connectedTarget) {
      await this.runAdb(['disconnect', this.connectedTarget]);
      this.connectedTarget = null;
      return;
    }

    await this.runAdb(['disconnect']);
  }

  async listDevices(): Promise<ADBDeviceInfo[]> {
    const output = await this.runAdb(['devices', '-l']);
    const devices: ADBDeviceInfo[] = [];

    for (const rawLine of output.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (
        line.length === 0 ||
        line.startsWith('List of devices attached') ||
        line.startsWith('*')
      ) {
        continue;
      }

      const parts = line.split(/\s+/);
      const id = parts[0];
      const state = parts[1];

      if (typeof id !== 'string' || typeof state !== 'string' || state !== 'device') {
        continue;
      }

      let product = '';
      let model = '';
      let transport = '';

      for (const part of parts.slice(2)) {
        const [key, value] = part.split(':', 2);
        if (typeof key !== 'string' || typeof value !== 'string') {
          continue;
        }

        if (key === 'product') {
          product = value;
        } else if (key === 'model') {
          model = value;
        } else if (key === 'transport_id' || key === 'transport' || key === 'usb') {
          transport = value;
        }
      }

      devices.push({
        id,
        type: id.startsWith('emulator-') ? 'emulator' : 'device',
        product,
        model,
        transport,
      });
    }

    return devices;
  }

  async shell(deviceId: string, command: string): Promise<string> {
    const output = await this.runAdb(['-s', deviceId, 'shell', command], 60_000);
    return output.replace(/\r?\n$/, '');
  }

  async reverse(deviceId: string, local: string, remote: string): Promise<void> {
    await this.runAdb(['-s', deviceId, 'reverse', local, remote]);
  }

  async install(deviceId: string, apkPath: string): Promise<void> {
    await this.ensureLocalFileExists(apkPath);
    await this.runAdb(['-s', deviceId, 'install', '-r', apkPath], 180_000);
  }

  async pull(deviceId: string, remotePath: string, localPath: string): Promise<void> {
    await this.runAdb(['-s', deviceId, 'pull', remotePath, localPath], 180_000);
  }

  async push(deviceId: string, localPath: string, remotePath: string): Promise<void> {
    await this.ensureLocalFileExists(localPath);
    await this.runAdb(['-s', deviceId, 'push', localPath, remotePath], 180_000);
  }

  async forward(deviceId: string, local: string, remote: string): Promise<void> {
    await this.runAdb(['-s', deviceId, 'forward', local, remote]);
  }

  async getWebViewVersion(deviceId: string): Promise<string | null> {
    const commands = [
      'cmd webviewupdate getCurrentWebViewPackage',
      'dumpsys webviewupdate',
      'dumpsys package com.google.android.webview',
      'dumpsys package com.android.webview',
      'dumpsys package com.android.chrome',
    ];

    for (const command of commands) {
      try {
        const output = await this.shell(deviceId, command);
        const version = parseVersionFromOutput(output);
        if (version) {
          return version;
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}
