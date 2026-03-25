/**
 * Memory scan domain — tool definitions with Zod schemas.
 *
 * 8 tools for CE-level iterative memory scanning, pointer scanning,
 * group scanning, and session management.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// ── Shared enums ──

type MemoryToolAnnotations = NonNullable<Tool['annotations']>;

const MEMORY_READ_ONLY_TOOLS = new Set([
  'memory_pointer_scan',
  'memory_group_scan',
  'memory_scan_list',
  'memory_scan_export',
  'memory_pointer_chain_scan',
  'memory_pointer_chain_validate',
  'memory_pointer_chain_resolve',
  'memory_pointer_chain_export',
  'memory_structure_analyze',
  'memory_vtable_parse',
  'memory_structure_export_c',
  'memory_structure_compare',
  'memory_breakpoint_list',
  'memory_code_caves',
  'memory_dump',
  'memory_heap_enumerate',
  'memory_heap_stats',
  'memory_heap_anomalies',
  'memory_pe_headers',
  'memory_pe_imports_exports',
  'memory_inline_hook_detect',
  'memory_anticheat_detect',
  'memory_guard_pages',
  'memory_integrity_check',
]);

const MEMORY_DESTRUCTIVE_TOOLS = new Set([
  'memory_scan_delete',
  'memory_breakpoint_set',
  'memory_breakpoint_remove',
  'memory_patch_bytes',
  'memory_patch_nop',
  'memory_patch_undo',
  'memory_write_value',
  'memory_freeze',
  'memory_unfreeze',
  'memory_speedhack_apply',
  'memory_speedhack_set',
  'memory_write_undo',
  'memory_write_redo',
]);

const MEMORY_IDEMPOTENT_TOOLS = new Set([
  ...MEMORY_READ_ONLY_TOOLS,
  'memory_scan_delete',
  'memory_breakpoint_remove',
  'memory_unfreeze',
  'memory_speedhack_set',
]);

const MEMORY_OPEN_WORLD_FALSE_TOOLS = new Set([
  'memory_scan_list',
  'memory_scan_delete',
  'memory_scan_export',
  'memory_breakpoint_list',
  'memory_pointer_chain_export',
  'memory_structure_export_c',
]);

function buildMemoryToolAnnotations(name: string): MemoryToolAnnotations {
  return {
    readOnlyHint: MEMORY_READ_ONLY_TOOLS.has(name),
    destructiveHint: MEMORY_DESTRUCTIVE_TOOLS.has(name),
    idempotentHint: MEMORY_IDEMPOTENT_TOOLS.has(name),
    openWorldHint: !MEMORY_OPEN_WORLD_FALSE_TOOLS.has(name),
  };
}

function withMemoryToolAnnotations(tool: Tool): Tool {
  return {
    ...tool,
    annotations: buildMemoryToolAnnotations(tool.name),
  };
}

const ScanValueTypeEnum = z.enum([
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
]);

const ScanCompareModeEnum = z.enum([
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
]);

// ── Tool definitions ──

const memoryScanToolDefinitionsBase = [
  {
    name: 'memory_first_scan',
    description:
      'Start a new memory scan session. Scans entire process memory for a value and returns matching addresses. ' +
      'Supports all numeric types (byte/int8/int16/uint16/int32/uint32/int64/uint64/float/double/pointer) plus hex/string patterns. ' +
      'Creates a session for iterative narrowing with memory_next_scan.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        value: {
          type: 'string',
          description: 'Value to search for (as string, e.g. "100", "3.14", "48 65 6C 6C 6F")',
        },
        valueType: {
          type: 'string',
          enum: ScanValueTypeEnum.options,
          description: 'Data type of the value',
        },
        alignment: {
          type: 'number',
          description:
            'Alignment in bytes (0=unaligned, 4=4-byte aligned). Default: natural alignment for the type.',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results to return (default: 1,000,000)',
        },
        regionFilter: {
          type: 'object',
          properties: {
            writable: { type: 'boolean', description: 'Only scan writable regions' },
            executable: { type: 'boolean', description: 'Only scan executable regions' },
            moduleOnly: { type: 'boolean', description: 'Only scan module-backed regions' },
          },
          description: 'Filter which memory regions to scan',
        },
      },
      required: ['pid', 'value', 'valueType'],
    },
  },
  {
    name: 'memory_next_scan',
    description:
      'Narrow an existing scan session. Re-reads previously matched addresses and filters using a comparison mode. ' +
      'Use after memory_first_scan or memory_unknown_scan to iteratively narrow results (like Cheat Engine\'s "Next Scan").',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Scan session ID from a previous scan' },
        mode: { type: 'string', enum: ScanCompareModeEnum.options, description: 'Comparison mode' },
        value: {
          type: 'string',
          description: 'Target value for exact/greater_than/less_than/between/not_equal modes',
        },
        value2: { type: 'string', description: 'Upper bound value for "between" mode' },
      },
      required: ['sessionId', 'mode'],
    },
  },
  {
    name: 'memory_unknown_scan',
    description:
      'Start an unknown initial value scan. Captures all readable memory addresses of the given type, ' +
      'then use memory_next_scan with "changed"/"unchanged"/"increased"/"decreased" to narrow down. ' +
      'This is the CE equivalent of "Unknown initial value" scan.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        valueType: {
          type: 'string',
          enum: ScanValueTypeEnum.options,
          description: 'Data type to capture',
        },
        alignment: {
          type: 'number',
          description: 'Alignment in bytes (default: natural for type)',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum addresses to capture (default: 5,000,000)',
        },
        regionFilter: {
          type: 'object',
          properties: {
            writable: { type: 'boolean' },
            executable: { type: 'boolean' },
            moduleOnly: { type: 'boolean' },
          },
        },
      },
      required: ['pid', 'valueType'],
    },
  },
  {
    name: 'memory_pointer_scan',
    description:
      'Find pointers to a target address. Scans process memory for pointer-sized values that point to or near ' +
      'the target address (within ±4096 bytes for struct member access).',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        targetAddress: {
          type: 'string',
          description: 'Target address to find pointers to (hex, e.g. "0x7FF612340000")',
        },
        maxResults: { type: 'number', description: 'Maximum results (default: 10,000)' },
        moduleOnly: { type: 'boolean', description: 'Only scan module-backed regions' },
      },
      required: ['pid', 'targetAddress'],
    },
  },
  {
    name: 'memory_group_scan',
    description:
      'Search for multiple values at known offsets simultaneously. Useful for finding structures where ' +
      'you know the relative layout (e.g. health at +0, mana at +4, level at +8).',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        pattern: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              offset: { type: 'number', description: 'Byte offset from base' },
              value: { type: 'string', description: 'Expected value at offset' },
              type: {
                type: 'string',
                enum: ScanValueTypeEnum.options,
                description: 'Value type at offset',
              },
            },
            required: ['offset', 'value', 'type'],
          },
          description: 'Array of {offset, value, type} patterns',
        },
        alignment: { type: 'number', description: 'Alignment for base address (default: 4)' },
        maxResults: { type: 'number', description: 'Maximum results (default: 1,000,000)' },
      },
      required: ['pid', 'pattern'],
    },
  },
  {
    name: 'memory_scan_list',
    description:
      'List all active scan sessions, showing PID, value type, match count, scan count, and age.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'memory_scan_delete',
    description: 'Delete a scan session and free its resources.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Scan session ID to delete' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'memory_scan_export',
    description:
      'Export a scan session as JSON for persistence. Can be imported later to resume the scan workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Scan session ID to export' },
      },
      required: ['sessionId'],
    },
  },

  // ── Pointer Chain Tools ──

  {
    name: 'memory_pointer_chain_scan',
    description:
      'Multi-level pointer chain scan. Finds stable pointer paths from module-relative bases to a target address. ' +
      'Uses BFS to discover chains like [game.exe+0x1A3C] → [+0x10] → [+0x08] → target. ' +
      'Static chains (module-relative base) survive process restarts.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        targetAddress: {
          type: 'string',
          description: 'Target address to find pointer chains to (hex)',
        },
        maxDepth: { type: 'number', description: 'Maximum chain depth 1-6 (default: 4)' },
        maxOffset: {
          type: 'number',
          description: 'Maximum offset at each level in bytes (default: 4096)',
        },
        staticOnly: {
          type: 'boolean',
          description: 'Only return chains with module-relative base (default: false)',
        },
        modules: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only scan specific modules by name',
        },
        maxResults: { type: 'number', description: 'Maximum chains to return (default: 1000)' },
      },
      required: ['pid', 'targetAddress'],
    },
  },
  {
    name: 'memory_pointer_chain_validate',
    description:
      'Validate pointer chains by re-dereferencing each link. Returns which chains are still valid ' +
      'and at which level broken chains fail.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        chains: { type: 'string', description: 'JSON string of PointerChain[] to validate' },
      },
      required: ['pid', 'chains'],
    },
  },
  {
    name: 'memory_pointer_chain_resolve',
    description:
      'Resolve a pointer chain to its current target address by dereferencing each link.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        chain: { type: 'string', description: 'JSON string of a single PointerChain to resolve' },
      },
      required: ['pid', 'chain'],
    },
  },
  {
    name: 'memory_pointer_chain_export',
    description: 'Export pointer chains as JSON for persistence. Can be imported across sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        chains: { type: 'string', description: 'JSON string of PointerChain[] to export' },
      },
      required: ['chains'],
    },
  },

  // ── Structure Analysis Tools ──

  {
    name: 'memory_structure_analyze',
    description:
      'Analyze memory at an address to infer data structure layout. Uses heuristics to classify fields as ' +
      'vtable pointers, regular pointers, string pointers, floats, ints, booleans, or padding. ' +
      'Optionally parses RTTI for class name and inheritance chain (MSVC x64).',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        address: { type: 'string', description: 'Base address of the structure (hex)' },
        size: { type: 'number', description: 'Size to analyze in bytes (default: 256)' },
        otherInstances: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional instance addresses for cross-comparison',
        },
        parseRtti: {
          type: 'boolean',
          description: 'Whether to attempt RTTI parsing (default: true)',
        },
      },
      required: ['pid', 'address'],
    },
  },
  {
    name: 'memory_vtable_parse',
    description:
      'Parse a vtable to enumerate virtual function pointers and resolve them to module+offset. ' +
      'Also attempts RTTI parsing for class name and inheritance hierarchy.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        vtableAddress: { type: 'string', description: 'Address of the vtable (hex)' },
      },
      required: ['pid', 'vtableAddress'],
    },
  },
  {
    name: 'memory_structure_export_c',
    description:
      'Export an inferred structure as a C-style struct definition with offset comments and type annotations.',
    inputSchema: {
      type: 'object',
      properties: {
        structure: { type: 'string', description: 'JSON string of InferredStruct to export' },
        name: {
          type: 'string',
          description: 'Struct name (defaults to RTTI class name or "UnknownStruct")',
        },
      },
      required: ['structure'],
    },
  },
  {
    name: 'memory_structure_compare',
    description:
      'Compare two structure instances to identify which fields differ (dynamic values like health/position) ' +
      'vs which are constant (vtable, type flags). Useful for finding important fields.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        address1: { type: 'string', description: 'First instance address (hex)' },
        address2: { type: 'string', description: 'Second instance address (hex)' },
        size: { type: 'number', description: 'Size to compare in bytes (default: 256)' },
      },
      required: ['pid', 'address1', 'address2'],
    },
  },

  // ── Breakpoint Tools ──

  {
    name: 'memory_breakpoint_set',
    description:
      'Set a hardware breakpoint using x64 debug registers (DR0-DR3). Max 4 concurrent breakpoints. Supports read/write/readwrite/execute access monitoring.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        address: { type: 'string', description: 'Address to watch (hex)' },
        access: {
          type: 'string',
          enum: ['read', 'write', 'readwrite', 'execute'],
          description: 'Access type to trigger on',
        },
        size: {
          type: 'number',
          enum: [1, 2, 4, 8],
          description: 'Watch size in bytes (default: 4)',
        },
      },
      required: ['pid', 'address', 'access'],
    },
  },
  {
    name: 'memory_breakpoint_remove',
    description: 'Remove a hardware breakpoint by ID and free its debug register.',
    inputSchema: {
      type: 'object',
      properties: {
        breakpointId: { type: 'string', description: 'Breakpoint ID to remove' },
      },
      required: ['breakpointId'],
    },
  },
  {
    name: 'memory_breakpoint_list',
    description: 'List all active hardware breakpoints with hit counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory_breakpoint_trace',
    description:
      'Trace access to an address: set a temporary breakpoint, collect N hits, then remove. Answers "who reads/writes this address?" by returning instruction addresses and register state for each access.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        address: { type: 'string', description: 'Address to trace (hex)' },
        access: {
          type: 'string',
          enum: ['read', 'write', 'readwrite', 'execute'],
          description: 'Access type to trace',
        },
        maxHits: { type: 'number', description: 'Maximum hits to collect (default: 50)' },
        timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default: 10000)' },
      },
      required: ['pid', 'address', 'access'],
    },
  },

  // ── Injection Tools ──

  {
    name: 'memory_patch_bytes',
    description:
      'Write bytes to target process at address. Saves original bytes for undo. Use for runtime code patching.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        address: { type: 'string', description: 'Address to patch (hex)' },
        bytes: {
          type: 'array',
          items: { type: 'number' },
          description: 'Byte values to write (e.g. [0x90, 0x90])',
        },
      },
      required: ['pid', 'address', 'bytes'],
    },
  },
  {
    name: 'memory_patch_nop',
    description:
      'NOP out instructions at address (replace with 0x90). Useful for disabling checks or jumps.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        address: { type: 'string', description: 'Address to NOP (hex)' },
        count: { type: 'number', description: 'Number of bytes to NOP' },
      },
      required: ['pid', 'address', 'count'],
    },
  },
  {
    name: 'memory_patch_undo',
    description: 'Undo a previous patch by restoring the original bytes.',
    inputSchema: {
      type: 'object',
      properties: {
        patchId: { type: 'string', description: 'Patch ID to undo' },
      },
      required: ['patchId'],
    },
  },
  {
    name: 'memory_code_caves',
    description:
      'Find code caves (runs of 0x00 or 0xCC) in executable sections of loaded modules. Returns largest caves first.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        minSize: { type: 'number', description: 'Minimum cave size in bytes (default: 16)' },
      },
      required: ['pid'],
    },
  },

  // ── Control Tools ──

  {
    name: 'memory_write_value',
    description: 'Write a typed value to a memory address. Supports undo via memory_write_undo.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        address: { type: 'string', description: 'Address to write to (hex)' },
        value: { type: 'string', description: 'Value to write (as string)' },
        valueType: {
          type: 'string',
          enum: ScanValueTypeEnum.options,
          description: 'Data type of the value',
        },
      },
      required: ['pid', 'address', 'value', 'valueType'],
    },
  },
  {
    name: 'memory_freeze',
    description:
      'Freeze an address to a value. Continuously writes the value at an interval to prevent changes.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        address: { type: 'string', description: 'Address to freeze (hex)' },
        value: { type: 'string', description: 'Value to maintain' },
        valueType: { type: 'string', enum: ScanValueTypeEnum.options, description: 'Data type' },
        intervalMs: { type: 'number', description: 'Write interval in ms (default: 100)' },
      },
      required: ['pid', 'address', 'value', 'valueType'],
    },
  },
  {
    name: 'memory_unfreeze',
    description: 'Stop freezing a previously frozen address.',
    inputSchema: {
      type: 'object',
      properties: {
        freezeId: { type: 'string', description: 'Freeze ID to remove' },
      },
      required: ['freezeId'],
    },
  },
  {
    name: 'memory_dump',
    description:
      'Dump memory region as hex with ASCII column. Outputs a formatted hex dump similar to xxd.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        address: { type: 'string', description: 'Start address (hex)' },
        size: { type: 'number', description: 'Size to dump in bytes (default: 256)' },
      },
      required: ['pid', 'address'],
    },
  },

  // ── Time Tools ──

  {
    name: 'memory_speedhack_apply',
    description:
      'Apply speedhack to a process. Hooks time APIs (GetTickCount64, QueryPerformanceCounter) to scale time. Speed 2.0 = 2x faster, 0.5 = half speed.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        speed: { type: 'number', description: 'Speed multiplier (e.g. 2.0 for 2x speed)' },
      },
      required: ['pid', 'speed'],
    },
  },
  {
    name: 'memory_speedhack_set',
    description: 'Adjust the speed multiplier of an active speedhack without re-hooking.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        speed: { type: 'number', description: 'New speed multiplier' },
      },
      required: ['pid', 'speed'],
    },
  },

  // ── History Tools ──

  {
    name: 'memory_write_undo',
    description: 'Undo the last memory write operation, restoring the previous value.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory_write_redo',
    description: 'Redo the last undone memory write operation.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Heap Analysis Tools (Phase 4) ──

  {
    name: 'memory_heap_enumerate',
    description:
      'Enumerate all heaps and heap blocks in a process via Toolhelp32 snapshot. ' +
      'Returns heap list with block counts, sizes, and overall statistics.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        maxBlocks: {
          type: 'number',
          description: 'Maximum blocks to enumerate per heap (default: 10000)',
        },
      },
      required: ['pid'],
    },
  },
  {
    name: 'memory_heap_stats',
    description:
      'Get detailed heap statistics with size distribution buckets (0-64B, 64B-1KB, 1-64KB, 64KB-1MB, >1MB), ' +
      'fragmentation ratio, and aggregate metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
      },
      required: ['pid'],
    },
  },
  {
    name: 'memory_heap_anomalies',
    description:
      'Detect heap anomalies: heap spray patterns (many same-size blocks), possible use-after-free (non-zero free blocks), ' +
      'and suspicious block sizes (0 or >100MB).',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
      },
      required: ['pid'],
    },
  },

  // ── PE / Module Introspection Tools (Phase 4) ──

  {
    name: 'memory_pe_headers',
    description:
      'Parse PE headers (DOS, NT, File, Optional) from a module base address in process memory. ' +
      'Returns machine type, entry point, image base, section count, and data directory info.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        moduleBase: {
          type: 'string',
          description: 'Module base address (hex, e.g. "0x7ff612340000")',
        },
      },
      required: ['pid', 'moduleBase'],
    },
  },
  {
    name: 'memory_pe_imports_exports',
    description:
      'Parse import and/or export tables from a PE module in process memory. ' +
      'Returns DLL names, function names, ordinals, hints, and forwarded exports.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        moduleBase: { type: 'string', description: 'Module base address (hex)' },
        table: {
          type: 'string',
          enum: ['imports', 'exports', 'both'],
          description: 'Which table to parse (default: both)',
        },
      },
      required: ['pid', 'moduleBase'],
    },
  },
  {
    name: 'memory_inline_hook_detect',
    description:
      'Detect inline hooks by comparing the first 16 bytes of each exported function on disk vs in memory. ' +
      'Identifies JMP rel32, JMP abs64, PUSH+RET hooks and decodes jump targets.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        moduleName: {
          type: 'string',
          description: 'Module name filter (optional — scans all modules if omitted)',
        },
      },
      required: ['pid'],
    },
  },

  // ── Anti-Cheat / Anti-Debug Tools (Phase 4) ──

  {
    name: 'memory_anticheat_detect',
    description:
      'Scan process imports for anti-debug/anti-cheat mechanisms: IsDebuggerPresent, NtQueryInformationProcess, ' +
      'timing checks (QPC, GetTickCount), thread hiding, heap flag checks, and DR register inspection. ' +
      'Each detection includes a bypass suggestion.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
      },
      required: ['pid'],
    },
  },
  {
    name: 'memory_guard_pages',
    description:
      'Find all memory regions with PAGE_GUARD protection in a process. ' +
      'Guard pages are often used as anti-tampering mechanisms or stack overflow detection.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
      },
      required: ['pid'],
    },
  },
  {
    name: 'memory_integrity_check',
    description:
      'Check code section integrity by comparing SHA-256 hashes of disk bytes vs memory bytes. ' +
      'Detects patches, hooks, and other runtime modifications to executable sections.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Target process ID' },
        moduleName: {
          type: 'string',
          description: 'Module name filter (optional — checks all modules if omitted)',
        },
      },
      required: ['pid'],
    },
  },
] as const satisfies readonly Tool[];

export const memoryScanToolDefinitions: readonly Tool[] =
  memoryScanToolDefinitionsBase.map(withMemoryToolAnnotations);
