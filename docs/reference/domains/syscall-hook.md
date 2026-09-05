# 系统调用挂钩

域名：`syscall-hook`

系统调用挂钩域，提供系统调用监控和映射能力。

## Profile

- full

## 典型场景

- 系统调用监控
- API 挂钩
- 行为分析

## 常见组合

- syscall-hook + process
- syscall-hook + instrumentation

## 工具清单（15）

| 工具 | 说明 |
| --- | --- |
| `syscall_start_monitor` | 使用 ETW、strace 或 dtrace 启动系统调用监控。 |
| `syscall_stop_monitor` | 停止系统调用监控。 |
| `syscall_capture_events` | 从活跃或上一次监控会话中捕获系统调用事件。 |
| `syscall_correlate_js` | 将捕获的系统调用与可能的 JavaScript 函数关联。 |
| `syscall_filter` | 按系统调用名称、PID 或返回值范围过滤已捕获的系统调用事件，可用 errorOnly 仅保留返回错误码的调用。 |
| `syscall_get_stats` | 获取系统调用监控统计。 |
| `syscall_ebpf_trace` | 通过 Linux eBPF/bpftrace 追踪系统调用。需要 root 或 CAP_BPF。 |
| `syscall_resolve_ssn` | 从磁盘 ntdll.dll 解析 NT 系统调用服务号（SSN）。解析导出表提取 Zw* → SSN 映射，并定位 syscall;ret gadget 用于直接调用桩。仅 Win32。 |
| `syscall_direct_invoke` | 直接 NT 系统调用调用指南。解析指定 NT 函数的 SSN，返回桩模板和使用说明，用于进程内直接系统调用，绕过 ntdll.dll 上的用户态钩子。仅 Win32。 |
| `syscall_stack_capture` | 通过调试器集成将捕获的系统调用事件与实时 JS 调用栈关联。超越静态启发式，为系统调用→JS 映射查询实时 CDP 调用栈。无调试器附加时回退到纯启发式模式。 |
| `syscall_trace_compare` | 对比两个系统调用 trace 快照，找出新增/消失的系统调用和频率变化。用于理解某个 JS 操作触发了哪些 OS 调用。采集基线 → 执行操作 → 采集目标 → 对比。 |
| `syscall_trace_export` | 将捕获的系统调用事件导出为可移植的 NDJSON 格式，支持时间范围过滤和去重。同时返回结构化数组和 NDJSON 字符串。 |
| `syscall_ebpf_attach` | 实时 eBPF 系统调用附加——启动 bpftrace 进程，实时捕获结构化 JSON 格式的系统调用事件并直接返回。与 syscall_ebpf_trace（脚本生成器）不同，此工具实际运行 bpftrace 并捕获输出。在非 Linux 或 bpftrace 不可用时回退到脚本模式。需要 bpftrace + CAP_BPF 或 root（Linux）。 |
| `syscall_origin_map` | 构建统一的系统调用→JS 来源映射。集成实时 CDP 调用栈（syscall_stack_capture）和静态时序启发式（syscall_correlate_js），按 JavaScript 函数聚合最近的系统调用事件，让调用方看到哪个 JS 函数触发了哪些系统调用及频率。优先使用调试器栈，启发式填补空缺。 |
| `syscall_pattern_detect` | 扫描捕获的系统调用事件中与逆向工程相关的行为模式：反调试探测（ptrace / IsDebuggerPresent）、系统指纹采集（uname / getuid）、文件系统枚举（openat + getdents）、网络信标（connect / sendto）、进程创建（clone / execve）和 Windows 注册表探测。返回分类的模式及证据。 |
