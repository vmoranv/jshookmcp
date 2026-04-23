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

- `network_enable` — 启用网络请求监控；必须在 page_navigate 之前调用才能捕获请求。
- `network_disable` — 禁用网络请求监控。
- `network_get_status` — 获取网络监控状态，包括是否启用、请求数和响应数。
- `network_monitor` — 管理网络请求监控。启用/禁用监控或查看状态，需在 page_navigate 前启用以捕获请求。
- `network_get_requests` — 查看已捕获的网络请求。数据量大时仅返回摘要，可通过 get_detailed_data 获取完整内容。
- `network_get_response_body` — 查看某个请求的响应内容；大响应会自动截断或摘要化。
- `network_get_stats` — 查看网络流量统计，包括请求量、响应量、错误率与时序信息。
- `performance_get_metrics` — 查看页面性能指标，如 FCP、LCP、FID、CLS。
- `performance_coverage` — 开始或停止 JavaScript 与 CSS 代码覆盖率录制。
- `performance_take_heap_snapshot` — 采集一份 V8 堆内存快照。

## 工具清单（27）

| 工具 | 说明 |
| --- | --- |
| `network_enable` | 启用网络请求监控；必须在 page_navigate 之前调用才能捕获请求。 |
| `network_disable` | 禁用网络请求监控。 |
| `network_get_status` | 获取网络监控状态，包括是否启用、请求数和响应数。 |
| `network_monitor` | 管理网络请求监控。启用/禁用监控或查看状态，需在 page_navigate 前启用以捕获请求。 |
| `network_get_requests` | 查看已捕获的网络请求。数据量大时仅返回摘要，可通过 get_detailed_data 获取完整内容。 |
| `network_get_response_body` | 查看某个请求的响应内容；大响应会自动截断或摘要化。 |
| `network_get_stats` | 查看网络流量统计，包括请求量、响应量、错误率与时序信息。 |
| `performance_get_metrics` | 查看页面性能指标，如 FCP、LCP、FID、CLS。 |
| `performance_coverage` | 开始或停止 JavaScript 与 CSS 代码覆盖率录制。 |
| `performance_take_heap_snapshot` | 采集一份 V8 堆内存快照。 |
| `performance_trace` | Chrome Performance Trace 录制。start 开始捕获，stop 结束并保存跟踪文件。 |
| `profiler_cpu` | CDP CPU 性能分析。start 开始录制，stop 结束并保存含热点函数的 Profile。 |
| `profiler_heap_sampling` | V8 堆分配采样。start 开始追踪，stop 结束并返回主要分配热点。 |
| `console_get_exceptions` | 获取页面中已捕获的未处理异常。 |
| `console_inject` | 注入页面内监控器/拦截器，支持 script_monitor、xhr_interceptor、fetch_interceptor、function_tracer 等类型。 |
| `console_buffers` | 管理已注入拦截器的状态，支持清空缓冲区或重置拦截器。 |
| `http_request_build` | 构建原始 HTTP/1.x 请求载荷（CRLF 行尾）。用于为 http_plain_request 或其他原始套接字工具准备确定性请求文本。 |
| `http_plain_request` | 通过原始 TCP 发送 HTTP 请求，使用确定性服务端逻辑，包含 DNS 固定、响应解析和有界捕获。非回环 HTTP 目标需要显式请求级授权。 |
| `http2_probe` | 使用 Node http2 探测 HTTP/2 端点，带确定性 DNS 固定和有界响应捕获。报告协商协议、ALPN 结果、响应头、状态码和响应体片段。非回环明文 h2c 目标需要显式请求级授权。 |
| `http2_frame_build` | 构建任意支持类型（DATA、SETTINGS、PING、WINDOW_UPDATE、RST_STREAM、GOAWAY、RAW）的原始 HTTP/2 二进制帧。返回 9 字节帧头和完整帧的十六进制字符串，可通过 tcp_write 或 tls_write 发送，用于协议级模糊测试与注入。 |
| `network_rtt_measure` | 测量到目标主机的网络往返时间（RTT），支持 TCP、TLS 和 HTTP 三种探测模式。多次迭代平滑抖动，返回 min/max/avg/p50/p95 统计数据。非回环目标需要显式授权。 |
| `network_traceroute` | 基于 ICMP 的路由追踪，逐跳返回 RTT 与错误分类。Windows 无需管理员权限；Linux/macOS 需要 root 或 CAP_NET_RAW。 |
| `network_icmp_probe` | ICMP 探测，支持 TTL 控制与错误分类。Windows 无需管理员权限；Linux/macOS 需要 root 或 CAP_NET_RAW。 |
| `network_extract_auth` | 从网络请求中提取认证凭据（Token、Cookie、API Key、签名等）。 |
| `network_export_har` | 将网络请求记录导出为 HAR 文件。 |
| `network_replay_request` | 重新发送某个已捕获的网络请求，支持按需修改请求内容。 |
| `network_intercept` | 管理基于 CDP Fetch 域的响应拦截规则。操作：add（创建规则）、list（显示活跃规则）、disable（移除规则）。 |
