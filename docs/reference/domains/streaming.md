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

- `ws_monitor_enable` — Enable WebSocket frame capture via CDP Network events (webSocketFrameSent / webSocketFrameReceived).
- `ws_monitor_disable` — Disable WebSocket monitoring and return capture summary.
- `ws_get_frames` — Get captured WebSocket frames with pagination and optional payload regex filter.
- `ws_get_connections` — Get tracked WebSocket connections and frame counts.
- `sse_monitor_enable` — Enable SSE monitoring by injecting an EventSource constructor interceptor in page context.
- `sse_get_events` — Get captured SSE events with filters and pagination.

## 工具清单（6）

| 工具                 | 说明                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `ws_monitor_enable`  | Enable WebSocket frame capture via CDP Network events (webSocketFrameSent / webSocketFrameReceived). |
| `ws_monitor_disable` | Disable WebSocket monitoring and return capture summary.                                             |
| `ws_get_frames`      | Get captured WebSocket frames with pagination and optional payload regex filter.                     |
| `ws_get_connections` | Get tracked WebSocket connections and frame counts.                                                  |
| `sse_monitor_enable` | Enable SSE monitoring by injecting an EventSource constructor interceptor in page context.           |
| `sse_get_events`     | Get captured SSE events with filters and pagination.                                                 |
