# Process

域名：`process`

进程、模块、内存诊断与受控注入域，适合宿主级分析、故障排查与 Windows 进程实验场景。

## Profile

- full

## 典型场景

- 进程枚举与模块检查
- 内存失败诊断与审计导出
- 受控环境中的 DLL/Shellcode 注入

## 常见组合

- process + debugger
- process + platform

## 代表工具

- `electron_attach` — 通过 CDP 连接正在运行的 Electron 应用并执行检查或脚本。
- `process_find` — 按名称模式查找进程，返回 PID、名称、路径和窗口句柄。
- `process_list` — 列出所有正在运行的进程。
- `process_get` — 根据 PID 获取指定进程的详细信息。
- `process_windows` — 获取指定进程关联的全部窗口句柄。
- `process_find_chromium` — 按设计禁用浏览器进程扫描；请改用受管浏览器会话连接。
- `process_check_debug_port` — 检查进程是否启用了可供 CDP 附加的调试端口。
- `process_launch_debug` — 以启用远程调试端口的方式启动可执行文件。
- `process_kill` — 按 PID 终止指定进程。
- `memory_read` — 读取目标进程指定地址的内存内容；失败时返回结构化 diagnostics，包含权限、区域检查、ASLR 提示和建议操作。

## 工具清单（26）

| 工具 | 说明 |
| --- | --- |
| `electron_attach` | 通过 CDP 连接正在运行的 Electron 应用并执行检查或脚本。 |
| `process_find` | 按名称模式查找进程，返回 PID、名称、路径和窗口句柄。 |
| `process_list` | 列出所有正在运行的进程。 |
| `process_get` | 根据 PID 获取指定进程的详细信息。 |
| `process_windows` | 获取指定进程关联的全部窗口句柄。 |
| `process_find_chromium` | 按设计禁用浏览器进程扫描；请改用受管浏览器会话连接。 |
| `process_check_debug_port` | 检查进程是否启用了可供 CDP 附加的调试端口。 |
| `process_launch_debug` | 以启用远程调试端口的方式启动可执行文件。 |
| `process_kill` | 按 PID 终止指定进程。 |
| `memory_read` | 读取目标进程指定地址的内存内容；失败时返回结构化 diagnostics，包含权限、区域检查、ASLR 提示和建议操作。 |
| `memory_write` | 向目标进程指定地址写入内存数据；失败时返回结构化 diagnostics，包含权限、区域检查、ASLR 提示和建议操作。 |
| `memory_scan` | 按模式或数值扫描进程内存；失败时返回结构化 diagnostics，包含权限、区域检查、ASLR 提示和建议操作。 |
| `memory_check_protection` | 检查指定内存地址的保护属性，如可读、可写、可执行。 |
| `memory_protect` | 检查指定内存地址的保护属性。 |
| `memory_scan_filtered` | 在已筛选地址范围内执行二次内存扫描。 |
| `memory_batch_write` | 一次性写入多处内存补丁。 |
| `memory_dump_region` | 将指定内存区域转储到文件以供分析。 |
| `memory_list_regions` | 列出进程中的全部内存区域及其保护标志。 |
| `memory_audit_export` | 导出内存操作审计轨迹为 JSON，并可通过 clear=true 在导出后清空缓冲区。 |
| `inject_dll` | 通过 CreateRemoteThread 与 LoadLibraryA 向目标进程注入 DLL。默认关闭；需设置 ENABLE_INJECTION_TOOLS=true 后启用。 |
| `module_inject_dll` | inject_dll 别名。默认关闭；需设置 ENABLE_INJECTION_TOOLS=true 后启用。 |
| `inject_shellcode` | 向目标进程注入并执行 Shellcode，支持 hex 或 base64。默认关闭；需设置 ENABLE_INJECTION_TOOLS=true 后启用。 |
| `module_inject_shellcode` | inject_shellcode 别名。默认关闭；需设置 ENABLE_INJECTION_TOOLS=true 后启用。 |
| `check_debug_port` | 通过 NtQueryInformationProcess 检查进程是否处于调试状态。 |
| `enumerate_modules` | 列出进程已加载的全部模块及其基址。 |
| `module_list` | 列出进程已加载的全部模块。 |
