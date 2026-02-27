/**
 * ExternalToolRunner — Safe, unified external CLI invocation.
 *
 * Security guarantees:
 * - Only registered tools can be invoked (ToolRegistry allowlist)
 * - Always uses execFile/spawn with shell:false (no shell injection)
 * - Arguments are array-only (no string concatenation)
 * - Output size bounded (truncation on overflow)
 * - Timeout enforced per invocation
 * - CWD boundary checked against project root
 */

import { spawn } from 'node:child_process';
import { resolve, relative, sep } from 'node:path';
import { getProjectRoot } from '../../utils/outputPaths.js';
import { logger } from '../../utils/logger.js';
import { ioLimit } from '../../utils/concurrency.js';
import { ToolRegistry } from './ToolRegistry.js';
import type {
  ToolRunRequest,
  ToolRunResult,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_STDOUT = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_STDERR = 1 * 1024 * 1024;  // 1MB

export class ExternalToolRunner {
  constructor(private readonly registry: ToolRegistry) {}

  /**
   * Probe all registered tools for availability.
   */
  async probeAll(force = false) {
    return this.registry.probeAll(force);
  }

  /**
   * Run an external tool safely.
   * Wrapped in ioLimit for global concurrency control.
   */
  async run(request: ToolRunRequest): Promise<ToolRunResult> {
    return ioLimit(() => this._run(request));
  }

  private async _run(request: ToolRunRequest): Promise<ToolRunResult> {
    const spec = this.registry.getSpec(request.tool);

    // Check availability
    const probe = this.registry.getCachedProbe(request.tool);
    if (probe && !probe.available) {
      return {
        ok: false,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: `Tool '${request.tool}' (${spec.command}) is not available: ${probe.reason}`,
        durationMs: 0,
        truncated: false,
      };
    }

    // Validate and resolve CWD
    const cwd = this.validateCwd(request.cwd);

    // Build argument list
    const args = [...(spec.defaultArgs || []), ...request.args];

    // Build minimal environment
    const env: Record<string, string> = { PATH: process.env.PATH || '' };
    if (process.platform === 'win32') {
      env.SYSTEMROOT = process.env.SYSTEMROOT || 'C:\\Windows';
      env.TEMP = process.env.TEMP || '';
      env.TMP = process.env.TMP || '';
    }
    if (spec.envAllowlist) {
      for (const key of spec.envAllowlist) {
        if (process.env[key]) {
          env[key] = process.env[key]!;
        }
      }
    }

    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxStdout = request.maxStdoutBytes ?? DEFAULT_MAX_STDOUT;
    const maxStderr = request.maxStderrBytes ?? DEFAULT_MAX_STDERR;

    logger.debug(`[ExternalToolRunner] Running: ${spec.command} ${args.join(' ')}`);
    const startTime = Date.now();

    return new Promise<ToolRunResult>((resolvePromise) => {
      const child = spawn(spec.command, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);

        const durationMs = Date.now() - startTime;
        const result: ToolRunResult = {
          ok: exitCode === 0,
          exitCode,
          signal,
          stdout,
          stderr,
          durationMs,
          truncated: stdoutTruncated || stderrTruncated,
        };

        if (result.ok) {
          logger.debug(`[ExternalToolRunner] ${spec.command} completed in ${durationMs}ms`);
        } else {
          logger.warn(`[ExternalToolRunner] ${spec.command} failed (exit=${exitCode}, signal=${signal}) in ${durationMs}ms`);
        }

        resolvePromise(result);
      };

      // Timeout
      timeoutHandle = setTimeout(() => {
        if (!settled) {
          child.kill('SIGTERM');
          // Give it 2s to gracefully exit before SIGKILL
          setTimeout(() => {
            if (!settled) {
              child.kill('SIGKILL');
              finish(null, 'SIGKILL');
            }
          }, 2000);
          request.onProgress?.({ phase: 'timeout', ts: Date.now() });
        }
      }, timeoutMs);

      // Pipe stdin if provided
      if (request.stdin) {
        child.stdin.write(request.stdin);
        child.stdin.end();
      } else {
        child.stdin.end();
      }

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < maxStdout) {
          const remaining = maxStdout - stdout.length;
          stdout += chunk.toString('utf-8', 0, Math.min(chunk.length, remaining));
          if (stdout.length >= maxStdout) stdoutTruncated = true;
        }
        request.onProgress?.({
          phase: 'stdout',
          bytesRead: stdout.length,
          ts: Date.now(),
        });
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < maxStderr) {
          const remaining = maxStderr - stderr.length;
          stderr += chunk.toString('utf-8', 0, Math.min(chunk.length, remaining));
          if (stderr.length >= maxStderr) stderrTruncated = true;
        }
        request.onProgress?.({
          phase: 'stderr',
          bytesRead: stderr.length,
          ts: Date.now(),
        });
      });

      child.on('close', (code, signal) => {
        finish(code, signal as NodeJS.Signals | null);
      });

      child.on('error', (err) => {
        stderr += `\nSpawn error: ${err.message}`;
        finish(1, null);
      });

      request.onProgress?.({ phase: 'spawn', ts: Date.now() });
    });
  }

  /**
   * Validate that the CWD is within the project root or system temp.
   */
  private validateCwd(requestedCwd?: string): string {
    if (!requestedCwd) {
      return getProjectRoot();
    }

    const resolved = resolve(requestedCwd);
    const projectRoot = getProjectRoot();
    const rel = relative(projectRoot, resolved);

    // Allow project root subdirectories
    if (rel && !rel.startsWith('..') && !resolve(rel).startsWith(sep)) {
      return resolved;
    }

    // Allow system temp directories
    const tmpDirs = [
      process.env.TEMP,
      process.env.TMP,
      '/tmp',
      '/var/tmp',
    ].filter(Boolean);

    for (const tmp of tmpDirs) {
      if (tmp && resolved.startsWith(resolve(tmp))) {
        return resolved;
      }
    }

    logger.warn(`[ExternalToolRunner] CWD '${requestedCwd}' outside allowed boundaries, using project root`);
    return projectRoot;
  }
}
