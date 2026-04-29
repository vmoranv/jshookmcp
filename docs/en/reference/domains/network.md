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
- `network_monitor` — Manage network request monitoring. Enable/disable monitoring or check status. Must enable before page_navigate to capture requests.
- `network_get_requests` — Get captured network requests. Large results (>25KB) automatically return a summary with detailId.
- `network_get_response_body` — Get response body for a specific request. Auto-truncates responses >100KB. Use returnSummary=true for large files.
- `network_get_stats` — Get network statistics (total requests, response count, error rate, timing)
- `performance_get_metrics` — Get page performance metrics (Web Vitals: FCP, LCP, FID, CLS)
- `performance_coverage` — Start or stop JavaScript and CSS code coverage recording
- `performance_take_heap_snapshot` — Take a V8 heap memory snapshot

## Full tool list (31)

| Tool | Description |
| --- | --- |
| `network_enable` | Enable network request monitoring. Must be called before page_navigate to capture requests. |
| `network_disable` | Disable network request monitoring |
| `network_get_status` | Get network monitoring status (enabled, request count, response count) |
| `network_monitor` | Manage network request monitoring. Enable/disable monitoring or check status. Must enable before page_navigate to capture requests. |
| `network_get_requests` | Get captured network requests. Large results (&gt;25KB) automatically return a summary with detailId. |
| `network_get_response_body` | Get response body for a specific request. Auto-truncates responses &gt;100KB. Use returnSummary=true for large files. |
| `network_get_stats` | Get network statistics (total requests, response count, error rate, timing) |
| `performance_get_metrics` | Get page performance metrics (Web Vitals: FCP, LCP, FID, CLS) |
| `performance_coverage` | Start or stop JavaScript and CSS code coverage recording |
| `performance_take_heap_snapshot` | Take a V8 heap memory snapshot |
| `performance_trace` | Chrome Performance Trace recording. Action 'start' begins capture; 'stop' ends and saves trace file. |
| `profiler_cpu` | CDP CPU profiling. Action 'start' begins recording; 'stop' ends and saves profile with top hot functions. |
| `profiler_heap_sampling` | V8 heap allocation sampling. Action 'start' begins tracking; 'stop' ends and returns top allocators. |
| `console_get_exceptions` | Get captured uncaught exceptions from the page |
| `console_inject` | Inject an in-page monitor/interceptor. Types: |
| `console_inject_fetch_interceptor` | Inject the fetch() interceptor directly |
| `console_inject_xhr_interceptor` | Inject the XMLHttpRequest interceptor directly |
| `console_buffers` | Manage injected interceptor state. |
| `http_request_build` | Build a raw HTTP/1.x request payload with CRLF line endings. Useful for preparing deterministic request text for http_plain_request or other raw socket tools. |
| `http_plain_request` | Send a raw HTTP request over plain TCP using deterministic server-side logic with DNS pinning, response parsing, and bounded capture. Non-loopback HTTP targets require explicit request-scoped authorization. |
| `http2_probe` | Probe an HTTP/2 endpoint using Node http2 with deterministic DNS pinning and bounded response capture. Reports the negotiated protocol, ALPN result, response headers, status, and a response body snippet. Non-loopback plaintext h2c targets require explicit request-scoped authorization. |
| `http2_frame_build` | Build a raw HTTP/2 binary frame of any supported type (DATA, SETTINGS, PING, WINDOW_UPDATE, RST_STREAM, GOAWAY, or RAW). Returns the 9-byte frame header and full frame as hex strings, ready to send over a tcp_write or tls_write channel for protocol-level fuzzing and injection. |
| `network_rtt_measure` | Measure round-trip time (RTT) to a target URL using TCP, TLS, or HTTP probes. Returns per-sample latencies and aggregate statistics (min/max/mean/median/p95). |
| `network_traceroute` | ICMP traceroute with per-hop RTT and error classification. Windows: no admin required. Linux/macOS: requires root or CAP_NET_RAW. |
| `network_icmp_probe` | ICMP echo probe with TTL control and error classification. Windows: no admin required. Linux/macOS: requires root or CAP_NET_RAW. |
| `network_extract_auth` | Scan all captured network requests and extract authentication credentials (tokens, cookies, API keys, signatures). |
| `network_export_har` | Export all captured network traffic as a standard HAR 1.2 file. |
| `network_replay_request` | Replay a previously captured network request with optional modifications. |
| `network_intercept` | Manage response interception rules using CDP Fetch domain. Actions: add (create rule), list (show active rules), disable (remove rules). |
| `network_tls_fingerprint` | Compute TLS/HTTP fingerprint hashes for bot detection. |
| `network_bot_detect_analyze` | Analyze captured requests for bot detection signals (TLS fingerprint, header ordering, timing). |
