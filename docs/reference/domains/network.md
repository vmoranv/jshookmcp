# Network

域名：`network`

请求捕获、响应体读取、HAR 导出、请求重放与性能追踪。

## Profile

- workflow
- full

## 典型场景

- 抓包
- 认证提取
- 请求重放
- 性能 trace

## 常见组合

- browser + network
- network + workflow

## 代表工具

- `network_enable` — 启用网络请求监控，供后续页面导航与抓包使用。
- `network_disable` — 禁用网络请求监控。
- `network_get_status` — 获取网络监控状态及请求统计。
- `network_get_requests` — 获取已捕获的网络请求；大结果会返回摘要与 detailId。
- `network_get_response_body` — 获取指定请求的响应体；大响应会自动截断或摘要化。
- `network_get_stats` — 获取网络流量统计，包括请求量、响应量、错误率与时序信息。
- `performance_get_metrics` — 获取页面性能指标，如 FCP、LCP、FID、CLS。
- `performance_start_coverage` — 开始记录 JavaScript 与 CSS 覆盖率。
- `performance_stop_coverage` — 停止覆盖率记录并返回报告。
- `performance_take_heap_snapshot` — 生成 V8 堆内存快照。

## 工具清单（27）

| 工具 | 说明 |
| --- | --- |
| `network_enable` | 启用网络请求监控，供后续页面导航与抓包使用。 |
| `network_disable` | 禁用网络请求监控。 |
| `network_get_status` | 获取网络监控状态及请求统计。 |
| `network_get_requests` | 获取已捕获的网络请求；大结果会返回摘要与 detailId。 |
| `network_get_response_body` | 获取指定请求的响应体；大响应会自动截断或摘要化。 |
| `network_get_stats` | 获取网络流量统计，包括请求量、响应量、错误率与时序信息。 |
| `performance_get_metrics` | 获取页面性能指标，如 FCP、LCP、FID、CLS。 |
| `performance_start_coverage` | 开始记录 JavaScript 与 CSS 覆盖率。 |
| `performance_stop_coverage` | 停止覆盖率记录并返回报告。 |
| `performance_take_heap_snapshot` | 生成 V8 堆内存快照。 |
| `performance_trace` | 待补充中文：Chrome Performance Trace recording. Action 'start' begins capture; 'stop' ends and saves trace file. |
| `profiler_cpu` | 待补充中文：CDP CPU profiling. Action 'start' begins recording; 'stop' ends and saves profile with top hot functions. |
| `profiler_heap_sampling` | 待补充中文：V8 heap allocation sampling. Action 'start' begins tracking; 'stop' ends and returns top allocators. |
| `console_get_exceptions` | 获取页面捕获到的未处理异常。 |
| `console_inject` | 待补充中文：Inject an in-page monitor/interceptor. Types: |
| `console_buffers` | 待补充中文：Manage injected interceptor state. |
| `dns_resolve` | 使用服务端确定性 DNS 查询将主机名解析为 IPv4/IPv6 地址。接受主机名或 IP 字面量，结果按地址族和地址排序。 |
| `dns_reverse` | 对 IPv4 或 IPv6 字面量执行反向 DNS 查询（PTR 记录），使用服务端确定性逻辑。 |
| `http_request_build` | 构建原始 HTTP/1.x 请求载荷（CRLF 行尾）。用于为 http_plain_request 或其他原始套接字工具准备确定性请求文本。 |
| `http_plain_request` | 通过原始 TCP 发送 HTTP 请求，使用确定性服务端逻辑，包含 DNS 固定、响应解析和有界捕获。非回环 HTTP 目标需要显式请求级授权。 |
| `http2_probe` | 使用 Node http2 探测 HTTP/2 端点，带确定性 DNS 固定和有界响应捕获。报告协商协议、ALPN 结果、响应头、状态码和响应体片段。非回环明文 h2c 目标需要显式请求级授权。 |
| `http2_frame_build` | 构建任意支持类型（DATA、SETTINGS、PING、WINDOW_UPDATE、RST_STREAM、GOAWAY、RAW）的原始 HTTP/2 二进制帧。返回 9 字节帧头和完整帧的十六进制字符串，可通过 tcp_write 或 tls_write 发送，用于协议级模糊测试与注入。 |
| `network_rtt_measure` | 测量到目标主机的网络往返时间（RTT），支持 TCP、TLS 和 HTTP 三种探测模式。多次迭代平滑抖动，返回 min/max/avg/p50/p95 统计数据。非回环目标需要显式授权。 |
| `network_extract_auth` | 扫描已捕获请求并提取认证凭据，如 Token、Cookie、API Key 与签名。 |
| `network_export_har` | 将捕获到的网络流量导出为标准 HAR 1.2 文件。 |
| `network_replay_request` | 重放已捕获的网络请求，并支持按需修改请求内容。 |
| `network_intercept` | 待补充中文：Manage response interception rules using CDP Fetch domain. Actions: add (create rule), list (show active rules), disable (remove rules). |
