/**
 * Tool availability probe.
 * Detects whether external CLI tools are available on the system.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  available: boolean;
  path?: string;
  version?: string;
  reason?: string;
}

/**
 * Check if a command exists and optionally extract its version.
 */
export async function probeCommand(
  command: string,
  versionArgs: string[] = ['--version'],
  timeoutMs = 5000
): Promise<ProbeResult> {
  try {
    // On Windows, use 'where'; on Unix, use 'which'
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const { stdout: pathOutput } = await execFileAsync(whichCmd, [command], {
      timeout: timeoutMs,
      windowsHide: true,
    });
    const resolvedPath = pathOutput.trim().split(/\r?\n/)[0];

    // Try to get version
    let version: string | undefined;
    try {
      const { stdout: versionOutput } = await execFileAsync(command, versionArgs, {
        timeout: timeoutMs,
        windowsHide: true,
      });
      const firstLine = versionOutput.trim().split(/\r?\n/)[0];
      version = firstLine ? firstLine.substring(0, 100) : undefined;
    } catch {
      // Version check failure is non-fatal
    }

    return { available: true, path: resolvedPath, version };
  } catch (err: any) {
    return {
      available: false,
      reason: err.code === 'ENOENT'
        ? `Command '${command}' not found in PATH`
        : `Probe failed: ${err.message?.substring(0, 200)}`,
    };
  }
}

/**
 * Probe multiple commands and return a summary.
 */
export async function probeAll(
  specs: Array<{ command: string; versionArgs?: string[] }>
): Promise<Map<string, ProbeResult>> {
  const results = new Map<string, ProbeResult>();

  const promises = specs.map(async (spec) => {
    const result = await probeCommand(spec.command, spec.versionArgs);
    results.set(spec.command, result);
    if (result.available) {
      logger.debug(`[ToolProbe] ${spec.command}: available at ${result.path} (${result.version || 'unknown version'})`);
    } else {
      logger.debug(`[ToolProbe] ${spec.command}: not available — ${result.reason}`);
    }
  });

  await Promise.all(promises);
  return results;
}
