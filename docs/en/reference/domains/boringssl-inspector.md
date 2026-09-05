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

## Full tool list (29)

| Tool | Description |
| --- | --- |
| `tls_keylog_enable` | Enable SSLKEYLOGFILE output for TLS library clients. |
| `tls_keylog_parse` | Parse an SSLKEYLOGFILE and summarize available key material. |
| `tls_keylog_disable` | Disable SSLKEYLOGFILE capture and unset the environment variable. |
| `tls_keylog_seal` | Encrypt the current keylog file in place with a fresh ephemeral key and securely wipe the plaintext source. Mitigates disk-forensics exposure (pagefile/hibernation/TEMP scraping) of captured TLS secrets. The returned keyHex is not persisted anywhere — hold onto it to decrypt the sealed envelope later, or it is unrecoverable once the process exits. |
| `tls_decrypt_payload` | Decrypt a TLS payload using a provided key, nonce, and algorithm. |
| `tls_keylog_summarize` | Summarize an SSLKEYLOGFILE: per-label distribution, secret-type classification (TLS 1.2 master-secret vs TLS 1.3 traffic-secret kinds), TLS version inference, and unique session (client_random) count. |
| `tls_keylog_lookup_secret` | Look up a TLS secret by client random hex from the parsed keylog. |
| `tls_cert_pin_bypass` | Return a certificate pinning bypass strategy for the selected platform. |
| `tls_parse_handshake` | Parse TLS handshake metadata from raw hex. For payload decryption, use tls_decrypt_payload with explicit keyHex/nonceHex/authTagHex. |
| `tls_cipher_suites` | List TLS cipher suites with IANA id, protocol, key-exchange / authentication / encryption / MAC split, and AEAD flag (each dimension derived from the suite name). |
| `tls_parse_certificate` | Parse a TLS Certificate message from raw hex and extract X.509 details (subject/issuer/SAN/validity/keyUsage), SHA-256 fingerprint, and SPKI pin hash (Android Network Security Config / HPKP format). |
| `tls_probe_endpoint` | Probe a TLS endpoint and report handshake and certificate details. |
| `tcp_open` | Open a TCP session. |
| `tcp_write` | Write data to an open TCP session. |
| `tcp_read_until` | Read from an open TCP session until a delimiter or byte limit is reached. |
| `tcp_close` | Close an open TCP session. |
| `tls_open` | Open a TLS session. |
| `tls_write` | Write data to an open TLS session. |
| `tls_read_until` | Read from an open TLS session until a delimiter or byte limit is reached. |
| `tls_close` | Close an open TLS session. |
| `websocket_open` | Open a WebSocket session. |
| `websocket_send_frame` | Send a WebSocket frame. |
| `websocket_read_frame` | Read the next queued WebSocket frame from an open session. |
| `websocket_close` | Close an open WebSocket session. |
| `tls_cert_pin_bypass_frida` | Bypass certificate pinning via Frida injection (supports the target TLS library and HTTP client frameworks). |
| `net_raw_tcp_send` | Send raw TCP data to a remote host; accepts hex or text input. |
| `net_raw_tcp_listen` | Listen on a local TCP port for one incoming connection. |
| `net_raw_udp_send` | Send a raw UDP datagram and wait for a response. |
| `net_raw_udp_listen` | Listen on a local UDP port for an incoming datagram. |
