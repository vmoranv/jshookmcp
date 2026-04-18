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
| `dns_resolve` | 待补充中文：Resolve a hostname to IPv4/IPv6 addresses using deterministic server-side DNS lookup. Accepts hostnames or IP literals. Results are sorted by family and address. |
| `dns_reverse` | 待补充中文：Perform a reverse DNS lookup (PTR) for an IPv4 or IPv6 literal using deterministic server-side DNS logic. |
| `http_request_build` | 待补充中文：Build a raw HTTP/1.x request payload with CRLF line endings. Useful for preparing deterministic request text for http_plain_request or other raw socket tools. |
| `http_plain_request` | 待补充中文：Send a raw HTTP request over plain TCP using deterministic server-side logic with DNS pinning, response parsing, and bounded capture. Non-loopback HTTP targets require explicit request-scoped authorization. |
| `http2_probe` | 待补充中文：Probe an HTTP/2 endpoint using Node http2 with deterministic DNS pinning and bounded response capture. Reports the negotiated protocol, ALPN result, response headers, status, and a response body snippet. Non-loopback plaintext h2c targets require explicit request-scoped authorization. |
| `http2_frame_build` | 待补充中文：Build a raw HTTP/2 binary frame of any supported type (DATA, SETTINGS, PING, WINDOW_UPDATE, RST_STREAM, GOAWAY, or RAW). Returns the 9-byte frame header and full frame as hex strings, ready to send over a tcp_write or tls_write channel for protocol-level fuzzing and injection. |
| `network_extract_auth` | 扫描已捕获请求并提取认证凭据，如 Token、Cookie、API Key 与签名。 |
| `network_export_har` | 将捕获到的网络流量导出为标准 HAR 1.2 文件。 |
| `network_replay_request` | 重放已捕获的网络请求，并支持按需修改请求内容。 |
| `network_intercept_response` | 使用 CDP Fetch 域添加响应拦截规则，匹配的请求将返回自定义响应而非真实服务器响应。支持单条和批量模式，URL 匹配支持 glob 和正则。 |
| `network_intercept_list` | 列出所有活跃的响应拦截规则及命中统计。 |
| `network_intercept_disable` | 移除指定拦截规则或禁用全部拦截。当所有规则被移除时，CDP Fetch 域会自动禁用。 |
