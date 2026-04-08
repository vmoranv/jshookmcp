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

- `proto_define_pattern` — 待补充中文：Define a protocol pattern with delimiter, byte order, and field layout
- `proto_auto_detect` — 待补充中文：Auto-detect a protocol pattern from one or more hex payload samples
- `proto_infer_fields` — 待补充中文：Infer likely protocol fields from repeated hex payload samples
- `proto_infer_state_machine` — 待补充中文：Infer a protocol state machine from captured message sequences
- `proto_export_schema` — 待补充中文：Export a protocol pattern to a .proto-like schema definition
- `proto_visualize_state` — 待补充中文：Generate a Mermaid state diagram from a protocol state machine definition

## 工具清单（6）

| 工具 | 说明 |
| --- | --- |
| `proto_define_pattern` | 待补充中文：Define a protocol pattern with delimiter, byte order, and field layout |
| `proto_auto_detect` | 待补充中文：Auto-detect a protocol pattern from one or more hex payload samples |
| `proto_infer_fields` | 待补充中文：Infer likely protocol fields from repeated hex payload samples |
| `proto_infer_state_machine` | 待补充中文：Infer a protocol state machine from captured message sequences |
| `proto_export_schema` | 待补充中文：Export a protocol pattern to a .proto-like schema definition |
| `proto_visualize_state` | 待补充中文：Generate a Mermaid state diagram from a protocol state machine definition |
