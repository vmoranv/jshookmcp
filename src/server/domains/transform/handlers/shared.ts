/**
 * Shared types, constants, and utilities for transform domain sub-handlers.
 */

import type { CodeCollector } from '@server/domains/shared/modules/collector';
import { ScriptManager } from '@server/domains/shared/modules';
import { asJsonResponse, serializeError } from '@server/domains/shared/response';
import { WorkerPool } from '@utils/WorkerPool';
import {
  TRANSFORM_WORKER_TIMEOUT_MS,
  TRANSFORM_CRYPTO_POOL_MAX_WORKERS,
  TRANSFORM_CRYPTO_POOL_IDLE_TIMEOUT_MS,
  TRANSFORM_CRYPTO_POOL_MAX_OLD_GEN_MB,
  TRANSFORM_CRYPTO_POOL_MAX_YOUNG_GEN_MB,
} from '@src/constants';

import {
  SUPPORTED_TRANSFORMS,
  type TransformKind,
} from '@server/domains/transform/transform-kinds';

export { SUPPORTED_TRANSFORMS, type TransformKind };

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

export interface CryptoExtractResult {
  targetPath: string | null;
  targetSource: string;
  candidates: CryptoExtractCandidate[];
  dependencies: string[];
  dependencySnippets: string[];
}

export const SUPPORTED_TRANSFORM_SET: ReadonlySet<string> = new Set(SUPPORTED_TRANSFORMS);

export const NUMERIC_BINARY_EXPR = /\b(-?\d+(?:\.\d+)?)\s*([+\-*/%])\s*(-?\d+(?:\.\d+)?)\b/g;
export const STRING_CONCAT_EXPR =
  /(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\+\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g;
export const STRING_LITERAL_EXPR = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
export const DEAD_CODE_IF_FALSE_WITH_ELSE =
  /if\s*\(\s*(?:false|0|!0\s*===\s*!1)\s*\)\s*\{([\s\S]*?)\}\s*else\s*\{([\s\S]*?)\}/g;
export const DEAD_CODE_IF_FALSE = /if\s*\(\s*(?:false|0|!0\s*===\s*!1)\s*\)\s*\{[\s\S]*?\}/g;

export const WORKER_TIMEOUT_MS = TRANSFORM_WORKER_TIMEOUT_MS;

export const TransformLimit = {
  MAX_LCS_CELLS: 250000,
} as const;

/** Transform limit value */
export type TransformLimit = (typeof TransformLimit)[keyof typeof TransformLimit];

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

const QUICKJS_MODULE_URL = import.meta.resolve('quickjs-emscripten');
const QUICKJS_MEMORY_LIMIT_BYTES = TRANSFORM_CRYPTO_POOL_MAX_OLD_GEN_MB * 1024 * 1024;
// Keep below QuickJS's fixed WebAssembly stack so evaluation cannot overflow it.
const QUICKJS_STACK_LIMIT_BYTES = 1 * 1024 * 1024;
const QUICKJS_TIMEOUT_MS = Math.max(1000, WORKER_TIMEOUT_MS - 1000);

/**
 * Pure JavaScript compatibility layer evaluated inside QuickJS.
 *
 * Buffer support is intentionally limited to common byte-oriented APIs and
 * encodings. Every function and returned value is created by the QuickJS
 * runtime; no Node.js Buffer or host-realm callable crosses the boundary.
 */
const CRYPTO_QUICKJS_SHIMS = String.raw`
(function () {
  const MAX_BUFFER_BYTES = 1048576;
  const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function normalizeEncoding(encoding) {
    const name = String(encoding || 'utf8').toLowerCase().replace(/[-_]/g, '');
    switch (name) {
      case 'utf8':
      case 'utf':
        return 'utf8';
      case 'hex':
        return 'hex';
      case 'base64':
        return 'base64';
      case 'base64url':
        return 'base64url';
      case 'latin1':
      case 'binary':
        return 'latin1';
      case 'ascii':
        return 'ascii';
      case 'utf16le':
      case 'ucs2':
        return 'utf16le';
      default:
        throw new TypeError('Unsupported encoding: ' + encoding);
    }
  }

  function encodeUtf8(value) {
    const text = String(value);
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      let point = text.charCodeAt(i);
      if (point >= 0xd800 && point <= 0xdbff) {
        const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
        if (next >= 0xdc00 && next <= 0xdfff) {
          point = 0x10000 + ((point - 0xd800) << 10) + (next - 0xdc00);
          i++;
        } else {
          point = 0xfffd;
        }
      } else if (point >= 0xdc00 && point <= 0xdfff) {
        point = 0xfffd;
      }

      if (point <= 0x7f) {
        bytes.push(point);
      } else if (point <= 0x7ff) {
        bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
      } else if (point <= 0xffff) {
        bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
      } else {
        bytes.push(
          0xf0 | (point >> 18),
          0x80 | ((point >> 12) & 0x3f),
          0x80 | ((point >> 6) & 0x3f),
          0x80 | (point & 0x3f),
        );
      }
    }
    return Uint8Array.from(bytes);
  }

  function decodeUtf8(bytes, fatal) {
    let result = '';
    for (let i = 0; i < bytes.length;) {
      const first = bytes[i];
      let point = 0xfffd;
      let count = 1;
      let minimum = 0;

      if (first <= 0x7f) {
        point = first;
      } else if (first >= 0xc2 && first <= 0xdf) {
        point = first & 0x1f;
        count = 2;
        minimum = 0x80;
      } else if (first >= 0xe0 && first <= 0xef) {
        point = first & 0x0f;
        count = 3;
        minimum = 0x800;
      } else if (first >= 0xf0 && first <= 0xf4) {
        point = first & 0x07;
        count = 4;
        minimum = 0x10000;
      }

      let valid = count === 1 ? first <= 0x7f : i + count <= bytes.length;
      if (valid && count > 1) {
        for (let j = 1; j < count; j++) {
          const continuation = bytes[i + j];
          if (continuation < 0x80 || continuation > 0xbf) {
            valid = false;
            break;
          }
          point = (point << 6) | (continuation & 0x3f);
        }
        if (
          valid &&
          (point < minimum || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff))
        ) {
          valid = false;
        }
      }

      if (!valid) {
        if (fatal) throw new TypeError('Invalid UTF-8 data');
        result += '\ufffd';
        i++;
        continue;
      }

      result += String.fromCodePoint(point);
      i += count;
    }
    return result;
  }

  function encodeBase64(bytes, urlSafe) {
    let output = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const first = bytes[i];
      const second = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const third = i + 2 < bytes.length ? bytes[i + 2] : 0;
      output += BASE64_CHARS[first >> 2];
      output += BASE64_CHARS[((first & 3) << 4) | (second >> 4)];
      output += i + 1 < bytes.length ? BASE64_CHARS[((second & 15) << 2) | (third >> 6)] : '=';
      output += i + 2 < bytes.length ? BASE64_CHARS[third & 63] : '=';
    }
    return urlSafe ? output.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') : output;
  }

  function decodeBase64(value) {
    const text = String(value).replace(/-/g, '+').replace(/_/g, '/');
    const bytes = [];
    let accumulator = 0;
    let bitCount = 0;
    for (let i = 0; i < text.length; i++) {
      const character = text[i];
      if (character === '=') break;
      const digit = BASE64_CHARS.indexOf(character);
      if (digit < 0) continue;
      accumulator = (accumulator << 6) | digit;
      bitCount += 6;
      if (bitCount >= 8) {
        bitCount -= 8;
        bytes.push((accumulator >> bitCount) & 0xff);
      }
    }
    return Uint8Array.from(bytes);
  }

  function encodeBytes(value, encoding) {
    const text = String(value);
    const normalized = normalizeEncoding(encoding);
    if (normalized === 'utf8') return encodeUtf8(text);
    const bytes = [];
    if (normalized === 'hex') {
      for (let i = 0; i + 1 < text.length; i += 2) {
        const byte = Number.parseInt(text.slice(i, i + 2), 16);
        if (!Number.isFinite(byte)) break;
        bytes.push(byte & 0xff);
      }
    } else if (normalized === 'base64' || normalized === 'base64url') {
      return decodeBase64(text);
    } else if (normalized === 'utf16le') {
      for (let i = 0; i < text.length; i++) {
        const point = text.charCodeAt(i);
        bytes.push(point & 0xff, point >> 8);
      }
    } else {
      for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 0xff);
    }
    return Uint8Array.from(bytes);
  }

  function bytesOf(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (Array.isArray(value) || (value && typeof value[Symbol.iterator] === 'function')) {
      return Uint8Array.from(value);
    }
    throw new TypeError('Expected a string, ArrayBuffer, typed array, or byte iterable');
  }

  function decodeBytes(bytes, encoding, fatal) {
    const normalized = normalizeEncoding(encoding);
    if (normalized === 'utf8') return decodeUtf8(bytes, fatal);
    if (normalized === 'base64') return encodeBase64(bytes, false);
    if (normalized === 'base64url') return encodeBase64(bytes, true);
    if (normalized === 'hex') {
      let output = '';
      for (let i = 0; i < bytes.length; i++) output += bytes[i].toString(16).padStart(2, '0');
      return output;
    }
    if (normalized === 'utf16le') {
      let output = '';
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        output += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
      }
      return output;
    }
    let output = '';
    for (let i = 0; i < bytes.length; i++) {
      output += String.fromCharCode(normalized === 'ascii' ? bytes[i] & 0x7f : bytes[i]);
    }
    return output;
  }

  function boundedLength(value) {
    const length = Math.trunc(Number(value));
    if (!Number.isFinite(length) || length < 0) throw new RangeError('Invalid buffer size');
    return Math.min(length, MAX_BUFFER_BYTES);
  }

  function normalizeIndex(value, length) {
    const index = Math.trunc(Number(value) || 0);
    return Math.max(0, Math.min(length, index < 0 ? length + index : index));
  }

  class QuickBuffer extends Uint8Array {
    static from(value, encodingOrOffset, length) {
      if (typeof value === 'string') return new QuickBuffer(encodeBytes(value, encodingOrOffset));
      if (value instanceof ArrayBuffer) {
        const offset = Math.max(0, Math.trunc(Number(encodingOrOffset) || 0));
        const available = Math.max(0, value.byteLength - offset);
        const size = length === undefined ? available : Math.max(0, Math.min(available, Math.trunc(Number(length))));
        return new QuickBuffer(value, offset, size);
      }
      return new QuickBuffer(bytesOf(value));
    }

    static alloc(size, fill, encoding) {
      const output = new QuickBuffer(boundedLength(size));
      if (fill === undefined || fill === 0) return output;
      if (typeof fill === 'number') {
        output.fill(fill & 0xff);
        return output;
      }
      const pattern = typeof fill === 'string' ? encodeBytes(fill, encoding) : bytesOf(fill);
      if (pattern.length === 0) return output;
      for (let i = 0; i < output.length; i++) output[i] = pattern[i % pattern.length];
      return output;
    }

    static concat(list, totalLength) {
      if (!Array.isArray(list)) throw new TypeError('Buffer.concat expects an array');
      const buffers = list.map((item) => bytesOf(item));
      const requested = totalLength === undefined
        ? buffers.reduce((sum, item) => sum + item.length, 0)
        : boundedLength(totalLength);
      const output = new QuickBuffer(Math.min(requested, MAX_BUFFER_BYTES));
      let offset = 0;
      for (const item of buffers) {
        const copied = Math.min(item.length, output.length - offset);
        if (copied <= 0) break;
        output.set(item.subarray(0, copied), offset);
        offset += copied;
      }
      return output;
    }

    static isBuffer(value) {
      return value instanceof QuickBuffer;
    }

    static isEncoding(value) {
      try {
        normalizeEncoding(value);
        return true;
      } catch {
        return false;
      }
    }

    static byteLength(value, encoding) {
      return encodeBytes(String(value), encoding).length;
    }

    toString(encoding, start, end) {
      const first = normalizeIndex(start, this.length);
      const last = end === undefined ? this.length : normalizeIndex(end, this.length);
      return decodeBytes(this.subarray(first, Math.max(first, last)), encoding);
    }

    slice(start, end) {
      const first = normalizeIndex(start, this.length);
      const last = end === undefined ? this.length : normalizeIndex(end, this.length);
      const size = Math.max(0, last - first);
      return new QuickBuffer(this.buffer, this.byteOffset + first, size);
    }

    subarray(start, end) {
      const first = normalizeIndex(start, this.length);
      const last = end === undefined ? this.length : normalizeIndex(end, this.length);
      const size = Math.max(0, last - first);
      return new QuickBuffer(this.buffer, this.byteOffset + first, size);
    }

    write(value, offset, length, encoding) {
      if (typeof offset === 'string') {
        encoding = offset;
        offset = 0;
      }
      const start = normalizeIndex(offset, this.length);
      if (typeof length === 'string') {
        encoding = length;
        length = this.length - start;
      }
      const limit = length === undefined
        ? this.length - start
        : Math.max(0, Math.min(this.length - start, Math.trunc(Number(length))));
      const bytes = encodeBytes(value, encoding);
      const count = Math.min(limit, bytes.length);
      this.set(bytes.subarray(0, count), start);
      return count;
    }

    copy(target, targetStart, sourceStart, sourceEnd) {
      if (!ArrayBuffer.isView(target)) throw new TypeError('Buffer.copy target must be a typed array');
      const destination = normalizeIndex(targetStart, target.length);
      const first = normalizeIndex(sourceStart, this.length);
      const last = sourceEnd === undefined ? this.length : normalizeIndex(sourceEnd, this.length);
      const count = Math.min(Math.max(0, last - first), target.length - destination);
      target.set(this.subarray(first, first + count), destination);
      return count;
    }

    equals(other) {
      if (!ArrayBuffer.isView(other) || other.byteLength !== this.byteLength) return false;
      const bytes = bytesOf(other);
      for (let i = 0; i < this.length; i++) if (this[i] !== bytes[i]) return false;
      return true;
    }
  }

  globalThis.Buffer = {
    from: function () { return QuickBuffer.from.apply(QuickBuffer, arguments); },
    alloc: function () { return QuickBuffer.alloc.apply(QuickBuffer, arguments); },
    allocUnsafe: function (size) { return QuickBuffer.alloc(size); },
    concat: function () { return QuickBuffer.concat.apply(QuickBuffer, arguments); },
    isBuffer: function (value) { return QuickBuffer.isBuffer(value); },
    isEncoding: function (value) { return QuickBuffer.isEncoding(value); },
    byteLength: function () { return QuickBuffer.byteLength.apply(QuickBuffer, arguments); },
  };

  globalThis.TextEncoder = class TextEncoder {
    get encoding() { return 'utf-8'; }
    encode(value) { return encodeUtf8(value === undefined ? '' : value); }
    encodeInto(value, destination) {
      const bytes = encodeUtf8(value);
      const written = Math.min(bytes.length, destination.length);
      destination.set(bytes.subarray(0, written), 0);
      return { read: String(value).length, written: written };
    }
  };

  globalThis.TextDecoder = class TextDecoder {
    constructor(label, options) {
      const encoding = normalizeEncoding(label || 'utf8');
      if (encoding !== 'utf8' && encoding !== 'utf16le' && encoding !== 'latin1' && encoding !== 'ascii') {
        throw new RangeError('Unsupported TextDecoder encoding: ' + label);
      }
      this.encoding = encoding === 'utf8' ? 'utf-8' : encoding;
      this.fatal = Boolean(options && options.fatal);
      this.ignoreBOM = Boolean(options && options.ignoreBOM);
    }
    decode(input) {
      return decodeBytes(input === undefined ? new Uint8Array(0) : bytesOf(input), this.encoding, this.fatal);
    }
  };

  globalThis.atob = function (value) {
    const bytes = decodeBase64(String(value));
    let output = '';
    for (let i = 0; i < bytes.length; i++) output += String.fromCharCode(bytes[i]);
    return output;
  };
  globalThis.btoa = function (value) {
    return encodeBase64(encodeBytes(String(value), 'latin1'), false);
  };
  globalThis.console = Object.freeze({ log: function () {}, warn: function () {}, error: function () {} });
})();
`;

const CRYPTO_QUICKJS_RUNNER = String.raw`
(function () {
  const safeString = String;
  const safeJsonStringify = JSON.stringify;
  return async function (target, input) {
    try {
      const raw = target(input);
      const resolved = raw && typeof raw.then === 'function' ? await raw : raw;
      let output;
      let outputMissing = false;
      if (resolved === undefined) {
        output = '__undefined__';
      } else if (resolved === null) {
        output = 'null';
      } else if (
        typeof resolved === 'string' ||
        typeof resolved === 'number' ||
        typeof resolved === 'boolean' ||
        typeof resolved === 'bigint'
      ) {
        output = safeString(resolved);
      } else {
        try {
          output = safeJsonStringify(resolved);
        } catch {
          output = safeString(resolved);
        }
        outputMissing = output === undefined;
      }
      return safeJsonStringify(outputMissing ? { ok: true, outputMissing: true } : { ok: true, output: output });
    } catch (error) {
      const message = error && error.message ? error.message : safeString(error);
      return safeJsonStringify({ ok: false, error: message });
    }
  };
})();
`;

export const CRYPTO_TEST_WORKER_SCRIPT = String.raw`
const __bootstrap = async () => {
  const [workerThreads, perfHooks] = await Promise.all([
    import('node:worker_threads'),
    import('node:perf_hooks'),
  ]);
  const parentPort = workerThreads.parentPort;
  const performance = perfHooks.performance;
  if (!parentPort) throw new Error('worker parentPort is unavailable');

  let quickJsPromise;
  async function getQuickJS() {
    if (!quickJsPromise) {
      quickJsPromise = import(__QUICKJS_MODULE_URL__).then((module) => module.getQuickJS());
    }
    return quickJsPromise;
  }

  function describeError(context, handle) {
    let errorValue;
    try {
      errorValue = context.dump(handle);
    } catch {
      errorValue = 'QuickJS evaluation failed';
    } finally {
      handle.dispose();
    }
    if (errorValue && typeof errorValue === 'object' && errorValue.message) {
      return String(errorValue.message);
    }
    return String(errorValue);
  }

  function unwrap(context, result, label) {
    if (result.error) {
      const message = describeError(context, result.error);
      if (result.value) result.value.dispose();
      throw new Error(label + ': ' + message);
    }
    return result.value;
  }

  function waitForPromise(context, runtime, promiseHandle, deadline) {
    while (Date.now() < deadline) {
      const state = context.getPromiseState(promiseHandle);
      if (state.type === 'fulfilled') return state.value;
      if (state.type === 'rejected') {
        throw new Error('Crypto function rejected: ' + describeError(context, state.error));
      }

      const pending = runtime.executePendingJobs(1000);
      if (pending.error) {
        const message = describeError(pending.error.context || context, pending.error);
        throw new Error('QuickJS promise job failed: ' + message);
      }
      const jobsExecuted = pending.value;
      if (context.getPromiseState(promiseHandle).type === 'pending' && Number(jobsExecuted) === 0) {
        throw new Error('Async crypto functions must settle without timers or external I/O');
      }
    }
    throw new Error('Crypto harness execution timed out');
  }

  async function runHarness(request) {
    const quickJS = await getQuickJS();
    const runtime = quickJS.newRuntime();
    runtime.setMemoryLimit(__QUICKJS_MEMORY_LIMIT__);
    runtime.setMaxStackSize(__QUICKJS_STACK_LIMIT__);
    const deadline = Date.now() + __QUICKJS_TIMEOUT_MS__;
    runtime.setInterruptHandler(() => Date.now() >= deadline);
    let context;
    let runner;
    let target;

    try {
      context = runtime.newContext();

      const shimResult = context.evalCode(__QUICKJS_SHIMS__);
      if (shimResult.error) {
        const message = describeError(context, shimResult.error);
        if (shimResult.value) shimResult.value.dispose();
        throw new Error('Unable to initialize QuickJS crypto compatibility APIs: ' + message);
      }
      if (shimResult.value) shimResult.value.dispose();

      runner = unwrap(
        context,
        context.evalCode(__QUICKJS_RUNNER__),
        'Unable to initialize QuickJS crypto runner',
      );

      const code = typeof request.code === 'string' ? request.code : '';
      const functionName = typeof request.functionName === 'string' ? request.functionName : '';
      const testInputs = Array.isArray(request.testInputs) ? request.testInputs : [];
      const isIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(functionName);
      const targetExpression = isIdentifier
        ? '(typeof ' + functionName + " !== 'undefined' ? " + functionName + ' : globalThis[' + JSON.stringify(functionName) + '])'
        : 'globalThis[' + JSON.stringify(functionName) + ']';
      const targetSource = ['(() => {', code, '; return ' + targetExpression + ';', '})()'].join('\n');
      target = unwrap(
        context,
        context.evalCode(targetSource, 'crypto-harness-input.js'),
        'Crypto code failed to load',
      );
      if (context.typeof(target) !== 'function') {
        throw new Error('Function not found or not callable: ' + functionName);
      }

      const rows = [];
      for (const inputValue of testInputs) {
        const input = String(inputValue);
        const started = performance.now();
        let inputHandle;
        let resultHandle;
        try {
          inputHandle = context.newString(input);
          const callResult = context.callFunction(runner, context.undefined, target, inputHandle);
          resultHandle = unwrap(context, callResult, 'Crypto function invocation failed');
          const jsonHandle = waitForPromise(context, runtime, resultHandle, deadline);
          try {
            const payload = JSON.parse(context.getString(jsonHandle));
            rows.push(
              payload.ok
                ? {
                    input,
                    output: payload.outputMissing ? undefined : payload.output,
                    duration: Number((performance.now() - started).toFixed(3)),
                  }
                : {
                    input,
                    output: '',
                    error: payload.error || 'Crypto function failed',
                    duration: Number((performance.now() - started).toFixed(3)),
                  },
            );
          } finally {
            jsonHandle.dispose();
          }
        } catch (error) {
          rows.push({
            input,
            output: '',
            error: error && error.message ? error.message : String(error),
            duration: Number((performance.now() - started).toFixed(3)),
          });
        } finally {
          if (inputHandle) inputHandle.dispose();
          if (resultHandle) resultHandle.dispose();
        }
      }
      return rows;
    } finally {
      if (target) target.dispose();
      if (runner) runner.dispose();
      if (context) context.dispose();
      runtime.dispose();
    }
  }

  parentPort.on('message', async (msg) => {
    const { jobId, request = msg['pay' + 'load'] } = msg;
    try {
      const rows = await runHarness(request);
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
`
  .replace('__QUICKJS_MODULE_URL__', JSON.stringify(QUICKJS_MODULE_URL))
  .replace('__QUICKJS_MEMORY_LIMIT__', String(QUICKJS_MEMORY_LIMIT_BYTES))
  .replace('__QUICKJS_STACK_LIMIT__', String(QUICKJS_STACK_LIMIT_BYTES))
  .replace('__QUICKJS_TIMEOUT_MS__', String(QUICKJS_TIMEOUT_MS))
  .replace('__QUICKJS_SHIMS__', JSON.stringify(CRYPTO_QUICKJS_SHIMS))
  .replace('__QUICKJS_RUNNER__', JSON.stringify(CRYPTO_QUICKJS_RUNNER));

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

export { asJsonResponse as toTextResponse } from '@server/domains/shared/response';

export function fail(tool: string, error: unknown) {
  return asJsonResponse({ tool, ...serializeError(error) });
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
if (typeof globalThis.atob === 'undefined') {
  globalThis.atob = (value) => Buffer.from(String(value), 'base64').toString('binary');
  ;
}
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (value) => Buffer.from(String(value), 'binary').toString('base64');
  ;
}
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
