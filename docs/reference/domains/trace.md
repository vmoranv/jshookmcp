# 追踪

域名：`trace`

时间旅行调试域，录制 CDP 事件并写入 SQLite，支持 SQL 查询与堆快照对比。

## Profile

- full

## 典型场景

- 录制浏览器事件
- SQL 查询跟踪数据
- 堆快照差异对比

## 常见组合

- trace + debugger + browser

## 工具清单（10）

| 工具 | 说明 |
| --- | --- |
| `trace_recording` | 开始或停止时间旅行跟踪录制，数据存入 SQLite 数据库。 |
| `start_trace_recording` | 开始录制 CDP 时间旅行跟踪，捕获 DOM 快照、网络事件、脚本执行和堆状态。 |
| `stop_trace_recording` | 停止跟踪录制，将捕获的事件写入 SQLite 数据库以供查询和回放。 |
| `query_trace_sql` | 对跟踪数据库执行 SQL 查询，可按时间戳、类别或内容搜索录制事件。 |
| `seek_to_timestamp` | 将跟踪回放跳转到指定时间戳，返回该时刻的快照上下文。 |
| `trace_get_samples` | 待补充中文：Query recorded CPU profile samples. mode="top" returns the hottest functions by self time (per-function rollup); mode="function" returns samples for one function; mode="window" returns samples near a timestamp. Ships NO hardcoded hot-function library — ordering is pure data projection, the caller decides what counts as hot. |
| `trace_get_network_flow` | 读取 trace 中按请求聚合的网络流。 |
| `diff_heap_snapshots` | 对比两个堆快照的差异，找出新增、删除和大小变化的对象。 |
| `export_trace` | 将 trace 数据导出为 Chrome Trace Event JSON，并按事件类别生成独立线程轨道和 thread_name 元数据，便于在 chrome://tracing 或 Perfetto 中分析。 |
| `summarize_trace` | 为跟踪数据库生成紧凑的、适用于大语言模型的摘要报告。 |
