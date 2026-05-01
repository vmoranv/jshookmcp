# Memory

Domain: `memory`

Memory analysis domain for native scans, pointer-chain discovery, structure inference, and breakpoint-based observation.

## Profiles

- full

## Typical scenarios

- Run first/next scans to narrow target values
- Analyze pointer chains and in-memory structures
- Manage scan sessions and memory breakpoints

## Common combinations

- memory + process
- memory + debugger
- memory + workflow

## Representative tools

- `memory_first_scan` — Start a new memory scan session.
- `memory_next_scan` — Narrow an existing scan session.
- `memory_unknown_scan` — Start an unknown initial value scan.
- `memory_pointer_scan` — Find pointers to a target address.
- `memory_group_scan` — Search for multiple values at known offsets simultaneously.
- `memory_scan_session` — Manage scan sessions. Actions: list (all sessions), delete (by sessionId), export (as JSON).
- `memory_pointer_chain` — Multi-level pointer chain operations.
- `memory_structure_analyze` — Analyze memory at an address to infer data structure layout.
- `memory_vtable_parse` — Parse a vtable to enumerate virtual function pointers and resolve them to module+offset. Also attempts RTTI parsing for class name and inheritance hierarchy.
- `memory_structure_export_c` — Export an inferred structure as a C-style struct definition with offset comments and type annotations.

## Full tool list (30)

| Tool | Description |
| --- | --- |
| `memory_first_scan` | Start a new memory scan session. |
| `memory_next_scan` | Narrow an existing scan session. |
| `memory_unknown_scan` | Start an unknown initial value scan. |
| `memory_pointer_scan` | Find pointers to a target address. |
| `memory_group_scan` | Search for multiple values at known offsets simultaneously. |
| `memory_scan_session` | Manage scan sessions. Actions: list (all sessions), delete (by sessionId), export (as JSON). |
| `memory_pointer_chain` | Multi-level pointer chain operations. |
| `memory_structure_analyze` | Analyze memory at an address to infer data structure layout. |
| `memory_vtable_parse` | Parse a vtable to enumerate virtual function pointers and resolve them to module+offset. Also attempts RTTI parsing for class name and inheritance hierarchy. |
| `memory_structure_export_c` | Export an inferred structure as a C-style struct definition with offset comments and type annotations. |
| `memory_structure_compare` | Compare two structure instances to identify which fields differ (dynamic values like health/position) vs which are constant (vtable, type flags). Useful for finding important fields. |
| `memory_breakpoint` | Hardware breakpoint operations using x64 debug registers (DR0-DR3). Max 4 concurrent. |
| `memory_patch_bytes` | Write bytes to target process at address. Saves original bytes for undo. Use for runtime code patching. |
| `memory_patch_nop` | NOP out instructions at address (replace with 0x90). Useful for disabling checks or jumps. |
| `memory_patch_undo` | Undo a previous patch by restoring the original bytes. |
| `memory_code_caves` | Find code caves (runs of 0x00 or 0xCC) in executable sections of loaded modules. Returns largest caves first. |
| `memory_write_value` | Write a typed value to a memory address. Supports undo/redo via memory_write_history(action=undo\|redo). |
| `memory_freeze` | Freeze or unfreeze a memory address. Freeze continuously writes a value to prevent changes; unfreeze stops it. |
| `memory_dump` | Dump memory region as hex with ASCII column. Outputs a formatted hex dump similar to xxd. |
| `memory_speedhack` | Speedhack: hook time APIs to scale process time. Speed 2.0 = 2x faster, 0.5 = half speed. |
| `memory_write_history` | Undo or redo the last memory write operation. |
| `memory_heap_enumerate` | Enumerate all heaps and heap blocks in a process via Toolhelp32 snapshot. Returns heap list with block counts, sizes, and overall statistics. |
| `memory_heap_stats` | Get detailed heap statistics with size distribution buckets (0-64B, 64B-1KB, 1-64KB, 64KB-1MB, &gt;1MB), fragmentation ratio, and aggregate metrics. |
| `memory_heap_anomalies` | Detect heap anomalies: heap spray patterns (many same-size blocks), possible use-after-free (non-zero free blocks), and suspicious block sizes (0 or &gt;100MB). |
| `memory_pe_headers` | Parse PE headers (DOS, NT, File, Optional) from a module base address in process memory. Returns machine type, entry point, image base, section count, and data directory info. |
| `memory_pe_imports_exports` | Parse import and/or export tables from a PE module in process memory. Returns DLL names, function names, ordinals, hints, and forwarded exports. |
| `memory_inline_hook_detect` | Detect inline hooks by comparing the first 16 bytes of each exported function on disk vs in memory. Identifies JMP rel32, JMP abs64, PUSH+RET hooks and decodes jump targets. |
| `memory_anticheat_detect` | Scan process imports for anti-debug/anti-cheat mechanisms: IsDebuggerPresent, NtQueryInformationProcess, timing checks (QPC, GetTickCount), thread hiding, heap flag checks, and DR register inspection. Each detection includes a bypass suggestion. |
| `memory_guard_pages` | Find all memory regions with PAGE_GUARD protection in a process. Guard pages are often used as anti-tampering mechanisms or stack overflow detection. |
| `memory_integrity_check` | Check executable memory regions against their corresponding on-disk PE files (.text sections) to detect modifications like inline hooks or code patches. |
