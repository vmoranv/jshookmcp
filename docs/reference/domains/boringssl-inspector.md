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

- `tls_keylog_enable` — 启用 BoringSSL 兼容客户端的 SSLKEYLOGFILE 输出。
- `tls_keylog_parse` — 解析 SSLKEYLOGFILE 并汇总可用的密钥材料。
- `tls_keylog_disable` — 禁用 SSLKEYLOGFILE 捕获并清除环境变量。
- `tls_decrypt_payload` — 使用提供的密钥、nonce 和算法解密密文负载。
- `tls_keylog_summarize` — 按标签分布汇总 SSLKEYLOGFILE 的内容。
- `tls_keylog_lookup_secret` — 从解析的 keylog 中按 client random hex 查找 TLS 密钥。
- `tls_cert_pin_bypass` — 返回目标平台的证书校验绕过策略。
- `tls_handshake_parse` — 从十六进制负载解析 TLS 记录头和基本握手元数据。
- `tls_parse_handshake` — 从原始十六进制解析 TLS 握手元数据（版本、密码套件、SNI、扩展）。
- `tls_cipher_suites` — 列出 IANA TLS 密码套件，支持按关键词过滤。

## 工具清单（30）

| 工具 | 说明 |
| --- | --- |
| `tls_keylog_enable` | 启用 BoringSSL 兼容客户端的 SSLKEYLOGFILE 输出。 |
| `tls_keylog_parse` | 解析 SSLKEYLOGFILE 并汇总可用的密钥材料。 |
| `tls_keylog_disable` | 禁用 SSLKEYLOGFILE 捕获并清除环境变量。 |
| `tls_decrypt_payload` | 使用提供的密钥、nonce 和算法解密密文负载。 |
| `tls_keylog_summarize` | 按标签分布汇总 SSLKEYLOGFILE 的内容。 |
| `tls_keylog_lookup_secret` | 从解析的 keylog 中按 client random hex 查找 TLS 密钥。 |
| `tls_cert_pin_bypass` | 返回目标平台的证书校验绕过策略。 |
| `tls_handshake_parse` | 从十六进制负载解析 TLS 记录头和基本握手元数据。 |
| `tls_parse_handshake` | 从原始十六进制解析 TLS 握手元数据（版本、密码套件、SNI、扩展）。 |
| `tls_cipher_suites` | 列出 IANA TLS 密码套件，支持按关键词过滤。 |
| `tls_parse_certificate` | 从原始十六进制解析 TLS Certificate 消息并提取指纹。 |
| `tls_probe_endpoint` | 待补充中文：Connect to a TLS endpoint and report certificate chain basics, trust result, ALPN, protocol, cipher, and SNI/hostname validation details for authorized target testing. |
| `tcp_open` | 待补充中文：Open a stateful TCP session and return a sessionId for follow-up read/write calls. |
| `tcp_write` | 待补充中文：Write raw bytes to an open TCP session; accepts hex or UTF-8 text input. |
| `tcp_read_until` | 待补充中文：Read from an open TCP session until a delimiter is observed or a byte limit is reached. |
| `tcp_close` | 待补充中文：Close an open TCP session and release its buffered state. |
| `tls_open` | 待补充中文：Open a stateful TLS session with explicit trust and hostname policy controls, then return a sessionId. |
| `tls_write` | 待补充中文：Write raw bytes to an open TLS session; accepts hex or UTF-8 text input. |
| `tls_read_until` | 待补充中文：Read from an open TLS session until a delimiter is observed or a byte limit is reached. |
| `tls_close` | 待补充中文：Close an open TLS session and release its buffered state. |
| `websocket_open` | 待补充中文：Open a stateful WebSocket session over ws or wss, perform the client handshake, and return a sessionId. |
| `websocket_send_frame` | 待补充中文：Send a single WebSocket frame on an open session using a minimal opcode set (text, binary, ping, pong, close). |
| `websocket_read_frame` | 待补充中文：Read the next queued WebSocket frame from an open session. |
| `websocket_close` | 待补充中文：Close an open WebSocket session and release its queued frame state. |
| `tls_cert_pin_bypass_frida` | 通过 Frida 注入绕过证书校验（支持 BoringSSL、Chrome、OkHttp）。 |
| `net_raw_tcp_send` | 向远程主机发送原始 TCP 数据，支持十六进制或文本输入。 |
| `net_raw_tcp_listen` | 在本地 TCP 端口监听一个传入连接。 |
| `net_raw_udp_send` | 向本地 UDP 端口发送原始 UDP 数据报并等待响应。 |
| `net_raw_udp_listen` | 在本地 UDP 端口监听传入的数据报。 |
| `net_raw_tcp_scan` | 扫描主机 TCP 端口范围内的开放端口。 |
