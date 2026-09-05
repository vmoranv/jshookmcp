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

## 工具清单（8）

| 工具 | 说明 |
| --- | --- |
| `mojo_ipc_capabilities` | 报告 Mojo IPC 监控可用性。 |
| `mojo_monitor` | 启动或停止当前 Chromium 内核目标的 Mojo IPC 监控。 |
| `mojo_decode_message` | 将 Mojo IPC 十六进制负载解码为结构化字段映射。 |
| `mojo_encode_message` | 将结构化 Mojo IPC 消息编码为十六进制负载 |
| `mojo_list_interfaces` | 列出已发现的 Mojo IPC 接口及其待处理消息计数。 |
| `mojo_messages_get` | 从活跃监控会话中获取已捕获的 Mojo IPC 消息。 |
| `mojo_messages_summarize` | 将已捕获的 Mojo IPC 缓冲区（非破坏性读取）聚合为按接口/方法/方向的分布统计、Top-N 列表与捕获时间窗。不清空缓冲区。 |
| `mojo_verify_live` | 生成 Frida 验证脚本，在目标 Chromium 进程中探测已知的 Mojo C-API 导出（MojoWriteMessage、MojoWriteMessageNew），跨多个模块查询。使用覆盖 Win32/Linux/macOS 上 Chromium M96+ 的手工维护符号库。返回可直接运行的 Frida 脚本与探测元数据。诚实边界（B 类）：符号库为手工维护，符号可能因构建配置而异；verified 标志恒为 false，需对照活动二进制确认。 |
