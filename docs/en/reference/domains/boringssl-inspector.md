# BoringSSL Inspector

Domain: `boringssl-inspector`

BoringSSL/TLS inspection domain supporting TLS traffic analysis and certificate inspection.

## Profiles

- workflow
- full

## Typical scenarios

- TLS traffic analysis
- Certificate parsing
- Key log capture

## Common combinations

- boringssl-inspector + network
- boringssl-inspector + browser

## Representative tools

- `tls_keylog_enable` — Enable SSLKEYLOGFILE output for BoringSSL-compatible clients.
- `tls_keylog_parse` — Parse an SSLKEYLOGFILE and summarize available key material.
- `tls_keylog_disable` — Disable SSLKEYLOGFILE capture and unset the environment variable.
- `tls_decrypt_payload` — Decrypt a TLS payload using a provided key, nonce, and algorithm.
- `tls_keylog_summarize` — Summarize the contents of an SSLKEYLOGFILE by label distribution.
- `tls_keylog_lookup_secret` — Look up a TLS secret by client random hex from the parsed keylog.
- `tls_cert_pin_bypass` — Return a certificate pinning bypass strategy for the selected platform.
- `tls_handshake_parse` — Parse a TLS record header and basic handshake metadata from a hex payload.
- `tls_parse_handshake` — Parse TLS handshake metadata (version, cipher suites, SNI, extensions) from raw hex.
- `tls_cipher_suites` — List IANA TLS cipher suites, optionally filtered by keyword.

## Full tool list (17)

| Tool | Description |
| --- | --- |
| `tls_keylog_enable` | Enable SSLKEYLOGFILE output for BoringSSL-compatible clients. |
| `tls_keylog_parse` | Parse an SSLKEYLOGFILE and summarize available key material. |
| `tls_keylog_disable` | Disable SSLKEYLOGFILE capture and unset the environment variable. |
| `tls_decrypt_payload` | Decrypt a TLS payload using a provided key, nonce, and algorithm. |
| `tls_keylog_summarize` | Summarize the contents of an SSLKEYLOGFILE by label distribution. |
| `tls_keylog_lookup_secret` | Look up a TLS secret by client random hex from the parsed keylog. |
| `tls_cert_pin_bypass` | Return a certificate pinning bypass strategy for the selected platform. |
| `tls_handshake_parse` | Parse a TLS record header and basic handshake metadata from a hex payload. |
| `tls_parse_handshake` | Parse TLS handshake metadata (version, cipher suites, SNI, extensions) from raw hex. |
| `tls_cipher_suites` | List IANA TLS cipher suites, optionally filtered by keyword. |
| `tls_parse_certificate` | Parse a TLS Certificate message from raw hex and extract fingerprints. |
| `tls_cert_pin_bypass_frida` | Bypass certificate pinning via Frida injection (supports BoringSSL, Chrome, OkHttp). |
| `net_raw_tcp_send` | Send raw TCP data to a remote host; accepts hex or text input. |
| `net_raw_tcp_listen` | Listen on a local TCP port for one incoming connection. |
| `net_raw_udp_send` | Send a raw UDP datagram and wait for a response. |
| `net_raw_udp_listen` | Listen on a local UDP port for an incoming datagram. |
| `net_raw_tcp_scan` | Scan a TCP port range on a host for open ports. |
