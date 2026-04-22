/**
 * Shared types, constants, and utilities for transform domain sub-handlers.
 */

import type { CodeCollector } from '@server/domains/shared/modules';
import { ScriptManager } from '@server/domains/shared/modules';
import { WorkerPool } from '@utils/WorkerPool';
import {
  TRANSFORM_WORKER_TIMEOUT_MS,
  TRANSFORM_CRYPTO_POOL_MAX_WORKERS,
  TRANSFORM_CRYPTO_POOL_IDLE_TIMEOUT_MS,
  TRANSFORM_CRYPTO_POOL_MAX_OLD_GEN_MB,
  TRANSFORM_CRYPTO_POOL_MAX_YOUNG_GEN_MB,
} from '@src/constants';

export type TransformKind =
  | 'constant_fold'
  | 'string_decrypt'
  | 'dead_code_remove'
  | 'control_flow_flatten'
  | 'rename_vars';

export interface ApplyResult {
  transformed: string;
  appliedTransforms: TransformKind[];
}

export interface TransformChainDefinition {
  name: string;
  transforms: TransformKind[];
  description?: string;
  createdAt: number;
}

interface CryptoHarnessRow {
  input: string;
  output: string;
  duration: number;
  error?: string;
}

export interface WorkerHarnessMessage {
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

export const SUPPORTED_TRANSFORMS = [
  'constant_fold',
  'string_decrypt',
  'dead_code_remove',
  'control_flow_flatten',
  'rename_vars',
] as const satisfies readonly TransformKind[];

export const SUPPORTED_TRANSFORM_SET: ReadonlySet<string> = new Set(SUPPORTED_TRANSFORMS);

export const NUMERIC_BINARY_EXPR = /\b(-?\d+(?:\.\d+)?)\s*([+\-*/%])\s*(-?\d+(?:\.\d+)?)\b/g;
export const STRING_CONCAT_EXPR =
  /(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\+\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g;
export const STRING_LITERAL_EXPR = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
export const DEAD_CODE_IF_FALSE_WITH_ELSE =
  /if\s*\(\s*(?:false|0|!0\s*===\s*!1)\s*\)\s*\{([\s\S]*?)\}\s*else\s*\{([\s\S]*?)\}/g;
export const DEAD_CODE_IF_FALSE = /if\s*\(\s*(?:false|0|!0\s*===\s*!1)\s*\)\s*\{[\s\S]*?\}/g;

export const WORKER_TIMEOUT_MS = TRANSFORM_WORKER_TIMEOUT_MS;

export const enum TransformLimit {
  MAX_LCS_CELLS = 250000,
}

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

export const CRYPTO_TEST_WORKER_SCRIPT = `
const __bootstrap = async () => {
  const [workerThreads, vm, perfHooks] = await Promise.all([
    import('node:worker_threads'), import('node:vm'), import('node:perf_hooks'),
  ]);
  const parentPort = workerThreads.parentPort;
  const performance = perfHooks.performance;
  if (!parentPort) throw new Error('worker parentPort is unavailable');
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
      const sandbox = Object.create(null);
      sandbox.console = Object.freeze({ log() {}, warn() {}, error() {} });
      sandbox.Buffer = { from: (...args) => Buffer.from(...args), alloc: (size) => Buffer.alloc(Math.min(size, 1048576)), concat: (...args) => Buffer.concat(...args) };
      Object.freeze(sandbox.Buffer);
      sandbox.TextEncoder = TextEncoder; sandbox.TextDecoder = TextDecoder;
      sandbox.atob = (v) => Buffer.from(String(v), 'base64').toString('binary');
      sandbox.btoa = (v) => Buffer.from(String(v), 'binary').toString('base64');
      sandbox.globalThis = sandbox; Object.freeze(sandbox);
      const context = vm.createContext(sandbox);
      const isValidIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(functionName);
      const bindCode = isValidIdentifier
        ? "\\n;globalThis.__targetFn = (typeof " + functionName + " !== 'undefined' ? " + functionName + " : globalThis[" + JSON.stringify(functionName) + "]);"
        : "\\n;globalThis.__targetFn = globalThis[" + JSON.stringify(functionName) + "];";
      const script = new vm.Script(code + bindCode, { timeout: 5000 });
      script.runInContext(context, { timeout: 5000 });
      const targetFn = context.__targetFn;
      if (typeof targetFn !== 'function') throw new Error("Function not found or not callable: " + functionName);
      const rows = [];
      for (const input of testInputs) {
        const started = performance.now();
        try {
          const raw = targetFn(input);
          const resolved = raw && typeof raw.then === 'function' ? await raw : raw;
          rows.push({ input, output: normalizeOutput(resolved), duration: Number((performance.now() - started).toFixed(3)) });
        } catch (err) {
          rows.push({ input, output: '', error: err && err.message ? err.message : String(err), duration: Number((performance.now() - started).toFixed(3)) });
        }
      }
      parentPort.postMessage({ jobId, ok: true, result: { ok: true, results: rows } });
    } catch (error) {
      parentPort.postMessage({ jobId, ok: true, result: { ok: false, error: error && error.message ? error.message : String(error), results: [] } });
    }
  });
};
__bootstrap().catch((error) => { if (typeof console !== 'undefined' && typeof console.error === 'function') console.error('crypto harness worker bootstrap failed:', error && error.message ? error.message : String(error)); });
`;

export interface TransformSharedState {
  collector: CodeCollector;
  chains: Map<string, TransformChainDefinition>;
  cryptoHarnessPool: WorkerPool<Record<string, unknown>, WorkerHarnessMessage>;
}

export function createTransformSharedState(collector: CodeCollector): TransformSharedState {
  return {
    collector,
    chains: new Map<string, TransformChainDefinition>(),
    cryptoHarnessPool: new WorkerPool({
      name: 'crypto-harness',
      workerScript: CRYPTO_TEST_WORKER_SCRIPT,
      minWorkers: 0,
      maxWorkers: TRANSFORM_CRYPTO_POOL_MAX_WORKERS,
      idleTimeoutMs: TRANSFORM_CRYPTO_POOL_IDLE_TIMEOUT_MS,
      resourceLimits: {
        maxOldGenerationSizeMb: TRANSFORM_CRYPTO_POOL_MAX_OLD_GEN_MB,
        maxYoungGenerationSizeMb: TRANSFORM_CRYPTO_POOL_MAX_YOUNG_GEN_MB,
        stackSizeMb: 8,
      },
    }),
  };
}

// ── Utility functions ──

export function toTextResponse(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

export function fail(tool: string, error: unknown) {
  return toTextResponse({ tool, error: error instanceof Error ? error.message : String(error) });
}

export function parseTransforms(raw: unknown): TransformKind[] {
  const values: string[] = Array.isArray(raw)
    ? raw.map((item) => String(item).trim()).filter((item) => item.length > 0)
    : typeof raw === 'string'
      ? raw
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];
  if (values.length === 0) throw new Error('transforms must contain at least one transform');
  const unique: TransformKind[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!SUPPORTED_TRANSFORM_SET.has(value)) throw new Error(`Unsupported transform: ${value}`);
    if (!seen.has(value)) {
      seen.add(value);
      unique.push(value as TransformKind);
    }
  }
  return unique;
}

export function parseTestInputs(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error('testInputs must be an array of strings');
  const normalized = raw.map((item) => String(item));
  if (normalized.length === 0) throw new Error('testInputs cannot be empty');
  return normalized;
}

export function parseBoolean(raw: unknown, defaultValue: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const n = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(n)) return true;
    if (['false', '0', 'no', 'off'].includes(n)) return false;
  }
  if (typeof raw === 'number') {
    if (raw === 1) return true;
    if (raw === 0) return false;
  }
  return defaultValue;
}

export function requireString(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || raw.length === 0)
    throw new Error(`${field} must be a non-empty string`);
  return raw;
}

export function escapeStringContent(value: string, quote: string): string {
  const escapedBackslash = value.replace(/\\/g, '\\\\');
  const escapedControls = escapedBackslash
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return quote === '"'
    ? escapedControls.replace(/"/g, '\\"')
    : escapedControls.replace(/'/g, "\\'");
}

export function decodeEscapedString(value: string): string {
  return value
    .replace(/\\x([0-9a-fA-F]{2})/g, (_f, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_f, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/\\u([0-9a-fA-F]{4})/g, (_f, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\v/g, '\v')
    .replace(/\\f/g, '\f')
    .replace(/\\0/g, '\0')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

export async function resolveScriptSource(
  collector: CodeCollector,
  scriptId: string,
): Promise<string> {
  let manager: ScriptManager | null = null;
  try {
    manager = new ScriptManager(collector);
    const script = await manager.getScriptSource(scriptId);
    if (script?.source && script.source.length > 0) return script.source;
  } catch {
    /* fallback */
  } finally {
    if (manager) {
      try {
        await manager.close();
      } catch {
        /* ignore */
      }
    }
  }

  const fromCache = collector.getFileByUrl(scriptId);
  if (fromCache?.content && fromCache.content.length > 0) return fromCache.content;

  const page = await collector.getActivePage();
  const pageSource = await page.evaluate(async (id: string): Promise<string> => {
    const scripts = Array.from(document.scripts);
    const byNumericIndex = Number(id);
    if (
      Number.isInteger(byNumericIndex) &&
      byNumericIndex >= 0 &&
      byNumericIndex < scripts.length
    ) {
      const script = scripts[byNumericIndex] as HTMLScriptElement;
      if (script.textContent && script.textContent.trim().length > 0) return script.textContent;
      if (script.src) {
        try {
          const r = await fetch(script.src);
          if (r.ok) return await r.text();
        } catch {}
      }
    }
    for (const script of scripts as HTMLScriptElement[]) {
      if (script.id === id || script.dataset?.scriptId === id) {
        if (script.textContent && script.textContent.trim().length > 0) return script.textContent;
        if (script.src) {
          try {
            const r = await fetch(script.src);
            if (r.ok) return await r.text();
          } catch {}
        }
      }
      if (script.src && script.src.includes(id)) {
        try {
          const r = await fetch(script.src);
          if (r.ok) return await r.text();
        } catch {}
      }
    }
    return '';
  }, scriptId);

  if (typeof pageSource === 'string' && pageSource.length > 0) return pageSource;
  throw new Error(`Unable to resolve source from scriptId: ${scriptId}`);
}

function extractLastSegment(value: string): string {
  const normalized = value.startsWith('window.') ? value.slice(7) : value;
  const parts = normalized.split('.').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : '';
}

export function resolveFunctionName(
  targetFunction: string,
  targetPath: string,
  source: string,
): string {
  const c1 = extractLastSegment(targetFunction);
  if (isValidIdentifier(c1)) return c1;
  const c2 = extractLastSegment(targetPath);
  if (isValidIdentifier(c2)) return c2;
  const match = source.match(/function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
  if (match?.[1] && isValidIdentifier(match[1])) return match[1];
  return 'extractedCryptoFn';
}

export function isValidIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

export async function ensureCryptoPoolWarmed(
  pool: WorkerPool<Record<string, unknown>, WorkerHarnessMessage>,
): Promise<void> {
  await pool.warmup(1);
}

export function buildCryptoPolyfills(): string {
  return `
const __textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const __textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
if (typeof globalThis.atob === 'undefined') { globalThis.atob = (value) => Buffer.from(String(value), 'base64').toString('binary'); }
if (typeof globalThis.btoa === 'undefined') { globalThis.btoa = (value) => Buffer.from(String(value), 'binary').toString('base64'); }
`.trim();
}

export async function runCryptoHarness(
  pool: WorkerPool<Record<string, unknown>, WorkerHarnessMessage>,
  code: string,
  functionName: string,
  testInputs: string[],
): Promise<{ results: CryptoHarnessRow[]; allPassed: boolean }> {
  try {
    const msg = await pool.submit(
      { code, functionName, testInputs } as unknown as Record<string, unknown>,
      WORKER_TIMEOUT_MS,
    );
    if (!msg.ok)
      return {
        results: testInputs.map((input) => ({
          input,
          output: '',
          duration: 0,
          error: msg.error ?? 'Worker execution failed',
        })),
        allPassed: false,
      };
    const rows = Array.isArray(msg.results) ? msg.results : [];
    return { results: rows, allPassed: rows.every((row) => !row.error) };
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
