import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';

export const wasmTools: Tool[] = [
  tool('wasm_capabilities', (t) => t.desc('Report WASM tool availability.').query()),
  tool('wasm_dump', (t) =>
    t
      .desc('Dump a captured WebAssembly module from the current page.')
      .number('moduleIndex', 'Index of the WASM module to dump if multiple were loaded', {
        default: 0,
      })
      .string(
        'outputPath',
        'Custom output file path. If omitted, auto-generates in artifacts/wasm/',
      )
      .boolean(
        'autoInject',
        'If no WASM is captured, auto-inject a bytes-capturing hook (stores raw bytes to window.__wasmModuleStorage — the stock webassembly-full preset only records events), reload the page, and retry. The page must instantiate its WASM on load for the re-capture to succeed.',
        { default: false },
      ),
  ),
  tool('wasm_disassemble', (t) =>
    t
      .desc('Disassemble a .wasm binary to WAT text format.')
      .string('inputPath', 'Path to the .wasm file to disassemble')
      .string('outputPath', 'Output .wat file path. If omitted, auto-generates in artifacts/wasm/')
      .boolean('foldExprs', 'Fold expressions for more compact output', { default: true })
      .required('inputPath'),
  ),
  tool('wasm_decompile', (t) =>
    t
      .desc('Decompile .wasm bytecode to readable pseudo-code with type info.')
      .string('inputPath', 'Path to the .wasm file to decompile')
      .string('outputPath', 'Output file path. If omitted, auto-generates in artifacts/wasm/')
      .required('inputPath'),
  ),
  tool('wasm_inspect_sections', (t) =>
    t
      .desc('Parse .wasm section headers: imports, exports, memory, tables, code.')
      .string('inputPath', 'Path to the .wasm file to inspect')
      .enum(
        'sections',
        ['headers', 'details', 'disassemble', 'all'],
        'What to dump: headers (section overview), details (full metadata), disassemble (bytecode), all',
        { default: 'details' },
      )
      .required('inputPath'),
  ),
  tool('wasm_offline_run', (t) =>
    t
      .desc('Run an exported .wasm function.')
      .string('inputPath', 'Path to the .wasm file')
      .string('functionName', 'Name of the exported function to invoke')
      .array(
        'args',
        { type: 'string' },
        'Arguments to pass to the function (will be parsed as integers/floats)',
      )
      .enum(
        'runtime',
        ['wasmtime', 'wasmer', 'auto'],
        'WASM runtime to use. "auto" tries wasmtime first, then wasmer',
        { default: 'auto' },
      )
      .number('timeoutMs', 'Execution timeout in ms', { default: 10000 })
      .required('inputPath', 'functionName'),
  ),
  tool('wasm_optimize', (t) =>
    t
      .desc('Optimize a .wasm binary for size or speed.')
      .string('inputPath', 'Path to the .wasm file to optimize')
      .string(
        'outputPath',
        'Output optimized .wasm file path. If omitted, auto-generates in artifacts/wasm/',
      )
      .enum('level', ['O1', 'O2', 'O3', 'O4', 'Os', 'Oz'], 'Optimization level', { default: 'O2' })
      .required('inputPath'),
  ),
  tool('wasm_vmp_trace', (t) =>
    t
      .desc('Read captured WASM VMP import-call traces from the current page.')
      .number('maxEvents', 'Maximum import call events to capture', { default: 5000 })
      .string('filterModule', 'Filter by import module name'),
  ),
  tool('wasm_memory_inspect', (t) =>
    t
      .desc(
        'Inspect exported WebAssembly.Memory from the current page. ' +
          'Pages often load multiple WASM modules (crypto/DRM/app) — the response always includes ' +
          'totalInstances + an instance inventory; pass instanceIndex to target a specific module.',
      )
      .number(
        'instanceIndex',
        'Which captured WASM instance to read (0-based). Out-of-range returns the instance list.',
        {
          default: 0,
        },
      )
      .number('offset', 'Starting byte offset to read from', { default: 0 })
      .number('length', 'Number of bytes to read', { default: 256 })
      .enum('format', ['hex', 'ascii', 'both'], 'Output format', { default: 'both' })
      .string('searchPattern', 'Search for this hex pattern or ASCII string in the memory range'),
  ),
  tool('wasm_to_c', (t) =>
    t
      .desc('Transpile .wasm bytecode to C source and header files.')
      .string('inputPath', 'Path to the .wasm file to convert')
      .string(
        'outputDir',
        'Directory for generated .c and .h files. If omitted, uses artifacts/wasm/',
      )
      .required('inputPath'),
  ),
  tool('wasm_detect_obfuscation', (t) =>
    t
      .desc('Detect WASM obfuscation: opaque predicates, control-flow flattening, bogus ops.')
      .string('inputPath', 'Path to the .wasm file to analyze')
      .boolean('verbose', 'Include detailed pattern evidence in output', { default: false })
      .required('inputPath'),
  ),
  tool('wasm_instrument_trace', (t) =>
    t
      .desc('Generate a JS instrumentation wrapper for a .wasm module.')
      .string('inputPath', 'Path to the .wasm file to instrument')
      .array(
        'hooks',
        { type: 'string', enum: ['call', 'memory', 'branch', 'loop', 'local'] },
        'Hook types to inject',
      )
      .boolean('allHooks', 'Inject all available hook types', { default: true })
      .string('outputPath', 'Output JS file path. If omitted, auto-generates in artifacts/wasm/')
      .required('inputPath'),
  ),
  tool('wasm_string_extract', (t) =>
    t
      .desc(
        'Extract printable strings from a .wasm binary, grouped by section, with name-section function-name recovery and classification (url/base64/hex-hash/file-path). Wasm-aware alternative to generic binary strings tools.',
      )
      .string('inputPath', 'Path to the .wasm file')
      .number('minLength', 'Minimum string length to report', { default: 4 })
      .number('maxStrings', 'Maximum number of strings to return (rest counted only)', {
        default: 200,
      })
      .required('inputPath'),
  ),
  tool('wasm_diff', (t) =>
    t
      .desc(
        'Patch-diff two .wasm binaries (original vs. patched) for vulnerability research: disassembles both via wasm2wat and emits a structured function-level diff (added/removed/changed) plus a per-function WAT line-level unified diff. The full diff is written to an artifact; the response carries summaries and previews.',
      )
      .string('inputPathA', 'Path to the first .wasm file (e.g. original)')
      .string('inputPathB', 'Path to the second .wasm file (e.g. patched)')
      .string(
        'outputPath',
        'Custom output file path for the full JSON diff. If omitted, auto-generates in artifacts/wasm/',
      )
      .boolean(
        'semantic',
        'Normalize transient local/temp names so pure renumbering is not reported as a change',
        { default: false },
      )
      .required('inputPathA', 'inputPathB'),
  ),
  tool('wasm_instrument_binary', (t) =>
    t
      .desc(
        'Real wasm-level binary instrumentation: disassembles via wasm2wat, inserts a call to an imported trace function at every function entry, and reassembles via wat2wasm. Unlike wasm_instrument_trace (which only proxies JS-visible exports), this rewrites the code section so every function entry is observable. Honest boundary: function-ENTRY-level tracing, not basic-block — the host must supply the trace_fn import at instantiation.',
      )
      .string('inputPath', 'Path to the .wasm file to instrument')
      .string(
        'outputPath',
        'Output instrumented .wasm file path. If omitted, auto-generates in artifacts/wasm/',
      )
      .required('inputPath'),
  ),
  tool('wasm_instrument_block', (t) =>
    t
      .desc(
        'Real wasm-level basic-block instrumentation: disassembles via wasm2wat, inserts a call to an imported trace function at every block/loop/if body entry (and function entry), and reassembles via wat2wasm. Unlike wasm_instrument_binary (function-entry-only) and wasm_instrument_trace (JS-proxy-only), this observes structured control-flow entries — branch targets (br/br_if/br_table) are covered because Wasm resolves them to block/loop/if labels. The host must supply the trace_block import at instantiation.',
      )
      .string('inputPath', 'Path to the .wasm file to instrument')
      .string(
        'outputPath',
        'Output instrumented .wasm file path. If omitted, auto-generates in artifacts/wasm/',
      )
      .required('inputPath'),
  ),
  tool('wasm_inspect', (t) =>
    t
      .desc(
        'Pure-TS wasm binary structural inspector (no wabt dependency). Parses the module surface — types, imports, functions (with name-section recovery), tables, memories, globals, exports, start, element/data/code segment counts, and custom sections (name/producers/target_features) — directly from the binary, returning structured JSON. The wabt-independent counterpart to wasm_inspect_sections (wasm-objdump): the only structural path when wabt is unavailable (see wasm_capabilities). Honest boundary: structure only, no code-body disassembly; element/data/global-init payloads reported as counts.',
      )
      .string('inputPath', 'Path to the .wasm file to inspect')
      .required('inputPath'),
  ),
];
