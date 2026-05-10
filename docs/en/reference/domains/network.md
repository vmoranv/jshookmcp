# Network

Domain: `network`

Request capture, response extraction, HAR export, safe replay, and performance tracing.

## Profiles

- workflow
- full

## Typical scenarios

- Capture requests
- Extract auth material
- Replay requests safely
- Record performance traces

## Common combinations

- browser + network
- network + workflow

## Full tool list (31)

| Tool | Description |
| --- | --- |
| `network_enable` | Enable network request monitoring. |
| `network_disable` | Disable network request monitoring |
| `network_get_status` | Get network monitoring status. |
| `network_monitor` | Manage network request monitoring. |
| `network_get_requests` | Get captured network requests. |
| `network_get_response_body` | Get the response body for a captured request. |
| `network_get_stats` | Get network statistics. |
| `performance_get_metrics` | Get page performance metrics. |
| `performance_coverage` | Start or stop code coverage recording. |
| `performance_take_heap_snapshot` | Take a V8 heap memory snapshot |
| `performance_trace` | Start or stop a Chrome performance trace. |
| `profiler_cpu` | Start or stop CPU profiling. |
| `profiler_heap_sampling` | Start or stop heap allocation sampling. |
| `console_get_exceptions` | Get captured uncaught exceptions from the page |
| `console_inject` | Inject an in-page script, XHR, fetch, or function monitor. |
| `console_inject_fetch_interceptor` | Inject a fetch interceptor. |
| `console_inject_xhr_interceptor` | Inject an XMLHttpRequest interceptor. |
| `console_buffers` | Manage injected interceptor state. |
| `http_request_build` | Build a raw HTTP/1.x request payload. |
| `http_plain_request` | Send a raw HTTP request over plain TCP. |
| `http2_probe` | Probe an HTTP/2 endpoint. |
| `http2_frame_build` | Build a raw HTTP/2 frame. |
| `network_rtt_measure` | Measure round-trip time to a target URL. |
| `network_traceroute` | Run an ICMP traceroute. |
| `network_icmp_probe` | Run an ICMP echo probe. |
| `network_extract_auth` | Extract authentication data from captured network requests. |
| `network_export_har` | Export captured network traffic as HAR. |
| `network_replay_request` | Replay a captured network request with optional changes. |
| `network_intercept` | Manage network interception rules. |
| `network_tls_fingerprint` | Compute TLS/HTTP fingerprint hashes for bot detection. |
| `network_bot_detect_analyze` | Analyze captured requests for bot-detection signals. |
