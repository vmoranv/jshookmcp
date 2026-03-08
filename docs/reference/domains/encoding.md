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

- `binary_detect_format` — Detect binary payload format/encoding via magic bytes, encoding heuristics, and Shannon entropy.
- `binary_decode` — Decode binary payloads (base64/hex/url/protobuf/msgpack) into hex, utf8, or json output.
- `binary_encode` — Encode utf8/hex/json input into base64/hex/url output.
- `binary_entropy_analysis` — Compute Shannon entropy + byte frequency distribution to assess plaintext/encoded/compressed/encrypted/random likelihood.
- `protobuf_decode_raw` — Decode base64 protobuf bytes without schema using wire-type aware recursive parser.

## 工具清单（5）

| 工具                      | 说明                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `binary_detect_format`    | Detect binary payload format/encoding via magic bytes, encoding heuristics, and Shannon entropy.                          |
| `binary_decode`           | Decode binary payloads (base64/hex/url/protobuf/msgpack) into hex, utf8, or json output.                                  |
| `binary_encode`           | Encode utf8/hex/json input into base64/hex/url output.                                                                    |
| `binary_entropy_analysis` | Compute Shannon entropy + byte frequency distribution to assess plaintext/encoded/compressed/encrypted/random likelihood. |
| `protobuf_decode_raw`     | Decode base64 protobuf bytes without schema using wire-type aware recursive parser.                                       |
