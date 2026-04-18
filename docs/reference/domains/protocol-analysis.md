# Protocol Analysis

域名：`protocol-analysis`

自定义协议分析域，支持协议模式定义、自动字段检测、状态机推断和可视化。

## Profile

- workflow
- full

## 典型场景

- 自定义协议模式定义
- 从十六进制载荷自动检测字段边界
- 从捕获消息推断协议状态机
- 生成 Mermaid 状态图

## 常见组合

- network + protocol-analysis
- encoding + protocol-analysis

## 代表工具

- `proto_define_pattern` — 用分隔符、字节序和字段布局定义协议模式。
- `proto_auto_detect` — 从一个或多个十六进制负载样本自动检测协议模式。
- `proto_infer_fields` — 从重复的十六进制负载样本推断可能的协议字段。
- `proto_infer_state_machine` — 从捕获的消息序列推断协议状态机。
- `proto_export_schema` — 将协议模式导出为类 .proto 的 schema 定义。
- `proto_visualize_state` — 从协议状态机定义生成 Mermaid 状态图。
- `payload_template_build` — 从声明式字段定义构建二进制载荷。支持原始数值字段、原始字节和 UTF-8 字符串。
- `payload_mutate` — 对十六进制载荷应用确定性字节级变异。用于协议探测、边界测试和重放准备。
- `ethernet_frame_build` — 从源/目标 MAC 地址、EtherType 和载荷字节构建确定性 Ethernet II 帧。
- `arp_build` — 构建用于 Ethernet/IPv4 地址解析的确定性 ARP 载荷。

## 工具清单（15）

| 工具 | 说明 |
| --- | --- |
| `proto_define_pattern` | 用分隔符、字节序和字段布局定义协议模式。 |
| `proto_auto_detect` | 从一个或多个十六进制负载样本自动检测协议模式。 |
| `proto_infer_fields` | 从重复的十六进制负载样本推断可能的协议字段。 |
| `proto_infer_state_machine` | 从捕获的消息序列推断协议状态机。 |
| `proto_export_schema` | 将协议模式导出为类 .proto 的 schema 定义。 |
| `proto_visualize_state` | 从协议状态机定义生成 Mermaid 状态图。 |
| `payload_template_build` | 从声明式字段定义构建二进制载荷。支持原始数值字段、原始字节和 UTF-8 字符串。 |
| `payload_mutate` | 对十六进制载荷应用确定性字节级变异。用于协议探测、边界测试和重放准备。 |
| `ethernet_frame_build` | 从源/目标 MAC 地址、EtherType 和载荷字节构建确定性 Ethernet II 帧。 |
| `arp_build` | 构建用于 Ethernet/IPv4 地址解析的确定性 ARP 载荷。 |
| `raw_ip_packet_build` | 在现有载荷外构建确定性原始 IPv4 或 IPv6 包头。IPv4 头部校验和自动计算。 |
| `icmp_echo_build` | 构建确定性 ICMPv4 回显请求或应答载荷，校验和自动计算。 |
| `checksum_apply` | 对载荷切片应用确定性 16 位互联网校验和，可选清零并将校验和字段写回数据包。 |
| `pcap_write` | 从确定性数据包字节记录写入紧凑的经典 PCAP 文件。 |
| `pcap_read` | 读取经典 PCAP 文件并返回紧凑的确定性数据包摘要。不支持 PCAPNG 格式。 |
