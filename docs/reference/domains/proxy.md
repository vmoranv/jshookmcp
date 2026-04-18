# Proxy

域名：`proxy`

全栈 HTTP/HTTPS 中间人代理域，提供系统级的流量拦截、篡改与应用级挂载配置。

## Profile

- full

## 典型场景

- 全局 HTTP/HTTPS 抓包
- 接口 Mock 与转发
- Android 辅助挂载

## 常见组合

- proxy + network
- proxy + adb-bridge

## 代表工具

- `proxy_start` — 启动本地 HTTP/HTTPS mockttp 代理服务器。如果用于 TLS 拦截的本地 CA 不存在，将会自动生成。
- `proxy_stop` — 停止正在运行的 mockttp 代理服务器。
- `proxy_status` — 获取代理服务器的当前运行状态以及 CA 证书的路径。
- `proxy_export_ca` — 导出本地根证书(CA)的路径和内容，以便将其安装到目标测试设备上并信任。
- `proxy_add_rule` — 向代理中添加一个新的拦截、转发或 Mock 规则。
- `proxy_get_requests` — 检索代理缓冲池中已捕获的 HTTP/HTTPS 请求。支持按照 URL 过滤。
- `proxy_clear_logs` — 清空已捕获的 HTTP/HTTPS 请求缓冲池。
- `proxy_setup_adb_device` — 通过 ADB 配置 Android 设备流量路由并辅助注入 CA 证书。

## 工具清单（8）

| 工具 | 说明 |
| --- | --- |
| `proxy_start` | 启动本地 HTTP/HTTPS mockttp 代理服务器。如果用于 TLS 拦截的本地 CA 不存在，将会自动生成。 |
| `proxy_stop` | 停止正在运行的 mockttp 代理服务器。 |
| `proxy_status` | 获取代理服务器的当前运行状态以及 CA 证书的路径。 |
| `proxy_export_ca` | 导出本地根证书(CA)的路径和内容，以便将其安装到目标测试设备上并信任。 |
| `proxy_add_rule` | 向代理中添加一个新的拦截、转发或 Mock 规则。 |
| `proxy_get_requests` | 检索代理缓冲池中已捕获的 HTTP/HTTPS 请求。支持按照 URL 过滤。 |
| `proxy_clear_logs` | 清空已捕获的 HTTP/HTTPS 请求缓冲池。 |
| `proxy_setup_adb_device` | 通过 ADB 配置 Android 设备流量路由并辅助注入 CA 证书。 |
