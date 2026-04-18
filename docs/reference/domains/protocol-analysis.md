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
- `payload_template_build` — 待补充中文：Build a binary payload from declarative field definitions. Supports primitive numeric fields, raw bytes, and UTF-8 strings.
- `payload_mutate` — 待补充中文：Apply deterministic byte-level mutations to a hex payload. Useful for protocol probing, boundary testing, and replay preparation.
- `ethernet_frame_build` — 待补充中文：Build a deterministic Ethernet II frame from source/destination MAC addresses, EtherType, and payload bytes.
- `arp_build` — 待补充中文：Build a deterministic ARP payload for Ethernet/IPv4 style address resolution packets.

## 工具清单（15）

| 工具 | 说明 |
| --- | --- |
| `proto_define_pattern` | 用分隔符、字节序和字段布局定义协议模式。 |
| `proto_auto_detect` | 从一个或多个十六进制负载样本自动检测协议模式。 |
| `proto_infer_fields` | 从重复的十六进制负载样本推断可能的协议字段。 |
| `proto_infer_state_machine` | 从捕获的消息序列推断协议状态机。 |
| `proto_export_schema` | 将协议模式导出为类 .proto 的 schema 定义。 |
| `proto_visualize_state` | 从协议状态机定义生成 Mermaid 状态图。 |
| `payload_template_build` | 待补充中文：Build a binary payload from declarative field definitions. Supports primitive numeric fields, raw bytes, and UTF-8 strings. |
| `payload_mutate` | 待补充中文：Apply deterministic byte-level mutations to a hex payload. Useful for protocol probing, boundary testing, and replay preparation. |
| `ethernet_frame_build` | 待补充中文：Build a deterministic Ethernet II frame from source/destination MAC addresses, EtherType, and payload bytes. |
| `arp_build` | 待补充中文：Build a deterministic ARP payload for Ethernet/IPv4 style address resolution packets. |
| `raw_ip_packet_build` | 待补充中文：Build a deterministic raw IPv4 or IPv6 packet header around an existing payload. IPv4 header checksum is computed automatically. |
| `icmp_echo_build` | 待补充中文：Build a deterministic ICMPv4 echo request or reply payload with an automatically computed checksum. |
| `checksum_apply` | 待补充中文：Apply a deterministic 16-bit Internet checksum across a payload slice, optionally zeroing and writing the checksum field back into the packet. |
| `pcap_write` | 待补充中文：Write a compact classic PCAP file from deterministic packet byte records. |
| `pcap_read` | 待补充中文：Read a classic PCAP file and return compact deterministic packet summaries. PCAPNG is intentionally not supported. |
