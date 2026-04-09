import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const nativeBridgeTools: Tool[] = [
  tool('native_bridge_status', (t) =>
    t
      .desc(
        'Check connectivity to Ghidra and/or IDA bridge servers.\n\nReturns health status, version info, and available capabilities for each configured backend.\n\nUse this first to verify your analysis environment is ready.',
      )
      .enum('backend', ['ghidra', 'ida', 'all'], 'Which backend to check', { default: 'all' })
      .string('ghidraEndpoint', 'Ghidra bridge server URL', { default: 'http://127.0.0.1:18080' })
      .string('idaEndpoint', 'IDA bridge server URL', { default: 'http://127.0.0.1:18081' })
      .query(),
  ),
  tool('ghidra_bridge', (t) =>
    t
      .desc(
        'Interact with Ghidra headless analyzer via a bridge server.\n\nSupported actions:\n- `status`: Check Ghidra server health\n- `open_project`: Open/create a Ghidra project for a binary\n- `list_functions`: List all functions in the analyzed binary\n- `decompile_function`: Decompile a specific function by name or address\n- `run_script`: Execute a Ghidra Python/Java script\n- `get_xrefs`: Get cross-references for a symbol\n- `search_strings`: Search for strings in the binary\n\nRequires a Ghidra bridge server (ghidra_bridge or ghidriff) running locally.',
      )
      .enum(
        'action',
        [
          'status',
          'open_project',
          'list_functions',
          'decompile_function',
          'run_script',
          'get_xrefs',
          'search_strings',
        ],

        'Action to perform',
      )
      .string('binaryPath', 'Path to binary file (for open_project)')
      .string('functionName', 'Function name or address (for decompile_function, get_xrefs)')
      .string('scriptPath', 'Path to Ghidra script (for run_script)')
      .array('scriptArgs', { type: 'string' }, 'Arguments for the script')
      .string('searchPattern', 'String pattern to search (for search_strings)')
      .string('endpoint', 'Ghidra bridge server URL')
      .required('action'),
  ),
  tool('ida_bridge', (t) =>
    t
      .desc(
        'Interact with IDA Pro via a Python sidecar bridge server.\n\nSupported actions:\n- `status`: Check IDA bridge server health\n- `open_binary`: Load a binary into IDA\n- `list_functions`: List all functions\n- `decompile_function`: Decompile with Hex-Rays (if available)\n- `run_script`: Execute an IDAPython script\n- `get_xrefs`: Get cross-references\n- `get_strings`: List defined strings\n\nRequires an IDA Python bridge server (ida_bridge or idalink) running locally.',
      )
      .enum(
        'action',
        [
          'status',
          'open_binary',
          'list_functions',
          'decompile_function',
          'run_script',
          'get_xrefs',
          'get_strings',
        ],

        'Action to perform',
      )
      .string('binaryPath', 'Path to binary file (for open_binary)')
      .string('functionName', 'Function name or address (for decompile_function, get_xrefs)')
      .string('scriptPath', 'Path to IDAPython script (for run_script)')
      .array('scriptArgs', { type: 'string' }, 'Arguments for the script')
      .string('endpoint', 'IDA bridge server URL')
      .required('action'),
  ),
  tool('native_symbol_sync', (t) =>
    t
      .desc(
        'Synchronize symbol information between native analysis tools and jshookmcp.\n\nExport function names and addresses from Ghidra/IDA, then make them available for WASM analysis, source map reconstruction, or hook generation.\n\nUseful when JS calls into WASM or native libraries — bridges the gap between web-level and binary-level analysis.',
      )
      .enum('source', ['ghidra', 'ida'], 'Which tool to export symbols from')
      .string('filter', 'Regex pattern to filter symbol names')
      .enum('exportFormat', ['json', 'csv', 'idc'], 'Output format', { default: 'json' })
      .string('endpoint', 'Bridge server URL')
      .required('source'),
  ),
];
