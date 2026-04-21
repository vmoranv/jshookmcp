import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

/**
 * Process Manager Tool Definitions
 * MCP tools for cross-platform process management and debugging
 */

export const processToolDefinitions: Tool[] = [
  tool('process_windows', (t) =>
    t
      .desc('Get all window handles for a process.')
      .number('pid', 'Process ID to get windows for')
      .required('pid'),
  ),
  tool('process_check_debug_port', (t) =>
    t
      .desc('Check if a process has a debug port enabled for CDP attachment.')
      .number('pid', 'Process ID to check')
      .required('pid'),
  ),

  tool('process_launch_debug', (t) =>
    t
      .desc('Launch an executable with remote debugging port enabled.')
      .string('executablePath', 'Full path to the executable to launch')
      .number('debugPort', 'Debug port to use', { default: 9222, minimum: 1, maximum: 65535 })
      .array('args', { type: 'string' }, 'Additional command line arguments')
      .required('executablePath'),
  ),

  tool('memory_read', (t) =>
    t
      .desc('Read memory from a process at a specific address. Requires elevated privileges.')
      .string('address', 'Memory address to read (hex string like "0x12345678")')
      .number('size', 'Number of bytes to read')
      .required('pid', 'address', 'size'),
  ),
  tool('memory_write', (t) =>
    t
      .desc('Write data to process memory at a specific address. Requires elevated privileges.')
      .string('address', 'Memory address to write to (hex string like "0x12345678")')
      .string('data', 'Data to write (hex string or base64)')
      .enum('encoding', ['hex', 'base64'], 'Encoding of the data parameter', { default: 'hex' })
      .required('pid', 'address', 'data'),
  ),
  tool('memory_scan', (t) =>
    t
      .desc('Scan process memory for a pattern or value. Requires elevated privileges.')
      .string('pattern', 'Pattern to search for (hex bytes like "48 8B 05" or value)')
      .enum(
        'patternType',
        ['hex', 'int32', 'int64', 'float', 'double', 'string'],
        'Type of pattern to search',
        { default: 'hex' },
      )
      .boolean(
        'suspendTarget',
        'Suspend the target process during scan for a consistent memory snapshot (default: false)',
        { default: false },
      )
      .required('pid', 'pattern'),
  ),
  tool('memory_check_protection', (t) =>
    t
      .desc('Check memory protection flags at a specific address.')
      .string('address', 'Memory address to check (hex string like "0x12345678")')
      .required('pid', 'address'),
  ),
  tool('memory_scan_filtered', (t) =>
    t
      .desc('Scan memory within a filtered set of addresses (secondary scan).')
      .string('pattern', 'Pattern to search for')
      .array(
        'addresses',
        { type: 'string' },
        'List of addresses to scan within (from previous scan)',
      )
      .enum(
        'patternType',
        ['hex', 'int32', 'int64', 'float', 'double', 'string'],
        'Type of pattern to search',
        { default: 'hex' },
      )
      .required('pid', 'pattern', 'addresses'),
  ),
  tool('memory_batch_write', (t) =>
    t
      .desc('Write multiple memory patches at once.')
      .number('pid', 'Target process ID')
      .array(
        'patches',
        {
          type: 'object',
          properties: {
            address: { type: 'string', description: 'Memory address (hex)' },
            data: { type: 'string', description: 'Data to write' },
            encoding: { type: 'string', enum: ['hex', 'base64'], default: 'hex' },
          },
          required: ['address', 'data'],
        },
        'Array of patches to apply',
      )
      .required('pid', 'patches'),
  ),
  tool('memory_dump_region', (t) =>
    t
      .desc('Dump a memory region to a file for analysis.')
      .number('pid', 'Target process ID')
      .string('address', 'Start address (hex)')
      .number('size', 'Number of bytes to dump')
      .string('outputPath', 'Output file path')
      .required('pid', 'address', 'size', 'outputPath'),
  ),
  tool('memory_list_regions', (t) =>
    t
      .desc('List all memory regions in a process with protection flags.')
      .number('pid', 'Target process ID')
      .required('pid'),
  ),
  tool('memory_audit_export', (t) =>
    t.desc('Export the in-memory audit trail for memory operations as JSON.'),
  ),

  // Injection tools
  tool('inject_dll', (t) =>
    t
      .desc('Inject a DLL into a target process using CreateRemoteThread + LoadLibraryA (W...')
      .string('dllPath', 'Full path to the DLL file to inject')
      .required('pid', 'dllPath'),
  ),
  tool('inject_shellcode', (t) =>
    t
      .desc('Inject and execute shellcode in a target process.')
      .string('shellcode', 'Shellcode bytes (hex string or base64)')
      .enum('encoding', ['hex', 'base64'], 'Encoding of shellcode', { default: 'hex' })
      .required('pid', 'shellcode'),
  ),

  // Anti-detection tools
  tool('check_debug_port', (t) =>
    t
      .desc(
        'Check if a process is being debugged using NtQueryInformationProcess (ProcessDebugPort).',
      )
      .number('pid', 'Target process ID')
      .required('pid'),
  ),
  tool('enumerate_modules', (t) =>
    t
      .desc('List all loaded modules (DLLs) in a process with their base addresses.')
      .number('pid', 'Target process ID')
      .required('pid'),
  ),

  tool('electron_attach', (t) =>
    t
      .desc('Connect to a running Electron app (VS Code, Cursor, etc.) via CDP and inspect...')
      .string(
        'pageUrl',
        'Filter pages by URL substring (e.g. "extension-host" to target VS Code extension host)',
      ),
  ),
];

export type ProcessToolName = (typeof processToolDefinitions)[number]['name'];
