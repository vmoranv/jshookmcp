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

## Full tool list (39)

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
| `http2_frame_parse` | Decode a raw HTTP/2 frame (hex string) back into its header fields and type-specific payload (SETTINGS entries, PING opaque data, WINDOW_UPDATE increment, RST_STREAM/GOAWAY error codes, GOAWAY debug data). Inverse of http2_frame_build. Lenient: malformed payloads set decodeError but still return payloadHex. |
| `network_http2_fingerprint` | Compute an Akamai-style HTTP/2 fingerprint from one or more captured HTTP/2 frames (the client connection preface: SETTINGS + stream-0 WINDOW_UPDATE + any PRIORITY frames). Returns the canonical "&lt;settings&gt;\|&lt;window_update&gt;\|&lt;priority&gt;" string, a sha256 hash, and the structured fields (settings entries, window update increment, priorities). Ships NO hardcoded feature library — the structured fields are authoritative; the caller decides what is "bad". Pair with network_tls_fingerprint for full client identity. |
| `network_rtt_measure` | Measure round-trip time to a target URL. |
| `network_latency_stats` | Measure repeated latency and compute percentile stats. |
| `network_traceroute` | Run an ICMP traceroute. |
| `network_icmp_probe` | Run an ICMP echo probe. |
| `dns_resolve` | Resolve a hostname to DNS records using the system resolver or an optional DNS server. |
| `dns_reverse` | Reverse DNS lookup — find hostnames for an IP address. |
| `dns_probe` | Run a DNS query and return structured status instead of throwing. |
| `dns_cname_chain` | Trace the full CNAME chain for a hostname. |
| `dns_bulk_resolve` | Resolve many hostnames concurrently with per-host status. |
| `network_extract_auth` | Extract authentication data from captured network requests. |
| `network_export_har` | Export captured network traffic as HAR. |
| `network_replay_request` | Replay a captured network request with optional changes. |
| `network_intercept` | Manage network interception rules. |
| `network_tls_fingerprint` | Compute TLS/HTTP fingerprints for bot detection. compute_tls/compute_http build fingerprints from user-supplied lists; parse_client_hello parses a raw ClientHello record (hex) and emits JA3 + JA4 from the real wire bytes; analyze_request links a captured requestId. |
| `network_bot_detect_analyze` | Analyze captured requests for bot-detection signals. Optionally supply a JA3/JA4 TLS fingerprint (from network_tls_fingerprint parse_client_hello) plus user-defined knownBad hash lists; matching hashes raise the bot score. Ships NO hardcoded feature library — the caller decides which hashes are bot-like. |
