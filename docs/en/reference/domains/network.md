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

## Representative tools

- `network_enable` — Enable network request monitoring. Must be called before page_navigate to capture requests.
- `network_disable` — Disable network request monitoring
- `network_get_status` — Get network monitoring status (enabled, request count, response count)
- `network_get_requests` — Get captured network requests. Large results (>50KB) automatically return a summary with detailId.
- `network_get_response_body` — Get response body for a specific request. Auto-truncates responses >100KB. Use returnSummary=true for large files.
- `network_get_stats` — Get network statistics (total requests, response count, error rate, timing)
- `performance_get_metrics` — Get page performance metrics (Web Vitals: FCP, LCP, FID, CLS)
- `performance_start_coverage` — Start JavaScript and CSS code coverage recording
- `performance_stop_coverage` — Stop coverage recording and return coverage report
- `performance_take_heap_snapshot` — Take a V8 heap memory snapshot

## Full tool list (26)

| Tool | Description |
| --- | --- |
| `network_enable` | Enable network request monitoring. Must be called before page_navigate to capture requests. |
| `network_disable` | Disable network request monitoring |
| `network_get_status` | Get network monitoring status (enabled, request count, response count) |
| `network_get_requests` | Get captured network requests. Large results (&gt;50KB) automatically return a summary with detailId. |
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
| `console_inject_script_monitor` | Inject a monitor that tracks dynamically created script elements |
| `console_inject_xhr_interceptor` | Inject an XHR interceptor to capture AJAX request/response data |
| `console_inject_fetch_interceptor` | Inject a Fetch API interceptor to capture fetch request/response data including headers, body, and timing. |
| `console_clear_injected_buffers` | Clear injected in-page monitoring buffers (XHR/Fetch queues and dynamic script records) without removing interceptors |
| `console_reset_injected_interceptors` | Reset injected interceptors/monitors to recover from stale hook state and allow clean reinjection |
| `console_inject_function_tracer` | Inject a Proxy-based function tracer to log all calls to a named function |
| `network_extract_auth` | Scan all captured network requests and extract authentication credentials (tokens, cookies, API keys, signatures). |
| `network_export_har` | Export all captured network traffic as a standard HAR 1.2 file. |
| `network_replay_request` | Replay a previously captured network request with optional modifications. |
