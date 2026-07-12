import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const nativeBridgeTools: Tool[] = [
  tool('native_bridge_status', (t) =>
    t
      .desc('Check native bridge backend health.')
      .enum('backend', ['ghidra', 'ida', 'rizin', 'binaryninja', 'all'], 'Which backend to check', {
        default: 'all',
      })
      .string('ghidraEndpoint', 'Ghidra bridge server URL', { default: 'http://127.0.0.1:18080' })
      .string('idaEndpoint', 'IDA bridge server URL', { default: 'http://127.0.0.1:18081' })
      .string('rizinEndpoint', 'Rizin bridge server URL', { default: 'http://127.0.0.1:18082' })
      .string('binaryNinjaEndpoint', 'Binary Ninja bridge server URL', {
        default: 'http://127.0.0.1:18083',
      })
      .query(),
  ),
  tool('ghidra_bridge', (t) =>
    t
      .desc('Send a command to a Ghidra headless analysis bridge.')
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
          'get_segments',
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
      .desc('Send a command to an IDA Pro plugin bridge.')
      .enum(
        'action',
        [
          'status',
          'open_binary',
          'list_functions',
          'decompile_function',
          'run_script',
          'get_xrefs',
          'search_strings',
          'get_strings',
          'get_segments',
        ],

        'Action to perform',
      )
      .string('binaryPath', 'Path to binary file (for open_binary)')
      .string('functionName', 'Function name or address (for decompile_function, get_xrefs)')
      .string('scriptPath', 'Path to IDAPython script (for run_script)')
      .array('scriptArgs', { type: 'string' }, 'Arguments for the script')
      .string('searchPattern', 'String pattern to search (for search_strings)')
      .string('endpoint', 'IDA bridge server URL')
      .required('action'),
  ),
  tool('rizin_bridge', (t) =>
    t
      .desc('Send a command to a local Rizin/r2 analysis bridge.')
      .enum(
        'action',
        [
          'status',
          'open_binary',
          'analyze',
          'list_functions',
          'disassemble_function',
          'run_command',
          'get_xrefs',
          'search_strings',
          'get_segments',
        ],
        'Action to perform',
      )
      .string('binaryPath', 'Path to binary file (for open_binary)')
      .string('functionName', 'Function name or address (for disassemble_function, get_xrefs)')
      .string('command', 'Rizin/r2 command to execute (for run_command)')
      .string('analysisLevel', 'Analysis level or preset (for analyze)')
      .string('searchPattern', 'String pattern to search (for search_strings)')
      .string('endpoint', 'Rizin bridge server URL')
      .required('action'),
  ),
  tool('binary_ninja_bridge', (t) =>
    t
      .desc('Send a command to a local Binary Ninja analysis bridge.')
      .enum(
        'action',
        [
          'status',
          'open_binary',
          'list_functions',
          'decompile_function',
          'disassemble_function',
          'run_script',
          'get_xrefs',
          'search_strings',
          'get_strings',
          'get_segments',
          'get_types',
        ],
        'Action to perform',
      )
      .string('binaryPath', 'Path to binary file (for open_binary)')
      .string(
        'functionName',
        'Function name or address (for decompile_function, disassemble_function, get_xrefs)',
      )
      .string('scriptPath', 'Path to Binary Ninja Python script (for run_script)')
      .array('scriptArgs', { type: 'string' }, 'Arguments for the script')
      .string('searchPattern', 'String pattern to search (for search_strings)')
      .string('endpoint', 'Binary Ninja bridge server URL')
      .required('action'),
  ),
  tool('native_symbol_sync', (t) =>
    t
      .desc(
        'Export native symbols to connected analysis backends. Supports json/csv/idc/sqlite output; an optional sinceHash requests an incremental export (only changed symbols) from backends that support it.',
      )
      .enum(
        'source',
        ['ghidra', 'ida', 'rizin', 'binaryninja'],
        'Which tool to export symbols from',
      )
      .string('filter', 'Regex pattern to filter symbol names')
      .enum('exportFormat', ['json', 'csv', 'idc', 'sqlite'], 'Output format', {
        default: 'json',
      })
      .string(
        'sinceHash',
        'Optional content hash from a previous sync. When the backend supports incremental export, only symbols changed since this hash are returned; unsupported backends return the full set.',
      )
      .string('endpoint', 'Bridge server URL')
      .required('source'),
  ),
];
