import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';

const ScanValueTypeOptions = [
  'byte',
  'int8',
  'int16',
  'uint16',
  'int32',
  'uint32',
  'int64',
  'uint64',
  'float',
  'double',
  'string',
  'hex',
  'pointer',
] as const;

const ScanCompareModeOptions = [
  'exact',
  'unknown_initial',
  'changed',
  'unchanged',
  'increased',
  'decreased',
  'greater_than',
  'less_than',
  'between',
  'not_equal',
  'changed_by',
  'increased_by',
  'decreased_by',
  'changed_by_variable',
  'not_equal_to',
] as const;

export const memoryScanToolDefinitions: readonly Tool[] = [
  tool('memory_first_scan', (t) =>
    t
      .desc('Start a new memory scan session.')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('value', 'Value to search for (as string, e.g. "100", "3.14", "48 65 6C 6C 6F")')
      .enum('valueType', [...ScanValueTypeOptions], 'Data type of the value')
      .number(
        'alignment',
        'Alignment in bytes (0=unaligned, 4=4-byte aligned). Default: natural alignment for the type.',
      )
      .number('maxResults', 'Maximum results to return (default: 1,000,000)')
      .number(
        'tolerance',
        'Float comparison tolerance (non-negative). Only valid with float/double valueType. Overrides default epsilon.',
      )
      .boolean(
        'encrypted',
        'Enable encrypted value search (GameGuardian parity). When true, also searches for value XOR xorKey. ' +
          'Only applies to integer types (byte/int8/int16/uint16/int32/uint32/int64/uint64). ' +
          'Encrypted matches are returned alongside normal matches with encrypted=true flag.',
      )
      .number(
        'xorKey',
        'XOR key for encrypted search (default: 0xFF). Only used when encrypted=true. ' +
          'The key is applied byte-wise to the value representation.',
      )
      .boolean(
        'persistToDisk',
        'When true, stream scan results to a binary temp file (16 bytes per address: 8-byte address + 8-byte value LE) ' +
          'instead of holding all addresses in memory. Caps at 100M addresses (~1.6 GB file). Above that, the scan is ' +
          'rejected with a "narrow first" message. Useful for extremely large initial scans where the result set might ' +
          'exhaust RAM. Next scans read from the persisted file.',
      )
      .prop('regionFilter', {
        type: 'object',
        properties: {
          writable: { type: 'boolean', description: 'Only scan writable regions' },
          executable: { type: 'boolean', description: 'Only scan executable regions' },
          moduleOnly: { type: 'boolean', description: 'Only scan module-backed regions' },
          skipSystemModules: {
            type: 'boolean',
            description: 'Skip system modules (ntdll/kernel32/kernelbase/etc)',
          },
          modulePattern: {
            type: 'string',
            description: 'Only scan matching module names (case-insensitive substring)',
          },
          minSize: { type: 'number', description: 'Skip regions smaller than N bytes' },
        },
        description: 'Filter which memory regions to scan',
      })
      .requiredOpenWorld('value', 'valueType'),
  ),
  tool('memory_next_scan', (t) =>
    t
      .desc(
        'Narrow an existing scan session. Supports delta modes: changed_by (value changed by exactly N), ' +
          'increased_by (value increased by at least N), decreased_by (value decreased by at least N), ' +
          'changed_by_variable (returns per-address delta in results).',
      )
      .string('sessionId', 'Scan session ID')
      .enum('mode', [...ScanCompareModeOptions], 'Comparison mode')
      .string('value', 'Target value for exact/greater_than/less_than/between/not_equal modes')
      .string('value2', 'Upper bound value for "between" mode')
      .number(
        'delta',
        'Delta value for changed_by/increased_by/decreased_by modes. ' +
          'changed_by: abs(cur-prev) === delta. increased_by: (cur-prev) >= delta. ' +
          'decreased_by: (prev-cur) >= delta. Required for these modes, non-negative for increased_by/decreased_by.',
      )
      .number(
        'tolerance',
        'Float comparison tolerance (non-negative). Only valid with float/double valueType. ' +
          'With delta modes: abs(diff - delta) <= tolerance.',
      )
      .array(
        'excludeValues',
        { type: 'string' },
        'Hex byte strings to exclude from results (post-filter). Each value is compared against ' +
          'the result value string. Useful for filtering out known noise values. Only applied when ' +
          'mode is exact, not_equal, or not_equal_to.',
      )
      .requiredOpenWorld('sessionId', 'mode'),
  ),
  tool('memory_unknown_scan', (t) =>
    t
      .desc('Start an unknown initial value scan.')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .enum('valueType', [...ScanValueTypeOptions], 'Data type to capture')
      .number('alignment', 'Alignment in bytes (default: natural for type)')
      .number('maxResults', 'Maximum addresses to capture (default: 5,000,000)')
      .prop('regionFilter', {
        type: 'object',
        properties: {
          writable: { type: 'boolean' },
          executable: { type: 'boolean' },
          moduleOnly: { type: 'boolean' },
          skipSystemModules: { type: 'boolean', description: 'Skip system modules' },
          modulePattern: {
            type: 'string',
            description: 'Only scan matching module names (case-insensitive substring)',
          },
          minSize: { type: 'number', description: 'Skip regions smaller than N bytes' },
        },
      })
      .requiredOpenWorld('valueType'),
  ),
  tool('memory_pointer_scan', (t) =>
    t
      .desc('Find pointers to a target address.')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('targetAddress', 'Target address to find pointers to (hex, e.g. "0x7FF612340000")')
      .number('maxResults', 'Maximum results (default: 10,000)')
      .boolean('moduleOnly', 'Only scan module-backed regions')
      .prop('regionFilter', {
        type: 'object',
        properties: {
          writable: { type: 'boolean', description: 'Only scan writable regions' },
          executable: { type: 'boolean', description: 'Only scan executable regions' },
          moduleOnly: { type: 'boolean', description: 'Only scan module-backed regions' },
          skipSystemModules: { type: 'boolean', description: 'Skip system modules' },
          modulePattern: {
            type: 'string',
            description: 'Only scan matching module names (case-insensitive substring)',
          },
          minSize: { type: 'number', description: 'Skip regions smaller than N bytes' },
        },
        description: 'Filter which memory regions to scan',
      })
      .required('targetAddress')
      .query()
      .openWorld(),
  ),
  tool('memory_group_scan', (t) =>
    t
      .desc('Search for multiple values at known offsets simultaneously.')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .array(
        'pattern',
        {
          type: 'object',
          properties: {
            offset: { type: 'number', description: 'Byte offset from base' },
            value: { type: 'string', description: 'Expected value at offset' },
            type: {
              type: 'string',
              enum: [...ScanValueTypeOptions],
              description: 'Value type at offset',
            },
          },
          required: ['offset', 'value', 'type'],
        },
        'Array of {offset, value, type} patterns',
      )
      .number('alignment', 'Alignment for base address (default: 4)')
      .number('maxResults', 'Maximum results (default: 1,000,000)')
      .required('pattern')
      .query(),
  ),
  tool('memory_scan_session', (t) =>
    t
      .desc(
        `Manage scan sessions. Actions: list (all sessions), delete (by sessionId), export (as JSON).`,
      )
      .enum('action', ['list', 'delete', 'export'], 'Session management action')
      .string('sessionId', 'Scan session ID (required for delete/export)')
      .required('action'),
  ),

  // Pointer Chain Tools
  tool('memory_pointer_chain', (t) =>
    t
      .desc(
        `Pointer chain operations: scan (multi-level BFS), autoscan (auto-discover pointer chains ` +
          `by recursively scanning for pointers that point to or near the target address), ` +
          `validate, resolve, or export as JSON. ` +
          `autoscan is Cheat Engine's "pointer scan" equivalent — no manual base/offsets needed.`,
      )
      .enum('action', ['scan', 'autoscan', 'validate', 'resolve', 'export'], 'Chain operation')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string(
        'targetAddress',
        'Target address hex (action=scan/autoscan). For autoscan this is the address to find pointer chains to.',
      )
      .number('maxDepth', 'Max chain depth 1-6 (action=scan/autoscan, default: 4)')
      .number('maxOffset', 'Max offset per level in bytes (action=scan/autoscan, default: 4096)')
      .boolean('staticOnly', 'Only module-relative chains (action=scan/autoscan, default: false)')
      .array('modules', { type: 'string' }, 'Only scan specific modules (action=scan/autoscan)')
      .number('maxResults', 'Max chains to return (action=scan/autoscan, default: 1000)')
      .string('chains', 'JSON PointerChain[] (action=validate/export)')
      .string('chain', 'JSON single PointerChain (action=resolve)')
      .required('action'),
  ),

  // Structure Analysis Tools
  tool('memory_structure_analyze', (t) =>
    t
      .desc('Analyze memory at an address to infer data structure layout.')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Base address of the structure (hex)')
      .number('size', 'Size to analyze in bytes (default: 256)')
      .array(
        'otherInstances',
        { type: 'string' },
        'Additional instance addresses for cross-comparison',
      )
      .boolean('parseRtti', 'Whether to attempt RTTI parsing (default: true)')
      .required('address')
      .query(),
  ),
  tool('memory_vtable_parse', (t) =>
    t
      .desc(
        'Parse a vtable to enumerate virtual function pointers and resolve them to module+offset. Also attempts ' +
          'RTTI parsing for class name and inheritance hierarchy.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('vtableAddress', 'Address of the vtable (hex)')
      .required('vtableAddress')
      .query(),
  ),
  tool('memory_structure_export_c', (t) =>
    t
      .desc(
        'Export an inferred structure as a C-style struct definition, ReClass.NET XML, Rust #[repr(C)], ' +
          'or C# [StructLayout] with explicit FieldOffset attributes. ' +
          'C export auto-detects composite types (Vector3, Matrix4x4, pointer arrays).',
      )
      .string('structure', 'JSON string of InferredStruct to export')
      .string('name', 'Struct name (defaults to RTTI class name or "UnknownStruct")')
      .enum(
        'format',
        ['c', 'reclass', 'rust', 'csharp'],
        'Export format: "c" (default, with composite type detection), "reclass" for ReClass.NET XML, ' +
          '"rust" for #[repr(C)] struct, "csharp" for [StructLayout] with FieldOffset',
        { default: 'c' },
      )
      .required('structure')
      .query(),
  ),
  tool('memory_structure_compare', (t) =>
    t
      .desc(
        'Compare struct instances to identify differing vs constant fields. ' +
          'Two modes: (1) Pairwise—compare address1 vs address2. ' +
          '(2) Group comparison (CE dissect data parity)—pass arrays of addresses in group1Addresses ' +
          'and group2Addresses. Group mode computes per-offset statistics and classifies fields as: ' +
          'between_groups (differs across groups—likely gameplay state), within_group (varies within groups—dynamic), ' +
          'constant_all (same everywhere—likely vtable, type flags). Returns confidence scores.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address1', 'First instance address (hex, pairwise mode)')
      .string('address2', 'Second instance address (hex, pairwise mode)')
      .array(
        'group1Addresses',
        { type: 'string' },
        'Group 1 instance addresses (hex array, group mode)',
      )
      .array(
        'group2Addresses',
        { type: 'string' },
        'Group 2 instance addresses (hex array, group mode)',
      )
      .number('size', 'Size to compare in bytes (default: 256)')
      .required('address1', 'address2')
      .query(),
  ),

  // Breakpoint Tools
  tool('memory_breakpoint', (t) =>
    t
      .desc(
        `Breakpoint via hardware debug registers (DR0-DR3) or software INT3 (0xCC). Actions: set, remove, list, trace. ` +
          `Hardware BPs (type='hardware'): use x64 DR0-DR3, max 4 concurrent, support read/write/readwrite/execute. ` +
          `Software BPs (type='software'): use INT3 (0xCC) patching, unlimited count, execute-only. ` +
          `Two debugger modes: "win32" (default, uses DebugActiveProcess — freezes entire process) ` +
          `and "veh" (Vectored Exception Handler — injects shellcode, only faulting thread pauses). ` +
          `VEH mode is less intrusive but requires code injection which may be detected by anti-cheat systems. ` +
          `Conditional breakpoints: pass a JS expression as "condition" (e.g. "rax > 0x1000"), evaluated against ` +
          `register context on each hit; falsy results auto-resume without reporting.`,
      )
      .enum('action', ['set', 'remove', 'list', 'trace'], 'Breakpoint operation')
      .enum(
        'type',
        ['hardware', 'software'],
        'Breakpoint type: hardware (DR0-DR3, default) or software (INT3/0xCC, unlimited count, execute-only)',
        { default: 'hardware' },
      )
      .number(
        'pid',
        'Target process ID (optional when a browser session is attached; action=set/trace)',
      )
      .string('address', 'Address hex (action=set/trace)')
      .enum('access', ['read', 'write', 'readwrite', 'execute'], 'Access type (action=set/trace)')
      .number('size', 'Watch size in bytes (action=set, default: 4)')
      .string('breakpointId', 'Breakpoint ID (action=remove)')
      .number('maxHits', 'Max hits to collect (action=trace, default: 50)')
      .number('timeoutMs', 'Timeout ms (action=trace, default: 10000)')
      .string(
        'condition',
        'JS expression evaluated against register context on each hit (e.g. "rax > 0x1000 && ecx == 5"). ' +
          'Falsy results auto-resume without reporting. Register aliases: rax/rbx/rcx/rdx/rsi/rdi/rsp/rbp/rip/rflags and ' +
          'x86-32 names (eax/ebx/ecx/edx/esi/edi/esp/ebp/eip/eflags). Use BigInt n-suffix for bitwise ops on rflags.',
      )
      .enum(
        'debuggerMode',
        ['win32', 'veh'],
        'Debugger backend: win32 (DebugActiveProcess, default) or veh (Vectored Exception Handler — requires code injection)',
      )
      .required('action')
      .destructive(),
  ),
  tool('memory_find_accesses', (t) =>
    t
      .desc(
        `Find what writes to or accesses a memory address (Cheat Engine MWT workflow). ` +
          `Sets a hardware breakpoint on the target address, auto-rearms after each hit, ` +
          `captures the faulting instruction address + context + timestamp, and optionally ` +
          `disassembles the instruction. Returns aggregated hits with per-hit instruction details.`,
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Memory address to watch (hex, e.g. "0x7FF612340000")')
      .enum(
        'mode',
        ['write', 'readwrite'],
        'Access mode: write (only writes) or readwrite (reads and writes)',
      )
      .number('size', 'Watch size in bytes: 1, 2, 4, or 8 (default: 4)')
      .number('maxHits', 'Maximum hits before auto-stop (default: 20)')
      .number('timeoutMs', 'Timeout in ms before auto-stop (default: 15000)')
      .boolean('disassemble', 'Whether to disassemble the faulting instruction (default: true)')
      .prop('regionFilter', {
        type: 'object',
        properties: {
          moduleOnly: {
            type: 'boolean',
            description: 'Hint: the breakpoint only fires in code that runs; used for tracking',
          },
          skipSystemModules: {
            type: 'boolean',
            description: 'Exclude system module hits from results',
          },
          modulePattern: { type: 'string', description: 'Only report hits from matching modules' },
        },
        description: 'Filter which instruction hits to report',
      })
      .required('address', 'mode')
      .query(),
  ),

  // Injection Tools
  tool('memory_patch_bytes', (t) =>
    t
      .desc(
        'Write bytes to target process at address. Saves original bytes for undo. Use for runtime code patching.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Address to patch (hex)')
      .array('bytes', { type: 'number' }, 'Byte values to write (e.g. [0x90, 0x90])')
      .required('address', 'bytes')
      .destructive()
      .openWorld(),
  ),
  tool('memory_patch_nop', (t) =>
    t
      .desc(
        'NOP out instructions at address (replace with 0x90). Useful for disabling checks or jumps.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Address to NOP (hex)')
      .number('count', 'Number of bytes to NOP')
      .required('address', 'count')
      .destructive(),
  ),
  tool('memory_patch_undo', (t) =>
    t
      .desc('Undo a previous patch by restoring the original bytes.')
      .string('patchId', 'Patch ID to undo')
      .required('patchId')
      .destructive(),
  ),
  tool('memory_code_caves', (t) =>
    t
      .desc(
        'Find code caves (runs of 0x00 or 0xCC) in executable sections of loaded modules. Returns largest caves first.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .number('minSize', 'Minimum cave size in bytes (default: 16)')
      .required()
      .query(),
  ),

  // Code Injection Tools (Win32 only, gated behind JSHOOK_INJECTION_ENABLE=1)
  tool('memory_allocate', (t) =>
    t
      .desc(
        'Allocate executable memory in target process (VirtualAllocEx wrapper). Win32 only. ' +
          'Requires JSHOOK_INJECTION_ENABLE=1.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .number('size', 'Size in bytes to allocate')
      .required('size')
      .destructive(),
  ),
  tool('memory_free', (t) =>
    t
      .desc(
        'Free remote memory in target process (VirtualFreeEx wrapper). Win32 only. ' +
          'Requires JSHOOK_INJECTION_ENABLE=1.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Address to free (hex)')
      .required('address')
      .destructive(),
  ),
  tool('memory_inject_shellcode', (t) =>
    t
      .desc(
        'Inject shellcode into target process. Win32 only. ' +
          'Methods: createremote (CreateRemoteThread) or ntcreatethread (NtCreateThreadEx). ' +
          'Requires JSHOOK_INJECTION_ENABLE=1.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('shellcode', 'Shellcode as hex bytes (e.g. "48 31 C0 ...")')
      .enum(
        'method',
        ['createremote', 'ntcreatethread'],
        'Injection method (default: createremote)',
      )
      .required('shellcode')
      .destructive(),
  ),
  tool('memory_inject_dll', (t) =>
    t
      .desc(
        'Inject a DLL into target process. Win32 only. ' +
          'Modes: loadlibrary (LoadLibraryW injection) or manualmap (manual mapping). ' +
          'Requires JSHOOK_INJECTION_ENABLE=1.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('dllPath', 'Path to the DLL file to inject')
      .enum('mode', ['loadlibrary', 'manualmap'], 'Injection mode (default: loadlibrary)')
      .required('dllPath')
      .destructive(),
  ),

  // Control Tools
  tool('memory_write_value', (t) =>
    t
      .desc(
        'Write a typed value to a memory address. Supports undo/redo via memory_write_history(action=undo|redo).',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Address to write to (hex)')
      .string('value', 'Value to write (as string)')
      .enum('valueType', [...ScanValueTypeOptions], 'Data type of the value')
      .required('address', 'value', 'valueType')
      .destructive(),
  ),
  tool('memory_freeze', (t) =>
    t
      .desc(
        `Freeze or unfreeze a memory address. Freeze continuously writes a value to prevent changes; unfreeze stops ` +
          `it.`,
      )
      .enum('action', ['freeze', 'unfreeze'], 'Freeze operation')
      .number(
        'pid',
        'Target process ID (optional when a browser session is attached; action=freeze)',
      )
      .string('address', 'Address to freeze hex (action=freeze)')
      .string('value', 'Value to maintain (action=freeze)')
      .enum('valueType', [...ScanValueTypeOptions], 'Data type (action=freeze)')
      .number('intervalMs', 'Write interval ms (action=freeze, default: 100)')
      .string('freezeId', 'Freeze ID to remove (action=unfreeze)')
      .required('action')
      .destructive(),
  ),
  tool('memory_dump', (t) =>
    t
      .desc(
        'Dump memory region as hex with ASCII column. Outputs a formatted hex dump similar to xxd.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Start address (hex)')
      .number('size', 'Size to dump in bytes (default: 256)')
      .required('address')
      .query(),
  ),

  // Time Tools
  tool('memory_speedhack', (t) =>
    t
      .desc(
        `Hook time APIs (GetTickCount64/GetTickCount/QueryPerformanceCounter/QueryPerformanceFrequency/` +
          `timeGetTime/GetSystemTimeAsFileTime) to scale process time via an in-process SSE2 trampoline. ` +
          `time via an in-process SSE2 trampoline. Actions: apply (hook + set speed), set (adjust ` +
          `speed without re-hooking), restore (unhook and restore original functions). Speed range ` +
          `0.01–100x; values outside this range are rejected to avoid destabilising the target.`,
      )
      .enum('action', ['apply', 'set', 'restore'], 'Speedhack action')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .number('speed', 'Speed multiplier (0.01–100)')
      .required('action')
      .destructive(),
  ),

  // History Tools
  tool('memory_write_history', (t) =>
    t
      .desc(
        'Undo or redo the last memory write operation. Pass pid to scope the operation to a ' +
          "specific process — per-PID undo prevents reverting an unrelated process's write when " +
          'multiple processes are being edited concurrently.',
      )
      .enum('action', ['undo', 'redo'], 'History action')
      .number(
        'pid',
        'Target process ID — scopes undo/redo to this process (optional; omit for global)',
      )
      .required('action')
      .destructive()
      .openWorld(),
  ),

  // Heap Analysis Tools
  tool('memory_heap_enumerate', (t) =>
    t
      .desc(
        'Enumerate all heaps and heap blocks in a process via Toolhelp32 snapshot. Returns heap list with block ' +
          'counts, sizes, and overall statistics.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .number('maxBlocks', 'Maximum blocks to enumerate per heap (default: 10000)')
      .required()
      .query(),
  ),
  tool('memory_heap_stats', (t) =>
    t
      .desc(
        'Get detailed heap statistics with size distribution buckets (0-64B, 64B-1KB, 1-64KB, 64KB-1MB, >1MB), ' +
          'fragmentation ratio, and aggregate metrics.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .required()
      .query(),
  ),
  tool('memory_heap_anomalies', (t) =>
    t
      .desc(
        'Detect heap anomalies: heap spray patterns (many same-size blocks), possible use-after-free (non-zero ' +
          'free blocks), and suspicious block sizes (0 or >100MB).',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .required()
      .query(),
  ),

  // PE / Module Introspection Tools
  tool('memory_pe_headers', (t) =>
    t
      .desc(
        'Parse PE headers (DOS, NT, File, Optional) from a module base address in process memory. Returns machine' +
          ' type, entry point, image base, section count, and data directory info.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('moduleBase', 'Module base address (hex, e.g. "0x7ff612340000") — Win32')
      .string(
        'moduleName',
        'Module name/path substring (cross-platform: required on Linux/macOS to locate the on-disk ELF/Mach-O binary)',
      )
      .required()
      .query(),
  ),
  tool('memory_pe_imports_exports', (t) =>
    t
      .desc(
        'Parse import and/or export tables from a PE module in process memory. Returns DLL names, function names,' +
          ' ordinals, hints, and forwarded exports. Cross-platform: parses ELF .dynsym / Mach-O LC_SYMTAB from disk when moduleName is given on Linux/macOS.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('moduleBase', 'Module base address (hex) — Win32')
      .string('moduleName', 'Module name/path substring (cross-platform: required on Linux/macOS)')
      .enum('table', ['imports', 'exports', 'both'], 'Which table to parse', { default: 'both' })
      .required()
      .query(),
  ),
  tool('memory_inline_hook_detect', (t) =>
    t
      .desc(
        'Detect hooks in process modules. scanMode "inline" (default) compares the first 16 ' +
          'bytes of each exported function disk-vs-memory and recognises 8 hook patterns ' +
          '(JMP/CALL/short-jmp/MOV+JMP/MOV+CALL/PUSH+RET/INT3/padding). scanMode "iat" detects ' +
          'Import Address Table hooks (entries redirected outside their source module — evades ' +
          'inline detection, used by EasyHook/MinHook/Detours). scanMode "both" runs both scans.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('moduleName', 'Module name filter (optional — scans all modules if omitted)')
      .string(
        'startAddress',
        'Hex address of the code range to scan (cross-platform raw mode — required on Linux/macOS where there is no PE export table)',
      )
      .number('size', 'Byte length of the range to scan in cross-platform raw mode (default 4096)')
      .enum('scanMode', ['inline', 'iat', 'both'], 'Hook scan mode (default: inline)', {
        default: 'inline',
      })
      .required()
      .query(),
  ),

  // Anti-Cheat / Anti-Debug Tools
  tool('memory_anticheat_detect', (t) =>
    t
      .desc(
        'Scan process imports for anti-debug/anti-cheat mechanisms: IsDebuggerPresent, NtQueryInformationProcess,' +
          ' timing checks (QPC, GetTickCount), thread hiding, heap flag checks, and DR register inspection. Each ' +
          'detection includes a bypass suggestion.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .required()
      .query(),
  ),
  tool('memory_antidetection', (t) =>
    t
      .desc(
        'Anti-detection hardening toolkit. Actions: check (run all detectors — kernel callbacks, ' +
          'instrumentation callback, AMSI/ETW status, chaos mode, platform info), ' +
          'harden (apply AMSI/ETW patches + process masquerade + self-defense — destructive), ' +
          'status (read-only current protection state). ' +
          'WARNING: harden action modifies process memory and mitigation policies. ' +
          'ProcessBreakOnTermination is PERMANENTLY DISABLED (stub — no BSOD risk). ' +
          'On non-Windows, returns platform info only.',
      )
      .enum('action', ['check', 'harden', 'status'], 'Operation mode (default: check)', {
        default: 'check',
      })
      .boolean(
        'includeDetails',
        'Include detailed per-detector results and limitations (default: false). ' +
          'When true, returns full driver lists, handle details, ETW sessions, and honest boundary notes.',
      )
      .required()
      .query(),
  ),
  tool('memory_guard_pages', (t) =>
    t
      .desc(
        'Find all memory regions with PAGE_GUARD protection in a process. Guard pages are often used as ' +
          'anti-tampering mechanisms or stack overflow detection.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .number('maxRegions', 'Maximum regions to scan before stopping (default: 10000)')
      .required()
      .query(),
  ),
  tool('memory_integrity_check', (t) =>
    t
      .desc(
        'Check executable memory regions against their corresponding on-disk PE files (.text sections) to detect ' +
          'modifications like inline hooks or code patches.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .number('maxSections', 'Maximum sections to check before stopping (default: 100)')
      .required()
      .query(),
  ),

  // Region Enumeration Tool
  tool('memory_region_enumerate', (t) =>
    t
      .desc(
        'Enumerate memory regions in a target process. Cross-platform: Windows (VirtualQueryEx), ' +
          'macOS (mach_vm_region), Linux (/proc/pid/maps). Returns base address, size, protection ' +
          '(r/w/x/rw/rx/rwx), state, type (image/mapped/private), and module name (if module-backed). ' +
          'Emulator mode (mode="emulator"): use with memory_emulator_detect to get emulator-specific ' +
          'memory region descriptors (EE RAM for PCSX2, MEM1/MEM2 for Dolphin, etc.) and filter results.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .enum(
        'protection',
        ['r', 'w', 'x', 'rw', 'rx', 'wx', 'rwx'],
        'Filter by protection (optional)',
      )
      .string(
        'moduleName',
        'Filter regions by module name (optional, case-insensitive substring match)',
      )
      .string(
        'emulatorName',
        'Emulator name for emulator-mode region mapping (e.g. "PCSX2", "Dolphin"). ' +
          'When set, returns emulator-specific region descriptors alongside normal region enumeration. ' +
          'Use with memory_emulator_detect first to identify the emulator.',
      )
      .number('maxRegions', 'Maximum regions to return (default: 500)')
      .required()
      .query(),
  ),

  // AOB (Array of Bytes) Scan Tool
  tool('memory_aob_scan', (t) =>
    t
      .desc(
        'Array-of-Bytes scan with wildcard and operator support (CE 7.6 parity). Search for byte patterns like ' +
          '"48 8B ?? ?? 00 00" across readable memory. Supports hex bytes (00-FF, optional 0x prefix), ' +
          '"??" wildcards, and operators: >XX (greater than), <XX (less than), XX-YY (range inclusive). ' +
          'Example: "48 8B >40 <80 00 00" matches bytes >0x40 at position 2 and <0x80 at position 3. ' +
          'Case insensitive. Use regionFilter to restrict to specific modules or skip system modules.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string(
        'pattern',
        'AOB pattern: space-separated hex bytes (00-FF) and "??" wildcards. ' +
          'Example: "48 8B ?? ?? 00 00".',
      )
      .string('moduleName', 'Restrict scan to a specific module (optional, case-insensitive)')
      .boolean(
        'executableOnly',
        'Only scan executable regions (legacy param, use regionFilter.executable instead)',
      )
      .number('maxResults', 'Maximum results to return (default: 10000)')
      .prop('regionFilter', {
        type: 'object',
        properties: {
          writable: { type: 'boolean', description: 'Only scan writable regions' },
          executable: { type: 'boolean', description: 'Only scan executable regions' },
          moduleOnly: { type: 'boolean', description: 'Only scan module-backed regions' },
          skipSystemModules: { type: 'boolean', description: 'Skip system modules' },
          modulePattern: { type: 'string', description: 'Only scan matching module names' },
          minSize: { type: 'number', description: 'Skip regions smaller than N bytes' },
        },
        description: 'Filter which memory regions to scan',
      })
      .required('pattern')
      .query(),
  ),

  // Cheat Table (.CT) Import/Export
  tool('memory_cheat_table', (t) =>
    t
      .desc(
        'Import, export, sign, or verify Cheat Engine .CT files. ' +
          'Export: converts JSON entries to valid .CT XML. Import: parses .CT XML to JSON. ' +
          'Sign: HMAC-SHA256 sign the XML using a secret (from JSHOOK_TABLE_SECRET env var, ' +
          'state_board "memory_ct_sign" secret key, or explicit "secret" arg). ' +
          "Verify: validate a signed table's HMAC signature. Addresses can be hex or module+offset.",
      )
      .enum('action', ['export', 'import', 'sign', 'verify'], 'Operation mode')
      .string('xml', 'CT XML string content (action=import/sign/verify)')
      .array(
        'entries',
        {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Human-readable label (e.g. "Health")' },
            address: {
              type: 'string',
              description:
                'Hex address or module+offset (e.g. "0x7FF612340000" or \\"game.exe\\"+00123456)',
            },
            valueType: {
              type: 'string',
              description: 'jshookmcp value type: int32, float, double, int64, pointer, etc.',
            },
            moduleName: {
              type: 'string',
              description: 'Module name if address is module-relative',
            },
            offset: { type: 'string', description: 'Module offset as hex (e.g. "0x00123456")' },
          },
          required: ['description', 'address', 'valueType'],
        },
        'Array of CheatEntry objects (action=export/sign)',
      )
      .number('version', 'CE table version (action=export, default: 45)')
      .string(
        'secret',
        'Signing secret (action=sign/verify). Falls back to JSHOOK_TABLE_SECRET env var or state_board.',
      )
      .string('signer', 'Signer attribution name (action=sign, default: "jshookmcp")')
      .required('action')
      .query(),
  ),

  // AOB Signature Generation
  tool('memory_generate_signature', (t) =>
    t
      .desc(
        'Generate an update-resistant AOB (Array-of-Bytes) signature from bytes at a memory address. ' +
          'Detects relative offsets in CALL/JMP/LEA/Jcc instructions and replaces the displacement bytes ' +
          'with wildcards (??), making the signature survive minor code changes between updates. ' +
          'Uses byte-pattern heuristics — no Capstone dependency required.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Starting address to read from (hex)')
      .number('size', 'Number of bytes to read (default: 64)')
      .number('wildcardRelOffsets', 'Bytes to wildcard after relative instructions (default: 4)')
      .required('address')
      .query(),
  ),

  // RTTI Standalone Tool
  tool('memory_rtti_info', (t) =>
    t
      .desc(
        'Parse MSVC RTTI (Run-Time Type Information) at an object address. Reads vtable pointer, ' +
          'follows the Complete Object Locator chain, extracts class name, base classes, and class ' +
          'hierarchy descriptor. Equivalent to CE\'s "Find out what addresses this code accesses" ' +
          'for type discovery — quickly answer "what type is this object?" without a full structure ' +
          'analysis. Only works on MSVC x64 binaries with RTTI enabled.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string(
        'address',
        'Object address (hex) — the first 8 bytes are read as the vtable pointer, then RTTI is ' +
          'resolved from vtable[-1]',
      )
      .required('address')
      .query(),
  ),

  // String Search Tool
  tool('memory_search_string', (t) =>
    t
      .desc(
        'Search process memory for strings matching a pattern. Wraps memory_first_scan with ' +
          'valueType=string for convenience and adds substring/regex post-filtering. Optionally ' +
          'also searches for UTF-16LE (wide) strings.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('pattern', 'String to search for (case-insensitive substring match)')
      .boolean('regex', 'Treat pattern as regex (default: false)')
      .boolean(
        'wide',
        'Search for UTF-16LE (wide) strings too (default: true). Each wide char = 2 bytes.',
      )
      .number('minLength', 'Minimum string length to include in results (default: 3)')
      .number('maxResults', 'Maximum results (default: 500)')
      .required('pattern')
      .query(),
  ),

  // Minidump Parsing Tool
  tool('memory_parse_dump', (t) =>
    t
      .desc(
        'Parse a Windows Minidump (.dmp) file and extract forensic information: ' +
          'loaded modules (base/size/name/timestamp), threads (ID/stack/context), ' +
          'memory ranges (64-bit or 32-bit), system info (OS/CPU), and exception records. ' +
          'Optionally resolve a list of addresses against the dump contents. ' +
          'Pure TS — cross-platform (can analyze Windows dumps on Linux/macOS).',
      )
      .string('filePath', 'Absolute or relative path to the .dmp file')
      .boolean('includeModules', 'Include module list (default: true)', { default: true })
      .boolean('includeThreads', 'Include thread list (default: true)', { default: true })
      .boolean('includeMemoryRanges', 'Include memory ranges (default: true)', { default: true })
      .boolean('includeException', 'Include exception record (default: true)', { default: true })
      .boolean('includeSystemInfo', 'Include system information (default: true)', { default: true })
      .array(
        'resolveAddresses',
        { type: 'string' },
        'Optional list of addresses to resolve against the dump',
      )
      .required('filePath'),
  ),

  // ── Mono / .NET Runtime Tools (Win32-only) ──
  tool('memory_mono_detect', (t) =>
    t
      .desc(
        'Detect Mono or IL2CPP runtime in a target process. Returns runtime kind (mono/il2cpp), ' +
          'module name, pointer size, and root domain address if resolved. ' +
          'Works on Unity games and other Mono/.NET applications.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .required()
      .query(),
  ),
  tool('memory_mono_assemblies', (t) =>
    t
      .desc(
        'List Mono assemblies loaded in the root domain of a Unity/Mono process. ' +
          'Returns assembly name, address, and image address. ' +
          'Optionally filter by name substring.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('nameFilter', 'Optional substring filter on assembly name (case-insensitive)')
      .required()
      .query(),
  ),
  tool('memory_mono_classes', (t) =>
    t
      .desc(
        'List Mono classes in a specific assembly from a Unity/Mono process. ' +
          'Reads the MonoImage type definition table (MONO_TABLE_TYPEDEF) and resolves ' +
          'class names from the string heap. Optionally filter by namespace.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string(
        'assemblyName',
        'Assembly name substring to match (e.g. "Assembly-CSharp", "UnityEngine")',
      )
      .string('namespaceFilter', 'Optional namespace substring filter')
      .number('maxResults', 'Maximum classes to return (default: 500)')
      .required('assemblyName')
      .query(),
  ),
  tool('memory_mono_objects', (t) =>
    t
      .desc(
        'Find live Mono objects of a specific class in the managed heap. ' +
          'Resolves class vtable, then scans writable heap regions for vtable pointer matches. ' +
          'Returns object addresses with class name and estimated size.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('className', 'Class name substring to match (e.g. "Player", "EnemyController")')
      .number('maxResults', 'Maximum objects to return (default: 100)')
      .required('className')
      .query(),
  ),
  tool('memory_mono_fields', (t) =>
    t
      .desc(
        'Read field values from a Mono object at the given address. ' +
          'Resolves the class via vtable pointer, walks MonoClass fields, and decodes each ' +
          'field value with type-aware heuristics (int, float, string pointer detection).',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Object address (hex, e.g. "0x7FF612340000")')
      .required('address')
      .query(),
  ),
  tool('memory_mono_methods', (t) =>
    t
      .desc(
        'Inspect method count for a Mono class in a Unity/Mono process. ' +
          'Full method name enumeration requires walking the MonoMethod table from MonoImage ' +
          '(not yet implemented — returns methodCount from the type definition table).',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('assemblyName', 'Assembly name substring to match')
      .string('className', 'Class name substring to match within the assembly')
      .required('assemblyName', 'className')
      .query(),
  ),

  // ── Batch Edit Tool ──
  tool('memory_batch_edit', (t) =>
    t
      .desc(
        'Write a value to ALL addresses in a scan session at once. Thin wrapper that iterates ' +
          'through the session address list and calls writeValue for each. Capped at 1000 addresses ' +
          'per call with a clear error when exceeded. Destructive — an audit trail entry is recorded ' +
          'for each write. Equivalent to GameGuardian\'s gg.editAll() or Cheat Engine\'s "Edit All".',
      )
      .string('sessionId', 'Scan session ID whose addresses will all be written to')
      .string('value', 'Value to write to all addresses (as string, e.g. "100", "3.14")')
      .enum('valueType', [...ScanValueTypeOptions], 'Data type of the value to write')
      .required('sessionId', 'value', 'valueType')
      .destructive(),
  ),

  // ── Watch Value Change Tool ──
  tool('memory_watch', (t) =>
    t
      .desc(
        'Poll a memory address until its value changes (like scanmem\'s "watch" command). ' +
          'Reads the current value, then polls at a configurable interval. Returns immediately with the ' +
          'old value, new value, and elapsed time when a change is detected. If no change occurs within ' +
          'the timeout, returns the unchanged value and a hint. Useful for "tell me when this variable ' +
          'changes" workflows.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Memory address to watch (hex, e.g. "0x7FF612340000")')
      .enum('valueType', [...ScanValueTypeOptions], 'Data type of the value to watch')
      .number(
        'size',
        'Number of bytes to read on each poll. Auto-detected for numeric types (1-8 bytes), ' +
          'required for string/hex value types.',
      )
      .number('intervalMs', 'Poll interval in ms (default: 500, min: 100)')
      .number('timeoutMs', 'Maximum time to wait in ms (default: 30000, max: 120000)')
      .required('address', 'valueType')
      .query(),
  ),

  // ── Custom Scan Types (CE parity) ──
  tool('memory_register_type', (t) =>
    t
      .desc(
        'Register a custom value type for memory scanning (Cheat Engine parity). ' +
          'Registered types can be used as valueType in memory_first_scan, memory_unknown_scan, etc. ' +
          'Types are session-scoped (live as long as the domain handler instance).',
      )
      .string(
        'name',
        'Unique type name (identifier, alphanumeric + underscore, e.g. "custom_hp", "vec3")',
      )
      .number('size', 'Byte size: 1, 2, 4, or 8')
      .enum(
        'encoding',
        ['int', 'uint', 'float', 'hex'],
        'How to interpret bytes: int (signed integer), uint (unsigned), float (IEEE 754), hex (raw bytes)',
      )
      .enum('endian', ['le', 'be'], 'Byte order: le (little-endian, default) or be (big-endian)', {
        default: 'le',
      })
      .required('name', 'size', 'encoding')
      .query(),
  ),
  tool('memory_list_types', (t) =>
    t.desc('List all registered custom scan types.').required().query(),
  ),
  tool('memory_unregister_type', (t) =>
    t
      .desc('Remove a registered custom scan type by name.')
      .string('name', 'Custom type name to unregister')
      .required('name')
      .query(),
  ),

  // Call Stack View Tool
  tool('memory_call_stack', (t) =>
    t
      .desc(
        'Walk the call stack of a target process thread using the x64 RBP frame-pointer chain. ' +
          'Suspends the thread, reads the CONTEXT to get RBP/RSP/RIP, then follows the linked list ' +
          'of saved_RBP / return_address frames via ReadProcessMemory. Resolves module names ' +
          'using Toolhelp32 module snapshots. Returns an array of {frameIndex, returnAddress, ' +
          'moduleName, functionName}. Equivalent to x64dbg\'s "standard" call stack mode. ' +
          'Win32 (x64) only — requires Administrator privileges.',
      )
      .number('pid', 'Target process ID')
      .number('threadId', 'Specific thread ID to walk (optional; defaults to the first thread)')
      .number('maxFrames', 'Maximum frames to return (default: 128)')
      .required('pid')
      .query(),
  ),

  // Process Suspend / Resume Tool
  tool('memory_process_control', (t) =>
    t
      .desc(
        'Suspend or resume a target process for consistent memory snapshots. ' +
          'Suspend freezes all threads (NtSuspendProcess on Win32, SIGSTOP on Linux, ' +
          'task_suspend on macOS) so memory reads/scans see a consistent state. ' +
          'Resume thaws all threads. Useful before memory_dump or memory_first_scan for ' +
          'processes with actively-changing memory. Cross-platform.',
      )
      .enum('action', ['suspend', 'resume'], 'Operation to perform')
      .number('pid', 'Target process ID')
      .required('action', 'pid')
      .query(),
  ),

  // ── Handle Enumeration Tool (Win32-only) ──
  tool('memory_handle_enum', (t) =>
    t
      .desc(
        'Enumerate all open handles in a target process via NtQuerySystemInformation. ' +
          'Returns handle value, object type, access mask, and object name for each handle. ' +
          'Filterable by type: File, Key, Process, Thread, Token, Section, etc. ' +
          'Useful for finding handles to protected resources and analyzing process security posture. ' +
          'Win32-only, admin required.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string(
        'filterType',
        'Filter handles by type name. Common types: File, Key, Process, Thread, Token, Section, Event, Mutant. ' +
          'Omit for all types.',
      )
      .boolean(
        'includeNames',
        'Resolve object names (default: true). Slow on many File handles due to named-pipe hang risk.',
        { default: true },
      )
      .number('maxResults', 'Maximum handles to return (default: 200, max: 1000)')
      .required()
      .query(),
  ),

  // ── Memory Protection Tool (cross-platform) ──
  tool('memory_protect', (t) =>
    t
      .desc(
        'Change memory page protection for a region in the target process. ' +
          'Wraps VirtualProtectEx (Win32) / mprotect (Linux) / mach_vm_protect (macOS). ' +
          'Protection: r (read-only), rw (read-write), rx (read-execute), rwx (all), none (no-access). ' +
          'Returns the old protection. Destructive — audit trail recorded.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Base address of the region (hex, e.g. "0x7FF612340000")')
      .number('size', 'Region size in bytes (positive integer)')
      .enum('protection', ['r', 'rw', 'rx', 'rwx', 'none'], 'New protection level')
      .required('address', 'size', 'protection')
      .destructive(),
  ),

  // ── Memory Region Comparison Tool (cross-platform) ──
  tool('memory_region_compare', (t) =>
    t
      .desc(
        'Compare two memory regions byte-by-byte and return a diff summary. ' +
          "Equivalent to Cheat Engine's compareMemory(). Returns identical flag, diff count, " +
          'and per-offset differences (byte1, byte2). Max compare size: 64KB.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address1', 'First base address (hex, e.g. "0x7FF612340000")')
      .string('address2', 'Second base address (hex, e.g. "0x7FF612340000")')
      .number('size', 'Number of bytes to compare (default: 256, max: 65536)')
      .required('address1', 'address2')
      .query(),
  ),

  // ── Cross-Reference Engine (x64dbg parity, cross-platform) ──
  tool('memory_find_references', (t) =>
    t
      .desc(
        'Find all references to an address in executable memory (x64dbg parity). ' +
          'Scans all executable regions for CALL rel32, JMP rel32, Jcc rel32, LEA [RIP+disp32], ' +
          'and MOV [RIP+disp32] instructions that reference the target address. ' +
          'Uses pure-TS byte-pattern heuristics — no Capstone dependency. ' +
          'Returns reference type, source address, disassembly, module name, and module offset. ' +
          'Optionally filter by module name.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Target address to find references to (hex, e.g. "0x7FF612340000")')
      .string(
        'moduleName',
        'Restrict search to a specific module (optional, case-insensitive substring match)',
      )
      .number('maxResults', 'Maximum results to return (default: 500)')
      .required('address')
      .query(),
  ),

  // ── Instruction-Level Code Tracing (Ultimap-style, Win32-only) ──
  tool('memory_trace_code', (t) =>
    t
      .desc(
        'Ultimap-style instruction-level code tracing. Sets INT3 (0xCC) software breakpoints ' +
          'at function entry points and logs every execution. Aggregates hit counts per address ' +
          'to produce a hot-code-path heat map. ' +
          'Win32-only — requires the Win32 debug API (DebugActiveProcess). ' +
          'Provide either "addresses" (list of specific hex addresses) or ' +
          '"startAddress" + "size" (range to scan for 0x55 push-rbp prologues). ' +
          'Max trace time: 30s, max hits: 10000.',
      )
      .number('pid', 'Target process ID (required)')
      .array('addresses', { type: 'string' }, 'List of hex addresses to set breakpoints at')
      .string(
        'startAddress',
        'Start address of the range to scan for function entries (hex, e.g. "0x7FF612341000")',
      )
      .number('size', 'Size of the range to scan in bytes (required with startAddress)')
      .number('maxHits', 'Maximum hits to collect before auto-stop (default: 10000)')
      .number('timeoutMs', 'Maximum trace time in ms (default: 30000, max: 120000)')
      .required('pid')
      .destructive(),
  ),

  // ── Reverse MWT (inverse of find_accesses, cross-platform) ──
  tool('memory_reverse_mwt', (t) =>
    t
      .desc(
        'Reverse memory write trace — given a code address, find what data addresses the ' +
          'instruction accesses. Inverse of memory_find_accesses. Disassembles the instruction ' +
          'at the given address using Capstone, then resolves RIP-relative and absolute memory ' +
          'operands to their target addresses. Returns instruction text, raw bytes, and a ' +
          'list of accessed addresses with access type (READ/WRITE/RIP_REL). ' +
          'Useful for understanding what data a specific piece of code operates on.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Code address to analyze (hex, e.g. "0x7FF612340000")')
      .boolean('disassemble', 'Whether to disassemble the instruction (default: true)', {
        default: true,
      })
      .required('address')
      .query(),
  ),

  // ── Pointer Map Persistence (.PTR parity) ──
  tool('memory_pointer_map', (t) =>
    t
      .desc(
        'Save, load, or compare pointer maps for cross-instance filtering (Cheat Engine .PTR parity). ' +
          'save: serialize pointer scan results to a .ptr.json file in <project>/.ptr/. ' +
          'load: deserialize a pointer map from file. ' +
          'compare: load 2+ pointer map files and find addresses that appear in ALL maps — ' +
          'the CE "rescan across multiple instances" workflow for finding stable pointer chains.',
      )
      .enum('action', ['save', 'load', 'compare'], 'Operation mode')
      .string('name', 'Pointer map name without extension (action=save/load)')
      .number('pid', 'Target process ID (action=save)')
      .string('targetAddress', 'Target address these pointer chains resolve to, hex (action=save)')
      .array(
        'entries',
        {
          type: 'object',
          properties: {
            address: { type: 'string', description: 'Hex address' },
            value: { type: 'string', description: 'Hex value at the address' },
            moduleName: { type: 'string', description: 'Optional module name' },
            label: { type: 'string', description: 'Optional human-readable label' },
          },
          required: ['address', 'value'],
        },
        'Array of {address, value, moduleName?, label?} pointer scan results (action=save)',
      )
      .string('filePath', 'Absolute path to a .ptr.json file (action=load, overrides name lookup)')
      .array('names', { type: 'string' }, 'Array of pointer map names to compare (action=compare)')
      .array(
        'filePaths',
        { type: 'string' },
        'Array of absolute file paths to compare (action=compare, overrides names)',
      )
      .string('projectRoot', 'Project root directory for .ptr/ storage (defaults to cwd)')
      .required('action'),
  ),

  // ── Inline Assembler (x64dbg parity) ──
  tool('memory_assemble', (t) =>
    t
      .desc(
        'Assemble x64 assembly instructions to machine code bytes (x64dbg inline assembler parity). ' +
          'Uses Keystone assembler via koffi FFI (keystone.dll) if available on Windows, with a built-in ' +
          'fallback opcode table for common instructions (NOP, RET, INT3, PUSH/POP, MOV, XOR, ADD, SUB, INC, DEC). ' +
          'assemble: compile ASM string to hex bytes. ' +
          'assemble_at: assemble + write directly to target process memory at address (destructive, audit trail recorded). ' +
          'Separate multiple instructions with semicolons or newlines. Max 256 instructions, 4096 assembled bytes.',
      )
      .enum('action', ['assemble', 'assemble_at'], 'Operation mode')
      .string(
        'code',
        'Assembly instructions as semicolon-separated or newline-separated string. ' +
          'Example: "mov rax, 0x1234; nop; ret"',
      )
      .number(
        'address',
        'Base address for relative instructions (action=assemble, optional — default 0)',
      )
      .number('pid', 'Target process ID (action=assemble_at)')
      .string('targetAddress', 'Address to write assembled bytes to, hex (action=assemble_at)')
      .boolean('dryRun', 'Preview without writing (action=assemble_at, default: false)')
      .required('action', 'code'),
  ),

  // ── Address Bookmark Tool (cross-platform) ──
  tool('memory_bookmark', (t) =>
    t
      .desc(
        'Manage address bookmarks for a process. Actions: add (bookmark an address with optional label and color), ' +
          'remove (delete a bookmark), list (show all bookmarks for the PID), clear (remove all bookmarks for the PID). ' +
          'Labels help categorize findings; colors use hex format (e.g. "#FF0000"). Bookmarks are scoped per PID. ' +
          'For long-term persistence, export via state_board_io with namespace "memory_bookmarks:<pid>".',
      )
      .enum('action', ['add', 'remove', 'list', 'clear', 'export'], 'Bookmark operation')
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('address', 'Address to bookmark (hex, required for add/remove)')
      .string('label', 'User-defined label for the bookmark (optional)')
      .string('color', 'Hex color string for categorization (optional, e.g. "#FF0000")')
      .required('action')
      .query(),
  ),

  // ── Type Definition Override (x64dbg/ReClass parity) ──
  tool('memory_type_define', (t) =>
    t
      .desc(
        'Override field types in an inferred structure. ' +
          'Actions: set (define a type at offset+size), list (show all overrides), ' +
          'clear (remove all overrides). Overrides are applied in subsequent memory_structure_analyze calls. ' +
          'Supported types: int8, uint8, int16, uint16, int32, uint32, int64, uint64, ' +
          'float, double, pointer, string_ptr, vtable_ptr, hex, padding, unknown.',
      )
      .enum('action', ['set', 'list', 'clear'], 'Operation mode', { default: 'set' })
      .number('offset', 'Byte offset of the field to override (action=set)')
      .number('size', 'Byte size of the field (action=set)')
      .string('type', 'Type name to assign (action=set, e.g. "int32", "float", "pointer")')
      .required('action')
      .query(),
  ),

  // ── Emulator Detection (ArtMoney parity) ──
  tool('memory_emulator_detect', (t) =>
    t
      .desc(
        'Detect if a target process is a known console emulator (ArtMoney parity). ' +
          'Supports: PCSX2, Dolphin, RPCS3, Yuzu, Cemu, ePSXe, PPSSPP, xemu. ' +
          'Detection uses process name matching + optional module fingerprint confirmation. ' +
          'Returns emulator name, platform, and known memory region layout for emulator-mode scanning. ' +
          'Set list=true to enumerate all known emulators without a process check.',
      )
      .string('processName', 'Process executable name (e.g. "pcsx2.exe", "dolphin-emu.exe")')
      .array(
        'moduleNames',
        { type: 'string' },
        'Optional loaded module names for fingerprint confirmation',
      )
      .boolean('list', 'List all known emulators instead of detecting (default: false)')
      .required()
      .query(),
  ),

  // ── Auto Assembler (CE parity) ──
  tool('memory_auto_assemble', (t) =>
    t
      .desc(
        'Execute a Cheat Engine-style Auto Assembler script. ' +
          'Parses [ENABLE]/[DISABLE] sections and executes ENABLE commands. ' +
          'Supported commands: ALLOC(name,size), DEALLOC(name), LABEL(name[,addr]), ' +
          'REGISTERSYMBOL(name), AOBSCAN(name,pattern), ASSERT(address,bytes), ' +
          'CREATETHREAD(address), DEFINE(name,value), FULLACCESS(address,size), ' +
          'READMEM(address,size), WRITEMEM(address,bytes). ' +
          'INCLUDE and LOADBINARY are rejected for security. ' +
          'Returns a disableScript for use with memory_auto_assemble_disable. ' +
          'Win32 only — requires native process access.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string('script', 'Auto Assembler script string with [ENABLE] and [DISABLE] sections')
      .required('script')
      .destructive(),
  ),
  tool('memory_auto_assemble_disable', (t) =>
    t
      .desc(
        'Execute the DISABLE section of a previously-run Auto Assembler script. ' +
          'Pass the disableScript returned by memory_auto_assemble. ' +
          'Executes DISABLE commands, running DEALLOC last (CE convention). ' +
          'Win32 only — requires native process access.',
      )
      .number('pid', 'Target process ID (optional when a browser session is attached)')
      .string(
        'disableScript',
        'JSON string of the disableScript object returned by memory_auto_assemble',
      )
      .required('disableScript')
      .destructive(),
  ),
  // ── EPT Hypervisor ───────────────────────────────────────────────────
  tool('memory_hypervisor', (t) =>
    t
      .desc(
        'EPT Hypervisor Phase 1: VMXON, VMCS setup, basic VM-exit handler design, CPUID spoofing. ' +
          'Intel VT-x only. Requires BYOVD kernel driver for MSR reads and VMXON region preparation. ' +
          'Gate: JSHOOK_HYPERVISOR_ENABLE=1 + admin. ' +
          'Actions: capabilities (detect VT-x/EPT/VPID, MSR values, Hyper-V conflicts), ' +
          'load (validate readiness + build VMCS config), ' +
          'unload (reset state), status (runtime state). ' +
          'NOTE: Actual VMXON/VMLAUNCH execution requires a kernel-mode component (not yet implemented). ' +
          'Phase 1 provides detection, configuration, and the exit-handler design.',
      )
      .enum(
        'action',
        ['capabilities', 'load', 'unload', 'status'],
        'capabilities=detect VT-x/EPT/VPID support, load=validate + build VMCS config, ' +
          'unload=reset state, status=runtime state',
      )
      .string(
        'detectFirst',
        'Set to "false" to skip auto-detection before load (default: auto-detect)',
      )
      .required('action'),
  ),

  // ── Remote Debugging Stub (ceserver-style) ──────────────────────────
  tool('memory_remote', (t) =>
    t
      .desc(
        'Connect to a remote jshookmcp MCP server via WebSocket for remote debugging. ' +
          'Enables ceserver-style remote memory operations: connect to a remote instance, ' +
          'forward tool calls (memory read/write, process enumerate, etc.), and receive results. ' +
          'Uses JSON-RPC 2.0 over WebSocket with auth token support and auto-reconnect. ' +
          'Actions: connect (establish WebSocket link), disconnect (tear down), ' +
          'status (connection state + stats), forward (proxy a tool call to the remote instance).',
      )
      .enum(
        'action',
        ['connect', 'disconnect', 'status', 'forward'],
        'connect=establish WebSocket link, disconnect=tear down, status=connection state, forward=proxy a tool call',
      )
      .string('url', 'WebSocket URL (e.g. ws://192.168.1.100:17171). Required for connect/forward.')
      .string('authToken', 'Bearer token for authenticated remote connections')
      .number('connectTimeoutMs', 'Connection timeout in ms (default: 10000)')
      .number('requestTimeoutMs', 'Per-request timeout in ms (default: 60000)')
      .string(
        'toolName',
        'Target tool name to forward to the remote instance (e.g. "memory_read"). Required for forward.',
      )
      .object('toolArgs', {}, 'Tool arguments object to forward. Required for forward.')
      .string('proxyId', 'Proxy identifier for reconnecting to an existing session')
      .required('action'),
  ),

  // ── Session Export (structured data dump) ──
  tool('memory_session_export', (t) =>
    t
      .desc(
        "Export a scan session's complete state as structured JSON. " +
          'Returns sessionId, pid, valueType, addresses[], values{}, and metadata. ' +
          'Pure data export — no workflow, no replay. ' +
          'Addresses are capped at 100K with a truncated flag when the cap is hit.',
      )
      .string('sessionId', 'Scan session ID to export')
      .required('sessionId')
      .query(),
  ),

  // ── Freeze Export (structured data dump) ──
  tool('memory_freeze_export', (t) =>
    t
      .desc(
        'Export all active freeze entries as structured JSON. ' +
          'Returns an array of freeze entries with freezeId, pid, address, value, valueType, intervalMs, and active flag. ' +
          'Optional pid filter to scope the export to a single process. ' +
          'Pure data export — no workflow, no replay.',
      )
      .number('pid', 'Target process ID filter (optional — exports all freezes if omitted)')
      .required()
      .query(),
  ),

  // ── Anti-Detection Check (read-only pre-flight audit) ──
  tool('memory_antidetection_check', (t) =>
    t
      .desc(
        'Pre-flight anti-detection security audit. READ-ONLY — no patches or modifications. ' +
          'Checks: (1) ETW/AMSI patch status, (2) debugger attached to self via IsDebuggerPresent, ' +
          '(3) HVCI (Hypervisor-protected Code Integrity) and VBS (Virtualization-Based Security) ' +
          'status via registry, (4) known anti-cheat/EDR/AV/debugger processes via process enumeration. ' +
          'Returns a pass/warn/fail verdict with a 0-100 score, per-check results, and actionable ' +
          'recommendations. All checks are safe, user-mode, read-only operations. ' +
          'For actual hardening, use memory_antidetection action=harden.',
      )
      .boolean(
        'includeDetails',
        'Include detailed per-check results including patch details, ETW monitoring summary, ' +
          'and process info (default: false).',
      )
      .required()
      .query(),
  ),
];
