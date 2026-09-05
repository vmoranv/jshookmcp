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

## Full tool list (17)

| Tool | Description |
| --- | --- |
| `ws_monitor` | Enable or disable WebSocket frame capture. |
| `ws_get_frames` | Get captured WebSocket frames with pagination and payload filter. |
| `ws_get_connections` | Get tracked WebSocket connections, frame counts, and timing metadata. |
| `ws_export_capture` | Export captured WebSocket frames to artifacts/captures as JSON or NDJSON. |
| `ws_send_frame` | Send a frame through a live in-page WebSocket instance retained by ws_monitor(exposeInstances=true). Enables edit-and-resend replay of WebSocket traffic. Only reaches WebSockets created AFTER exposeInstances was enabled (existing sockets are not retroactively reachable). |
| `sse_monitor_enable` | Enable SSE monitoring by injecting EventSource interceptor. |
| `sse_get_events` | Get captured SSE events with filters and pagination. |
| `sse_export_capture` | Export captured SSE events to artifacts/captures as JSON or NDJSON. |
| `grpc_monitor` | Enable or disable live capture of gRPC / gRPC-Web calls. gRPC calls are detected by content-type application/grpc(-web)?(+proto)? on the HTTP/2 response. On loadingFinished the response body is pulled (base64) and split into length-prefixed messages; feed each message payloadBase64 to protobuf_decode_raw to complete the decode chain. Must be enabled before navigating so requests are captured from the start. |
| `grpc_get_calls` | Get captured gRPC / gRPC-Web calls with parsed message summaries. Set fullMessages=true to include the parsed message arrays (each carries payloadBase64 — feed to protobuf_decode_raw). Without fullMessages only per-call counts and flags are returned. |
| `grpc_export_capture` | Export captured gRPC / gRPC-Web calls to artifacts/captures as JSON or NDJSON. |
| `fetch_stream_monitor` | Enable or disable capture of fetch()-based streams. Wraps window.fetch and, for responses with content-type text/event-stream, clones the body and parses the SSE frame stream into events. Covers the LLM / GraphQL-subscription streaming that the EventSource-based sse_monitor_enable misses (fetch + POST + custom headers). Use fetch_stream_get_events to read captured events. |
| `fetch_stream_get_events` | Get events captured by the fetch()-based stream monitor (text/event-stream consumed via fetch). Set fullData=true to include full event data. |
| `fetch_stream_export_capture` | Export events captured by the fetch()-based stream monitor to artifacts/captures as JSON or NDJSON. |
| `webrtc_monitor` | Enable or disable capture of WebRTC data-channel traffic. Wraps RTCPeerConnection in-page (no CDP coverage for RTCDataChannel): intercepts createDataChannel (local channels) and the datachannel event (remote channels), capturing both outbound send() and inbound message events. Use webrtc_get_events to read captured messages. |
| `webrtc_get_events` | Get messages captured by the WebRTC data-channel monitor. Set fullData=true to include full message data. Filter by channel label and direction (sent/received). |
| `webrtc_export_capture` | Export messages captured by the WebRTC data-channel monitor to artifacts/captures as JSON or NDJSON. |
