# Streaming

Domain: `streaming`

WebSocket and SSE monitoring domain.

## Profiles

- full

## Typical scenarios

- Capture WebSocket frames
- Monitor SSE events

## Common combinations

- browser + streaming + network

## Representative tools

- `ws_monitor_enable` — Enable WebSocket frame capture via CDP Network events
- `ws_monitor_disable` — Disable WebSocket monitoring and return capture summary
- `ws_get_frames` — Get captured WebSocket frames with pagination and payload filter
- `ws_get_connections` — Get tracked WebSocket connections and frame counts
- `sse_monitor_enable` — Enable SSE monitoring by injecting EventSource interceptor
- `sse_get_events` — Get captured SSE events with filters and pagination

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `ws_monitor_enable` | Enable WebSocket frame capture via CDP Network events |
| `ws_monitor_disable` | Disable WebSocket monitoring and return capture summary |
| `ws_get_frames` | Get captured WebSocket frames with pagination and payload filter |
| `ws_get_connections` | Get tracked WebSocket connections and frame counts |
| `sse_monitor_enable` | Enable SSE monitoring by injecting EventSource interceptor |
| `sse_get_events` | Get captured SSE events with filters and pagination |
