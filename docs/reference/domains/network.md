# Network

域名：`network`

请求捕获、响应体读取、HAR 导出、请求重放与性能追踪。

## Profile

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

## 工具清单（35）

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
| `performance_trace_start` | 开始录制 Chrome Performance Trace。 |
| `performance_trace_stop` | 停止 Performance Trace 并保存跟踪文件。 |
| `profiler_cpu_start` | 开始 CDP CPU Profiling。 |
| `profiler_cpu_stop` | 停止 CPU Profiling，保存结果并返回热点函数。 |
| `profiler_heap_sampling_start` | 开始 V8 堆分配采样。 |
| `profiler_heap_sampling_stop` | 停止堆分配采样并返回主要分配热点。 |
| `console_get_exceptions` | 获取页面捕获到的未处理异常。 |
| `console_inject_script_monitor` | 注入脚本监视器，跟踪动态创建的脚本元素。 |
| `console_inject_xhr_interceptor` | 注入 XHR 拦截器，捕获 AJAX 请求与响应数据。 |
| `console_inject_fetch_interceptor` | 注入 Fetch 拦截器，捕获请求、响应、头部、请求体与时序信息。 |
| `console_clear_injected_buffers` | 清空已注入监控器的缓冲区，但保留拦截器本身。 |
| `console_reset_injected_interceptors` | 重置已注入的拦截器与监视器，以恢复干净状态。 |
| `console_inject_function_tracer` | 注入基于 Proxy 的函数调用跟踪器。 |
| `dns_resolve` | 使用服务端确定性 DNS 查询将主机名解析为 IPv4/IPv6 地址。接受主机名或 IP 字面量，结果按地址族和地址排序。 |
| `dns_reverse` | 对 IPv4 或 IPv6 字面量执行反向 DNS 查询（PTR 记录），使用服务端确定性逻辑。 |
| `http_request_build` | 构建原始 HTTP/1.x 请求载荷（CRLF 行尾）。用于为 http_plain_request 或其他原始套接字工具准备确定性请求文本。 |
| `http_plain_request` | 通过原始 TCP 发送 HTTP 请求，使用确定性服务端逻辑，包含 DNS 固定、响应解析和有界捕获。非回环 HTTP 目标需要显式请求级授权。 |
| `http2_probe` | 使用 Node http2 探测 HTTP/2 端点，带确定性 DNS 固定和有界响应捕获。报告协商协议、ALPN 结果、响应头、状态码和响应体片段。非回环明文 h2c 目标需要显式请求级授权。 |
| `http2_frame_build` | 构建任意支持类型（DATA、SETTINGS、PING、WINDOW_UPDATE、RST_STREAM、GOAWAY、RAW）的原始 HTTP/2 二进制帧。返回 9 字节帧头和完整帧的十六进制字符串，可通过 tcp_write 或 tls_write 发送，用于协议级模糊测试与注入。 |
| `network_extract_auth` | 扫描已捕获请求并提取认证凭据，如 Token、Cookie、API Key 与签名。 |
| `network_export_har` | 将捕获到的网络流量导出为标准 HAR 1.2 文件。 |
| `network_replay_request` | 重放已捕获的网络请求，并支持按需修改请求内容。 |
| `network_intercept_response` | 使用 CDP Fetch 域添加响应拦截规则，匹配的请求将返回自定义响应而非真实服务器响应。支持单条和批量模式，URL 匹配支持 glob 和正则。 |
| `network_intercept_list` | 列出所有活跃的响应拦截规则及命中统计。 |
| `network_intercept_disable` | 移除指定拦截规则或禁用全部拦截。当所有规则被移除时，CDP Fetch 域会自动禁用。 |
