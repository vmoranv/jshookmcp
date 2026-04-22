# Process

Domain: `process`

Process, module, memory diagnostics, and controlled injection domain for host-level inspection, troubleshooting, and Windows process experimentation workflows.

## Profiles

- full

## Typical scenarios

- Enumerate processes and inspect modules
- Diagnose memory failures and export audit trails
- Perform controlled DLL/shellcode injection in opt-in environments

## Common combinations

- process + debugger
- process + platform

## Representative tools

- `electron_attach` — Connect to a running Electron app (VS Code, Cursor, etc.) via CDP and inspect...
- `process_windows` — Get all window handles for a process.
- `process_check_debug_port` — Check if a process has a debug port enabled for CDP attachment.
- `process_launch_debug` — Launch an executable with remote debugging port enabled.
- `memory_read` — Read memory from a process at a specific address. Requires elevated privileges.
- `memory_write` — Write data to process memory at a specific address. Requires elevated privileges.
- `memory_scan` — Scan process memory for a pattern or value. Requires elevated privileges.
- `memory_check_protection` — Check memory protection flags at a specific address.
- `memory_scan_filtered` — Scan memory within a filtered set of addresses (secondary scan).
- `memory_batch_write` — Write multiple memory patches at once.

## Full tool list (17)

| Tool | Description |
| --- | --- |
| `electron_attach` | Connect to a running Electron app (VS Code, Cursor, etc.) via CDP and inspect... |
| `process_windows` | Get all window handles for a process. |
| `process_check_debug_port` | Check if a process has a debug port enabled for CDP attachment. |
| `process_launch_debug` | Launch an executable with remote debugging port enabled. |
| `memory_read` | Read memory from a process at a specific address. Requires elevated privileges. |
| `memory_write` | Write data to process memory at a specific address. Requires elevated privileges. |
| `memory_scan` | Scan process memory for a pattern or value. Requires elevated privileges. |
| `memory_check_protection` | Check memory protection flags at a specific address. |
| `memory_scan_filtered` | Scan memory within a filtered set of addresses (secondary scan). |
| `memory_batch_write` | Write multiple memory patches at once. |
| `memory_dump_region` | Dump a memory region to a file for analysis. |
| `memory_list_regions` | List all memory regions in a process with protection flags. |
| `memory_audit_export` | Export the in-memory audit trail for memory operations as JSON. |
| `inject_dll` | Inject a DLL into a target process using CreateRemoteThread + LoadLibraryA (W... |
| `inject_shellcode` | Inject and execute shellcode in a target process. |
| `check_debug_port` | Check if a process is being debugged using NtQueryInformationProcess (ProcessDebugPort). |
| `enumerate_modules` | List all loaded modules (DLLs) in a process with their base addresses. |
