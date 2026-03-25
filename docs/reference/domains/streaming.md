# Streaming

域名：`streaming`

WebSocket 与 SSE 监控域。

## Profile

- workflow
- full

## 典型场景

- WS 帧采集
- SSE 事件监控

## 常见组合

- browser + streaming + network

## 代表工具

- `ws_monitor_enable` — 启用 WebSocket 帧捕获监控。
- `ws_monitor_disable` — 禁用 WebSocket 监控并返回摘要。
- `ws_get_frames` — 获取已捕获的 WebSocket 帧，支持分页与载荷过滤。
- `ws_get_connections` — 获取已跟踪的 WebSocket 连接及帧统计。
- `sse_monitor_enable` — 启用 SSE 事件流监控。
- `sse_get_events` — 获取已捕获的 SSE 事件，支持过滤与分页。

## 工具清单（6）

| 工具 | 说明 |
| --- | --- |
| `ws_monitor_enable` | 启用 WebSocket 帧捕获监控。 |
| `ws_monitor_disable` | 禁用 WebSocket 监控并返回摘要。 |
| `ws_get_frames` | 获取已捕获的 WebSocket 帧，支持分页与载荷过滤。 |
| `ws_get_connections` | 获取已跟踪的 WebSocket 连接及帧统计。 |
| `sse_monitor_enable` | 启用 SSE 事件流监控。 |
| `sse_get_events` | 获取已捕获的 SSE 事件，支持过滤与分页。 |
