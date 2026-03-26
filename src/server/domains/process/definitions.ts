import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

/**
 * Process Manager Tool Definitions
 * MCP tools for cross-platform process management and debugging
 */

export const processToolDefinitions: Tool[] = [
  tool('process_find')
    .desc('Find processes by name pattern. Returns process IDs, names, paths, and window handles.')
    .string('pattern', 'Process name pattern to search for (e.g., "chrome", "msedge")')
    .required('pattern')
    .build(),

  tool('process_list')
    .desc('List all running processes. Alias of process_find with empty pattern.')
    .build(),

  tool('process_get')
    .desc('Get detailed information about a specific process by PID.')
    .number('pid', 'Process ID to query')
    .required('pid')
    .build(),

  tool('process_windows')
    .desc('Get all window handles for a process.')
    .number('pid', 'Process ID to get windows for')
    .required('pid')
    .build(),

  tool('process_find_chromium')
    .desc('Disabled by design: does not scan user-installed browser processes. Use managed browser sessions (browser_launch/browser_attach with explicit endpoint) instead.')
    .string('processName', 'Process name pattern to search for (e.g., "chrome", "msedge", "chromium")', { default: 'chromium' })
    .string('windowClass', 'Window class pattern to match (e.g., "Chrome_WidgetWin")')
    .build(),

  tool('process_check_debug_port')
    .desc('Check if a process has a debug port enabled for CDP attachment.')
    .number('pid', 'Process ID to check')
    .required('pid')
    .build(),

  tool('process_launch_debug')
    .desc('Launch an executable with remote debugging port enabled.')
    .string('executablePath', 'Full path to the executable to launch')
    .number('debugPort', 'Debug port to use', { default: 9222 })
    .array('args', { type: 'string' }, 'Additional command line arguments')
    .required('executablePath')
    .build(),

  tool('process_kill')
    .desc('Kill a process by PID.')
    .number('pid', 'Process ID to kill')
    .required('pid')
    .build(),

  tool('memory_read')
    .desc('Read memory from a process at a specific address. Failures include structured diagnostics for permissions, region checks, and ASLR guidance.')
    .number('pid', 'Target process ID')
    .string('address', 'Memory address to read (hex string like "0x12345678")')
    .number('size', 'Number of bytes to read')
    .required('pid', 'address', 'size')
    .build(),

  tool('memory_write')
    .desc('Write data to process memory at a specific address. Failures include structured diagnostics for permissions, region checks, and ASLR guidance.')
    .number('pid', 'Target process ID')
    .string('address', 'Memory address to write to (hex string like "0x12345678")')
    .string('data', 'Data to write (hex string or base64)')
    .enum('encoding', ['hex', 'base64'], 'Encoding of the data parameter', { default: 'hex' })
    .required('pid', 'address', 'data')
    .build(),

  tool('memory_scan')
    .desc('Scan process memory for a pattern or value. Failures include structured diagnostics for permissions, region checks, and ASLR guidance.')
    .number('pid', 'Target process ID')
    .string('pattern', 'Pattern to search for (hex bytes like "48 8B 05" or value)')
    .enum('patternType', ['hex', 'int32', 'int64', 'float', 'double', 'string'], 'Type of pattern to search', { default: 'hex' })
    .required('pid', 'pattern')
    .build(),

  tool('memory_check_protection')
    .desc('Check memory protection flags at a specific address. Detects if memory is writable/readable/executable.')
    .number('pid', 'Target process ID')
    .string('address', 'Memory address to check (hex string like "0x12345678")')
    .required('pid', 'address')
    .build(),

  tool('memory_protect')
    .desc('Alias of memory_check_protection. Check memory protection flags at a specific address.')
    .number('pid', 'Target process ID')
    .string('address', 'Memory address to check (hex string like "0x12345678")')
    .required('pid', 'address')
    .build(),

  tool('memory_scan_filtered')
    .desc('Scan memory within a filtered set of addresses (secondary scan). Useful for narrowing down results.')
    .number('pid', 'Target process ID')
    .string('pattern', 'Pattern to search for')
    .array('addresses', { type: 'string' }, 'List of addresses to scan within (from previous scan)')
    .enum('patternType', ['hex', 'int32', 'int64', 'float', 'double', 'string'], 'Type of pattern to search', { default: 'hex' })
    .required('pid', 'pattern', 'addresses')
    .build(),

  tool('memory_batch_write')
    .desc('Write multiple memory patches at once. Useful for applying cheats or modifications.')
    .number('pid', 'Target process ID')
    .array('patches', {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Memory address (hex)' },
        data: { type: 'string', description: 'Data to write' },
        encoding: { type: 'string', enum: ['hex', 'base64'], default: 'hex' },
      },
      required: ['address', 'data'],
    }, 'Array of patches to apply')
    .required('pid', 'patches')
    .build(),

  tool('memory_dump_region')
    .desc('Dump a memory region to a file for analysis.')
    .number('pid', 'Target process ID')
    .string('address', 'Start address (hex)')
    .number('size', 'Number of bytes to dump')
    .string('outputPath', 'Output file path')
    .required('pid', 'address', 'size', 'outputPath')
    .build(),

  tool('memory_list_regions')
    .desc('List all memory regions in a process with protection flags.')
    .number('pid', 'Target process ID')
    .required('pid')
    .build(),

  tool('memory_audit_export')
    .desc('Export the in-memory audit trail for memory operations as JSON. Supports clear=true to flush the buffer after export.')
    .boolean('clear', 'Clear audit trail after export')
    .build(),

  // Injection tools
  tool('inject_dll')
    .desc('Inject a DLL into a target process using CreateRemoteThread + LoadLibraryA. Enabled by default on Windows; set ENABLE_INJECTION_TOOLS=false to disable. Requires administrator privileges.')
    .number('pid', 'Target process ID')
    .string('dllPath', 'Full path to the DLL file to inject')
    .required('pid', 'dllPath')
    .build(),

  tool('module_inject_dll')
    .desc('Alias of inject_dll. Enabled by default on Windows; set ENABLE_INJECTION_TOOLS=false to disable.')
    .number('pid', 'Target process ID')
    .string('dllPath', 'Full path to the DLL file to inject')
    .required('pid', 'dllPath')
    .build(),

  tool('inject_shellcode')
    .desc('Inject and execute shellcode in a target process. Accepts hex or base64. Enabled by default on Windows; set ENABLE_INJECTION_TOOLS=false to disable.')
    .number('pid', 'Target process ID')
    .string('shellcode', 'Shellcode bytes (hex string or base64)')
    .enum('encoding', ['hex', 'base64'], 'Encoding of shellcode', { default: 'hex' })
    .required('pid', 'shellcode')
    .build(),

  tool('module_inject_shellcode')
    .desc('Alias of inject_shellcode. Enabled by default on Windows; set ENABLE_INJECTION_TOOLS=false to disable.')
    .number('pid', 'Target process ID')
    .string('shellcode', 'Shellcode bytes (hex string or base64)')
    .enum('encoding', ['hex', 'base64'], 'Encoding of shellcode', { default: 'hex' })
    .required('pid', 'shellcode')
    .build(),

  // Anti-detection tools
  tool('check_debug_port')
    .desc('Check if a process is being debugged using NtQueryInformationProcess (ProcessDebugPort).')
    .number('pid', 'Target process ID')
    .required('pid')
    .build(),

  tool('enumerate_modules')
    .desc('List all loaded modules (DLLs) in a process with their base addresses.')
    .number('pid', 'Target process ID')
    .required('pid')
    .build(),

  tool('module_list')
    .desc('Alias of enumerate_modules. List loaded modules (DLLs) in a process.')
    .number('pid', 'Target process ID')
    .required('pid')
    .build(),

  tool('electron_attach')
    .desc('Connect to a running Electron app (VS Code, Cursor, etc.) via CDP and inspect/execute JS. Useful for debugging Electron applications or extracting extension data.')
    .number('port', 'CDP debugger port (default: 9229 for --inspect, 9222 for --remote-debugging-port)', { default: 9229 })
    .string('wsEndpoint', 'Full WebSocket endpoint (overrides port). e.g. ws://127.0.0.1:9229/devtools/browser/xxx')
    .string('evaluate', 'JavaScript expression to evaluate in the first matching page')
    .string('pageUrl', 'Filter pages by URL substring (e.g. "extension-host" to target VS Code extension host)')
    .build(),
];

export type ProcessToolName = (typeof processToolDefinitions)[number]['name'];
