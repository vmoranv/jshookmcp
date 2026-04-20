# Mojo IPC

域名：`mojo-ipc`

Mojo IPC 监控域，用于 Chromium 内部进程间通信分析。

## Profile

- full

## 典型场景

- Mojo 消息监控
- IPC 模式分析
- Chromium 内部协议逆向

## 常见组合

- mojo-ipc + browser
- mojo-ipc + network

## 代表工具

- `mojo_monitor` — 启动或停止当前 Chromium 内核目标的 Mojo IPC 监控。
- `mojo_decode_message` — 将 Mojo IPC 十六进制负载解码为结构化字段映射。
- `mojo_list_interfaces` — 列出已发现的 Mojo IPC 接口及其待处理消息计数。
- `mojo_messages_get` — 从活跃监控会话中获取已捕获的 Mojo IPC 消息。

## 工具清单（4）

| 工具 | 说明 |
| --- | --- |
| `mojo_monitor` | 启动或停止当前 Chromium 内核目标的 Mojo IPC 监控。 |
| `mojo_decode_message` | 将 Mojo IPC 十六进制负载解码为结构化字段映射。 |
| `mojo_list_interfaces` | 列出已发现的 Mojo IPC 接口及其待处理消息计数。 |
| `mojo_messages_get` | 从活跃监控会话中获取已捕获的 Mojo IPC 消息。 |
