# Protocol Analysis

Domain: `protocol-analysis`

Custom protocol analysis domain supporting protocol pattern definition, automatic field detection from hex payloads, state machine inference from captured messages, and Mermaid diagram visualization.

## Profiles

- workflow
- full

## Typical scenarios

- Custom protocol pattern definition
- Automatic field boundary detection from hex payloads
- State machine inference from captured message sequences
- Mermaid state diagram generation

## Common combinations

- network + protocol-analysis
- encoding + protocol-analysis

## Representative tools

- `proto_define_pattern` — Define a protocol pattern with delimiter, byte order, and field layout
- `proto_auto_detect` — Auto-detect a protocol pattern from one or more hex payload samples
- `proto_infer_fields` — Infer likely protocol fields from repeated hex payload samples
- `proto_infer_state_machine` — Infer a protocol state machine from captured message sequences
- `proto_export_schema` — Export a protocol pattern to a .proto-like schema definition
- `proto_visualize_state` — Generate a Mermaid state diagram from a protocol state machine definition

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `proto_define_pattern` | Define a protocol pattern with delimiter, byte order, and field layout |
| `proto_auto_detect` | Auto-detect a protocol pattern from one or more hex payload samples |
| `proto_infer_fields` | Infer likely protocol fields from repeated hex payload samples |
| `proto_infer_state_machine` | Infer a protocol state machine from captured message sequences |
| `proto_export_schema` | Export a protocol pattern to a .proto-like schema definition |
| `proto_visualize_state` | Generate a Mermaid state diagram from a protocol state machine definition |
