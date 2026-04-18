# Encoding

域名：`encoding`

二进制格式检测、编码转换、熵分析与 protobuf 原始解码。

## Profile

- workflow
- full

## 典型场景

- payload 判型
- 编码互转
- 未知 protobuf 粗解码

## 常见组合

- network + encoding

## 代表工具

- `binary_detect_format` — 基于魔数、编码特征与熵值检测二进制载荷格式。
- `binary_decode` — 将二进制载荷解码为 hex、utf8 或 JSON。
- `binary_encode` — 将 utf8、hex 或 JSON 输入编码为目标格式。
- `binary_entropy_analysis` — 计算香农熵与字节分布，用于判断载荷特征。
- `protobuf_decode_raw` — 在无 schema 条件下递归解析 base64 编码的 Protobuf 数据。

## 工具清单（5）

| 工具 | 说明 |
| --- | --- |
| `binary_detect_format` | 基于魔数、编码特征与熵值检测二进制载荷格式。 |
| `binary_decode` | 将二进制载荷解码为 hex、utf8 或 JSON。 |
| `binary_encode` | 将 utf8、hex 或 JSON 输入编码为目标格式。 |
| `binary_entropy_analysis` | 计算香农熵与字节分布，用于判断载荷特征。 |
| `protobuf_decode_raw` | 在无 schema 条件下递归解析 base64 编码的 Protobuf 数据。 |
