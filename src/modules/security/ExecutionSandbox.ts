/**
 * ExecutionSandbox — Safe code execution for untrusted JavaScript.
 *
 * Uses worker_threads + vm module to isolate dynamic code execution
 * (e.g., deobfuscation eval, packer unpacking).
 *
 * Security:
 * - Runs in a separate worker thread (process isolation)
 * - vm.createContext with empty global (no require, no fs, no net)
 * - Timeout enforcement via worker termination
 * - Memory limit via worker resourceLimits
 */

import { Worker } from 'node:worker_threads';
import { logger } from '../../utils/logger.js';
import { cpuLimit } from '../../utils/concurrency.js';

export interface SandboxExecuteRequest {
  /** JavaScript code to execute */
  code: string;
  /** Execution timeout in ms (default: 5000) */
  timeoutMs?: number;
  /** Memory limit in MB (default: 128) */
  memoryLimitMB?: number;
}

export interface SandboxExecuteResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  timedOut: boolean;
  durationMs: number;
}

interface SandboxWorkerMessage {
  ok: boolean;
  output?: unknown;
  error?: string;
  timedOut?: boolean;
}

// Worker script as inline string — runs as ESM worker to avoid CommonJS require().
const WORKER_SCRIPT = `
import { workerData, parentPort } from 'node:worker_threads';
import * as vm from 'node:vm';

const { code, timeoutMs } = workerData;

try {
  // Create an isolated context with minimal globals
  const sandbox = {
    // Safe built-ins only
    parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent,
    encodeURI, decodeURI,
    JSON: { parse: JSON.parse, stringify: JSON.stringify },
    Math,
    String, Number, Boolean, Array, Object, Map, Set,
    Date, RegExp, Error, TypeError, RangeError,
    Promise,
    Symbol,
    undefined,
    NaN,
    Infinity,
    // Explicitly denied: require, process, __filename, __dirname, Buffer, setTimeout, setInterval, fetch
  };

  const context = vm.createContext(sandbox, {
    name: 'jshhook-sandbox',
    codeGeneration: { strings: false, wasm: false },
  });

  const script = new vm.Script(code, {
    filename: 'sandbox-eval.js',
    timeout: timeoutMs,
  });

  const result = script.runInContext(context, { timeout: timeoutMs });
  parentPort.postMessage({ ok: true, output: result });
} catch (err) {
  parentPort.postMessage({
    ok: false,
    error: err.message || String(err),
    timedOut: err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT',
  });
}
`;

export class ExecutionSandbox {
  /**
   * Execute JavaScript in an isolated sandbox.
   * Wrapped in cpuLimit for global concurrency control.
   */
  async execute(request: SandboxExecuteRequest): Promise<SandboxExecuteResult> {
    return cpuLimit(() => this._execute(request));
  }

  private _execute(request: SandboxExecuteRequest): Promise<SandboxExecuteResult> {
    const timeoutMs = request.timeoutMs ?? 5000;
    const memoryLimitMB = request.memoryLimitMB ?? 128;
    const startTime = Date.now();

    return new Promise<SandboxExecuteResult>((resolve) => {
      let settled = false;
      let terminationTimeout: ReturnType<typeof setTimeout> | undefined;

      const workerOptions: ConstructorParameters<typeof Worker>[1] & { type?: 'module' } = {
        eval: true,
        workerData: {
          code: request.code,
          timeoutMs,
        },
        resourceLimits: {
          maxOldGenerationSizeMb: memoryLimitMB,
          maxYoungGenerationSizeMb: Math.ceil(memoryLimitMB / 4),
          stackSizeMb: 4,
        },
      };
      workerOptions.type = 'module';

      const worker = new Worker(WORKER_SCRIPT, workerOptions);

      const finish = (result: Omit<SandboxExecuteResult, 'durationMs'>) => {
        if (settled) return;
        settled = true;
        if (terminationTimeout) clearTimeout(terminationTimeout);
        resolve({ ...result, durationMs: Date.now() - startTime });
      };

      // Hard timeout: terminate worker if it doesn't respond
      terminationTimeout = setTimeout(() => {
        if (!settled) {
          worker.terminate();
          logger.warn(`[ExecutionSandbox] Worker terminated after ${timeoutMs + 2000}ms`);
          finish({ ok: false, error: 'Execution timed out (worker terminated)', timedOut: true });
        }
      }, timeoutMs + 2000);

      worker.on('message', (msg: SandboxWorkerMessage) => {
        finish({
          ok: msg.ok,
          output: msg.output,
          error: msg.error,
          timedOut: msg.timedOut || false,
        });
        worker.terminate();
      });

      worker.on('error', (err: Error) => {
        finish({
          ok: false,
          error: `Worker error: ${err.message}`,
          timedOut: false,
        });
      });

      worker.on('exit', (code) => {
        if (!settled) {
          finish({
            ok: false,
            error: `Worker exited unexpectedly with code ${code}`,
            timedOut: false,
          });
        }
      });
    });
  }
}
