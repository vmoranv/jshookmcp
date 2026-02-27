import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const wasmTools: Tool[] = [
  {
    name: 'wasm_dump',
    description:
      'Dump a WebAssembly module from the current browser page.\n\nExtracts the WASM binary via the webassembly-full hook preset, saves it to disk, and returns module metadata (hash, size, imports, exports).\n\nPrerequisites: A page with WASM must be loaded. The webassembly-full hook preset will be auto-injected if not already active.',
    inputSchema: {
      type: 'object',
      properties: {
        moduleIndex: {
          type: 'number',
          description: 'Index of the WASM module to dump if multiple were loaded (default: 0 = first)',
          default: 0,
        },
        outputPath: {
          type: 'string',
          description: 'Custom output file path. If omitted, auto-generates in artifacts/wasm/',
        },
      },
    },
  },

  {
    name: 'wasm_disassemble',
    description:
      'Disassemble a .wasm file to WebAssembly Text Format (WAT) using wasm2wat.\n\nRequires: wabt toolchain installed (wasm2wat in PATH).\n\nUSE THIS to read WASM bytecode as human-readable text. The output shows all functions, imports, exports, and instructions.',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: 'Path to the .wasm file to disassemble',
        },
        outputPath: {
          type: 'string',
          description: 'Output .wat file path. If omitted, auto-generates in artifacts/wasm/',
        },
        foldExprs: {
          type: 'boolean',
          description: 'Fold expressions for more compact output (default: true)',
          default: true,
        },
      },
      required: ['inputPath'],
    },
  },

  {
    name: 'wasm_decompile',
    description:
      'Decompile a .wasm file to C-like pseudo-code using wasm-decompile.\n\nRequires: wabt toolchain installed (wasm-decompile in PATH).\n\nProduces more readable output than WAT, resembling C/JavaScript syntax. Useful for understanding VMP handler logic.',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: 'Path to the .wasm file to decompile',
        },
        outputPath: {
          type: 'string',
          description: 'Output file path. If omitted, auto-generates in artifacts/wasm/',
        },
      },
      required: ['inputPath'],
    },
  },

  {
    name: 'wasm_inspect_sections',
    description:
      'Inspect sections and metadata of a .wasm file using wasm-objdump.\n\nRequires: wabt toolchain installed (wasm-objdump in PATH).\n\nReturns section headers, import/export tables, function signatures, and memory layout.',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: 'Path to the .wasm file to inspect',
        },
        sections: {
          type: 'string',
          enum: ['headers', 'details', 'disassemble', 'all'],
          description: 'What to dump: headers (section overview), details (full metadata), disassemble (bytecode), all. Default: details',
          default: 'details',
        },
      },
      required: ['inputPath'],
    },
  },

  {
    name: 'wasm_offline_run',
    description:
      'Execute a specific exported function from a .wasm file offline using wasmtime or wasmer.\n\nRequires: wasmtime or wasmer installed in PATH.\n\nUSE THIS to run sign/encrypt functions extracted from WASM VMP without a browser. Provide the function name and arguments.\n\nSecurity: Runs in a sandboxed WASM runtime with no filesystem or network access.',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: 'Path to the .wasm file',
        },
        functionName: {
          type: 'string',
          description: 'Name of the exported function to invoke (e.g., "_sign", "encrypt")',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments to pass to the function (will be parsed as integers/floats)',
        },
        runtime: {
          type: 'string',
          enum: ['wasmtime', 'wasmer', 'auto'],
          description: 'WASM runtime to use. "auto" tries wasmtime first, then wasmer. Default: auto',
          default: 'auto',
        },
        timeoutMs: {
          type: 'number',
          description: 'Execution timeout in ms (default: 10000)',
          default: 10000,
        },
      },
      required: ['inputPath', 'functionName'],
    },
  },

  {
    name: 'wasm_optimize',
    description:
      'Optimize a .wasm file using binaryen wasm-opt.\n\nRequires: binaryen toolchain installed (wasm-opt in PATH).\n\nApplies optimization passes (dead code elimination, constant folding, etc.) to reduce size and improve performance. Optimized output can be re-injected into the browser.',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: 'Path to the .wasm file to optimize',
        },
        outputPath: {
          type: 'string',
          description: 'Output optimized .wasm file path. If omitted, auto-generates in artifacts/wasm/',
        },
        level: {
          type: 'string',
          enum: ['O1', 'O2', 'O3', 'O4', 'Os', 'Oz'],
          description: 'Optimization level (default: O2)',
          default: 'O2',
        },
      },
      required: ['inputPath'],
    },
  },

  {
    name: 'wasm_vmp_trace',
    description:
      'Trace WASM VMP (Virtual Machine Protection) opcode execution.\n\nCombines the webassembly-full hook preset with enhanced import call tracing to reconstruct VMP handler tables and execution flows.\n\nUSE THIS when a page uses WASM-based VMP to protect sign/encrypt functions. Returns:\n- Import call sequence (opcode trace)\n- Identified handler patterns\n- Input→output data flow',
    inputSchema: {
      type: 'object',
      properties: {
        maxEvents: {
          type: 'number',
          description: 'Maximum import call events to capture (default: 5000)',
          default: 5000,
        },
        filterModule: {
          type: 'string',
          description: 'Only trace calls to this import module name (e.g., "env", "wasi_snapshot_preview1")',
        },
      },
    },
  },

  {
    name: 'wasm_memory_inspect',
    description:
      'Inspect WebAssembly.Memory contents from the browser.\n\nReads the linear memory buffer of the active WASM module, displaying it as hex dump, ASCII, or searching for patterns.\n\nUSE THIS to:\n- Examine WASM memory layout (stack, heap, data segments)\n- Find strings, keys, or encoded data in WASM memory\n- Track how input data is transformed through WASM functions',
    inputSchema: {
      type: 'object',
      properties: {
        offset: {
          type: 'number',
          description: 'Starting byte offset to read from (default: 0)',
          default: 0,
        },
        length: {
          type: 'number',
          description: 'Number of bytes to read (default: 256, max: 65536)',
          default: 256,
        },
        format: {
          type: 'string',
          enum: ['hex', 'ascii', 'both'],
          description: 'Output format (default: both)',
          default: 'both',
        },
        searchPattern: {
          type: 'string',
          description: 'Search for this hex pattern or ASCII string in the memory range',
        },
      },
    },
  },
];
