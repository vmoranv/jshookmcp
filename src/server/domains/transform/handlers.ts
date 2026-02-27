import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import { ScriptManager } from '../../../modules/debugger/ScriptManager.js';
import { WorkerPool } from '../../../utils/WorkerPool.js';

type TransformKind =
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

interface ApplyResult {
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

interface CryptoExtractCandidate {
  path: string;
  source: string;
  score: number;
}

interface CryptoExtractPayload {
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

const NUMERIC_BINARY_EXPR =
  /\b(-?\d+(?:\.\d+)?)\s*([+\-*/%])\s*(-?\d+(?:\.\d+)?)\b/g;
const STRING_CONCAT_EXPR = /(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\+\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g;
const STRING_LITERAL_EXPR = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
const DEAD_CODE_IF_FALSE_WITH_ELSE =
  /if\s*\(\s*(?:false|0|!0\s*===\s*!1)\s*\)\s*\{([\s\S]*?)\}\s*else\s*\{([\s\S]*?)\}/g;
const DEAD_CODE_IF_FALSE = /if\s*\(\s*(?:false|0|!0\s*===\s*!1)\s*\)\s*\{[\s\S]*?\}/g;

const WORKER_TIMEOUT_MS = 15000;
const MAX_LCS_CELLS = 250000;

const CRYPTO_KEYWORDS = [
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
const { parentPort } = require('worker_threads');
const vm = require('vm');
const { performance } = require('perf_hooks');

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
`;

export class TransformToolHandlers {
  private collector: CodeCollector;
  private chains: Map<string, TransformChainDefinition>;
  private cryptoHarnessPool: WorkerPool<Record<string, unknown>, WorkerHarnessMessage>;

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

  async handleAstTransformPreview(args: Record<string, unknown>) {
    try {
      const code = this.requireString(args.code, 'code');
      const transforms = this.parseTransforms(args.transforms);
      const preview = this.parseBoolean(args.preview, true);

      const result = this.applyTransforms(code, transforms);
      const diff = preview ? this.buildDiff(code, result.transformed) : '';

      return this.toTextResponse({
        original: code,
        transformed: result.transformed,
        diff,
        appliedTransforms: result.appliedTransforms,
      });
    } catch (error) {
      return this.fail('ast_transform_preview', error);
    }
  }

  async handleAstTransformChain(args: Record<string, unknown>) {
    try {
      const name = this.requireString(args.name, 'name').trim();
      const description =
        typeof args.description === 'string' && args.description.trim().length > 0
          ? args.description.trim()
          : undefined;
      const transforms = this.parseTransforms(args.transforms);

      if (name.length === 0) {
        throw new Error('name cannot be empty');
      }

      this.chains.set(name, {
        name,
        transforms,
        description,
        createdAt: Date.now(),
      });

      return this.toTextResponse({
        name,
        transforms,
        created: true,
      });
    } catch (error) {
      return this.fail('ast_transform_chain', error);
    }
  }

  async handleAstTransformApply(args: Record<string, unknown>) {
    try {
      const chainName = typeof args.chainName === 'string' ? args.chainName.trim() : '';
      const inlineCode = typeof args.code === 'string' ? args.code : '';
      const scriptId = typeof args.scriptId === 'string' ? args.scriptId.trim() : '';

      const sourceCode =
        inlineCode.length > 0
          ? inlineCode
          : scriptId.length > 0
            ? await this.resolveScriptSource(scriptId)
            : '';

      if (sourceCode.length === 0) {
        throw new Error('Either code or scriptId must be provided');
      }

      const transforms = this.resolveTransformsForApply(chainName, args.transforms);
      const result = this.applyTransforms(sourceCode, transforms);

      return this.toTextResponse({
        transformed: result.transformed,
        stats: {
          originalSize: sourceCode.length,
          transformedSize: result.transformed.length,
          transformsApplied: result.appliedTransforms,
        },
      });
    } catch (error) {
      return this.fail('ast_transform_apply', error);
    }
  }

  async handleCryptoExtractStandalone(args: Record<string, unknown>) {
    try {
      const targetFunction = this.requireString(args.targetFunction, 'targetFunction').trim();
      const includePolyfills = this.parseBoolean(args.includePolyfills, true);
      const page = await this.collector.getActivePage();

      const extracted = (await page.evaluate(
        (target, keywords): CryptoExtractPayload => {
          const keywordList = Array.isArray(keywords) ? keywords : [];
          const lowerKeywords = keywordList.map((item) => String(item).toLowerCase());
          const globalObj: Record<string, unknown> = window as unknown as Record<string, unknown>;

          const resolvePath = (path: string): unknown => {
            const normalized = path.startsWith('window.') ? path.slice(7) : path;
            const parts = normalized.split('.').filter(Boolean);
            let cursor: unknown = window;
            for (const part of parts) {
              if (
                cursor === null ||
                cursor === undefined ||
                (typeof cursor !== 'object' && typeof cursor !== 'function')
              ) {
                return undefined;
              }
              const carrier = cursor as Record<string, unknown>;
              if (!(part in carrier)) {
                return undefined;
              }
              cursor = carrier[part];
            }
            return cursor;
          };

          const scoreFunction = (path: string, source: string): number => {
            const text = (path + '\\n' + source).toLowerCase();
            let score = 0;
            for (const keyword of lowerKeywords) {
              if (text.includes(keyword)) {
                score += 1;
              }
            }
            return score;
          };

          const candidates: CryptoExtractCandidate[] = [];
          const pushCandidate = (path: string, value: unknown, boost = 0) => {
            if (typeof value !== 'function') return;
            const source = Function.prototype.toString.call(value);
            if (source.includes('[native code]')) return;

            const score = scoreFunction(path, source) + boost;
            if (score <= 0 && boost <= 0) return;

            candidates.push({
              path,
              source,
              score,
            });
          };

          if (target.length > 0) {
            const resolved = resolvePath(target);
            pushCandidate(target, resolved, 100);
          }

          const globalKeys = Object.getOwnPropertyNames(globalObj).slice(0, 800);
          for (const key of globalKeys) {
            const topValue = globalObj[key];
            pushCandidate('window.' + key, topValue);

            if (topValue && typeof topValue === 'object') {
              const nestedObj = topValue as Record<string, unknown>;
              const nestedKeys = Object.keys(nestedObj).slice(0, 40);
              for (const nestedKey of nestedKeys) {
                pushCandidate('window.' + key + '.' + nestedKey, nestedObj[nestedKey]);
              }
            }
          }

          candidates.sort((a, b) => b.score - a.score);

          const selected = candidates[0];
          if (!selected) {
            return {
              targetPath: null,
              targetSource: '',
              candidates: [],
              dependencies: [],
              dependencySnippets: [],
            };
          }

          const identifierRegex = /\\b[A-Za-z_$][A-Za-z0-9_$]{1,}\\b/g;
          const reserved = new Set([
            'function',
            'return',
            'const',
            'let',
            'var',
            'if',
            'else',
            'for',
            'while',
            'switch',
            'case',
            'break',
            'continue',
            'new',
            'this',
            'window',
            'globalThis',
            'Math',
            'JSON',
            'Date',
            'Array',
            'Object',
            'String',
            'Number',
            'Boolean',
            'Promise',
            'RegExp',
            'Error',
            'null',
            'undefined',
            'true',
            'false',
            'async',
            'await',
          ]);

          const dependencyNames = Array.from(
            new Set((selected.source.match(identifierRegex) ?? []).filter((name) => !reserved.has(name)))
          ).slice(0, 30);

          const dependencySnippets: string[] = [];
          for (const depName of dependencyNames) {
            if (!(depName in globalObj)) continue;
            const depValue = globalObj[depName];

            if (typeof depValue === 'function') {
              const depSource = Function.prototype.toString.call(depValue);
              if (!depSource.includes('[native code]') && depSource.length < 50000) {
                dependencySnippets.push('const ' + depName + ' = ' + depSource + ';');
              }
              continue;
            }

            if (
              depValue === null ||
              typeof depValue === 'string' ||
              typeof depValue === 'number' ||
              typeof depValue === 'boolean'
            ) {
              dependencySnippets.push('const ' + depName + ' = ' + JSON.stringify(depValue) + ';');
              continue;
            }

            if (typeof depValue === 'object') {
              try {
                const serialized = JSON.stringify(depValue);
                if (serialized && serialized.length < 4000) {
                  dependencySnippets.push('const ' + depName + ' = ' + serialized + ';');
                }
              } catch {
                // ignore non-serializable object
              }
            }
          }

          return {
            targetPath: selected.path,
            targetSource: selected.source,
            candidates: candidates.slice(0, 20),
            dependencies: dependencyNames,
            dependencySnippets,
          };
        },
        targetFunction,
        CRYPTO_KEYWORDS
      )) as CryptoExtractPayload;

      if (!extracted || extracted.targetSource.trim().length === 0) {
        throw new Error('No crypto/signature-like function found on current page');
      }

      const functionName = this.resolveFunctionName(
        targetFunction,
        extracted.targetPath ?? '',
        extracted.targetSource
      );
      const sections: string[] = [`'use strict';`];

      if (includePolyfills) {
        sections.push(this.buildCryptoPolyfills());
      }

      if (extracted.dependencySnippets.length > 0) {
        sections.push(extracted.dependencySnippets.join('\n'));
      }

      sections.push(`const ${functionName} = ${extracted.targetSource.trim()};`);
      sections.push(
        `if (typeof globalThis !== 'undefined') { globalThis.${functionName} = ${functionName}; }`
      );

      const extractedCode = sections.filter((part) => part.trim().length > 0).join('\n\n');

      return this.toTextResponse({
        extractedCode,
        dependencies: extracted.dependencies,
        size: extractedCode.length,
      });
    } catch (error) {
      return this.fail('crypto_extract_standalone', error);
    }
  }

  async handleCryptoTestHarness(args: Record<string, unknown>) {
    try {
      const code = this.requireString(args.code, 'code');
      const functionName = this.requireString(args.functionName, 'functionName');
      const testInputs = this.parseTestInputs(args.testInputs);

      const harness = await this.runCryptoHarness(code, functionName, testInputs);

      return this.toTextResponse({
        results: harness.results.map((row) => ({
          input: row.input,
          output: row.output,
          duration: row.duration,
          ...(row.error ? { error: row.error } : {}),
        })),
        allPassed: harness.allPassed,
      });
    } catch (error) {
      return this.fail('crypto_test_harness', error);
    }
  }

  async handleCryptoCompare(args: Record<string, unknown>) {
    try {
      const code1 = this.requireString(args.code1, 'code1');
      const code2 = this.requireString(args.code2, 'code2');
      const functionName = this.requireString(args.functionName, 'functionName');
      const testInputs = this.parseTestInputs(args.testInputs);

      const [run1, run2] = await Promise.all([
        this.runCryptoHarness(code1, functionName, testInputs),
        this.runCryptoHarness(code2, functionName, testInputs),
      ]);

      const rows = testInputs.map((input, index) => {
        const left = run1.results[index] ?? {
          input,
          output: '',
          duration: 0,
          error: 'missing result from implementation #1',
        };
        const right = run2.results[index] ?? {
          input,
          output: '',
          duration: 0,
          error: 'missing result from implementation #2',
        };

        const sameOutput = left.output === right.output;
        const noError = !left.error && !right.error;

        return {
          input,
          output1: left.output,
          output2: right.output,
          duration1: left.duration,
          duration2: right.duration,
          match: sameOutput && noError,
          ...(left.error ? { error1: left.error } : {}),
          ...(right.error ? { error2: right.error } : {}),
        };
      });

      const matches = rows.filter((row) => row.match).length;
      const mismatches = rows.length - matches;

      return this.toTextResponse({
        matches,
        mismatches,
        results: rows,
      });
    } catch (error) {
      return this.fail('crypto_compare', error);
    }
  }

  private resolveTransformsForApply(
    chainName: string,
    transformsRaw: unknown
  ): TransformKind[] {
    if (chainName.length > 0) {
      const chain = this.chains.get(chainName);
      if (!chain) {
        throw new Error(`Transform chain not found: ${chainName}`);
      }
      return [...chain.transforms];
    }
    return this.parseTransforms(transformsRaw);
  }

  private applyTransforms(code: string, transforms: TransformKind[]): ApplyResult {
    let transformed = code;
    const appliedTransforms: TransformKind[] = [];

    for (const transform of transforms) {
      const before = transformed;
      transformed = this.applySingleTransform(transformed, transform);
      if (transformed !== before) {
        appliedTransforms.push(transform);
      }
    }

    return { transformed, appliedTransforms };
  }

  private applySingleTransform(code: string, transform: TransformKind): string {
    switch (transform) {
      case 'constant_fold':
        return this.transformConstantFold(code);
      case 'string_decrypt':
        return this.transformStringDecrypt(code);
      case 'dead_code_remove':
        return this.transformDeadCodeRemove(code);
      case 'control_flow_flatten':
        return this.transformControlFlowFlatten(code);
      case 'rename_vars':
        return this.transformRenameVars(code);
      default:
        return code;
    }
  }

  private transformConstantFold(code: string): string {
    let current = code;
    for (let round = 0; round < 4; round++) {
      const numericFolded = current.replace(
        NUMERIC_BINARY_EXPR,
        (_full, leftRaw: string, operator: string, rightRaw: string) => {
          const left = Number(leftRaw);
          const right = Number(rightRaw);

          if (!Number.isFinite(left) || !Number.isFinite(right)) {
            return `${leftRaw}${operator}${rightRaw}`;
          }

          let value: number | null = null;
          switch (operator) {
            case '+':
              value = left + right;
              break;
            case '-':
              value = left - right;
              break;
            case '*':
              value = left * right;
              break;
            case '/':
              if (right !== 0) value = left / right;
              break;
            case '%':
              if (right !== 0) value = left % right;
              break;
            default:
              value = null;
          }

          if (value === null || !Number.isFinite(value)) {
            return `${leftRaw}${operator}${rightRaw}`;
          }

          return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(12)));
        }
      );

      const stringFolded = numericFolded.replace(
        STRING_CONCAT_EXPR,
        (_full, q1: string, left: string, q2: string, right: string) => {
          const quote = q1 === q2 ? q1 : "'";
          const merged = `${left}${right}`;
          return `${quote}${this.escapeStringContent(merged, quote)}${quote}`;
        }
      );

      if (stringFolded === current) {
        break;
      }
      current = stringFolded;
    }
    return current;
  }

  private transformStringDecrypt(code: string): string {
    return code.replace(STRING_LITERAL_EXPR, (_full, quote: string, inner: string) => {
      const decoded = this.decodeEscapedString(inner);
      if (decoded === inner) {
        return `${quote}${inner}${quote}`;
      }
      return `${quote}${this.escapeStringContent(decoded, quote)}${quote}`;
    });
  }

  private transformDeadCodeRemove(code: string): string {
    const withElseSimplified = code.replace(
      DEAD_CODE_IF_FALSE_WITH_ELSE,
      (_full, _ifBody: string, elseBody: string) => elseBody
    );
    return withElseSimplified.replace(DEAD_CODE_IF_FALSE, '');
  }

  private transformControlFlowFlatten(code: string): string {
    const flattenedPattern =
      /var\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*['"]([^'"]+)['"]\.split\(\s*['"]\|['"]\s*\)\s*;\s*var\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*0\s*;\s*while\s*\(\s*!!\[\]\s*\)\s*\{\s*switch\s*\(\s*\1\[\s*\3\+\+\s*\]\s*\)\s*\{([\s\S]*?)\}\s*break;\s*\}/g;

    return code.replace(
      flattenedPattern,
      (_full, _dispatcher: string, orderRaw: string, _cursor: string, switchBody: string) => {
        const caseRegex = /case\s*['"]([^'"]+)['"]\s*:\s*([\s\S]*?)(?=case\s*['"]|default\s*:|$)/g;
        const caseMap = new Map<string, string>();
        let match: RegExpExecArray | null;

        while ((match = caseRegex.exec(switchBody)) !== null) {
          const caseKey = match[1];
          const body = match[2] ?? '';
          const cleaned = body
            .replace(/\bcontinue\s*;?/g, '')
            .replace(/\bbreak\s*;?/g, '')
            .trim();

          if (caseKey && cleaned.length > 0) {
            caseMap.set(caseKey, cleaned);
          }
        }

        const order = orderRaw.split('|').map((item) => item.trim());
        const rebuilt = order
          .map((token) => caseMap.get(token))
          .filter((part): part is string => typeof part === 'string' && part.length > 0)
          .join('\n');

        return rebuilt.length > 0 ? rebuilt : _full;
      }
    );
  }

  private transformRenameVars(code: string): string {
    const declaredSingleLetterVars = new Set<string>();
    const declarationRegex = /\b(?:var|let|const)\s+([A-Za-z])\b/g;
    let match: RegExpExecArray | null;

    while ((match = declarationRegex.exec(code)) !== null) {
      const name = match[1];
      if (name) {
        declaredSingleLetterVars.add(name);
      }
    }

    if (declaredSingleLetterVars.size === 0) {
      return code;
    }

    const renameMap = new Map<string, string>();
    let counter = 1;
    for (const name of declaredSingleLetterVars) {
      renameMap.set(name, `var_${counter}`);
      counter += 1;
    }

    return code.replace(/\b([A-Za-z])\b/g, (token: string, identifier: string, offset: number, full: string) => {
      const replacement = renameMap.get(identifier);
      if (!replacement) {
        return token;
      }

      const prev = offset > 0 ? full[offset - 1] : '';
      if (prev === '.' || prev === '\'' || prev === '"' || prev === '`' || prev === '$') {
        return token;
      }

      return replacement;
    });
  }

  private buildDiff(original: string, transformed: string): string {
    if (original === transformed) {
      return '';
    }

    const oldLines = original.split('\n');
    const newLines = transformed.split('\n');

    if (oldLines.length * newLines.length > MAX_LCS_CELLS) {
      return this.buildFallbackDiff(oldLines, newLines);
    }

    const m = oldLines.length;
    const n = newLines.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));

    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i]![j] =
          oldLines[i] === newLines[j]
            ? dp[i + 1]![j + 1]! + 1
            : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }

    const diffLines: string[] = [];
    let i = 0;
    let j = 0;

    while (i < m && j < n) {
      if (oldLines[i] === newLines[j]) {
        diffLines.push(` ${oldLines[i]}`);
        i += 1;
        j += 1;
        continue;
      }

      if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        diffLines.push(`-${oldLines[i]}`);
        i += 1;
      } else {
        diffLines.push(`+${newLines[j]}`);
        j += 1;
      }
    }

    while (i < m) {
      diffLines.push(`-${oldLines[i]}`);
      i += 1;
    }

    while (j < n) {
      diffLines.push(`+${newLines[j]}`);
      j += 1;
    }

    return diffLines.join('\n');
  }

  private buildFallbackDiff(oldLines: string[], newLines: string[]): string {
    let start = 0;
    while (
      start < oldLines.length &&
      start < newLines.length &&
      oldLines[start] === newLines[start]
    ) {
      start += 1;
    }

    let oldEnd = oldLines.length - 1;
    let newEnd = newLines.length - 1;
    while (
      oldEnd >= start &&
      newEnd >= start &&
      oldLines[oldEnd] === newLines[newEnd]
    ) {
      oldEnd -= 1;
      newEnd -= 1;
    }

    const removed = oldLines.slice(start, oldEnd + 1).map((line) => `-${line}`);
    const added = newLines.slice(start, newEnd + 1).map((line) => `+${line}`);

    return [...removed, ...added].join('\n');
  }

  private parseTransforms(raw: unknown): TransformKind[] {
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

  private parseTestInputs(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
      throw new Error('testInputs must be an array of strings');
    }

    const normalized = raw.map((item) => String(item));
    if (normalized.length === 0) {
      throw new Error('testInputs cannot be empty');
    }
    return normalized;
  }

  private parseBoolean(raw: unknown, defaultValue: boolean): boolean {
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

  private requireString(raw: unknown, field: string): string {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new Error(`${field} must be a non-empty string`);
    }
    return raw;
  }

  private escapeStringContent(value: string, quote: string): string {
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

  private decodeEscapedString(value: string): string {
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

  private async resolveScriptSource(scriptId: string): Promise<string> {
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

  private resolveFunctionName(targetFunction: string, targetPath: string, source: string): string {
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

  private isValidIdentifier(value: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
  }

  private buildCryptoPolyfills(): string {
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

  private async runCryptoHarness(
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

  private toTextResponse(payload: unknown) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  private fail(tool: string, error: unknown) {
    return this.toTextResponse({
      tool,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
