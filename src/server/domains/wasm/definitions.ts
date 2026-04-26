import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const wasmTools: Tool[] = [
  tool('wasm_capabilities', (t) => t.desc('Report WASM capture and tool availability.').query()),
  tool('wasm_dump', (t) =>
    t
      .desc('Dump a captured WebAssembly module from the current page.')
      .number('moduleIndex', 'Index of the WASM module to dump if multiple were loaded', {
        default: 0,
      })
      .string(
        'outputPath',
        'Custom output file path. If omitted, auto-generates in artifacts/wasm/',
      ),
  ),
  tool('wasm_disassemble', (t) =>
    t
      .desc('Disassemble a .wasm file to WAT with wasm2wat.')
      .string('inputPath', 'Path to the .wasm file to disassemble')
      .string('outputPath', 'Output .wat file path. If omitted, auto-generates in artifacts/wasm/')
      .boolean('foldExprs', 'Fold expressions for more compact output', { default: true })
      .required('inputPath'),
  ),
  tool('wasm_decompile', (t) =>
    t
      .desc('Decompile a .wasm file to C-like pseudo-code with wasm-decompile.')
      .string('inputPath', 'Path to the .wasm file to decompile')
      .string('outputPath', 'Output file path. If omitted, auto-generates in artifacts/wasm/')
      .required('inputPath'),
  ),
  tool('wasm_inspect_sections', (t) =>
    t
      .desc('Inspect sections and metadata of a .wasm file with wasm-objdump.')
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
      .desc('Run an exported .wasm function with wasmtime or wasmer.')
      .string('inputPath', 'Path to the .wasm file')
      .string('functionName', 'Name of the exported function to invoke (e.g., "_sign", "encrypt")')
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
      .desc('Optimize a .wasm file with wasm-opt.')
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
      .string(
        'filterModule',
        'Only trace calls to this import module name (e.g., "env", "wasi_snapshot_preview1")',
      ),
  ),
  tool('wasm_memory_inspect', (t) =>
    t
      .desc('Inspect exported WebAssembly.Memory from the current page.')
      .number('offset', 'Starting byte offset to read from', { default: 0 })
      .number('length', 'Number of bytes to read', { default: 256 })
      .enum('format', ['hex', 'ascii', 'both'], 'Output format', { default: 'both' })
      .string('searchPattern', 'Search for this hex pattern or ASCII string in the memory range'),
  ),
];
