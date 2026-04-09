import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const wasmTools: Tool[] = [
  tool('wasm_dump', (t) =>
    t
      .desc(
        'Dump a WebAssembly module from the current browser page.\n\nExtracts the WASM binary via the webassembly-full hook preset, saves it to disk, and returns module metadata (hash, size, imports, exports).\n\nPrerequisites: A page with WASM must be loaded. The webassembly-full hook preset will be auto-injected if not already active.',
      )
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
      .desc(
        'Disassemble a .wasm file to WebAssembly Text Format (WAT) using wasm2wat.\n\nRequires: wabt toolchain installed (wasm2wat in PATH).\n\nUSE THIS to read WASM bytecode as human-readable text. The output shows all functions, imports, exports, and instructions.',
      )
      .string('inputPath', 'Path to the .wasm file to disassemble')
      .string('outputPath', 'Output .wat file path. If omitted, auto-generates in artifacts/wasm/')
      .boolean('foldExprs', 'Fold expressions for more compact output', { default: true })
      .required('inputPath'),
  ),
  tool('wasm_decompile', (t) =>
    t
      .desc(
        'Decompile a .wasm file to C-like pseudo-code using wasm-decompile.\n\nRequires: wabt toolchain installed (wasm-decompile in PATH).\n\nProduces more readable output than WAT, resembling C/JavaScript syntax. Useful for understanding VMP handler logic.',
      )
      .string('inputPath', 'Path to the .wasm file to decompile')
      .string('outputPath', 'Output file path. If omitted, auto-generates in artifacts/wasm/')
      .required('inputPath'),
  ),
  tool('wasm_inspect_sections', (t) =>
    t
      .desc(
        'Inspect sections and metadata of a .wasm file using wasm-objdump.\n\nRequires: wabt toolchain installed (wasm-objdump in PATH).\n\nReturns section headers, import/export tables, function signatures, and memory layout.',
      )
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
      .desc(
        'Execute a specific exported function from a .wasm file offline using wasmtime or wasmer.\n\nRequires: wasmtime or wasmer installed in PATH.\n\nUSE THIS to run sign/encrypt functions extracted from WASM VMP without a browser. Provide the function name and arguments.\n\nSecurity: Runs in a sandboxed WASM runtime with no filesystem or network access.',
      )
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
      .desc(
        'Optimize a .wasm file using binaryen wasm-opt.\n\nRequires: binaryen toolchain installed (wasm-opt in PATH).\n\nApplies optimization passes (dead code elimination, constant folding, etc.) to reduce size and improve performance. Optimized output can be re-injected into the browser.',
      )
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
      .desc(
        'Trace WASM VMP (Virtual Machine Protection) opcode execution.\n\nCombines the webassembly-full hook preset with enhanced import call tracing to reconstruct VMP handler tables and execution flows.\n\nUSE THIS when a page uses WASM-based VMP to protect sign/encrypt functions. Returns:\n- Import call sequence (opcode trace)\n- Identified handler patterns\n- Input→output data flow',
      )
      .number('maxEvents', 'Maximum import call events to capture', { default: 5000 })
      .string(
        'filterModule',
        'Only trace calls to this import module name (e.g., "env", "wasi_snapshot_preview1")',
      ),
  ),
  tool('wasm_memory_inspect', (t) =>
    t
      .desc(
        'Inspect WebAssembly.Memory contents from the browser.\n\nReads the linear memory buffer of the active WASM module, displaying it as hex dump, ASCII, or searching for patterns.\n\nUSE THIS to:\n- Examine WASM memory layout (stack, heap, data segments)\n- Find strings, keys, or encoded data in WASM memory\n- Track how input data is transformed through WASM functions',
      )
      .number('offset', 'Starting byte offset to read from', { default: 0 })
      .number('length', 'Number of bytes to read', { default: 256 })
      .enum('format', ['hex', 'ascii', 'both'], 'Output format', { default: 'both' })
      .string('searchPattern', 'Search for this hex pattern or ASCII string in the memory range'),
  ),
];
