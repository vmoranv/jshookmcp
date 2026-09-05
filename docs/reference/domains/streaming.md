# 流式

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

## 工具清单（17）

| 工具 | 说明 |
| --- | --- |
| `ws_monitor` | 通过 CDP Network 事件启用或禁用 WebSocket 帧捕获。 |
| `ws_get_frames` | 获取已捕获的 WebSocket 帧，支持分页、载荷过滤，并可按需返回完整载荷。 |
| `ws_get_connections` | 获取已跟踪的 WebSocket 连接、帧统计、握手状态和连接时序。 |
| `ws_export_capture` | 将已捕获的 WebSocket 帧导出到 artifacts/captures，支持 JSON 或 NDJSON 格式。 |
| `ws_send_frame` | 通过 ws_monitor(exposeInstances=true) 保留的页内 WebSocket 实例发送帧，支持编辑后重发的流量回放。仅能触达 exposeInstances 启用后创建的 WebSocket（已存在的连接无法回溯触达）。 |
| `sse_monitor_enable` | 启用 SSE 事件流监控。 |
| `sse_get_events` | 获取已捕获的 SSE 事件，支持过滤、分页，并可按需返回完整事件数据。 |
| `sse_export_capture` | 将已捕获的 SSE 事件导出到 artifacts/captures，支持 JSON 或 NDJSON 格式。 |
| `grpc_monitor` | 启用/停用 gRPC / gRPC-Web 调用的实时捕获。gRPC 调用通过 HTTP/2 响应的 content-type application/grpc(-web)?(+proto)? 检测。loadingFinished 时拉取响应 body（base64）并拆成长度前缀消息；把每条消息的 payloadBase64 喂给 protobuf_decode_raw 即完成解码链。必须在导航前启用，才能从头捕获请求。 |
| `grpc_get_calls` | 获取已捕获的 gRPC / gRPC-Web 调用及解析出的消息摘要。设 fullMessages=true 返回解析后的消息数组（每条含 payloadBase64，可直接喂 protobuf_decode_raw）；不设则只返回每调用的消息计数与标志。 |
| `grpc_export_capture` | 将捕获的 gRPC / gRPC-Web 调用导出为 artifacts/captures 下的 JSON 或 NDJSON 工件。 |
| `fetch_stream_monitor` | 启用/停用 fetch() 流捕获。包装 window.fetch，对 content-type 为 text/event-stream 的响应克隆 body 并解析 SSE 帧流为事件。覆盖 EventSource 版 sse_monitor_enable 漏掉的 LLM / GraphQL subscription 流量（fetch + POST + 自定义头）。用 fetch_stream_get_events 读取捕获的事件。 |
| `fetch_stream_get_events` | 读取 fetch() 流监控捕获的事件（经 fetch 消费的 text/event-stream）。设 fullData=true 返回完整事件数据。 |
| `fetch_stream_export_capture` | 将 fetch() 流监控捕获的事件导出为 artifacts/captures 下的 JSON 或 NDJSON 工件。 |
| `webrtc_monitor` | 启用/停用 WebRTC 数据通道流量捕获。在页面内包装 RTCPeerConnection（RTCDataChannel 无 CDP 支持）：拦截 createDataChannel（本地通道）与 datachannel 事件（远端通道），同时捕获出站 send() 与入站 message。用 webrtc_get_events 读取捕获的消息。 |
| `webrtc_get_events` | 读取 WebRTC 数据通道监控捕获的消息。设 fullData=true 返回完整消息数据。可按通道 label 与方向（sent/received）过滤。 |
| `webrtc_export_capture` | 将 WebRTC 数据通道监控捕获的消息导出为 artifacts/captures 下的 JSON 或 NDJSON 工件。 |
