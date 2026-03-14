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

<details>
<summary><b>Encoding & Decoding</b> (5 tools)</summary>

| Tool                      | Description                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `binary_detect_format`    | Detect binary payload format/encoding via magic bytes, encoding heuristics, and Shannon entropy.                          |
| `binary_decode`           | Decode binary payloads (base64/hex/url/protobuf/msgpack) into hex, utf8, or json output.                                  |
| `binary_encode`           | Encode utf8/hex/json input into base64/hex/url output.                                                                    |
| `binary_entropy_analysis` | Compute Shannon entropy + byte frequency distribution to assess plaintext/encoded/compressed/encrypted/random likelihood. |
| `protobuf_decode_raw`     | Decode base64 protobuf bytes without schema using wire-type aware recursive parser.                                       |

</details>
