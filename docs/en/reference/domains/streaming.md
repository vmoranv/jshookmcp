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

## Full tool list (6)

<details>
<summary><b>WebSocket</b> (4 tools)</summary>

| Tool                 | Description                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `ws_monitor_enable`  | Enable WebSocket frame capture via CDP Network events (webSocketFrameSent / webSocketFrameReceived). |
| `ws_monitor_disable` | Disable WebSocket monitoring and return capture summary.                                             |
| `ws_get_frames`      | Get captured WebSocket frames with pagination and optional payload regex filter.                     |
| `ws_get_connections` | Get tracked WebSocket connections and frame counts.                                                  |

</details>

<details>
<summary><b>SSE</b> (2 tools)</summary>

| Tool                 | Description                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `sse_monitor_enable` | Enable SSE monitoring by injecting an EventSource constructor interceptor in page context. |
| `sse_get_events`     | Get captured SSE events with filters and pagination.                                       |

</details>
