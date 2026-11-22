/**
 * Off-thread string-array decoding for `analysis_decode_string_array`.
 *
 * The handler parses the source, derotates any string-array rotation IIFE,
 * then does two Babel traverse passes (collect string arrays, replace
 * `_0x(idx)` lookups with their literal) and a final generate — all of which
 * block the event loop on large obfuscated samples. This module moves that
 * parse+traverse+generate work (plus `derotateStringArray`) into a
 * `WorkerPool`-backed worker thread (the same `eval: true` self-contained
 * script pattern as the v8-inspector heap-parse worker and `webcrack-worker`).
 *
 * ── IMPORTANT: keep the inlined `derotateStringArray` + decode logic in
 * `DECODE_STRING_ARRAY_WORKER_SCRIPT` in sync with
 * `derotateStringArray` in `./AdvancedDeobfuscator.ast.ts` and
 * `handleAnalysisDecodeStringArray` in
 * `@server/domains/analysis/handlers/deobfuscation.ts` — the worker runs the
 * same passes; the main thread only posts the raw code and receives the
 * decoded output. ──
 */

import { WorkerPool } from '@utils/WorkerPool';
import type { BabelWorkerUrls } from './babel-urls';

export interface DecodeStringArrayWorkerPayload extends Record<string, unknown> {
  code: string;
  babelUrls: BabelWorkerUrls;
  maxReplacements: number;
  removeRotation: boolean;
}

export interface DecodeStringArrayReplacement {
  arrayName: string;
  index: number;
  value: string;
  original: string;
}

export interface DecodeStringArrayWorkerResult {
  success: boolean;
  code?: string;
  replacedCount?: number;
  arraysFound?: number;
  rotationRemoved?: boolean;
  replacements?: DecodeStringArrayReplacement[];
  error?: string;
}

/** Minimal pool surface the handler depends on; injectable for tests. */
export interface DecodeStringArrayPool {
  submit(
    payload: DecodeStringArrayWorkerPayload,
    timeoutMs?: number,
  ): Promise<DecodeStringArrayWorkerResult>;
}

const DECODE_POOL_MIN_WORKERS = 1;
const DECODE_POOL_MAX_WORKERS = 2;
const DECODE_POOL_IDLE_TIMEOUT_MS = 30_000;
export const DECODE_STRING_ARRAY_JOB_TIMEOUT_MS = 60_000;
/** Babel parse+traverse over up-to-5MB code; generous old-gen ceiling. */
const DECODE_POOL_MAX_OLD_GEN_MB = 512;
const DECODE_POOL_MAX_YOUNG_GEN_MB = 64;

/**
 * Self-contained worker script. Bootstraps `parentPort` via dynamic import and
 * loads `@babel/*` from the `file://` URLs the main thread resolved (an eval
 * worker cannot resolve bare specifiers reliably — see `babel-urls.ts`).
 *
 * Message protocol (matches `WorkerPool`):
 *   → { jobId, payload: { code, babelUrls, maxReplacements, removeRotation } }
 *   ← { jobId, ok: true,  result: DecodeStringArrayWorkerResult }
 *   ← { jobId, ok: false, error: string }
 */
export const DECODE_STRING_ARRAY_WORKER_SCRIPT = `
const __bootstrap = async () => {
  const { parentPort } = await import('node:worker_threads');
  if (!parentPort) throw new Error('worker parentPort is unavailable');

  let parser;
  let traverse;
  let generate;
  let t;
  let loadedBabelUrls = '';

  async function loadBabel(babelUrls) {
    if (!babelUrls || loadedBabelUrls === babelUrls.parser) return;
    const parserNs = await import(babelUrls.parser);
    parser = parserNs.default ?? parserNs;
    const traverseNs = await import(babelUrls.traverse);
    traverse = traverseNs.default ?? traverseNs;
    const genNs = await import(babelUrls.generator);
    generate = genNs.default ?? genNs;
    t = await import(babelUrls.types);
    loadedBabelUrls = babelUrls.parser;
  }

  function derotateStringArray(code) {
    try {
      const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript', 'decorators'] });
      let derotated = 0;
      traverse(ast, {
        CallExpression(path) {
          if (
            !t.isFunctionExpression(path.node.callee) &&
            !t.isArrowFunctionExpression(path.node.callee)
          ) {
            return;
          }
          const func = path.node.callee;
          if (!t.isFunctionExpression(func) || !t.isBlockStatement(func.body)) {
            return;
          }
          const hasWhileLoop = func.body.body.some((stmt) => t.isWhileStatement(stmt));
          const hasArrayRotation =
            JSON.stringify(func.body).includes('push') && JSON.stringify(func.body).includes('shift');
          if (hasWhileLoop && hasArrayRotation) {
            path.remove();
            derotated += 1;
          }
        },
      });
      if (derotated > 0) {
        return generate(ast, { comments: true, compact: false }).code;
      }
      return code;
    } catch {
      return code;
    }
  }

  function decodeStringArray(code, maxReplacements, removeRotation) {
    const preparedCode = removeRotation ? derotateStringArray(code) : code;

    const stringArrays = new Map();
    let ast;
    try {
      ast = parser.parse(preparedCode, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript', 'decorators'] });
    } catch (err) {
      return {
        success: false,
        error: 'Parse error: ' + (err && err.message ? err.message : String(err)),
      };
    }

    traverse(ast, {
      VariableDeclarator(path) {
        if (!path.isVariableDeclarator()) return;
        const node = path.node;
        if (!t.isIdentifier(node.id) || !t.isArrayExpression(node.init)) return;
        const items = [];
        for (const element of node.init.elements) {
          if (!t.isStringLiteral(element)) return;
          items.push(element.value);
        }
        stringArrays.set(node.id.name, items);
      },
    });

    const replacements = [];
    let replacedCount = 0;

    traverse(ast, {
      CallExpression(path) {
        if (replacedCount >= maxReplacements) {
          path.stop();
          return;
        }
        if (!path.isCallExpression()) return;
        const node = path.node;
        if (!t.isIdentifier(node.callee)) return;
        const arrayName = node.callee.name;
        const items = stringArrays.get(arrayName);
        if (!items || node.arguments.length !== 1) return;
        const firstArg = node.arguments[0];
        if (!t.isNumericLiteral(firstArg) && !t.isStringLiteral(firstArg)) return;

        const index = t.isNumericLiteral(firstArg)
          ? firstArg.value
          : firstArg.value.startsWith('0x')
            ? Number.parseInt(firstArg.value, 16)
            : Number(firstArg.value);
        if (!Number.isInteger(index) || index < 0 || index >= items.length) return;

        const value = items[index];
        if (typeof value !== 'string') return;

        const originalCode = preparedCode.slice(node.start ?? 0, node.end ?? 0);

        replacements.push({ arrayName, index, value, original: originalCode });
        path.replaceWith(t.stringLiteral(value));
        replacedCount += 1;
      },
    });

    return {
      success: true,
      code: generate(ast, { retainLines: true }).code,
      replacedCount,
      arraysFound: stringArrays.size,
      rotationRemoved: removeRotation && preparedCode !== code,
      replacements,
    };
  }

  parentPort.on('message', async (msg) => {
    const jobId = msg && msg.jobId;
    const payload = msg && msg.payload;
    try {
      await loadBabel(payload && payload.babelUrls);
      const code = payload && typeof payload.code === 'string' ? payload.code : '';
      const maxReplacements = payload && typeof payload.maxReplacements === 'number' ? payload.maxReplacements : 200;
      const removeRotation = payload && payload.removeRotation !== false;
      const result = decodeStringArray(code, maxReplacements, removeRotation);
      parentPort.postMessage({ jobId, ok: true, result });
    } catch (err) {
      parentPort.postMessage({
        jobId,
        ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  });
};
__bootstrap().catch((error) => {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error(
      'decode string array worker bootstrap failed:',
      error && error.message ? error.message : String(error),
    );
  }
});
`;

let sharedPool: WorkerPool<Record<string, unknown>, DecodeStringArrayWorkerResult> | null = null;

/** Lazily create (and reuse) the shared decode-string-array worker pool. */
export function getDecodeStringArrayPool(): DecodeStringArrayPool {
  if (!sharedPool) {
    sharedPool = new WorkerPool<Record<string, unknown>, DecodeStringArrayWorkerResult>({
      name: 'decode-string-array',
      workerScript: DECODE_STRING_ARRAY_WORKER_SCRIPT,
      minWorkers: DECODE_POOL_MIN_WORKERS,
      maxWorkers: DECODE_POOL_MAX_WORKERS,
      idleTimeoutMs: DECODE_POOL_IDLE_TIMEOUT_MS,
      resourceLimits: {
        maxOldGenerationSizeMb: DECODE_POOL_MAX_OLD_GEN_MB,
        maxYoungGenerationSizeMb: DECODE_POOL_MAX_YOUNG_GEN_MB,
      },
    });
  }
  return sharedPool as DecodeStringArrayPool;
}

/**
 * Close the shared decode-string-array pool and reset the singleton
 * (idempotent — a no-op when never created). Wired into `closeServer()` so the
 * min-1 warm worker is released on shutdown (see `disposeWebcrackPool`).
 */
export async function disposeDecodeStringArrayPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.close();
    sharedPool = null;
  }
}
