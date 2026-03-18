import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const nativeBridgeTools: Tool[] = [
  {
    name: 'native_bridge_status',
    description:
      'Check connectivity to Ghidra and/or IDA bridge servers.\n\n' +
      'Returns health status, version info, and available capabilities for each configured backend.\n\n' +
      'Use this first to verify your analysis environment is ready.',
    inputSchema: {
      type: 'object',
      properties: {
        backend: {
          type: 'string',
          enum: ['ghidra', 'ida', 'all'],
          description: 'Which backend to check (default: all)',
          default: 'all',
        },
        ghidraEndpoint: {
          type: 'string',
          description: 'Ghidra bridge server URL (default: http://127.0.0.1:18080)',
        },
        idaEndpoint: {
          type: 'string',
          description: 'IDA bridge server URL (default: http://127.0.0.1:18081)',
        },
      },
    },
  },

  {
    name: 'ghidra_bridge',
    description:
      'Interact with Ghidra headless analyzer via a bridge server.\n\n' +
      'Supported actions:\n' +
      '- `status`: Check Ghidra server health\n' +
      '- `open_project`: Open/create a Ghidra project for a binary\n' +
      '- `list_functions`: List all functions in the analyzed binary\n' +
      '- `decompile_function`: Decompile a specific function by name or address\n' +
      '- `run_script`: Execute a Ghidra Python/Java script\n' +
      '- `get_xrefs`: Get cross-references for a symbol\n' +
      '- `search_strings`: Search for strings in the binary\n\n' +
      'Requires a Ghidra bridge server (ghidra_bridge or ghidriff) running locally.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'status',
            'open_project',
            'list_functions',
            'decompile_function',
            'run_script',
            'get_xrefs',
            'search_strings',
          ],
          description: 'Action to perform',
        },
        binaryPath: {
          type: 'string',
          description: 'Path to binary file (for open_project)',
        },
        functionName: {
          type: 'string',
          description: 'Function name or address (for decompile_function, get_xrefs)',
        },
        scriptPath: {
          type: 'string',
          description: 'Path to Ghidra script (for run_script)',
        },
        scriptArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments for the script',
        },
        searchPattern: {
          type: 'string',
          description: 'String pattern to search (for search_strings)',
        },
        endpoint: {
          type: 'string',
          description: 'Ghidra bridge server URL',
        },
      },
      required: ['action'],
    },
  },

  {
    name: 'ida_bridge',
    description:
      'Interact with IDA Pro via a Python sidecar bridge server.\n\n' +
      'Supported actions:\n' +
      '- `status`: Check IDA bridge server health\n' +
      '- `open_binary`: Load a binary into IDA\n' +
      '- `list_functions`: List all functions\n' +
      '- `decompile_function`: Decompile with Hex-Rays (if available)\n' +
      '- `run_script`: Execute an IDAPython script\n' +
      '- `get_xrefs`: Get cross-references\n' +
      '- `get_strings`: List defined strings\n\n' +
      'Requires an IDA Python bridge server (ida_bridge or idalink) running locally.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'status',
            'open_binary',
            'list_functions',
            'decompile_function',
            'run_script',
            'get_xrefs',
            'get_strings',
          ],
          description: 'Action to perform',
        },
        binaryPath: {
          type: 'string',
          description: 'Path to binary file (for open_binary)',
        },
        functionName: {
          type: 'string',
          description: 'Function name or address (for decompile_function, get_xrefs)',
        },
        scriptPath: {
          type: 'string',
          description: 'Path to IDAPython script (for run_script)',
        },
        scriptArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments for the script',
        },
        endpoint: {
          type: 'string',
          description: 'IDA bridge server URL',
        },
      },
      required: ['action'],
    },
  },

  {
    name: 'native_symbol_sync',
    description:
      'Synchronize symbol information between native analysis tools and jshookmcp.\n\n' +
      'Export function names and addresses from Ghidra/IDA, then make them available ' +
      'for WASM analysis, source map reconstruction, or hook generation.\n\n' +
      'Useful when JS calls into WASM or native libraries — bridges the gap between ' +
      'web-level and binary-level analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['ghidra', 'ida'],
          description: 'Which tool to export symbols from',
        },
        filter: {
          type: 'string',
          description: 'Regex pattern to filter symbol names',
        },
        exportFormat: {
          type: 'string',
          enum: ['json', 'csv', 'idc'],
          description: 'Output format (default: json)',
          default: 'json',
        },
        endpoint: {
          type: 'string',
          description: 'Bridge server URL',
        },
      },
      required: ['source'],
    },
  },
];
