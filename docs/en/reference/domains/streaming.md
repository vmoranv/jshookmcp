# Streaming

Domain: `streaming`

WebSocket and SSE monitoring domain.

## Profiles

- workflow
- full

## Typical scenarios

- Capture WebSocket frames
- Monitor SSE events

## Common combinations

- browser + streaming + network

## Representative tools

- `ws_monitor` — Enable or disable WebSocket frame capture via CDP Network events.
- `ws_get_frames` — Get captured WebSocket frames with pagination and payload filter
- `ws_get_connections` — Get tracked WebSocket connections and frame counts
- `sse_monitor_enable` — Enable SSE monitoring by injecting EventSource interceptor
- `sse_get_events` — Get captured SSE events with filters and pagination

## Full tool list (5)

| Tool | Description |
| --- | --- |
| `ws_monitor` | Enable or disable WebSocket frame capture via CDP Network events. |
| `ws_get_frames` | Get captured WebSocket frames with pagination and payload filter |
| `ws_get_connections` | Get tracked WebSocket connections and frame counts |
| `sse_monitor_enable` | Enable SSE monitoring by injecting EventSource interceptor |
| `sse_get_events` | Get captured SSE events with filters and pagination |
