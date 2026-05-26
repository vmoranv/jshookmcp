/**
 * Detect whether the `rg` (ripgrep) executable is available on the host.
 *
 * Result is cached for the lifetime of the process (ripgrep does not get
 * installed mid-session in practice). Tests reset the cache via
 * {@link resetRipgrepDetection}.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RipgrepProbeResult {
  available: boolean;
  /** Resolved absolute path to the `rg` executable, when available. */
  path?: string;
  /** First line of `rg --version`, when available. */
  version?: string;
  /** Reason the probe failed. Present when `available: false`. */
  reason?: string;
}

let cached: RipgrepProbeResult | undefined;
let inFlight: Promise<RipgrepProbeResult> | undefined;

/** Internal: reset memoised state. Test-only. */
export function resetRipgrepDetection(): void {
  cached = undefined;
  inFlight = undefined;
}

/** Override the cached probe result. Test-only. */
export function setRipgrepDetectionForTests(result: RipgrepProbeResult | undefined): void {
  cached = result;
  inFlight = undefined;
}

/**
 * Probe for ripgrep. The result is cached after the first call so
 * repeated searches do not re-spawn `where`/`which` and `rg --version`.
 *
 * @param timeoutMs Per-spawn timeout in ms; defaults to 3000.
 */
export async function detectRipgrep(timeoutMs = 3000): Promise<RipgrepProbeResult> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<RipgrepProbeResult> => {
    try {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const { stdout: pathOutput } = await execFileAsync(whichCmd, ['rg'], {
        timeout: timeoutMs,
        windowsHide: true,
      });
      const resolvedPath = pathOutput.trim().split(/\r?\n/)[0];
      if (!resolvedPath) {
        const result: RipgrepProbeResult = {
          available: false,
          reason: `'${whichCmd} rg' produced empty output`,
        };
        cached = result;
        return result;
      }

      let version: string | undefined;
      try {
        const { stdout } = await execFileAsync('rg', ['--version'], {
          timeout: timeoutMs,
          windowsHide: true,
        });
        const firstLine = stdout.trim().split(/\r?\n/)[0];
        version = firstLine ? firstLine.substring(0, 100) : undefined;
      } catch {
        // Version check failure is non-fatal — fall through to available:true
      }

      const result: RipgrepProbeResult = version
        ? { available: true, path: resolvedPath, version }
        : { available: true, path: resolvedPath };
      cached = result;
      return result;
    } catch (err: unknown) {
      const errorCode =
        typeof err === 'object' && err !== null && 'code' in err
          ? (err as { code?: string }).code
          : undefined;
      const errorMessage =
        err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err);
      const result: RipgrepProbeResult = {
        available: false,
        reason:
          errorCode === 'ENOENT'
            ? "Command 'rg' not found in PATH — install ripgrep (brew/apt/scoop install ripgrep)"
            : `Probe failed: ${errorMessage.substring(0, 200)}`,
      };
      cached = result;
      return result;
    } finally {
      inFlight = undefined;
    }
  })();

  return inFlight;
}
