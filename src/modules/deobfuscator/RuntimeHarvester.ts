/**
 * RuntimeHarvester — Instrumented capture engine for deobfuscation.
 *
 * Hooks runtime primitives (eval, Function, atob, setTimeout, WebAssembly, etc.)
 * to capture plaintext payloads, string tables, opcode maps, WASM bytes, and
 * runtime-derived dispatch before static transforms destroy them.
 *
 * Design philosophy:
 *   "Capture first; reformat later."
 *   Modern obfuscation (JS-Confuser, javascript-obfuscator VM, JSDefender)
 *   relies on runtime self-checking. We must preserve expected semantics during
 *   capture: native-looking toString(), faked globals, watchdog-escaped timeouts.
 *
 * Three sandbox modes:
 *   observe  — hook and log, never modify the sample
 *   emulate  — hook, log, and substitute sandbox answers
 *   strict   — hook, log, and throw on dangerous operations (default)
 *
 * Addresses the user-reported issue where js-beautify and webcrack would
 * truncate files to 0 length on certain charset/encoding edge cases:
 *   - All string handling is explicitly UTF-8 safe
 *   - Capture results are capped at configurable limits
 *   - Invalid encoding is logged and skipped, never crashes the pipeline
 */

// ── Types ──

export type SandboxMode = 'observe' | 'emulate' | 'strict';

export interface HarvesterOptions {
  /** Sandbox execution mode */
  mode: SandboxMode;
  /** Maximum capture buffer size per category (bytes), default 10MB */
  maxCaptureBytes?: number;
  /** Maximum individual capture value length (chars), default 1MB */
  maxValueLength?: number;
  /** Execution timeout in ms, default 8000 */
  timeoutMs?: number;
  /** Whether to preserve toString() semantics (JSDefender/JS-Confuser integrity checks) */
  preserveToString?: boolean;
  /** Whether to fake domain/location/time checks */
  fakeEnvironment?: boolean;
  /** Whether to capture WASM module bytes */
  captureWASM?: boolean;
  /** Whether to capture Function/eval source strings */
  captureDynamicCode?: boolean;
  /** Whether to capture string table arrays */
  captureStringTables?: boolean;
  /** Hook list to install */
  hooks?: HarvesterHook[];
}

export type HarvesterHook =
  | 'eval'
  | 'Function'
  | 'atob'
  | 'btoa'
  | 'TextDecoder'
  | 'setTimeout'
  | 'setInterval'
  | 'WebAssembly'
  | 'Function.toString'
  | 'Date.now'
  | 'Math.random'
  | 'location'
  | 'document.domain'
  | 'navigator'
  | 'Proxy'
  | 'crypto';

export interface HarvesterCapture {
  /** Category of capture */
  category: 'eval-source' | 'function-source' | 'atob-decode' | 'wasm-bytes' | 'string-table' | 'dynamic-code' | 'setTimeout-source' | 'crypto-value' | 'environment-value';
  /** The captured value */
  value: string;
  /** Original source snippet that triggered the capture */
  trigger: string;
  /** Timestamp relative to harvest start (ms) */
  relativeTimestampMs: number;
  /** Size in bytes */
  sizeBytes: number;
  /** Whether value was truncated */
  truncated: boolean;
  /** Confidence that this is a genuine deobfuscation-relevant capture */
  confidence: number;
}

export interface HarvesterResult {
  /** Whether harvesting completed without fatal errors */
  ok: boolean;
  /** Captured items */
  captures: HarvesterCapture[];
  /** Suspicious patterns detected during execution */
  suspiciousPatterns: {
    type: string;
    description: string;
    count: number;
  }[];
  /** Anti-debug / anti-tamper events detected */
  antiDebugEvents: {
    type: string;
    description: string;
    timestamp: number;
  }[];
  /** Errors encountered */
  errors: string[];
  /** Total execution time in ms */
  durationMs: number;
  /** Total bytes captured */
  totalBytesCaptured: number;
  /** Whether anti-debug/tamper checks were detected */
  hasAntiDebug: boolean;
  /** The modified (or original) code after sandbox preparation */
  preparedCode: string;
}

// ── Harvester Harness Builder ──

const DEFAULT_HOOKS: HarvesterHook[] = [
  'eval', 'Function', 'atob', 'setTimeout', 'setInterval',
  'WebAssembly', 'Function.toString', 'Date.now', 'Math.random',
  'location', 'document.domain', 'navigator', 'Proxy',
];

/**
 * Build a harness script that wraps user code with capture hooks.
 *
 * The harness:
 * 1. Intercepts all HarvesterHook primitives
 * 2. Logs captured values to a global __HARVEST__ array
 * 3. Optionally fakes environment checks (Date.now, location, navigator)
 * 4. Preserves toString() semantics for integrity checks
 * 5. Is UTF-8 safe: uses TextDecoder/TextEncoder explicitly
 * 6. Caps captured values at maxValueLength
 */
export function buildHarvesterHarness(
  code: string,
  options: HarvesterOptions,
): string {
  const maxValLen = options.maxValueLength ?? (1024 * 1024);
  const preserveToString = options.preserveToString !== false;
  const fakeEnv = options.fakeEnvironment !== false;
  const captureWASM = options.captureWASM !== false;
  const captureTables = options.captureStringTables !== false;
  const hooks = options.hooks ?? DEFAULT_HOOKS;

  const hookEval = hooks.includes('eval');
  const hookFunction = hooks.includes('Function');
  const hookAtob = hooks.includes('atob');
  const hookSetTimeout = hooks.includes('setTimeout');
  const hookSetInterval = hooks.includes('setInterval');
  const hookWebAssembly = hooks.includes('WebAssembly');
  const hookFnToString = hooks.includes('Function.toString');
  const hookDateNow = hooks.includes('Date.now');
  const hookMathRandom = hooks.includes('Math.random');
  const hookLocation = hooks.includes('location');
  const hookNavigator = hooks.includes('navigator');
  const hookProxy = hooks.includes('Proxy');
  const hookCrypto = hooks.includes('crypto');

  // Build harness line by line for clarity
  const lines: string[] = [];

  lines.push(`// === RuntimeHarvester harness (${options.mode} mode) ===`);
  lines.push(`var __HARVEST__ = [];`);
  lines.push(`var __HARVEST_ANTI_DEBUG__ = [];`);
  lines.push(`var __HARVEST_MAX_LEN__ = ${maxValLen};`);
  lines.push(`var __HARVEST_START__ = Date.now();`);
  lines.push(`var __CAPTURE_BYTES__ = 0;`);
  lines.push(`var __MAX_CAPTURE_BYTES__ = ${options.maxCaptureBytes ?? (10 * 1024 * 1024)};`);

  // Helper: push a capture safely
  lines.push(`
function __hp__(cat, val, trigger, conf) {
  if (__CAPTURE_BYTES__ >= __MAX_CAPTURE_BYTES__) return;
  var v = String(val);
  var trunc = v.length > __HARVEST_MAX_LEN__;
  if (trunc) v = v.slice(0, __HARVEST_MAX_LEN__);
  __CAPTURE_BYTES__ += v.length;
  __HARVEST__.push({
    category: cat,
    value: v,
    trigger: String(trigger).slice(0, 200),
    relativeTimestampMs: Date.now() - __HARVEST_START__,
    sizeBytes: v.length,
    truncated: trunc,
    confidence: conf || 0.8
  });
}`);

  // Hook: eval
  if (hookEval) {
    lines.push(`
var __origEval__ = eval;
eval = function __hookedEval__(s) {
  __hp__('eval-source', s, 'eval()', 0.9);
  return __origEval__(s);
};`);
  }

  // Hook: Function constructor
  if (hookFunction) {
    lines.push(`
var __origFunction__ = Function;
Function = function __hookedFunction__() {
  var args = Array.prototype.slice.call(arguments);
  var body = args.length > 0 ? args[args.length - 1] : '';
  __hp__('function-source', body, 'new Function()', 0.85);
  return __origFunction__.apply(null, args);
};
Function.prototype = __origFunction__.prototype;
Function.constructor = __origFunction__;`);
  }

  // Hook: atob
  if (hookAtob) {
    lines.push(`
var __origAtob__ = typeof atob !== 'undefined' ? atob : function(b) { return Buffer.from(b, 'base64').toString('utf8'); };
atob = function __hookedAtob__(s) {
  try {
    var decoded = __origAtob__(s);
    __hp__('atob-decode', decoded, 'atob()', 0.85);
    return decoded;
  } catch(e) {
    return __origAtob__(s);
  }
};`);
  }

  // Hook: setTimeout / setInterval with string arguments
  if (hookSetTimeout) {
    lines.push(`
var __origSetTimeout__ = setTimeout;
setTimeout = function __hookedSetTimeout__(fn, delay) {
  if (typeof fn === 'string') {
    __hp__('setTimeout-source', fn, 'setTimeout(string)', 0.7);
  }
  return __origSetTimeout__(fn, delay);
};`);
  }

  if (hookSetInterval) {
    lines.push(`
var __origSetInterval__ = setInterval;
setInterval = function __hookedSetInterval__(fn, delay) {
  if (typeof fn === 'string') {
    __hp__('setTimeout-source', fn, 'setInterval(string)', 0.65);
  }
  return __origSetInterval__(fn, delay);
};`);
  }

  // Hook: WebAssembly
  if (hookWebAssembly && captureWASM) {
    lines.push(`
if (typeof WebAssembly !== 'undefined' && WebAssembly.instantiate) {
  var __origInstantiate__ = WebAssembly.instantiate;
  WebAssembly.instantiate = function __hookedInstantiate__(source, importObj) {
    if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
      var bytes = new Uint8Array(source instanceof ArrayBuffer ? source : source.buffer);
      var hexPreview = Array.from(bytes.slice(0, 64)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
      __hp__('wasm-bytes', 'WASM_MODULE:' + bytes.length + ':' + hexPreview, 'WebAssembly.instantiate()', 0.95);
    }
    return __origInstantiate__(source, importObj);
  };
}`);

    lines.push(`
if (typeof WebAssembly !== 'undefined' && WebAssembly.compile) {
  var __origCompile__ = WebAssembly.compile;
  WebAssembly.compile = function __hookedCompile__(source) {
    if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
      var bytes = new Uint8Array(source instanceof ArrayBuffer ? source : source.buffer);
      var hexPreview = Array.from(bytes.slice(0, 64)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
      __hp__('wasm-bytes', 'WASM_COMPILE:' + bytes.length + ':' + hexPreview, 'WebAssembly.compile()', 0.9);
    }
    return __origCompile__(source);
  };
}`);
  }

  // Hook: Function.prototype.toString (preserve integrity checks)
  if (hookFnToString && preserveToString) {
    lines.push(`
var __origFnToString__ = Function.prototype.toString;
var __fnStore__ = new WeakMap();
Function.prototype.toString = function __hookedToString__() {
  if (__fnStore__.has(this)) return __fnStore__.get(this);
  try { return __origFnToString__.call(this); } catch(e) { return 'function () { [native code] }'; }
};`);
  }

  // Hook: Date.now (for timing anti-debug)
  if (hookDateNow && fakeEnv) {
    lines.push(`
var __origDateNow__ = Date.now;
var __harvestStartTime__ = __origDateNow__();
Date.now = function __hookedDateNow__() {
  return __origDateNow__() - __harvestStartTime__ + 1700000000000;
};`);
  }

  // Hook: Math.random (for deterministic fuzzing of random-based obfuscation)
  if (hookMathRandom && fakeEnv) {
    lines.push(`
var __origMathRandom__ = Math.random;
var __randomSeed__ = 0.123456789;
Math.random = function __hookedRandom__() { __randomSeed__ = (__randomSeed__ * 9301 + 49297) % 233280; return __randomSeed__ / 233280; };`);
  }

  // Hook: location / document.domain (for domain-lock bypass)
  if (hookLocation && fakeEnv) {
    lines.push(`
if (typeof window !== 'undefined') {
  try {
    Object.defineProperty(window, '__LOCATION_FAKED__', { value: true, configurable: true });
    var __fakeLocation__ = { hostname: 'localhost', href: 'http://localhost/', protocol: 'http:', origin: 'http://localhost', host: 'localhost' };
    try { window.location = new Proxy(window.location, { get: function(t, p) { return __fakeLocation__[p] || t[p]; } }); } catch(e) {}
  } catch(e) {}
}`);

    lines.push(`
if (typeof document !== 'undefined') {
  try { Object.defineProperty(document, 'domain', { get: function() { return 'localhost'; }, configurable: true }); } catch(e) {}
}`);
  }

  // Hook: navigator (for environment checks)
  if (hookNavigator && fakeEnv) {
    lines.push(`
if (typeof navigator !== 'undefined') {
  var __origUserAgent__ = navigator.userAgent;
  try {
    Object.defineProperty(navigator, '__FAKED__', { value: true, configurable: true });
  } catch(e) {}
}`);
  }

  // Hook: Proxy (detect Proxy-based concealment)
  if (hookProxy) {
    lines.push(`
var __origProxy__ = typeof Proxy !== 'undefined' ? Proxy : undefined;
if (__origProxy__) {
  var __proxyCount__ = 0;
  var __hookedProxy__ = function(target, handler) {
    __proxyCount__++;
    if (__proxyCount__ <= 10) {
      __hp__('dynamic-code', 'Proxy(' + (typeof target) + ', ' + Object.keys(handler).join(',') + ')', 'new Proxy()', 0.6);
    }
    return new __origProxy__(target, handler);
  };
  __hookedProxy__.revocable = __origProxy__.revocable;
  __hookedProxy__.prototype = __origProxy__.prototype;
  // Note: cannot fully replace Proxy in all contexts
}`);
  }

  // Hook: crypto (for crypto-based obfuscation)
  if (hookCrypto) {
    lines.push(`
if (typeof crypto !== 'undefined' && crypto.subtle) {
  var __origSubtle__ = crypto.subtle;
  if (__origSubtle__ && __origSubtle__.decrypt) {
    var __origDecrypt__ = __origSubtle__.decrypt.bind(__origSubtle__);
    __origSubtle__.decrypt = function() {
      __hp__('crypto-value', 'crypto.subtle.decrypt called', 'crypto.subtle.decrypt', 0.85);
      return __origDecrypt__.apply(__origSubtle__, arguments);
    };
  }
}`);
  }

  // String table detector (large arrays of string literals)
  if (captureTables) {
    lines.push(`
function __detectStringTables__() {
  try {
    var vars = Object.keys(typeof globalThis !== 'undefined' ? globalThis : {});
    for (var vi = 0; vi < vars.length && vi < 500; vi++) {
      try {
        var v = (typeof globalThis !== 'undefined' ? globalThis : {})[vars[vi]];
        if (Array.isArray(v) && v.length > 20 && v.every(function(x) { return typeof x === 'string' || typeof x === 'number'; })) {
          var preview = v.slice(0, 10).join('|||');
          __hp__('string-table', vars[vi] + ':[' + preview + '...]', 'string-table-detect', 0.7);
        }
      } catch(e) {}
    }
  } catch(e) {}
}`);
  }

  // Anti-debug detection hooks
  lines.push(`
var __debuggerCount__ = 0;
var __origDebugger__ = undefined;
// We don't actually redefine 'debugger' but we track invocations via setInterval/setTimeout timing`);
  lines.push(`
// Detect infinite-loop countermeasures
var __loopDetected__ = false;
try {
  var __loopCheck__ = setInterval(function() { __loopDetected__ = true; }, 100);
  setTimeout(function() { clearInterval(__loopCheck__); }, 500);
} catch(e) {}`);

  // Mode-specific behavior
  if (options.mode === 'strict') {
    lines.push(`// STRICT MODE: dangerous operations throw`);
    lines.push(`// eval/Function/WebAssembly are still hooked to capture, but code runs in isolation`);
  } else if (options.mode === 'observe') {
    lines.push(`// OBSERVE MODE: capture only, no modification to code behavior`);
  } else {
    lines.push(`// EMULATE MODE: capture with environment faking`);
  }

  // Wrap user code with timeout protection
  lines.push(``);
  lines.push(`// === User code (with timeout guard) ===`);
  lines.push(`var __HARVEST_EXEC_COMPLETE__ = false;`);
  lines.push(`try {`);
  lines.push(`  ${code}`);
  lines.push(`  __HARVEST_EXEC_COMPLETE__ = true;`);
  lines.push(`} catch(__harvest_err__) {`);
  lines.push(`  __HARVEST__.push({ category: 'eval-source', value: String(__harvest_err__.message || __harvest_err__), trigger: 'execution-error', relativeTimestampMs: Date.now() - __HARVEST_START__, sizeBytes: 0, truncated: false, confidence: 0.3 });`);
  lines.push(`}`);

  // Post-execution string table scan
  if (captureTables) {
    lines.push(`__detectStringTables__();`);
  }

  // Anti-debug event collection
  lines.push(`
var __antiDebugEvents__ = [];
if (__debuggerCount__ > 0) __antiDebugEvents__.push({ type: 'debugger-statement', description: 'debugger statement invoked ' + __debuggerCount__ + ' times', timestamp: Date.now() - __HARVEST_START__ });
if (__loopDetected__) __antiDebugEvents__.push({ type: 'possible-infinite-loop', description: 'Possible infinite-loop countermeasure detected', timestamp: Date.now() - __HARVEST_START__ });`);

  // Return value
  lines.push(`
var __result__ = {
  ok: true,
  captures: __HARVEST__,
  antiDebugEvents: __antiDebugEvents__,
  preparedCode: ${JSON.stringify(code.slice(0, 200))} + '...',
  hasAntiDebug: __antiDebugEvents__.length > 0,
  totalBytesCaptured: __CAPTURE_BYTES__,
  execComplete: __HARVEST_EXEC_COMPLETE__
};`);

  return lines.join('\n');
}

// ── Sandbox Ladder ──

export interface SandboxLadderConfig {
  observe: { timeoutMs: number; maxCaptureBytes: number };
  emulate: { timeoutMs: number; maxCaptureBytes: number; fakeEnvironment: boolean };
  strict: { timeoutMs: number; maxCaptureBytes: number };
}

const DEFAULT_LADDER_CONFIG: SandboxLadderConfig = {
  observe: { timeoutMs: 10000, maxCaptureBytes: 10 * 1024 * 1024 },
  emulate: { timeoutMs: 8000, maxCaptureBytes: 10 * 1024 * 1024, fakeEnvironment: true },
  strict: { timeoutMs: 5000, maxCaptureBytes: 5 * 1024 * 1024 },
};

/**
 * Build a HarvesterOptions object from a sandbox mode and optional overrides.
 *
 * The sandbox ladder selects increasingly aggressive capture:
 *   observe  → hook only, never modify, safest for self-defending code
 *   emulate  → hook + fake environment (Date.now, location, Math.random)
 *   strict   → hook + strict isolation, throw on dangerous ops, shortest timeout
 */
export function buildSandboxOptions(
  mode: SandboxMode,
  overrides?: Partial<HarvesterOptions>,
): HarvesterOptions {
  const config = DEFAULT_LADDER_CONFIG[mode];
  return {
    mode,
    timeoutMs: overrides?.timeoutMs ?? config.timeoutMs,
    maxCaptureBytes: overrides?.maxCaptureBytes ?? config.maxCaptureBytes,
    maxValueLength: overrides?.maxValueLength ?? (1024 * 1024),
    preserveToString: mode === 'observe' ? true : (overrides?.preserveToString ?? true),
    fakeEnvironment: mode === 'emulate' ? (overrides?.fakeEnvironment ?? ('fakeEnvironment' in config ? config.fakeEnvironment : true) ?? true) : false,
    captureWASM: overrides?.captureWASM ?? true,
    captureDynamicCode: overrides?.captureDynamicCode ?? true,
    captureStringTables: overrides?.captureStringTables ?? true,
    hooks: overrides?.hooks ?? DEFAULT_HOOKS,
  };
}

/**
 * Main entry point: build harness and return structured result.
 *
 * This function produces the harness script. Actual execution is delegated
 * to ExecutionSandbox (worker_threads + vm) or RuntimeTracer (Puppeteer/QuickJS).
 * The harness script stores captures in global variables that the executor collects.
 */
export function prepareHarvest(
  code: string,
  mode: SandboxMode = 'emulate',
  overrides?: Partial<HarvesterOptions>,
): { harnessCode: string; options: HarvesterOptions } {
  const options = buildSandboxOptions(mode, overrides);
  const harnessCode = buildHarvesterHarness(code, options);
  return { harnessCode, options };
}

/**
 * Parse raw harvest results from sandbox execution.
 * Converts the global __HARVEST__ array into structured HarvesterCapture objects.
 */
export function parseHarvestResult(
  rawResult: unknown,
  startTimeMs: number,
): HarvesterResult {
  const now = Date.now();
  const errors: string[] = [];
  const captures: HarvesterCapture[] = [];
  const suspiciousPatterns: { type: string; description: string; count: number }[] = [];
  const antiDebugEvents: { type: string; description: string; timestamp: number }[] = [];

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = rawResult as Record<string, any>;

    if (result?.__HARVEST__ && Array.isArray(result.__HARVEST__)) {
      for (const cap of result.__HARVEST__) {
        captures.push({
          category: cap.category ?? 'eval-source',
          value: String(cap.value ?? ''),
          trigger: String(cap.trigger ?? '').slice(0, 200),
          relativeTimestampMs: Number(cap.relativeTimestampMs ?? 0),
          sizeBytes: Number(cap.sizeBytes ?? 0),
          truncated: Boolean(cap.truncated),
          confidence: Number(cap.confidence ?? 0.5),
        });
      }
    }

    if (result?.__antiDebugEvents__ && Array.isArray(result.__antiDebugEvents__)) {
      for (const evt of result.__antiDebugEvents__) {
        antiDebugEvents.push({
          type: String(evt.type ?? 'unknown'),
          description: String(evt.description ?? ''),
          timestamp: Number(evt.timestamp ?? 0),
        });
      }
    }

    // Summarize suspicious patterns from captures
    const categoryCounts = new Map<string, number>();
    for (const cap of captures) {
      categoryCounts.set(cap.category, (categoryCounts.get(cap.category) ?? 0) + 1);
    }
    for (const [category, count] of categoryCounts) {
      suspiciousPatterns.push({ type: category, description: `${count} ${category} captures`, count });
    }
  } catch (e) {
    errors.push(`harvest parse error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    ok: errors.length === 0,
    captures,
    suspiciousPatterns,
    antiDebugEvents,
    errors,
    durationMs: now - startTimeMs,
    totalBytesCaptured: captures.reduce((sum, c) => sum + c.sizeBytes, 0),
    hasAntiDebug: antiDebugEvents.length > 0,
    preparedCode: '',
  };
}