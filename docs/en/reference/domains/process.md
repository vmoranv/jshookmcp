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

- `electron_attach` — Connect to a running Electron app (VS Code, Cursor, etc.) via CDP and inspect/execute JS. Useful for debugging Electron applications or extracting extension data.
- `process_find` — Find processes by name pattern. Returns process IDs, names, paths, and window handles.
- `process_list` — List all running processes. Alias of process_find with empty pattern.
- `process_get` — Get detailed information about a specific process by PID.
- `process_windows` — Get all window handles for a process.
- `process_find_chromium` — Disabled by design: does not scan user-installed browser processes. Use managed browser sessions (browser_launch/browser_attach with explicit endpoint) instead.
- `process_check_debug_port` — Check if a process has a debug port enabled for CDP attachment.
- `process_launch_debug` — Launch an executable with remote debugging port enabled.
- `process_kill` — Kill a process by PID.
- `memory_read` — Read memory from a process at a specific address. Failures include structured diagnostics for permissions, region checks, and ASLR guidance.

## Full tool list (26)

| Tool | Description |
| --- | --- |
| `electron_attach` | Connect to a running Electron app (VS Code, Cursor, etc.) via CDP and inspect/execute JS. Useful for debugging Electron applications or extracting extension data. |
| `process_find` | Find processes by name pattern. Returns process IDs, names, paths, and window handles. |
| `process_list` | List all running processes. Alias of process_find with empty pattern. |
| `process_get` | Get detailed information about a specific process by PID. |
| `process_windows` | Get all window handles for a process. |
| `process_find_chromium` | Disabled by design: does not scan user-installed browser processes. Use managed browser sessions (browser_launch/browser_attach with explicit endpoint) instead. |
| `process_check_debug_port` | Check if a process has a debug port enabled for CDP attachment. |
| `process_launch_debug` | Launch an executable with remote debugging port enabled. |
| `process_kill` | Kill a process by PID. |
| `memory_read` | Read memory from a process at a specific address. Failures include structured diagnostics for permissions, region checks, and ASLR guidance. |
| `memory_write` | Write data to process memory at a specific address. Failures include structured diagnostics for permissions, region checks, and ASLR guidance. |
| `memory_scan` | Scan process memory for a pattern or value. Failures include structured diagnostics for permissions, region checks, and ASLR guidance. |
| `memory_check_protection` | Check memory protection flags at a specific address. Detects if memory is writable/readable/executable. |
| `memory_protect` | Alias of memory_check_protection. Check memory protection flags at a specific address. |
| `memory_scan_filtered` | Scan memory within a filtered set of addresses (secondary scan). Useful for narrowing down results. |
| `memory_batch_write` | Write multiple memory patches at once. Useful for applying cheats or modifications. |
| `memory_dump_region` | Dump a memory region to a file for analysis. |
| `memory_list_regions` | List all memory regions in a process with protection flags. |
| `memory_audit_export` | Export the in-memory audit trail for memory operations as JSON. Supports clear=true to flush the buffer after export. |
| `inject_dll` | Inject a DLL into a target process using CreateRemoteThread + LoadLibraryA. Disabled by default; set ENABLE_INJECTION_TOOLS=true to enable. Requires administrator privileges. |
| `module_inject_dll` | Alias of inject_dll. Disabled by default; set ENABLE_INJECTION_TOOLS=true to enable. |
| `inject_shellcode` | Inject and execute shellcode in a target process. Accepts hex or base64. Disabled by default; set ENABLE_INJECTION_TOOLS=true to enable. |
| `module_inject_shellcode` | Alias of inject_shellcode. Disabled by default; set ENABLE_INJECTION_TOOLS=true to enable. |
| `check_debug_port` | Check if a process is being debugged using NtQueryInformationProcess (ProcessDebugPort). |
| `enumerate_modules` | List all loaded modules (DLLs) in a process with their base addresses. |
| `module_list` | Alias of enumerate_modules. List loaded modules (DLLs) in a process. |
