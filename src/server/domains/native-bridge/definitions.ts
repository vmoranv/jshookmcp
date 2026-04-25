import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const nativeBridgeTools: Tool[] = [
  tool('native_bridge_status', (t) =>
    t
      .desc('Check native bridge backend health.')
      .enum('backend', ['ghidra', 'ida', 'all'], 'Which backend to check', { default: 'all' })
      .string('ghidraEndpoint', 'Ghidra bridge server URL', { default: 'http://127.0.0.1:18080' })
      .string('idaEndpoint', 'IDA bridge server URL', { default: 'http://127.0.0.1:18081' })
      .query(),
  ),
  tool('ghidra_bridge', (t) =>
    t
      .desc('Send an action to a Ghidra bridge server.')
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
      .desc('Send an action to an IDA bridge server.')
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
      .desc('Export native symbols through a bridge server.')
      .enum('source', ['ghidra', 'ida'], 'Which tool to export symbols from')
      .string('filter', 'Regex pattern to filter symbol names')
      .enum('exportFormat', ['json', 'csv', 'idc'], 'Output format', { default: 'json' })
      .string('endpoint', 'Bridge server URL')
      .required('source'),
  ),
];
