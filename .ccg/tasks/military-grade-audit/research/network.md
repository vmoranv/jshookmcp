# Network Domain — Functional Research Profile

> Source: `src/server/domains/network/` (definitions.ts + manifest.ts + handlers/ + CLAUDE.md)
> Audit context: 38 tools actually registered.
> Current CCG sync (2026-07-08): **9.6/10**. parse_client_hello mode emits real JA3 (Salesforce MD5) + JA4 (FoxIO) from captured ClientHello wire bytes; http2_frame_parse (build+parse symmetric) and extract_auth signing-scheme recognition (AWS SigV4 / Aliyun ACS3 / DPoP / OAuth2 client_assertion) are done.

---

## Purpose

Capture, intercept, replay, and analyze HTTP/WebSocket/DNS/ICMP traffic from a CDP-driven
browser session plus a set of browser-less raw transport probes (HTTP/1, HTTP/2, DNS, ICMP,
RTT/latency, traceroute, TLS-fingerprint, bot-detection).

## Current tool inventory (37)

**Capture / monitoring (7)** — `network_enable`, `network_disable`, `network_get_status`,
`network_monitor`, `network_get_requests`, `network_get_response_body`, `network_get_stats`.

**Replay / interception / analysis (4)** — `network_replay_request`, `network_intercept`,
`network_extract_auth`, `network_export_har`.

**Performance / profiling (6)** — `performance_get_metrics`, `performance_coverage`,
`performance_take_heap_snapshot`, `performance_trace`, `profiler_cpu`, `profiler_heap_sampling`.

**Console injection (4)** — `console_get_exceptions`, `console_inject`,
`console_inject_fetch_interceptor`, `console_inject_xhr_interceptor`, `console_buffers`.

**Raw HTTP / HTTP2 crafting (4)** — `http_request_build`, `http_plain_request`, `http2_probe`,
`http2_frame_build`.

**DNS (5)** — `dns_resolve`, `dns_reverse`, `dns_probe`, `dns_cname_chain`, `dns_bulk_resolve`.

**ICMP / latency (4)** — `network_traceroute`, `network_icmp_probe`, `network_rtt_measure`,
`network_latency_stats`.

**Fingerprint / bot-detection (2)** — `network_tls_fingerprint`, `network_bot_detect_analyze`.
(Some console tools from CLAUDE.md like `console_inject_script_monitor` /
`console_inject_function_tracer` are NOT in definitions — they were collapsed into `console_inject`.)

## Concrete enhancement opportunities

### 1. `http2_frame_build` is build-only — no parser/decoder — ✅ DONE Session 25

- **What**: Added `http2_frame_parse` (inverse of `http2_frame_build`). The pure function `parseHttp2Frame` in `http2-raw.ts` decodes a hex HTTP/2 frame: 9-byte header (3B length + type + flags + streamId) → typeCode reverse-lookup → type-specific payload decode (SETTINGS entries / PING opaque / WINDOW_UPDATE increment / RST_STREAM errorCode / GOAWAY lastStreamId+errorCode+debugData).
- **Lenient decode**: malformed payloads set `decodeError` but still return `payloadHex`, so analysing a corrupt capture never loses data. Unknown type codes fall back to `'RAW'`. streamId reserved high bit is cleared (RFS 7540 §4.1) rather than rejected.
- **Status**: Shipped as `http2_frame_parse` (single required `frameHex`, whitespace-tolerant). Added to `RAW_NETWORK_TOOLS` (no browser core needed). `network:http2_frame_parsed` event registered in ServerEventMap. Tests in `http2-raw-parse.test.ts` (18 cases: 7-type round-trips + lenient decodeError + error paths).

### 2. `network_extract_auth` misses modern signing schemes — ✅ DONE Session 25

- **What**: `extractAuthFromRequests` now recognises AWS SigV4 (header `AWS4-HMAC-SHA256` + presigned URL query `X-Amz-Signature`/`X-Amz-Credential`/`X-Amz-Algorithm`), Aliyun ACS3 (`x-acs-signature` header + `ACS3-HMAC-SHA256` authorization), DPoP (`DPoP` header), and OAuth2 `client_assertion` (JSON + form-urlencoded body). Findings carry a new `source: 'signature'` and optional `scheme` field.
- **Why**: Token coverage is the entire point of this tool; these scheme families are exactly the high-value auth on API gateways, and were previously surfaced as low-confidence generic base64 or missed entirely (presigned URL query params hit the TOKEN_BODY_KEYS gate and were dropped).
- **Bonus**: form-urlencoded body parsing via `URLSearchParams` fallback — previously `JSON.parse` threw on `grant_type=...&client_assertion=...` and the whole body was missed.
- **Status**: 14 new auth-extractor test cases. The signing-scheme layer runs before the generic header/query/body gates so signature values aren't misclassified; consumed header keys are skipped by the generic path to avoid duplicates.

### 3. `network_tls_fingerprint` requires the caller to supply cipher/extension hex codes manually — ✅ DONE Session 28

- **What**: New `mode: 'parse_client_hello'` on `network_tls_fingerprint` accepts a `clientHelloHex` arg (a raw TLS record) and parses the ClientHello wire bytes (RFC 5246 §7.4.1.2 / RFC 8446 §4.1.2) into typed fields, then emits both **JA3** (Salesforce MD5 of `version,ciphers,extensions,ec_point_formats,elliptic_curves`) and **JA4** (FoxIO truncated-sha256 segments) from the real handshake — no user-supplied cipher/extension arrays required. Pure-function parser in `handlers/clienthello-parser.ts`: `parseClientHello` (lenient, returns `{valid:false,error}` on malformed input rather than throwing), `computeJa3`, `computeJa4FromClientHello` (delegates Part A/B/C assembly to the existing `computeTlsFingerprint`).
- **Parsed fields**: record version, legacy version, ciphers (wire order, GREASE retained), extensions with raw values, SNI presence, ALPN list, supported_versions (→ negotiated TLS version for JA4 Part A), elliptic_curves / supported_groups, ec_point_formats, signature_algorithms.
- **Why**: `compute_tls` only re-hashed whatever arrays the caller passed in — the JA3/JA4 of a real captured ClientHello was never derivable. JA3 is the industry-standard (Salesforce/attack-intel) TLS fingerprint; JA4 is the modern sorted/GREASE-stripped successor. Bot-detection and reverse-engineering both depend on matching these against known client hashes.
- **Status**: 17 parser unit tests (build-helper for typed ClientHello construction + parse/JA3/JA4 assertions, GREASE stripping, truncation rejection, non-ClientHello rejection) + 5 handler integration tests via `TlsBotHandlers.handleNetworkTlsFingerprint`. Tests in `clienthello-parser.test.ts` + `tls-fingerprint.test.ts`. Tool count unchanged (38) — this extends an existing tool rather than adding one.

### 4. `network_bot_detect_analyze` heuristic set is shallow — ✅ DONE Session 30

- **What**: `detectBotSignals` (handlers/bot-detection.ts:101 lines) scores on UA substring,
  presence of `accept*` headers, header count, and a single hardcoded Chrome-ordering array.
  Real TLS-JA3 / JA4 fingerprint matching, HTTP/2 SETTINGS fingerprint (Akamai), and Canvas/WGL
  fingerprint signals are NOT consulted even though `network_tls_fingerprint` computes a TLS
  hash right next to it. Pull `tls.tls` (peetza-ish hash) from `computeTlsFingerprint` into the
  bot score, and add known-bad JA3 hashes (e.g. python-requests default) to the signal list.
- **Why**: Bot detection at 10/10 needs to combine UA + header order + TLS fp + HTTP/2 fp; today
  only the first two are used.
- **Effort**: M.
- **Score lift**: +0.2.
- **Status (Session 30)**: `detectBotSignals` extended with optional `jaFingerprint` {ja3, ja4, knownBadJa3, knownBadJa4}. ja3/ja4 always surface as informational signals (`tls-ja3: <hash>`); a +0.45 bot score is added ONLY when the caller supplies a knownBad list and the captured hash matches. `network_bot_detect_analyze` schema adds ja3/ja4/knownBadJa3/knownBadJa4 params. **Zero hardcoded feature library** — design corrected from the original "add known-bad JA3 hashes" to user-supplied lists (reverse-engineering neutrality: "bad" is the caller's judgement, not the tool's preset). HTTP/2 SETTINGS fingerprint + Canvas/WGL signals remain (out of scope). 7 new tests (5 pure-function + 2 handler integration). network 9.6→9.8.

### 5. `network_replay_request` cannot replay against the original captured WebSocket / SSE flow

- **What**: `replay.ts` is HTTP-only. Once `ws_get_frames` / `sse_get_events` (streaming domain)
  capture a flow, there is no `network_replay_request` path to re-send a frame over the live
  WebSocket. Add an opt-in `wsRequestId` mode that re-sends a previously-captured frame payload
  through the CDP `Network.sendWebSocketMessage` (or via the in-page fetch interceptor for
  SSE re-emit).
- **Why**: Replay coverage today stops at request/response HTTP; a streaming replay closes the
  "edit-and-resend" loop for the most common reverse-engineering target type (live WS APIs).
- **Effort**: L.
- **Score lift**: +0.5.

### 6. `dns_*` tools only use the system resolver — no controlled-recursive-server option

- **What**: All five DNS tools (`dns_resolve`, `dns_probe`, `dns_cname_chain`,
  `dns_bulk_resolve`, `dns_reverse`) go through Node's `dns` module which uses the OS resolver.
  For reverse-engineering there's no way to query a specific authoritative NS, follow the
  resolution chain manually, or compare results across resolvers (helps detect DNS-based
  geo-routing / sinkholing). Add an optional `server: '1.1.1.1'` arg that uses
  `dns.Resolver({servers:[...]})` instead.
- **Why**: Tiny code change; large payoff for anti-censorship / CDN-origin investigation.
- **Effort**: S.
- **Score lift**: +0.1.
