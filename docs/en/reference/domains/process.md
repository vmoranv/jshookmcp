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

## Full tool list (27)

| Tool | Description |
| --- | --- |
| `process_find` | Search for processes by name pattern. Returns a list of matching processes with PID, name, path, and window information. |
| `process_list` | List all running processes. This is an alias for process_find with an empty pattern. |
| `process_get` | Get detailed information about a specific process by PID, including command line, parent PID, and debug port status. |
| `process_kill` | Terminate a process by PID. Requires appropriate privileges. |
| `process_windows` | Get all window handles for a process. |
| `process_check_debug_port` | Check if a process has a debug port enabled for CDP attachment. |
| `process_launch_debug` | Launch an executable with remote debugging port enabled. |
| `electron_attach` | Attach to an Electron CDP port and optionally evaluate in a matching page. |
| `memory_read` | Read memory from a process at a specific address. Requires elevated privileges. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session. |
| `memory_write` | Write data to process memory at a given address. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session. |
| `memory_scan` | Scan process memory for a pattern or value. Requires elevated privileges. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session. |
| `memory_check_protection` | Check memory protection flags at a specific address. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session. |
| `memory_scan_filtered` | Refine a previous memory scan with filtered addresses. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session. |
| `memory_batch_write` | Write multiple memory patches at once. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session. |
| `memory_dump_region` | Dump a process memory region to a binary file for offline analysis. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session. |
| `memory_list_regions` | List all memory regions in a process with protection flags. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session. |
| `memory_audit_export` | Export the in-memory audit trail for memory operations as JSON. |
| `inject_dll` | Inject a DLL into a target process. Requires elevated privileges. Target process and payload are validated before injection. |
| `inject_shellcode` | Allocate and execute raw shellcode in a target process. Requires elevated privileges. Target process and payload are validated before injection. |
| `check_debug_port` | Check if a process is being debugged using NtQueryInformationProcess (ProcessDebugPort). |
| `enumerate_modules` | List all loaded modules (DLLs) in a process with their base addresses. |
| `process_enum_threads` | Enumerate all threads in a process. Returns thread IDs. Cross-platform: Win32 uses CreateToolhelp32Snapshot; Linux reads /proc/{pid}/task; macOS uses `ps -M`. |
| `process_detect_hollowing` | Detect process hollowing (malware technique that unmaps original process image and injects malicious code). Compares process memory sections (.text, .data, .rdata) with on-disk PE file using SHA-256 hashes. Returns detection result with confidence score and list of differing sections. WARNING: autoRestore=true is HIGH RISK, may crash the target process, and is Win32-only. Cross-platform: Win32 compares PE sections; Linux/macOS compare ELF/Mach-O executable sections via IntegrityScanner (autoRestore unavailable). |
| `process_enum_handles` | Enumerate open handles for a process using NtQuerySystemInformation. Resolves handle type and object name, decodes access masks, identifies security risks (high-privilege handles to sensitive processes, dangerous Token handles, inheritable sensitive handles, Section handles to executables). Skips name resolution for File/EtwRegistration types (known to hang). Requires elevated privileges (run as Administrator). Win32 only. |
| `process_detect_apc` | Detect APC (Asynchronous Procedure Call) injection in a process. Enumerates threads, probes each thread APC queue via NtQueryInformationThread(ThreadApcState), and detects threads in alertable wait state (SleepEx/WaitForMultipleObjectsEx). Returns verdict (clean/suspicious/infected), confidence score, and risk reasons. Requires elevated privileges (run as Administrator). Win32 only. |
| `process_suspend` | Suspend a process for forensic snapshotting. Cross-platform: NtSuspendProcess (Win32), SIGSTOP (Linux), task_suspend (macOS). Pair with process_resume to restore. Use before memory_scan/dump for a consistent snapshot. Requires admin/root on most platforms. |
| `process_resume` | Resume a previously suspended process. Cross-platform: NtResumeProcess (Win32), SIGCONT (Linux), task_resume (macOS). |
