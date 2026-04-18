# Network

Domain: `network`

Request capture, response extraction, HAR export, safe replay, and performance tracing.

## Profiles

- full

## Typical scenarios

- Capture requests
- Extract auth material
- Replay requests safely
- Record performance traces

## Common combinations

- browser + network
- network + workflow

## Representative tools

- `network_enable` — Enable network request monitoring. Must be called before page_navigate to capture requests.
- `network_disable` — Disable network request monitoring
- `network_get_status` — Get network monitoring status (enabled, request count, response count)
- `network_get_requests` — Get captured network requests. Large results (>25KB) automatically return a summary with detailId.
- `network_get_response_body` — Get response body for a specific request. Auto-truncates responses >100KB. Use returnSummary=true for large files.
- `network_get_stats` — Get network statistics (total requests, response count, error rate, timing)
- `performance_get_metrics` — Get page performance metrics (Web Vitals: FCP, LCP, FID, CLS)
- `performance_start_coverage` — Start JavaScript and CSS code coverage recording
- `performance_stop_coverage` — Stop coverage recording and return coverage report
- `performance_take_heap_snapshot` — Take a V8 heap memory snapshot

## Full tool list (35)

| Tool | Description |
| --- | --- |
| `network_enable` | Enable network request monitoring. Must be called before page_navigate to capture requests. |
| `network_disable` | Disable network request monitoring |
| `network_get_status` | Get network monitoring status (enabled, request count, response count) |
| `network_get_requests` | Get captured network requests. Large results (&gt;25KB) automatically return a summary with detailId. |
| `network_get_response_body` | Get response body for a specific request. Auto-truncates responses &gt;100KB. Use returnSummary=true for large files. |
| `network_get_stats` | Get network statistics (total requests, response count, error rate, timing) |
| `performance_get_metrics` | Get page performance metrics (Web Vitals: FCP, LCP, FID, CLS) |
| `performance_start_coverage` | Start JavaScript and CSS code coverage recording |
| `performance_stop_coverage` | Stop coverage recording and return coverage report |
| `performance_take_heap_snapshot` | Take a V8 heap memory snapshot |
| `performance_trace_start` | Start a Chrome Performance Trace recording using the CDP Tracing domain. |
| `performance_trace_stop` | Stop a running Performance Trace and save the trace file. |
| `profiler_cpu_start` | Start CDP CPU profiling. |
| `profiler_cpu_stop` | Stop CPU profiling, save the profile, and return top hot functions. |
| `profiler_heap_sampling_start` | Start V8 heap allocation sampling. |
| `profiler_heap_sampling_stop` | Stop heap allocation sampling and return the top allocators. |
| `console_get_exceptions` | Get captured uncaught exceptions from the page |
| `console_inject_script_monitor` | Inject a monitor that tracks dynamically created script elements. Use persistent: true to survive page navigations. |
| `console_inject_xhr_interceptor` | Inject an XHR interceptor to capture AJAX request/response data. Use persistent: true for the interceptor to survive page navigations. |
| `console_inject_fetch_interceptor` | Inject a Fetch API interceptor to capture fetch request/response data including headers, body, and timing. |
| `console_clear_injected_buffers` | Clear injected in-page monitoring buffers (XHR/Fetch queues and dynamic script records) without removing interceptors |
| `console_reset_injected_interceptors` | Reset injected interceptors/monitors to recover from stale hook state and allow clean reinjection |
| `console_inject_function_tracer` | Inject a Proxy-based function tracer to log all calls to a named function. Use persistent: true to survive page navigations. |
| `dns_resolve` | Resolve a hostname to IPv4/IPv6 addresses using deterministic server-side DNS lookup. Accepts hostnames or IP literals. Results are sorted by family and address. |
| `dns_reverse` | Perform a reverse DNS lookup (PTR) for an IPv4 or IPv6 literal using deterministic server-side DNS logic. |
| `http_request_build` | Build a raw HTTP/1.x request payload with CRLF line endings. Useful for preparing deterministic request text for http_plain_request or other raw socket tools. |
| `http_plain_request` | Send a raw HTTP request over plain TCP using deterministic server-side logic with DNS pinning, response parsing, and bounded capture. Non-loopback HTTP targets require explicit request-scoped authorization. |
| `http2_probe` | Probe an HTTP/2 endpoint using Node http2 with deterministic DNS pinning and bounded response capture. Reports the negotiated protocol, ALPN result, response headers, status, and a response body snippet. Non-loopback plaintext h2c targets require explicit request-scoped authorization. |
| `http2_frame_build` | Build a raw HTTP/2 binary frame of any supported type (DATA, SETTINGS, PING, WINDOW_UPDATE, RST_STREAM, GOAWAY, or RAW). Returns the 9-byte frame header and full frame as hex strings, ready to send over a tcp_write or tls_write channel for protocol-level fuzzing and injection. |
| `network_extract_auth` | Scan all captured network requests and extract authentication credentials (tokens, cookies, API keys, signatures). |
| `network_export_har` | Export all captured network traffic as a standard HAR 1.2 file. |
| `network_replay_request` | Replay a previously captured network request with optional modifications. |
| `network_intercept_response` | Add response interception rules using CDP Fetch domain. Matched requests will receive a custom response instead of the real server response. |
| `network_intercept_list` | List all active response interception rules with hit statistics. |
| `network_intercept_disable` | Remove interception rules. Provide ruleId to remove a single rule, or all=true to disable all interception. |
