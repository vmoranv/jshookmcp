import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

/**
 * Process Manager Tool Definitions
 * MCP tools for cross-platform process management and debugging
 */

export const processToolDefinitions: Tool[] = [
  // Core process management
  tool('process_find', (t) =>
    t
      .desc(
        'Search for processes by name pattern. Returns a list of matching processes with PID, name, path, and window information.',
      )
      .string('pattern', 'Process name pattern to search for (supports partial matches)')
      .required('pattern'),
  ),
  tool('process_list', (t) =>
    t.desc('List all running processes. This is an alias for process_find with an empty pattern.'),
  ),
  tool('process_get', (t) =>
    t
      .desc(
        'Get detailed information about a specific process by PID, including command line, parent PID, and debug port status.',
      )
      .number('pid', 'Process ID to retrieve details for')
      .required('pid'),
  ),
  tool('process_kill', (t) =>
    t
      .desc('Terminate a process by PID. Requires appropriate privileges.')
      .number('pid', 'Process ID to terminate')
      .required('pid'),
  ),
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
      .desc(
        'Read memory from a process at a specific address. Requires elevated privileges. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Memory address to read (hex string like "0x12345678")')
      .number('size', 'Number of bytes to read')
      .required('address', 'size'),
  ),
  tool('memory_write', (t) =>
    t
      .desc(
        'Write data to process memory at a given address. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Memory address to write to (hex string like "0x12345678")')
      .string('data', 'Data to write (hex string or base64)')
      .enum('encoding', ['hex', 'base64'], 'Encoding of the data parameter', { default: 'hex' })
      .required('address', 'data'),
  ),
  tool('memory_scan', (t) =>
    t
      .desc(
        'Scan process memory for a pattern or value. Requires elevated privileges. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
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
      .required('pattern'),
  ),
  tool('memory_check_protection', (t) =>
    t
      .desc(
        'Check memory protection flags at a specific address. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Memory address to check (hex string like "0x12345678")')
      .required('address'),
  ),
  tool('memory_scan_filtered', (t) =>
    t
      .desc(
        'Refine a previous memory scan with filtered addresses. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
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
      .required('pattern', 'addresses'),
  ),
  tool('memory_batch_write', (t) =>
    t
      .desc(
        'Write multiple memory patches at once. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
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
      .required('patches'),
  ),
  tool('memory_dump_region', (t) =>
    t
      .desc(
        'Dump a process memory region to a binary file for offline analysis. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Start address (hex)')
      .number('size', 'Number of bytes to dump')
      .string('outputPath', 'Output file path')
      .required('address', 'size', 'outputPath'),
  ),
  tool('memory_list_regions', (t) =>
    t
      .desc(
        'List all memory regions in a process with protection flags. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)'),
  ),
  tool('memory_audit_export', (t) =>
    t.desc('Export the in-memory audit trail for memory operations as JSON.'),
  ),

  // Injection tools
  tool('inject_dll', (t) =>
    t
      .desc(
        'Inject a DLL into a target process. Requires elevated privileges. Target process and payload are validated before injection.',
      )
      .number('pid', 'Target process ID')
      .string('dllPath', 'Full path to the DLL file to inject')
      .boolean('confirmed', 'Bypass confirmation prompts (use with caution)', { default: false })
      .string(
        'payloadHash',
        'Expected SHA-256 hash of the DLL for integrity verification (optional)',
      )
      .enum(
        'validationMode',
        ['strict', 'balanced', 'permissive', 'disabled'],
        'Validation mode override (default: from JSHOOK_INJECTION_VALIDATION_MODE env var)',
      )
      .required('pid', 'dllPath'),
  ),
  tool('inject_shellcode', (t) =>
    t
      .desc(
        'Allocate and execute raw shellcode in a target process. Requires elevated privileges. Target process and payload are validated before injection.',
      )
      .number('pid', 'Target process ID')
      .string('shellcode', 'Shellcode bytes (hex string or base64)')
      .enum('encoding', ['hex', 'base64'], 'Encoding of shellcode', { default: 'hex' })
      .boolean('confirmed', 'Bypass confirmation prompts (use with caution)', { default: false })
      .enum(
        'validationMode',
        ['strict', 'balanced', 'permissive', 'disabled'],
        'Validation mode override (default: from JSHOOK_INJECTION_VALIDATION_MODE env var)',
      )
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
  tool('process_enum_threads', (t) =>
    t
      .desc(
        'Enumerate all threads in a process. Returns thread IDs, with optional per-thread context and diagnostics. Cross-platform: Win32 uses CreateToolhelp32Snapshot; Linux reads /proc/{pid}/task; macOS uses `ps -M`.',
      )
      .number('pid', 'Process ID to enumerate threads for')
      .boolean('includeDetails', 'Include per-thread objects and process diagnostics', {
        default: false,
      })
      .required('pid'),
  ),

  tool('process_detect_hollowing', (t) =>
    t
      .desc(
        'Detect process hollowing (malware technique that unmaps original process image and injects malicious code). ' +
          'Compares process memory sections (.text, .data, .rdata) with on-disk PE file using SHA-256 hashes. ' +
          'Returns detection result with confidence score and list of differing sections. ' +
          'WARNING: autoRestore=true is HIGH RISK, may crash the target process, and is Win32-only. ' +
          'Cross-platform: Win32 compares PE sections; Linux/macOS compare ELF/Mach-O executable ' +
          'sections via IntegrityScanner (autoRestore unavailable).',
      )
      .number('pid', 'Process ID to check for hollowing')
      .boolean(
        'autoRestore',
        'Attempt to restore original code from disk (HIGH RISK, default: false)',
      )
      .boolean('includeMemoryDump', 'Include memory dump in result for forensics (default: false)')
      .required('pid'),
  ),

  tool('process_enum_handles', (t) =>
    t
      .desc(
        'Enumerate open handles for a process using NtQuerySystemInformation. ' +
          'Resolves handle type and object name, decodes access masks, identifies security risks ' +
          '(high-privilege handles to sensitive processes, dangerous Token handles, inheritable sensitive handles, ' +
          'Section handles to executables). Skips name resolution for File/EtwRegistration types (known to hang). ' +
          'Requires elevated privileges (run as Administrator). Win32 only.',
      )
      .number('pid', 'Process ID to enumerate handles for')
      .string(
        'filterType',
        'Filter by object type name (e.g. Process, Thread, Token, File, Key, Section, Mutant, Event, Semaphore)',
      )
      .boolean(
        'includeNames',
        'Resolve handle object names (slower; skip types known to hang like File) (default: true)',
      )
      .boolean('securityOnly', 'Only return handles with security findings (default: false)')
      .required('pid'),
  ),

  tool('process_detect_apc', (t) =>
    t
      .desc(
        'Detect APC (Asynchronous Procedure Call) injection in a process. ' +
          'Enumerates threads, probes each thread APC queue via NtQueryInformationThread(ThreadApcState), ' +
          'and detects threads in alertable wait state (SleepEx/WaitForMultipleObjectsEx). ' +
          'Returns verdict (clean/suspicious/infected), confidence score, and risk reasons. ' +
          'Requires elevated privileges (run as Administrator). Win32 only.',
      )
      .number('pid', 'Process ID to check for APC injection')
      .required('pid'),
  ),

  tool('electron_attach', (t) =>
    t
      .desc('Attach to an Electron CDP port and optionally evaluate in a matching page.')
      .number('port', 'CDP port to connect to', { minimum: 1, maximum: 65535 })
      .string('pageUrl', 'Optional URL substring used to pick the target page')
      .string('evaluate', 'Optional JavaScript expression to evaluate in the selected page')
      .string('wsEndpoint', 'Optional browser WebSocket endpoint override'),
  ),

  tool('process_suspend', (t) =>
    t
      .desc(
        'Suspend a process for forensic snapshotting. Cross-platform: NtSuspendProcess (Win32), SIGSTOP (Linux), task_suspend (macOS). ' +
          'Pair with process_resume to restore. Use before memory_scan/dump for a consistent snapshot. ' +
          'Requires admin/root on most platforms.',
      )
      .number('pid', 'Process ID to suspend')
      .required('pid'),
  ),

  tool('process_resume', (t) =>
    t
      .desc(
        'Resume a previously suspended process. Cross-platform: NtResumeProcess (Win32), SIGCONT (Linux), task_resume (macOS).',
      )
      .number('pid', 'Process ID to resume')
      .required('pid'),
  ),
];

export type ProcessToolName = (typeof processToolDefinitions)[number]['name'];
