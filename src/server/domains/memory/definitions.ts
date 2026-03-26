import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

const ScanValueTypeOptions = [
  'byte', 'int8', 'int16', 'uint16', 'int32', 'uint32',
  'int64', 'uint64', 'float', 'double', 'string', 'hex', 'pointer',
] as const;

const ScanCompareModeOptions = [
  'exact', 'unknown_initial', 'changed', 'unchanged', 'increased',
  'decreased', 'greater_than', 'less_than', 'between', 'not_equal',
] as const;

export const memoryScanToolDefinitions: readonly Tool[] = [
  tool('memory_first_scan')
    .desc('Start a new memory scan session. Scans entire process memory for a value and returns matching addresses. Supports all numeric types (byte/int8/int16/uint16/int32/uint32/int64/uint64/float/double/pointer) plus hex/string patterns. Creates a session for iterative narrowing with memory_next_scan.')
    .number('pid', 'Target process ID')
    .string('value', 'Value to search for (as string, e.g. "100", "3.14", "48 65 6C 6C 6F")')
    .enum('valueType', [...ScanValueTypeOptions], 'Data type of the value')
    .number('alignment', 'Alignment in bytes (0=unaligned, 4=4-byte aligned). Default: natural alignment for the type.')
    .number('maxResults', 'Maximum results to return (default: 1,000,000)')
    .prop('regionFilter', {
      type: 'object',
      properties: {
        writable: { type: 'boolean', description: 'Only scan writable regions' },
        executable: { type: 'boolean', description: 'Only scan executable regions' },
        moduleOnly: { type: 'boolean', description: 'Only scan module-backed regions' },
      },
      description: 'Filter which memory regions to scan'
    })
    .required('pid', 'value', 'valueType')
    .openWorld()
    .build(),

  tool('memory_next_scan')
    .desc("Narrow an existing scan session. Re-reads previously matched addresses and filters using a comparison mode. Use after memory_first_scan or memory_unknown_scan to iteratively narrow results (like Cheat Engine's \"Next Scan\").")
    .string('sessionId', 'Scan session ID from a previous scan')
    .enum('mode', [...ScanCompareModeOptions], 'Comparison mode')
    .string('value', 'Target value for exact/greater_than/less_than/between/not_equal modes')
    .string('value2', 'Upper bound value for "between" mode')
    .required('sessionId', 'mode')
    .openWorld()
    .build(),

  tool('memory_unknown_scan')
    .desc('Start an unknown initial value scan. Captures all readable memory addresses of the given type, then use memory_next_scan with "changed"/"unchanged"/"increased"/"decreased" to narrow down. This is the CE equivalent of "Unknown initial value" scan.')
    .number('pid', 'Target process ID')
    .enum('valueType', [...ScanValueTypeOptions], 'Data type to capture')
    .number('alignment', 'Alignment in bytes (default: natural for type)')
    .number('maxResults', 'Maximum addresses to capture (default: 5,000,000)')
    .prop('regionFilter', {
      type: 'object',
      properties: {
        writable: { type: 'boolean' },
        executable: { type: 'boolean' },
        moduleOnly: { type: 'boolean' },
      },
    })
    .required('pid', 'valueType')
    .openWorld()
    .build(),

  tool('memory_pointer_scan')
    .desc('Find pointers to a target address. Scans process memory for pointer-sized values that point to or near the target address (within ±4096 bytes for struct member access).')
    .number('pid', 'Target process ID')
    .string('targetAddress', 'Target address to find pointers to (hex, e.g. "0x7FF612340000")')
    .number('maxResults', 'Maximum results (default: 10,000)')
    .boolean('moduleOnly', 'Only scan module-backed regions')
    .required('pid', 'targetAddress')
    .readOnly()
    .idempotent()
    .openWorld()
    .build(),

  tool('memory_group_scan')
    .desc('Search for multiple values at known offsets simultaneously. Useful for finding structures where you know the relative layout (e.g. health at +0, mana at +4, level at +8).')
    .number('pid', 'Target process ID')
    .array('pattern', {
      type: 'object',
      properties: {
        offset: { type: 'number', description: 'Byte offset from base' },
        value: { type: 'string', description: 'Expected value at offset' },
        type: { type: 'string', enum: [...ScanValueTypeOptions], description: 'Value type at offset' },
      },
      required: ['offset', 'value', 'type'],
    }, 'Array of {offset, value, type} patterns')
    .number('alignment', 'Alignment for base address (default: 4)')
    .number('maxResults', 'Maximum results (default: 1,000,000)')
    .required('pid', 'pattern')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_scan_list')
    .desc('List all active scan sessions, showing PID, value type, match count, scan count, and age.')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_scan_delete')
    .desc('Delete a scan session and free its resources.')
    .string('sessionId', 'Scan session ID to delete')
    .required('sessionId')
    .destructive()
    .idempotent()
    .build(),

  tool('memory_scan_export')
    .desc('Export a scan session as JSON for persistence. Can be imported later to resume the scan workflow.')
    .string('sessionId', 'Scan session ID to export')
    .required('sessionId')
    .readOnly()
    .idempotent()
    .build(),

  // Pointer Chain Tools
  tool('memory_pointer_chain_scan')
    .desc('Multi-level pointer chain scan. Finds stable pointer paths from module-relative bases to a target address. Uses BFS to discover chains like [game.exe+0x1A3C] → [+0x10] → [+0x08] → target. Static chains (module-relative base) survive process restarts.')
    .number('pid', 'Target process ID')
    .string('targetAddress', 'Target address to find pointer chains to (hex)')
    .number('maxDepth', 'Maximum chain depth 1-6 (default: 4)')
    .number('maxOffset', 'Maximum offset at each level in bytes (default: 4096)')
    .boolean('staticOnly', 'Only return chains with module-relative base (default: false)')
    .array('modules', { type: 'string' }, 'Only scan specific modules by name')
    .number('maxResults', 'Maximum chains to return (default: 1000)')
    .required('pid', 'targetAddress')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_pointer_chain_validate')
    .desc('Validate pointer chains by re-dereferencing each link. Returns which chains are still valid and at which level broken chains fail.')
    .number('pid', 'Target process ID')
    .string('chains', 'JSON string of PointerChain[] to validate')
    .required('pid', 'chains')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_pointer_chain_resolve')
    .desc('Resolve a pointer chain to its current target address by dereferencing each link.')
    .number('pid', 'Target process ID')
    .string('chain', 'JSON string of a single PointerChain to resolve')
    .required('pid', 'chain')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_pointer_chain_export')
    .desc('Export pointer chains as JSON for persistence. Can be imported across sessions.')
    .string('chains', 'JSON string of PointerChain[] to export')
    .required('chains')
    .readOnly()
    .idempotent()
    .build(),

  // Structure Analysis Tools
  tool('memory_structure_analyze')
    .desc('Analyze memory at an address to infer data structure layout. Uses heuristics to classify fields as vtable pointers, regular pointers, string pointers, floats, ints, booleans, or padding. Optionally parses RTTI for class name and inheritance chain (MSVC x64).')
    .number('pid', 'Target process ID')
    .string('address', 'Base address of the structure (hex)')
    .number('size', 'Size to analyze in bytes (default: 256)')
    .array('otherInstances', { type: 'string' }, 'Additional instance addresses for cross-comparison')
    .boolean('parseRtti', 'Whether to attempt RTTI parsing (default: true)')
    .required('pid', 'address')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_vtable_parse')
    .desc('Parse a vtable to enumerate virtual function pointers and resolve them to module+offset. Also attempts RTTI parsing for class name and inheritance hierarchy.')
    .number('pid', 'Target process ID')
    .string('vtableAddress', 'Address of the vtable (hex)')
    .required('pid', 'vtableAddress')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_structure_export_c')
    .desc('Export an inferred structure as a C-style struct definition with offset comments and type annotations.')
    .string('structure', 'JSON string of InferredStruct to export')
    .string('name', 'Struct name (defaults to RTTI class name or "UnknownStruct")')
    .required('structure')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_structure_compare')
    .desc('Compare two structure instances to identify which fields differ (dynamic values like health/position) vs which are constant (vtable, type flags). Useful for finding important fields.')
    .number('pid', 'Target process ID')
    .string('address1', 'First instance address (hex)')
    .string('address2', 'Second instance address (hex)')
    .number('size', 'Size to compare in bytes (default: 256)')
    .required('pid', 'address1', 'address2')
    .readOnly()
    .idempotent()
    .build(),

  // Breakpoint Tools
  tool('memory_breakpoint_set')
    .desc('Set a hardware breakpoint using x64 debug registers (DR0-DR3). Max 4 concurrent breakpoints. Supports read/write/readwrite/execute access monitoring.')
    .number('pid', 'Target process ID')
    .string('address', 'Address to watch (hex)')
    .enum('access', ['read', 'write', 'readwrite', 'execute'], 'Access type to trigger on')
    .number('size', 'Watch size in bytes (default: 4)')
    .required('pid', 'address', 'access')
    .destructive()
    .build(),

  tool('memory_breakpoint_remove')
    .desc('Remove a hardware breakpoint by ID and free its debug register.')
    .string('breakpointId', 'Breakpoint ID to remove')
    .required('breakpointId')
    .destructive()
    .idempotent()
    .build(),

  tool('memory_breakpoint_list')
    .desc('List all active hardware breakpoints with hit counts.')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_breakpoint_trace')
    .desc('Trace access to an address: set a temporary breakpoint, collect N hits, then remove. Answers "who reads/writes this address?" by returning instruction addresses and register state for each access.')
    .number('pid', 'Target process ID')
    .string('address', 'Address to trace (hex)')
    .enum('access', ['read', 'write', 'readwrite', 'execute'], 'Access type to trace')
    .number('maxHits', 'Maximum hits to collect (default: 50)')
    .number('timeoutMs', 'Timeout in milliseconds (default: 10000)')
    .required('pid', 'address', 'access')
    .idempotent()
    .build(),

  // Injection Tools
  tool('memory_patch_bytes')
    .desc('Write bytes to target process at address. Saves original bytes for undo. Use for runtime code patching.')
    .number('pid', 'Target process ID')
    .string('address', 'Address to patch (hex)')
    .array('bytes', { type: 'number' }, 'Byte values to write (e.g. [0x90, 0x90])')
    .required('pid', 'address', 'bytes')
    .destructive()
    .openWorld()
    .build(),

  tool('memory_patch_nop')
    .desc('NOP out instructions at address (replace with 0x90). Useful for disabling checks or jumps.')
    .number('pid', 'Target process ID')
    .string('address', 'Address to NOP (hex)')
    .number('count', 'Number of bytes to NOP')
    .required('pid', 'address', 'count')
    .destructive()
    .build(),

  tool('memory_patch_undo')
    .desc('Undo a previous patch by restoring the original bytes.')
    .string('patchId', 'Patch ID to undo')
    .required('patchId')
    .destructive()
    .build(),

  tool('memory_code_caves')
    .desc('Find code caves (runs of 0x00 or 0xCC) in executable sections of loaded modules. Returns largest caves first.')
    .number('pid', 'Target process ID')
    .number('minSize', 'Minimum cave size in bytes (default: 16)')
    .required('pid')
    .readOnly()
    .idempotent()
    .build(),

  // Control Tools
  tool('memory_write_value')
    .desc('Write a typed value to a memory address. Supports undo via memory_write_undo.')
    .number('pid', 'Target process ID')
    .string('address', 'Address to write to (hex)')
    .string('value', 'Value to write (as string)')
    .enum('valueType', [...ScanValueTypeOptions], 'Data type of the value')
    .required('pid', 'address', 'value', 'valueType')
    .destructive()
    .build(),

  tool('memory_freeze')
    .desc('Freeze an address to a value. Continuously writes the value at an interval to prevent changes.')
    .number('pid', 'Target process ID')
    .string('address', 'Address to freeze (hex)')
    .string('value', 'Value to maintain')
    .enum('valueType', [...ScanValueTypeOptions], 'Data type')
    .number('intervalMs', 'Write interval in ms (default: 100)')
    .required('pid', 'address', 'value', 'valueType')
    .destructive()
    .build(),

  tool('memory_unfreeze')
    .desc('Stop freezing a previously frozen address.')
    .string('freezeId', 'Freeze ID to remove')
    .required('freezeId')
    .destructive()
    .idempotent()
    .build(),

  tool('memory_dump')
    .desc('Dump memory region as hex with ASCII column. Outputs a formatted hex dump similar to xxd.')
    .number('pid', 'Target process ID')
    .string('address', 'Start address (hex)')
    .number('size', 'Size to dump in bytes (default: 256)')
    .required('pid', 'address')
    .readOnly()
    .idempotent()
    .build(),

  // Time Tools
  tool('memory_speedhack_apply')
    .desc('Apply speedhack to a process. Hooks time APIs (GetTickCount64, QueryPerformanceCounter) to scale time. Speed 2.0 = 2x faster, 0.5 = half speed.')
    .number('pid', 'Target process ID')
    .number('speed', 'Speed multiplier (e.g. 2.0 for 2x speed)')
    .required('pid', 'speed')
    .destructive()
    .build(),

  tool('memory_speedhack_set')
    .desc('Adjust the speed multiplier of an active speedhack without re-hooking.')
    .number('pid', 'Target process ID')
    .number('speed', 'New speed multiplier')
    .required('pid', 'speed')
    .destructive()
    .idempotent()
    .build(),

  // History Tools
  tool('memory_write_undo')
    .desc('Undo the last memory write operation, restoring the previous value.')
    .destructive()
    .openWorld()
    .build(),

  tool('memory_write_redo')
    .desc('Redo the last undone memory write operation.')
    .destructive()
    .build(),

  // Heap Analysis Tools
  tool('memory_heap_enumerate')
    .desc('Enumerate all heaps and heap blocks in a process via Toolhelp32 snapshot. Returns heap list with block counts, sizes, and overall statistics.')
    .number('pid', 'Target process ID')
    .number('maxBlocks', 'Maximum blocks to enumerate per heap (default: 10000)')
    .required('pid')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_heap_stats')
    .desc('Get detailed heap statistics with size distribution buckets (0-64B, 64B-1KB, 1-64KB, 64KB-1MB, >1MB), fragmentation ratio, and aggregate metrics.')
    .number('pid', 'Target process ID')
    .required('pid')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_heap_anomalies')
    .desc('Detect heap anomalies: heap spray patterns (many same-size blocks), possible use-after-free (non-zero free blocks), and suspicious block sizes (0 or >100MB).')
    .number('pid', 'Target process ID')
    .required('pid')
    .readOnly()
    .idempotent()
    .build(),

  // PE / Module Introspection Tools
  tool('memory_pe_headers')
    .desc('Parse PE headers (DOS, NT, File, Optional) from a module base address in process memory. Returns machine type, entry point, image base, section count, and data directory info.')
    .number('pid', 'Target process ID')
    .string('moduleBase', 'Module base address (hex, e.g. "0x7ff612340000")')
    .required('pid', 'moduleBase')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_pe_imports_exports')
    .desc('Parse import and/or export tables from a PE module in process memory. Returns DLL names, function names, ordinals, hints, and forwarded exports.')
    .number('pid', 'Target process ID')
    .string('moduleBase', 'Module base address (hex)')
    .enum('table', ['imports', 'exports', 'both'], 'Which table to parse', { default: 'both' })
    .required('pid', 'moduleBase')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_inline_hook_detect')
    .desc('Detect inline hooks by comparing the first 16 bytes of each exported function on disk vs in memory. Identifies JMP rel32, JMP abs64, PUSH+RET hooks and decodes jump targets.')
    .number('pid', 'Target process ID')
    .string('moduleName', 'Module name filter (optional — scans all modules if omitted)')
    .required('pid')
    .readOnly()
    .idempotent()
    .build(),

  // Anti-Cheat / Anti-Debug Tools
  tool('memory_anticheat_detect')
    .desc('Scan process imports for anti-debug/anti-cheat mechanisms: IsDebuggerPresent, NtQueryInformationProcess, timing checks (QPC, GetTickCount), thread hiding, heap flag checks, and DR register inspection. Each detection includes a bypass suggestion.')
    .number('pid', 'Target process ID')
    .required('pid')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_guard_pages')
    .desc('Find all memory regions with PAGE_GUARD protection in a process. Guard pages are often used as anti-tampering mechanisms or stack overflow detection.')
    .number('pid', 'Target process ID')
    .required('pid')
    .readOnly()
    .idempotent()
    .build(),

  tool('memory_integrity_check')
    .desc('Check executable memory regions against their corresponding on-disk PE files (.text sections) to detect modifications like inline hooks or code patches.')
    .number('pid', 'Target process ID')
    .required('pid')
    .readOnly()
    .idempotent()
    .build(),
];
