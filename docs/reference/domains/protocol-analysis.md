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

## 工具清单（6）

| 工具 | 说明 |
| --- | --- |
| `proto_define_pattern` | 用分隔符、字节序和字段布局定义协议模式。 |
| `proto_auto_detect` | 从一个或多个十六进制负载样本自动检测协议模式。 |
| `proto_infer_fields` | 从重复的十六进制负载样本推断可能的协议字段。 |
| `proto_infer_state_machine` | 从捕获的消息序列推断协议状态机。 |
| `proto_export_schema` | 将协议模式导出为类 .proto 的 schema 定义。 |
| `proto_visualize_state` | 从协议状态机定义生成 Mermaid 状态图。 |
