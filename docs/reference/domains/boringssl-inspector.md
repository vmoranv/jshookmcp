# BoringSSL Inspector

域名：`boringssl-inspector`

BoringSSL/TLS 检查域，支持 TLS 流量分析和证书检查。

## Profile

- workflow
- full

## 典型场景

- TLS 流量分析
- 证书解析
- 密钥日志捕获

## 常见组合

- boringssl-inspector + network
- boringssl-inspector + browser

## 代表工具

- `tls_keylog_enable` — 待补充中文：Enable SSLKEYLOGFILE output for BoringSSL-compatible clients.
- `tls_keylog_parse` — 待补充中文：Parse an SSLKEYLOGFILE and summarize available key material.
- `tls_keylog_disable` — 待补充中文：Disable SSLKEYLOGFILE capture and unset the environment variable.
- `tls_decrypt_payload` — 待补充中文：Decrypt a TLS payload using a provided key, nonce, and algorithm.
- `tls_keylog_summarize` — 待补充中文：Summarize the contents of an SSLKEYLOGFILE by label distribution.
- `tls_keylog_lookup_secret` — 待补充中文：Look up a TLS secret by client random hex from the parsed keylog.
- `tls_cert_pin_bypass` — 待补充中文：Return a certificate pinning bypass strategy for the selected platform.
- `tls_handshake_parse` — 待补充中文：Parse a TLS record header and basic handshake metadata from a hex payload.
- `tls_parse_handshake` — 待补充中文：Parse TLS handshake metadata (version, cipher suites, SNI, extensions) from raw hex.
- `tls_cipher_suites` — 待补充中文：List IANA TLS cipher suites, optionally filtered by keyword.

## 工具清单（17）

| 工具 | 说明 |
| --- | --- |
| `tls_keylog_enable` | 待补充中文：Enable SSLKEYLOGFILE output for BoringSSL-compatible clients. |
| `tls_keylog_parse` | 待补充中文：Parse an SSLKEYLOGFILE and summarize available key material. |
| `tls_keylog_disable` | 待补充中文：Disable SSLKEYLOGFILE capture and unset the environment variable. |
| `tls_decrypt_payload` | 待补充中文：Decrypt a TLS payload using a provided key, nonce, and algorithm. |
| `tls_keylog_summarize` | 待补充中文：Summarize the contents of an SSLKEYLOGFILE by label distribution. |
| `tls_keylog_lookup_secret` | 待补充中文：Look up a TLS secret by client random hex from the parsed keylog. |
| `tls_cert_pin_bypass` | 待补充中文：Return a certificate pinning bypass strategy for the selected platform. |
| `tls_handshake_parse` | 待补充中文：Parse a TLS record header and basic handshake metadata from a hex payload. |
| `tls_parse_handshake` | 待补充中文：Parse TLS handshake metadata (version, cipher suites, SNI, extensions) from raw hex. |
| `tls_cipher_suites` | 待补充中文：List IANA TLS cipher suites, optionally filtered by keyword. |
| `tls_parse_certificate` | 待补充中文：Parse a TLS Certificate message from raw hex and extract fingerprints. |
| `tls_cert_pin_bypass_frida` | 待补充中文：Bypass certificate pinning via Frida injection (supports BoringSSL, Chrome, OkHttp). |
| `net_raw_tcp_send` | 待补充中文：Send raw TCP data to a remote host; accepts hex or text input. |
| `net_raw_tcp_listen` | 待补充中文：Listen on a local TCP port for one incoming connection. |
| `net_raw_udp_send` | 待补充中文：Send a raw UDP datagram and wait for a response. |
| `net_raw_udp_listen` | 待补充中文：Listen on a local UDP port for an incoming datagram. |
| `net_raw_tcp_scan` | 待补充中文：Scan a TCP port range on a host for open ports. |
