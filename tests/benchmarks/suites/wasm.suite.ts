/**
 * WASM domain benchmark (structural subset — wabt-dependent cases skip when absent).
 *
 * External reference:
 *  - WebAssembly Binary Format spec (github.com/WebAssembly/spec §Binary Format):
 *    a hand-assembled minimal module (\0asm 1, type/func/export/code sections) whose
 *    layout and evaluation semantics (answer() === 42) are normative.
 * Homemade fixtures:
 *  - structural counts (imports/exports/functions/sections)
 *  - offline execution of the exported function
 */
import { WasmToolHandlers } from '@server/domains/wasm/handlers';
import { body, type BenchSuite } from '../harness';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const collector = { getActivePage: async () => null } as never;
const handlers = new WasmToolHandlers(collector);

// Hand-assembled per the spec's binary format:
//   magic + version, type (() -> i32), func (uses type 0),
//   export ("answer" → func 0), code (i32.const 42, end)
const MINIMAL_WASM = Buffer.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, 0x03,
  0x02, 0x01, 0x00, 0x07, 0x0a, 0x01, 0x06, 0x61, 0x6e, 0x73, 0x77, 0x65, 0x72, 0x00, 0x00, 0x0a,
  0x06, 0x01, 0x04, 0x00, 0x41, 0x2a, 0x0b,
]);

const tmp = mkdtempSync(join(tmpdir(), 'jshook-bench-wasm-'));
const wasmPath = join(tmp, 'answer.wasm');
writeFileSync(wasmPath, MINIMAL_WASM);
process.once('exit', () => {
  try {
    require('node:fs').rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* tmpdir */
  }
});

export const wasmSuite: BenchSuite = {
  name: 'wasm',
  domain: 'wasm',
  description:
    'spec-conformant minimal module: structural inspection, section parsing, offline execution (answer() = 42)',
  cases: [
    {
      name: 'wasm_inspect/minimal-module-structure',
      tool: 'wasm_inspect',
      origin: 'external-vector',
      reference:
        'WebAssembly spec §Binary Format: minimal module must yield 1 function, 1 export "answer", no imports',
      run: () => handlers.handleWasmInspectTool({ inputPath: wasmPath }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        const text = JSON.stringify(b);
        if (!text.includes('answer')) return 'export name "answer" not recovered';
        const num = (keys: string[]) => {
          for (const k of keys) {
            const m = text.match(new RegExp(`"${k}":\\s*(\\d+)`));
            if (m) return Number(m[1]);
          }
          return undefined;
        };
        const funcs = num(['functions', 'functionCount', 'codeSegments']);
        if (funcs !== undefined && funcs < 1) return `expected ≥1 function, got ${funcs}`;
        const imports = num(['imports', 'importCount']);
        if (imports !== undefined && imports !== 0) return `expected 0 imports, got ${imports}`;
        return true;
      },
    },
    {
      name: 'wasm_inspect_sections/pure-ts-fallback',
      tool: 'wasm_inspect_sections',
      origin: 'external-vector',
      reference:
        'spec section IDs 1/2/3/7/10/11: with wabt absent the handler must fall back to the pure-TS parser and still report type/import/function/export/code/data sections',
      run: () => handlers.handleWasmInspectSectionsTool({ inputPath: wasmPath }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `fallback did not engage: ${b.error}`;
        if (b.source !== 'pure-ts-fallback')
          return `expected pure-ts-fallback source, got ${b.source}`;
        const sections = (b.sections ?? []) as Array<{ name?: string; count?: number }>;
        const names = sections.map((sec) => String(sec.name ?? ''));
        for (const required of ['type', 'import', 'function', 'export', 'code', 'data']) {
          if (!names.includes(required))
            return `section "${required}" missing: [${names.join(',')}]`;
        }
        const code = sections.find((sec) => sec.name === 'code');
        if (code?.count !== 1)
          return `expected code section with 1 function, got ${JSON.stringify(code)}`;
        return true;
      },
    },
    {
      name: 'wasm_capabilities/runtime-report-honest',
      tool: 'wasm_capabilities',
      origin: 'homemade',
      reference:
        'capability reporting must be explicit about the wabt/external-runtime dimension rather than silently degrading',
      run: () => handlers.handleWasmCapabilitiesTool(),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        const text = JSON.stringify(b).toLowerCase();
        if (!text.includes('capabilities')) return 'no capabilities array in response';
        if (!text.includes('wabt')) return 'capabilities response missing "wabt" dimension';
        if (!text.includes('available')) return 'capabilities entries lack available flags';
        return true;
      },
    },
    {
      name: 'wasm_offline_run/answer-42-node-fallback',
      tool: 'wasm_offline_run',
      origin: 'external-vector',
      reference:
        'WebAssembly evaluation semantics: exported answer() with body (i32.const 42) must return 42 — via wasmtime/wasmer when installed, else the built-in node WebAssembly engine',
      run: () =>
        handlers.handleWasmOfflineRunTool({
          inputPath: wasmPath,
          functionName: 'answer',
          args: [],
        }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `run failed: ${b.error}`;
        const text = JSON.stringify(b);
        if (!text.includes('42')) return `expected result 42, got: ${text.slice(0, 200)}`;
        const runtime = String(b.runtime ?? '');
        return /wasmtime|wasmer|node/i.test(runtime)
          ? true
          : `unrecognized runtime label: ${runtime}`;
      },
    },

    // ── Coverage batch 2026-11-11 (autoresearch): pure-TS wasm string extraction ──
    {
      name: 'wasm_string_extract/extract-export-name',
      tool: 'wasm_string_extract',
      origin: 'external-vector',
      reference:
        'extracts printable strings from WASM binary sections (finds the exported "answer" identifier)',
      run: () => handlers.handleWasmStringExtractTool({ inputPath: wasmPath, minLength: 4 }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `string extract failed: ${b.error}`;
        const strings = (b.strings as Array<{ value?: string }>) ?? [];
        const values = strings.map((s) => s.value);
        if (!values.includes('answer'))
          return `expected "answer" in extracted strings, got: ${JSON.stringify(values)}`;
        return true;
      },
    },

    // ── Wave 2 2026-11-12 (autoresearch): hook-state + external-tool contracts ──
    // The three hook-state tools read `window.__aiHooks` / `__wasmModuleStorage`
    // / `__wasmInstances` inside page.evaluate. Driving them with a page stub
    // whose evaluate runs the callback against a seeded global measures the real
    // host-side work: artifact hashing, occurrence ranking, hex-dump formatting.
    {
      name: 'wasm_dump/hash-and-export-metadata',
      tool: 'wasm_dump',
      origin: 'homemade',
      reference:
        'module dump: the captured bytes are written byte-exact, the reported hash is the first 16 hex chars of their SHA-256, and export/import metadata comes from the instantiated event',
      run: () =>
        hookStateHandlers().handleWasmDumpTool({
          outputPath: join(tmp, 'dumped.wasm'),
        }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== true) return `dump failed: ${JSON.stringify(b).slice(0, 200)}`;
        const expected = createHash('sha256').update(MINIMAL_WASM).digest('hex').slice(0, 16);
        if (b['hash'] !== expected) return `hash ${String(b['hash'])} != ${expected}`;
        if (b['size'] !== MINIMAL_WASM.length) return `size ${String(b['size'])} wrong`;
        if (b['totalModules'] !== 1) return `totalModules ${String(b['totalModules'])} != 1`;
        const exportsObj = b['exports'] as Record<string, unknown> | undefined;
        if (!exportsObj || exportsObj['answer'] === undefined)
          return `export metadata missing: ${JSON.stringify(b['exports'])}`;
        return true;
      },
    },
    {
      name: 'wasm_vmp_trace/ranks-import-calls-by-frequency',
      tool: 'wasm_vmp_trace',
      origin: 'homemade',
      reference:
        'dispatch ranking: import_call events are grouped by module.function and sorted by descending count, with the trace capped and filterModule honoured',
      run: () => hookStateHandlers().handleWasmVmpTraceTool({ maxEvents: 10, filterModule: 'env' }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== true) return `vmp trace failed: ${JSON.stringify(b).slice(0, 200)}`;
        if (b['totalEvents'] !== 3) return `totalEvents ${String(b['totalEvents'])} != 3`;
        const top = (b['topFunctions'] ?? []) as Array<Record<string, unknown>>;
        if (top[0]?.['name'] !== 'env.foo' || top[0]?.['count'] !== 2)
          return `ranking wrong: ${JSON.stringify(top)}`;
        if (top[1]?.['name'] !== 'env.bar' || top[1]?.['count'] !== 1)
          return `second rank wrong: ${JSON.stringify(top)}`;
        if (((b['trace'] ?? []) as unknown[]).length !== 3)
          return `trace length != captured events`;
        return true;
      },
    },
    {
      name: 'wasm_memory_inspect/hex-dump-and-byte-scan',
      tool: 'wasm_memory_inspect',
      origin: 'homemade',
      reference:
        'memory readback: the requested window is dumped as 16-byte rows with an ASCII gutter, and a hex searchPattern returns the absolute match offsets inside that window',
      run: () =>
        hookStateHandlers().handleWasmMemoryInspectTool({
          instanceIndex: 0,
          offset: 0,
          length: 32,
          searchPattern: '41 42',
          format: 'both',
        }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== true)
          return `memory inspect failed: ${JSON.stringify(b).slice(0, 200)}`;
        const hex = String(b['hexDump'] ?? '');
        if (!/^00000000 {2}41 42 43/.test(hex)) return `hex dump wrong: ${hex.slice(0, 80)}`;
        if (!/\|ABC\./.test(hex)) return `ascii gutter wrong: ${hex.slice(0, 80)}`;
        if (!/^00000010 {2}00/m.test(hex)) return `second row address wrong: ${hex.slice(0, 160)}`;
        const hits = (b['searchResults'] ?? []) as Array<Record<string, unknown>>;
        if (hits.length !== 1 || hits[0]?.['offset'] !== 0)
          return `search offsets wrong: ${JSON.stringify(hits)}`;
        if (b['totalInstances'] !== 1)
          return `totalInstances wrong: ${String(b['totalInstances'])}`;
        return true;
      },
    },
    // External-tool contracts. These tools shell out to wabt / binaryen. The
    // checkable contract in BOTH environments: either the tool runs and produces
    // a real payload, or it is absent and the handler fails with an explicit
    // message naming the missing binary — never success with an empty artifact.
    {
      name: 'wasm_disassemble/runs-or-names-missing-wabt',
      tool: 'wasm_disassemble',
      origin: 'homemade',
      reference:
        'external-tool contract: wasm2wat absent → explicit failure naming the binary; present → a wat artifact is written and a preview returned',
      run: () => handlers.handleWasmDisassembleTool({ inputPath: wasmPath }),
      validate: (v) => externalToolOutcome(v, /wasm2wat/),
    },
    {
      name: 'wasm_decompile/runs-or-names-missing-wabt',
      tool: 'wasm_decompile',
      origin: 'homemade',
      reference:
        'external-tool contract: wasm-decompile absent → explicit failure naming the binary, no fabricated dcmp artifact',
      run: () => handlers.handleWasmDecompileTool({ inputPath: wasmPath }),
      validate: (v) => externalToolOutcome(v, /wasm-decompile/),
    },
    {
      name: 'wasm_optimize/runs-or-names-missing-binaryen',
      tool: 'wasm_optimize',
      origin: 'homemade',
      reference:
        'external-tool contract: wasm-opt absent → explicit failure naming the binary, no fabricated size-reduction figures',
      run: () =>
        handlers.handleWasmOptimizeTool({ inputPath: wasmPath, outputPath: join(tmp, 'opt.wasm') }),
      validate: (v) => externalToolOutcome(v, /wasm-opt/),
    },
    {
      name: 'wasm_to_c/runs-or-names-missing-wabt',
      tool: 'wasm_to_c',
      origin: 'homemade',
      reference:
        'external-tool contract: wasm2c absent → explicit failure naming the binary rather than an empty .c/.h pair',
      run: () =>
        handlers.handleWasmToCTool({ inputPath: wasmPath, outputDir: join(tmp, 'toc-out') }),
      validate: (v) => externalToolOutcome(v, /wasm2c/),
    },
    {
      name: 'wasm_detect_obfuscation/runs-or-names-missing-wabt',
      tool: 'wasm_detect_obfuscation',
      origin: 'homemade',
      reference:
        'external-tool contract: obfuscation scoring needs a WAT view; with wasm2wat absent the handler must fail explicitly instead of reporting "no obfuscation detected"',
      run: () => handlers.handleWasmDetectObfuscationTool({ inputPath: wasmPath }),
      validate: (v) => externalToolOutcome(v, /wasm2wat/),
    },
    {
      name: 'wasm_diff/runs-or-names-missing-wabt',
      tool: 'wasm_diff',
      origin: 'homemade',
      reference:
        'external-tool contract: a patch diff needs both modules disassembled; with wasm2wat absent the failure must name the input side that could not be read',
      run: () => handlers.handleWasmDiffTool({ inputPathA: wasmPath, inputPathB: wasmPath }),
      validate: (v) => externalToolOutcome(v, /wasm2wat/),
    },
    {
      name: 'wasm_instrument_binary/runs-or-names-missing-wabt',
      tool: 'wasm_instrument_binary',
      origin: 'homemade',
      reference:
        'external-tool contract: rewriting the code section needs a WAT view; with wasm2wat absent the handler must not claim an instrumented binary',
      run: () => handlers.handleWasmInstrumentBinaryTool({ inputPath: wasmPath }),
      validate: (v) => externalToolOutcome(v, /wasm2wat/),
    },
    {
      name: 'wasm_instrument_block/runs-or-names-missing-wabt',
      tool: 'wasm_instrument_block',
      origin: 'homemade',
      reference:
        'external-tool contract: block-level instrumentation needs a WAT view; with wasm2wat absent the handler must not report blocksInstrumented',
      run: () => handlers.handleWasmInstrumentBlockTool({ inputPath: wasmPath }),
      validate: (v) => externalToolOutcome(v, /wasm2wat/),
    },
    {
      name: 'wasm_instrument_trace/requires-inputPath',
      tool: 'wasm_instrument_trace',
      origin: 'homemade',
      reference:
        'argument contract: inputPath is required and must be rejected by name before any external tool is spawned',
      run: () => handlers.handleWasmInstrumentTraceTool({}),
      validate: (v) => {
        const b = body(v);
        if (b['success'] !== false) return `expected success=false, got ${JSON.stringify(b)}`;
        if (!/inputPath/.test(String(b['error'])))
          return `expected an inputPath validation error, got "${String(b['error'])}"`;
        return true;
      },
    },
  ],
};

/**
 * External-tool outcome contract used by the wabt/binaryen cases: either the
 * tool ran (success + a real payload key) or it is missing and the handler
 * failed naming the binary. Anything else — success with no artifact, or a
 * vague error — is a violation.
 */
function externalToolOutcome(v: unknown, binary: RegExp): true | string {
  const b = body(v);
  if (b['success'] === false) {
    const err = String(b['error'] ?? '');
    return binary.test(err)
      ? true
      : `failure does not name the missing binary: ${err.slice(0, 160)}`;
  }
  const payloadKeys = ['artifactPath', 'preview', 'outputDir', 'outputPath', 'totals', 'diff'];
  return payloadKeys.some((k) => b[k] !== undefined)
    ? true
    : `success without any artifact/preview payload: ${JSON.stringify(b).slice(0, 200)}`;
}

/** Handlers whose page.evaluate callbacks read seeded `window` hook state. */
function hookStateHandlers(): WasmToolHandlers {
  const seededWindow = {
    __aiHooks: {
      'preset-webassembly-full': [
        {
          type: 'instantiated',
          exports: { answer: 'function' },
          importMods: ['env'],
          size: MINIMAL_WASM.length,
        },
        { type: 'import_call', mod: 'env', fn: 'foo', args: [], ts: 1 },
        { type: 'import_call', mod: 'env', fn: 'foo', args: [], ts: 2 },
        { type: 'import_call', mod: 'env', fn: 'bar', args: [], ts: 3 },
        { type: 'import_call', mod: 'other', fn: 'baz', args: [], ts: 4 },
      ],
    },
    __wasmModuleStorage: [
      MINIMAL_WASM.buffer.slice(
        MINIMAL_WASM.byteOffset,
        MINIMAL_WASM.byteOffset + MINIMAL_WASM.length,
      ),
    ],
    __wasmInstances: [{ exports: { memory: { buffer: MEMORY_FIXTURE.buffer } } }],
  };
  (globalThis as unknown as { window: unknown }).window = seededWindow;
  const page = {
    // The three hook-state tools always pass a function payload, so running it
    // against the seeded global models the in-page evaluate faithfully.
    evaluate: async (fn: unknown, arg: unknown) => {
      if (typeof fn !== 'function') throw new Error('unexpected string evaluate payload');
      return (fn as (a: unknown) => unknown)(arg);
    },
  };
  return new WasmToolHandlers({ getActivePage: async () => page } as never);
}

/** 64-byte WASM memory window whose first three bytes are ASCII "ABC". */
const MEMORY_FIXTURE = new Uint8Array(64);
MEMORY_FIXTURE[0] = 0x41;
MEMORY_FIXTURE[1] = 0x42;
MEMORY_FIXTURE[2] = 0x43;
