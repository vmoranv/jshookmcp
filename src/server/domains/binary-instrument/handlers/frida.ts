/**
 * Frida dex-dump handler.
 */

import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { ToolError } from '@errors/ToolError';
import { fridaDeviceArgs, type FridaDevice } from '@modules/binary-instrument';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import { getSafeOutputRoots } from '@utils/outputPaths';
import { resolveSafeOutputPath } from '@utils/safeOutput';
import { probeCommand } from '@modules/external/ToolProbe';
import {
  readRequiredString,
  readOptionalString,
  readOptionalNumber,
  readOptionalBoolean,
  resolveFridaDevice,
  jsonResponse,
} from './shared';

/**
 * Resolve a package/process name to a pid via `frida-ps -j` on the same device.
 * frida-dexdump's `-n <name>` path spawns and fails on already-running Android
 * apps ("Failed to spawn: unable to find process"); `-p <pid>` attaches and
 * works. Resolving first keeps the name-based API usable.
 */
function resolvePidByName(device: FridaDevice, name: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile(
      'frida-ps',
      [...fridaDeviceArgs(device), '-j'],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        try {
          const list = JSON.parse(stdout) as Array<{
            pid?: number;
            name?: string;
            identifier?: string;
          }>;
          const hit = list.find((p) => p.name === name || p.identifier === name);
          resolve(typeof hit?.pid === 'number' ? hit.pid : undefined);
        } catch {
          resolve(undefined);
        }
      },
    );
  });
}

/**
 * adb fallback for name → pid. frida-ps does not always list an Android app's
 * main process (it can expose only `pkg:subprocess` entries), while `pidof`
 * still resolves the main pid. Only used for USB devices with a plain
 * package/process name so nothing is shell-injected.
 */
function resolvePidViaAdb(name: string): Promise<number | undefined> {
  if (!/^[A-Za-z0-9._:-]+$/.test(name)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile(
      'adb',
      ['shell', `pidof ${name}`],
      { encoding: 'utf8', windowsHide: true, timeout: 5_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        const match = /\b(\d+)\b/.exec(stdout);
        resolve(match ? Number(match[1]) : undefined);
      },
    );
  });
}

export class FridaDexDumpHandlers {
  async handleFridaDexDump(args: Record<string, unknown>): Promise<unknown> {
    const outputDir = await resolveSafeOutputPath(readRequiredString(args, 'outputDir'), {
      allowedRoots: getSafeOutputRoots(),
      allowedRootsDescription: 'project root or system temp directory',
    });
    const target = readOptionalString(args, 'target');
    const pid = readOptionalNumber(args, 'pid');
    const usb = readOptionalBoolean(args, 'usb') ?? true;
    const config = getReverseEngineeringConfig().frida;
    const timeoutMs = readOptionalNumber(args, 'timeoutMs') ?? config.dexDumpTimeoutMs;
    if (!pid && !target) {
      throw new ToolError('VALIDATION', 'Either pid or target must be provided for frida_dex_dump');
    }
    const probe = await probeCommand('frida-dexdump', ['--help']);
    if (!probe.available) {
      return jsonResponse({
        available: false,
        capability: 'frida-dexdump',
        fix: 'Install with `pip install frida-dexdump` and ensure it is on PATH.',
        reason: probe.reason ?? 'frida-dexdump is not available',
      });
    }
    await mkdir(outputDir, { recursive: true });
    // Device precedence: an explicit device arg wins; otherwise fall back to
    // the legacy usb boolean (default true → -U) for backward compatibility.
    const resolvedDevice = resolveFridaDevice(args);
    if (resolvedDevice && 'error' in resolvedDevice) {
      throw new ToolError('VALIDATION', resolvedDevice.error);
    }
    const device: FridaDevice = resolvedDevice ?? (usb ? { type: 'usb' } : { type: 'local' });

    const dexArgs: string[] = [...fridaDeviceArgs(device)];
    let resolvedPid = pid ?? (target ? await resolvePidByName(device, target) : undefined);
    if (!resolvedPid && target && device.type === 'usb') {
      resolvedPid = await resolvePidViaAdb(target);
    }
    if (resolvedPid) dexArgs.push('-p', String(resolvedPid));
    else if (target) dexArgs.push('-n', target);
    dexArgs.push('-o', outputDir);

    const result = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
      signal?: string;
    }>((resolve) => {
      execFile(
        probe.path ?? 'frida-dexdump',
        dexArgs,
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: timeoutMs,
          maxBuffer: config.dexDumpMaxBufferBytes,
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: typeof stdout === 'string' ? stdout : '',
            stderr: typeof stderr === 'string' ? stderr : '',
            exitCode:
              typeof (error as { code?: unknown } | null)?.code === 'number'
                ? ((error as { code: number }).code ?? 1)
                : 0,
            signal:
              typeof (error as { signal?: unknown } | null)?.signal === 'string'
                ? ((error as { signal: string }).signal ?? undefined)
                : undefined,
          });
        },
      );
    });
    const dumpedFiles = await this.findFilesByExtension(
      outputDir,
      ['.dex', '.cdex'],
      config.dexDumpFileLimit,
    );
    const success = result.exitCode === 0 && dumpedFiles.length > 0;
    return jsonResponse({
      available: true,
      success,
      target,
      pid: resolvedPid ?? pid,
      ...(resolvedPid && !pid && target ? { resolvedFromName: target } : {}),
      device,
      outputDir,
      dumpedFiles,
      count: dumpedFiles.length,
      ...(!success && result.exitCode === 0
        ? { reason: 'No DEX/CDEX artifacts were produced by frida-dexdump.' }
        : {}),
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      ...(result.signal ? { signal: result.signal } : {}),
    });
  }

  private async findFilesByExtension(
    root: string,
    extensions: string[],
    limit: number,
  ): Promise<string[]> {
    const { readdir } = await import('node:fs/promises');
    const { join, relative } = await import('node:path');
    const out: string[] = [];
    const lowerExts = extensions.map((ext) => ext.toLowerCase());
    const walk = async (directory: string): Promise<void> => {
      if (out.length >= limit) return;
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (out.length >= limit) return;
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!lowerExts.some((ext) => entry.name.toLowerCase().endsWith(ext))) continue;
        out.push(relative(root, fullPath).replace(/\\/g, '/'));
      }
    };
    await walk(root);
    return out;
  }
}
