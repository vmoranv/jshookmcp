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

export class FridaHandlers {
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
    if (pid) dexArgs.push('-p', String(pid));
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
      pid,
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
