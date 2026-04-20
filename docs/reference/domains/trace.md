# Trace

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

## 代表工具

- `trace_recording` — 开始或停止时间旅行跟踪录制，数据存入 SQLite 数据库。
- `query_trace_sql` — 对跟踪数据库执行 SQL 查询，可按时间戳、类别或内容搜索录制事件。
- `seek_to_timestamp` — 将跟踪回放跳转到指定时间戳，返回该时刻的快照上下文。
- `diff_heap_snapshots` — 对比两个堆快照的差异，找出新增、删除和大小变化的对象。
- `export_trace` — 将跟踪数据导出为标准格式文件，便于外部工具分析或团队共享。
- `summarize_trace` — 为跟踪数据库生成紧凑的、适用于大语言模型的摘要报告。

## 工具清单（6）

| 工具 | 说明 |
| --- | --- |
| `trace_recording` | 开始或停止时间旅行跟踪录制，数据存入 SQLite 数据库。 |
| `query_trace_sql` | 对跟踪数据库执行 SQL 查询，可按时间戳、类别或内容搜索录制事件。 |
| `seek_to_timestamp` | 将跟踪回放跳转到指定时间戳，返回该时刻的快照上下文。 |
| `diff_heap_snapshots` | 对比两个堆快照的差异，找出新增、删除和大小变化的对象。 |
| `export_trace` | 将跟踪数据导出为标准格式文件，便于外部工具分析或团队共享。 |
| `summarize_trace` | 为跟踪数据库生成紧凑的、适用于大语言模型的摘要报告。 |
