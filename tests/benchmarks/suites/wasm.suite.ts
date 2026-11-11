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
  ],
};
