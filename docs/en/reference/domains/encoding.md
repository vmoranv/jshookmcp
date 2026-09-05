# Encoding

Domain: `encoding`

Binary format detection, encoding conversion, entropy analysis, and raw protobuf decoding.

## Profiles

- workflow
- full

## Typical scenarios

- Identify unknown payload formats
- Convert between encodings
- Decode schema-less protobuf payloads

## Common combinations

- network + encoding

## Full tool list (5)

| Tool | Description |
| --- | --- |
| `binary_detect_format` | Detect binary payload format and encoding signals. |
| `binary_decode` | Decode binary payloads, transport encodings, and compressed blobs into hex, utf8, or json output. |
| `binary_encode` | Encode utf8/hex/json input into transport encodings or compressed base64 blobs. |
| `binary_entropy_analysis` | Compute entropy and byte frequency for a payload. |
| `protobuf_decode_raw` | Decode protobuf bytes. Raw wire-format walk by default; schema mode returns ProtoJSON, expands valid google.protobuf.Any messages, preserves open-enum numeric values, and reports unknown fields with raw bytes plus wire details. |
