import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import { ScriptManager } from '../../../modules/debugger/ScriptManager.js';
import { WorkerPool } from '../../../utils/WorkerPool.js';

export type TransformKind =
  | 'constant_fold'
  | 'string_decrypt'
  | 'dead_code_remove'
  | 'control_flow_flatten'
  | 'rename_vars';

interface TransformChainDefinition {
  name: string;
  transforms: TransformKind[];
  description?: string;
  createdAt: number;
}

export interface ApplyResult {
  transformed: string;
  appliedTransforms: TransformKind[];
}

interface CryptoHarnessRow {
  input: string;
  output: string;
  duration: number;
  error?: string;
}

interface WorkerHarnessMessage {
  ok: boolean;
  error?: string;
  results?: CryptoHarnessRow[];
}

export interface CryptoExtractCandidate {
  path: string;
  source: string;
  score: number;
}

export interface CryptoExtractPayload {
  targetPath: string | null;
  targetSource: string;
  candidates: CryptoExtractCandidate[];
  dependencies: string[];
  dependencySnippets: string[];
}

const SUPPORTED_TRANSFORMS: readonly TransformKind[] = [
  'constant_fold',
  'string_decrypt',
  'dead_code_remove',
  'control_flow_flatten',
  'rename_vars',
] as const;

const SUPPORTED_TRANSFORM_SET: ReadonlySet<string> = new Set(SUPPORTED_TRANSFORMS);

export const NUMERIC_BINARY_EXPR =
  /\b(-?\d+(?:\.\d+)?)\s*([+\-*/%])\s*(-?\d+(?:\.\d+)?)\b/g;
export const STRING_CONCAT_EXPR = /(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\+\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g;
export const STRING_LITERAL_EXPR = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
export const DEAD_CODE_IF_FALSE_WITH_ELSE =
  /if\s*\(\s*(?:false|0|!0\s*===\s*!1)\s*\)\s*\{([\s\S]*?)\}\s*else\s*\{([\s\S]*?)\}/g;
export const DEAD_CODE_IF_FALSE = /if\s*\(\s*(?:false|0|!0\s*===\s*!1)\s*\)\s*\{[\s\S]*?\}/g;

const WORKER_TIMEOUT_MS = 15000;
export const MAX_LCS_CELLS = 250000;

export const CRYPTO_KEYWORDS = [
  'cryptojs',
  'md5',
  'sha',
  'hmac',
  'sign',
  'signature',
  'encrypt',
  'decrypt',
  'aes',
  'rsa',
];

const CRYPTO_TEST_WORKER_SCRIPT = `
const __bootstrap = async () => {
  const [workerThreads, vm, perfHooks] = await Promise.all([
    import('node:worker_threads'),
    import('node:vm'),
    import('node:perf_hooks'),
  ]);

  const parentPort = workerThreads.parentPort;
  const performance = perfHooks.performance;

  if (!parentPort) {
    throw new Error('worker parentPort is unavailable');
  }

  function normalizeOutput(value) {
    if (value === undefined) return '__undefined__';
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    try { return JSON.stringify(value); } catch { return String(value); }
  }

  parentPort.on('message', async (msg) => {
    const { jobId, payload } = msg;
    try {
      const { code, functionName, testInputs } = payload;
      const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        Buffer,
        TextEncoder,
        TextDecoder,
        atob: (v) => Buffer.from(String(v), 'base64').toString('binary'),
        btoa: (v) => Buffer.from(String(v), 'binary').toString('base64'),
      };
      sandbox.globalThis = sandbox;
      const context = vm.createContext(sandbox);

      const isValidIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(functionName);
      const bindCode = isValidIdentifier
        ? "\\n;globalThis.__targetFn = (typeof " + functionName + " !== 'undefined' ? " + functionName + " : globalThis[" + JSON.stringify(functionName) + "]);"
        : "\\n;globalThis.__targetFn = globalThis[" + JSON.stringify(functionName) + "];";

      const script = new vm.Script(code + bindCode, { timeout: 5000 });
      script.runInContext(context, { timeout: 5000 });

      const targetFn = context.__targetFn;
      if (typeof targetFn !== 'function') {
        throw new Error("Function not found or not callable: " + functionName);
      }

      const rows = [];
      for (const input of testInputs) {
        const started = performance.now();
        try {
          const raw = targetFn(input);
          const resolved = raw && typeof raw.then === 'function' ? await raw : raw;
          rows.push({
            input,
            output: normalizeOutput(resolved),
            duration: Number((performance.now() - started).toFixed(3)),
          });
        } catch (err) {
          rows.push({
            input,
            output: '',
            error: err && err.message ? err.message : String(err),
            duration: Number((performance.now() - started).toFixed(3)),
          });
        }
      }

      parentPort.postMessage({ jobId, ok: true, result: { ok: true, results: rows } });
    } catch (error) {
      parentPort.postMessage({
        jobId,
        ok: true,
        result: {
          ok: false,
          error: error && error.message ? error.message : String(error),
          results: [],
        },
      });
    }
  });
};

__bootstrap().catch((error) => {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('crypto harness worker bootstrap failed:', error && error.message ? error.message : String(error));
  }
});
`;


export class TransformToolHandlersBase {
  protected collector: CodeCollector;
  protected chains: Map<string, TransformChainDefinition>;
  protected cryptoHarnessPool: WorkerPool<Record<string, unknown>, WorkerHarnessMessage>;

  constructor(collector: CodeCollector) {
    this.collector = collector;
    this.chains = new Map<string, TransformChainDefinition>();
    this.cryptoHarnessPool = new WorkerPool({
      name: 'crypto-harness',
      workerScript: CRYPTO_TEST_WORKER_SCRIPT,
      minWorkers: 0,
      maxWorkers: 4,
      idleTimeoutMs: 30_000,
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 8,
      },
    });
  }

  async close(): Promise<void> {
    await this.cryptoHarnessPool.close();
  }


  protected parseTransforms(raw: unknown): TransformKind[] {
    const values: string[] = Array.isArray(raw)
      ? raw.map((item) => String(item).trim()).filter((item) => item.length > 0)
      : typeof raw === 'string'
        ? raw
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
        : [];

    if (values.length === 0) {
      throw new Error('transforms must contain at least one transform');
    }

    const unique: TransformKind[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      if (!SUPPORTED_TRANSFORM_SET.has(value)) {
        throw new Error(`Unsupported transform: ${value}`);
      }
      if (!seen.has(value)) {
        seen.add(value);
        unique.push(value as TransformKind);
      }
    }

    return unique;
  }

  protected parseTestInputs(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
      throw new Error('testInputs must be an array of strings');
    }

    const normalized = raw.map((item) => String(item));
    if (normalized.length === 0) {
      throw new Error('testInputs cannot be empty');
    }
    return normalized;
  }

  protected parseBoolean(raw: unknown, defaultValue: boolean): boolean {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    if (typeof raw === 'number') {
      if (raw === 1) return true;
      if (raw === 0) return false;
    }
    return defaultValue;
  }

  protected requireString(raw: unknown, field: string): string {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new Error(`${field} must be a non-empty string`);
    }
    return raw;
  }

  protected escapeStringContent(value: string, quote: string): string {
    const escapedBackslash = value.replace(/\\/g, '\\\\');
    const escapedControls = escapedBackslash
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');

    if (quote === '"') {
      return escapedControls.replace(/"/g, '\\"');
    }
    return escapedControls.replace(/'/g, "\\'");
  }

  protected decodeEscapedString(value: string): string {
    return value
      .replace(/\\x([0-9a-fA-F]{2})/g, (_full, hex: string) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_full, hex: string) =>
        String.fromCodePoint(parseInt(hex, 16))
      )
      .replace(/\\u([0-9a-fA-F]{4})/g, (_full, hex: string) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\v/g, '\v')
      .replace(/\\f/g, '\f')
      .replace(/\\0/g, '\0')
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'");
  }

  protected async resolveScriptSource(scriptId: string): Promise<string> {
    let manager: ScriptManager | null = null;
    try {
      manager = new ScriptManager(this.collector);
      const script = await manager.getScriptSource(scriptId);
      if (script?.source && script.source.length > 0) {
        return script.source;
      }
    } catch {
      // fallback chain continues
    } finally {
      if (manager) {
        try {
          await manager.close();
        } catch {
          // ignore close errors
        }
      }
    }

    const fromCache = this.collector.getFileByUrl(scriptId);
    if (fromCache?.content && fromCache.content.length > 0) {
      return fromCache.content;
    }

    const page = await this.collector.getActivePage();
    const pageSource = await page.evaluate(
      async (id: string): Promise<string> => {
        const scripts = Array.from(document.scripts);

        const byNumericIndex = Number(id);
        if (
          Number.isInteger(byNumericIndex) &&
          byNumericIndex >= 0 &&
          byNumericIndex < scripts.length
        ) {
          const script = scripts[byNumericIndex] as HTMLScriptElement;
          if (script.textContent && script.textContent.trim().length > 0) {
            return script.textContent;
          }
          if (script.src) {
            try {
              const response = await fetch(script.src);
              if (response.ok) {
                return await response.text();
              }
            } catch {
              // ignore and continue
            }
          }
        }

        for (const script of scripts as HTMLScriptElement[]) {
          if (script.id === id || (script.dataset && script.dataset.scriptId === id)) {
            if (script.textContent && script.textContent.trim().length > 0) {
              return script.textContent;
            }
            if (script.src) {
              try {
                const response = await fetch(script.src);
                if (response.ok) {
                  return await response.text();
                }
              } catch {
                // ignore and continue
              }
            }
          }

          if (script.src && script.src.includes(id)) {
            try {
              const response = await fetch(script.src);
              if (response.ok) {
                return await response.text();
              }
            } catch {
              // ignore and continue
            }
          }
        }

        return '';
      },
      scriptId
    );

    if (typeof pageSource === 'string' && pageSource.length > 0) {
      return pageSource;
    }

    throw new Error(`Unable to resolve source from scriptId: ${scriptId}`);
  }

  protected resolveFunctionName(targetFunction: string, targetPath: string, source: string): string {
    const extractLastSegment = (value: string): string => {
      const normalized = value.startsWith('window.') ? value.slice(7) : value;
      const parts = normalized.split('.').filter(Boolean);
      return parts.length > 0 ? parts[parts.length - 1]! : '';
    };

    const candidateFromTarget = extractLastSegment(targetFunction);
    if (this.isValidIdentifier(candidateFromTarget)) {
      return candidateFromTarget;
    }

    const candidateFromPath = extractLastSegment(targetPath);
    if (this.isValidIdentifier(candidateFromPath)) {
      return candidateFromPath;
    }

    const match = source.match(/function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
    if (match?.[1] && this.isValidIdentifier(match[1])) {
      return match[1];
    }

    return 'extractedCryptoFn';
  }

  protected isValidIdentifier(value: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
  }

  protected buildCryptoPolyfills(): string {
    return `
const __textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const __textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

if (typeof globalThis.atob === 'undefined') {
  globalThis.atob = (value) => Buffer.from(String(value), 'base64').toString('binary');
}
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (value) => Buffer.from(String(value), 'binary').toString('base64');
}
`.trim();
  }

  protected async runCryptoHarness(
    code: string,
    functionName: string,
    testInputs: string[]
  ): Promise<{ results: CryptoHarnessRow[]; allPassed: boolean }> {
    try {
      const msg = await this.cryptoHarnessPool.submit(
        { code, functionName, testInputs } as unknown as Record<string, unknown>,
        WORKER_TIMEOUT_MS
      );

      if (!msg.ok) {
        return {
          results: testInputs.map((input) => ({
            input,
            output: '',
            duration: 0,
            error: msg.error ?? 'Worker execution failed',
          })),
          allPassed: false,
        };
      }

      const rows = Array.isArray(msg.results) ? msg.results : [];
      const allPassed = rows.every((row) => !row.error);
      return { results: rows, allPassed };
    } catch (error) {
      return {
        results: testInputs.map((input) => ({
          input,
          output: '',
          duration: 0,
          error: error instanceof Error ? error.message : String(error),
        })),
        allPassed: false,
      };
    }
  }

  protected toTextResponse(payload: unknown) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  protected fail(tool: string, error: unknown) {
    return this.toTextResponse({
      tool,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

