# 进程

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

## 工具清单（27）

| 工具 | 说明 |
| --- | --- |
| `process_find` | 按名称模式搜索进程，返回匹配进程的 PID、名称、路径和窗口信息。 |
| `process_list` | 列出所有正在运行的进程，等同于空模式的 process_find。 |
| `process_get` | 获取指定 PID 进程的详细信息，包括命令行、父进程 PID 和调试端口状态。 |
| `process_kill` | 终止指定 PID 的进程，需要适当的权限。 |
| `process_windows` | 获取指定进程关联的全部窗口句柄。 |
| `process_check_debug_port` | 检查目标进程是否已开启可用于 CDP 附加的调试端口。 |
| `process_launch_debug` | 以启用远程调试端口的方式启动可执行文件。 |
| `electron_attach` | 通过 CDP 连接正在运行的 Electron 应用并执行检查或脚本。 |
| `memory_read` | 读取目标进程指定地址的内存内容。需要提权。失败时返回结构化 diagnostics。 |
| `memory_write` | 向目标进程指定地址写入内存数据。需要提权。失败时返回结构化 diagnostics。 |
| `memory_scan` | 按模式或数值扫描进程内存。需要提权。失败时返回结构化 diagnostics。 |
| `memory_check_protection` | 检查指定内存地址的保护属性，如可读、可写、可执行。 |
| `memory_scan_filtered` | 在已筛选地址范围内执行二次内存扫描。 |
| `memory_batch_write` | 一次性写入多处内存补丁。 |
| `memory_dump_region` | 将指定内存区域转储到文件以供分析。 |
| `memory_list_regions` | 列出进程中的全部内存区域及其保护标志。 |
| `memory_audit_export` | 导出内存操作审计轨迹为 JSON，并可通过 clear=true 在导出后清空缓冲区。 |
| `inject_dll` | 通过 CreateRemoteThread 与 LoadLibraryA (Windows) 或 gdb/lldb (Linux/macOS) 向目标进程注入 DLL 或 shared object。需要高权限，并会先执行目标进程与载荷校验。 |
| `inject_shellcode` | 向目标进程注入并执行 Shellcode，支持 hex 或 base64。需要高权限，并会先执行目标进程与载荷校验。 |
| `check_debug_port` | 通过 NtQueryInformationProcess 检查进程是否处于调试状态。 |
| `enumerate_modules` | 列出进程中所有已加载模块（DLL）及其基址。 |
| `process_enum_threads` | 枚举进程中的所有线程并返回线程 ID。Win32 使用 CreateToolhelp32Snapshot；Linux 读取 /proc/{pid}/task；macOS 使用 ps -M。跨平台。 |
| `process_detect_hollowing` | 检测进程镂空攻击（恶意软件取消映射原始进程镜像并注入恶意代码）。对比进程内存节区（.text/.data/.rdata）与磁盘 PE 文件的 SHA-256 哈希。Win32 走 PE 比对，Linux/macOS 走 IntegrityScanner ELF/Mach-O 段哈希回退。返回检测结果、置信度和差异节区列表。autoRestore=true 高危，可能导致目标进程崩溃。 |
| `process_enum_handles` | 使用 NtQuerySystemInformation 枚举进程的打开句柄。解析句柄类型和对象名，解码访问掩码，识别安全风险（对敏感进程的高权限句柄、危险的 Token 句柄、可继承的敏感句柄、指向可执行文件的 Section 句柄）。跳过 File/EtwRegistration 类型的名称解析（已知会挂起）。需要提权（以管理员身份运行）。仅 Win32。 |
| `process_detect_apc` | 检测进程中的 APC（异步过程调用）注入。枚举线程，通过 NtQueryInformationThread(ThreadApcState) 探测每个线程的 APC 队列，并检测处于可警告等待状态（SleepEx/WaitForMultipleObjectsEx）的线程。返回判定（clean/suspicious/infected）、置信度和风险原因。需要提权（以管理员身份运行）。仅 Win32。 |
| `process_suspend` | 暂停进程以获取一致的取证快照。跨平台实现：Win32 使用 NtSuspendProcess，Linux 使用 SIGSTOP，macOS 使用 task_suspend。通常与 process_resume 配对使用，可在 memory_scan/dump 前稳定目标状态；多数平台需要管理员/root 权限。 |
| `process_resume` | 恢复先前暂停的进程。跨平台实现：Win32 使用 NtResumeProcess，Linux 使用 SIGCONT，macOS 使用 task_resume。 |
