# Syscall Hook

域名：`syscall-hook`

系统调用挂钩域，提供系统调用监控和映射能力。

## Profile

- workflow
- full

## 典型场景

- 系统调用监控
- API 挂钩
- 行为分析

## 常见组合

- syscall-hook + process
- syscall-hook + hooks

## 代表工具

- `syscall_start_monitor` — 使用 ETW、strace 或 dtrace 启动系统调用监控。
- `syscall_stop_monitor` — 停止系统调用监控。
- `syscall_capture_events` — 从活跃或上一次监控会话中捕获系统调用事件。
- `syscall_correlate_js` — 将捕获的系统调用与可能的 JavaScript 函数关联。
- `syscall_filter` — 按系统调用名称过滤已捕获的系统调用事件。
- `syscall_get_stats` — 获取系统调用监控统计。

## 工具清单（6）

| 工具 | 说明 |
| --- | --- |
| `syscall_start_monitor` | 使用 ETW、strace 或 dtrace 启动系统调用监控。 |
| `syscall_stop_monitor` | 停止系统调用监控。 |
| `syscall_capture_events` | 从活跃或上一次监控会话中捕获系统调用事件。 |
| `syscall_correlate_js` | 将捕获的系统调用与可能的 JavaScript 函数关联。 |
| `syscall_filter` | 按系统调用名称过滤已捕获的系统调用事件。 |
| `syscall_get_stats` | 获取系统调用监控统计。 |
