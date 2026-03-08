# Process

域名：`process`

进程、模块与内存域，适合宿主级分析与 Windows 原生注入场景。

## Profile

- full

## 典型场景

- 进程枚举
- 内存扫描
- DLL/Shellcode 注入

## 常见组合

- process + debugger
- process + platform

## 代表工具

- `electron_attach` — Connect to a running Electron app (VS Code, Cursor, etc.) via CDP and inspect/execute JS. Useful for debugging Electron applications or extracting extension data.
- `process_find` — Find processes by name pattern. Returns process IDs, names, paths, and window handles.
- `process_list` — List all running processes. Alias of process_find with empty pattern.
- `process_get` — Get detailed information about a specific process by PID.
- `process_windows` — Get all window handles for a process.
- `process_find_chromium` — Disabled by design: does not scan user-installed browser processes. Use managed browser sessions (browser_launch/browser_attach with explicit endpoint) instead.
- `process_check_debug_port` — Check if a process has a debug port enabled for CDP attachment.
- `process_launch_debug` — Launch an executable with remote debugging port enabled.
- `process_kill` — Kill a process by PID.
- `memory_read` — Read memory from a process at a specific address. Requires process to be attached.

## 工具清单（25）

| 工具                       | 说明                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `electron_attach`          | Connect to a running Electron app (VS Code, Cursor, etc.) via CDP and inspect/execute JS. Useful for debugging Electron applications or extracting extension data. |
| `process_find`             | Find processes by name pattern. Returns process IDs, names, paths, and window handles.                                                                             |
| `process_list`             | List all running processes. Alias of process_find with empty pattern.                                                                                              |
| `process_get`              | Get detailed information about a specific process by PID.                                                                                                          |
| `process_windows`          | Get all window handles for a process.                                                                                                                              |
| `process_find_chromium`    | Disabled by design: does not scan user-installed browser processes. Use managed browser sessions (browser_launch/browser_attach with explicit endpoint) instead.   |
| `process_check_debug_port` | Check if a process has a debug port enabled for CDP attachment.                                                                                                    |
| `process_launch_debug`     | Launch an executable with remote debugging port enabled.                                                                                                           |
| `process_kill`             | Kill a process by PID.                                                                                                                                             |
| `memory_read`              | Read memory from a process at a specific address. Requires process to be attached.                                                                                 |
| `memory_write`             | Write data to process memory at a specific address. Requires process to be attached.                                                                               |
| `memory_scan`              | Scan process memory for a pattern or value. Useful for finding game values.                                                                                        |
| `memory_check_protection`  | Check memory protection flags at a specific address. Detects if memory is writable/readable/executable.                                                            |
| `memory_protect`           | Alias of memory_check_protection. Check memory protection flags at a specific address.                                                                             |
| `memory_scan_filtered`     | Scan memory within a filtered set of addresses (secondary scan). Useful for narrowing down results.                                                                |
| `memory_batch_write`       | Write multiple memory patches at once. Useful for applying cheats or modifications.                                                                                |
| `memory_dump_region`       | Dump a memory region to a file for analysis.                                                                                                                       |
| `memory_list_regions`      | List all memory regions in a process with protection flags.                                                                                                        |
| `inject_dll`               | Inject a DLL into a target process using CreateRemoteThread + LoadLibraryA. Requires administrator privileges.                                                     |
| `module_inject_dll`        | Alias of inject_dll. Inject a DLL into a target process.                                                                                                           |
| `inject_shellcode`         | Inject and execute shellcode in a target process. Uses VirtualAllocEx + WriteProcessMemory + CreateRemoteThread.                                                   |
| `module_inject_shellcode`  | Alias of inject_shellcode. Inject and execute shellcode in a target process.                                                                                       |
| `check_debug_port`         | Check if a process is being debugged using NtQueryInformationProcess (ProcessDebugPort).                                                                           |
| `enumerate_modules`        | List all loaded modules (DLLs) in a process with their base addresses.                                                                                             |
| `module_list`              | Alias of enumerate_modules. List loaded modules (DLLs) in a process.                                                                                               |
