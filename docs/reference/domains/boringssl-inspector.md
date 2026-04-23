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
- `tls_parse_handshake` — 从原始十六进制解析 TLS 记录头和握手元数据（版本、密码套件、SNI、扩展）。可选 decrypt 参数使用已加载的 keylog 解密载荷预览。
- `tls_cipher_suites` — 列出 IANA TLS 密码套件，支持按关键词过滤。
- `tls_parse_certificate` — 从原始十六进制解析 TLS Certificate 消息并提取指纹。

## 工具清单（28）

| 工具 | 说明 |
| --- | --- |
| `tls_keylog_enable` | 启用 BoringSSL 兼容客户端的 SSLKEYLOGFILE 输出。 |
| `tls_keylog_parse` | 解析 SSLKEYLOGFILE 并汇总可用的密钥材料。 |
| `tls_keylog_disable` | 禁用 SSLKEYLOGFILE 捕获并清除环境变量。 |
| `tls_decrypt_payload` | 使用提供的密钥、nonce 和算法解密密文负载。 |
| `tls_keylog_summarize` | 按标签分布汇总 SSLKEYLOGFILE 的内容。 |
| `tls_keylog_lookup_secret` | 从解析的 keylog 中按 client random hex 查找 TLS 密钥。 |
| `tls_cert_pin_bypass` | 返回目标平台的证书校验绕过策略。 |
| `tls_parse_handshake` | 从原始十六进制解析 TLS 记录头和握手元数据（版本、密码套件、SNI、扩展）。可选 decrypt 参数使用已加载的 keylog 解密载荷预览。 |
| `tls_cipher_suites` | 列出 IANA TLS 密码套件，支持按关键词过滤。 |
| `tls_parse_certificate` | 从原始十六进制解析 TLS Certificate 消息并提取指纹。 |
| `tls_probe_endpoint` | 连接 TLS 端点并报告证书链基本信息、信任验证结果、ALPN 协商、协议版本、密码套件及 SNI/主机名校验详情，用于授权目标测试。 |
| `tcp_open` | 建立 TCP 连接，用于后续读写操作。 |
| `tcp_write` | 向已打开的 TCP 会话写入原始字节，支持十六进制或 UTF-8 文本输入。 |
| `tcp_read_until` | 从已打开的 TCP 会话读取数据，直到遇到分隔符或达到字节上限。 |
| `tcp_close` | 关闭已打开的 TCP 会话并释放其缓冲状态。 |
| `tls_open` | 建立加密的 TLS 连接，用于后续读写操作。 |
| `tls_write` | 向已打开的 TLS 会话写入原始字节，支持十六进制或 UTF-8 文本输入。 |
| `tls_read_until` | 从已打开的 TLS 会话读取数据，直到遇到分隔符或达到字节上限。 |
| `tls_close` | 关闭已打开的 TLS 会话并释放其缓冲状态。 |
| `websocket_open` | 建立 WebSocket 连接，用于后续收发消息。 |
| `websocket_send_frame` | 在已打开的 WebSocket 会话上发送单帧数据，支持 text、binary、ping、pong、close 操作码。 |
| `websocket_read_frame` | 从已打开的 WebSocket 会话中读取下一个排队的帧。 |
| `websocket_close` | 关闭已打开的 WebSocket 会话并释放其排队帧状态。 |
| `tls_cert_pin_bypass_frida` | 通过 Frida 注入绕过证书校验（支持 BoringSSL、Chrome、OkHttp）。 |
| `net_raw_tcp_send` | 向远程主机发送原始 TCP 数据，支持十六进制或文本输入。 |
| `net_raw_tcp_listen` | 在本地 TCP 端口监听一个传入连接。 |
| `net_raw_udp_send` | 向本地 UDP 端口发送原始 UDP 数据报并等待响应。 |
| `net_raw_udp_listen` | 在本地 UDP 端口监听传入的数据报。 |
