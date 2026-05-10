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

## Full tool list (17)

| Tool | Description |
| --- | --- |
| `electron_attach` | Attach to an Electron CDP port and optionally evaluate in a matching page. |
| `process_windows` | Get all window handles for a process. |
| `process_check_debug_port` | Check if a process has a debug port enabled for CDP attachment. |
| `process_launch_debug` | Launch an executable with remote debugging port enabled. |
| `memory_read` | Read memory from a process at a specific address. Requires elevated privileges. |
| `memory_write` | Write data to process memory at a given address. |
| `memory_scan` | Scan process memory for a pattern or value. Requires elevated privileges. |
| `memory_check_protection` | Check memory protection flags at a specific address. |
| `memory_scan_filtered` | Refine a previous memory scan with filtered addresses. |
| `memory_batch_write` | Write multiple memory patches at once. |
| `memory_dump_region` | Dump a process memory region to a binary file for offline analysis. |
| `memory_list_regions` | List all memory regions in a process with protection flags. |
| `memory_audit_export` | Export the in-memory audit trail for memory operations as JSON. |
| `inject_dll` | Inject a DLL into a target process. |
| `inject_shellcode` | Allocate and execute raw shellcode in a target process. |
| `check_debug_port` | Check if a process is being debugged using NtQueryInformationProcess (ProcessDebugPort). |
| `enumerate_modules` | List all loaded modules (DLLs) in a process with their base addresses. |
