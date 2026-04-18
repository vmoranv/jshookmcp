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
- `payload_template_build` — Build a binary payload from declarative field definitions. Supports primitive numeric fields, raw bytes, and UTF-8 strings.
- `payload_mutate` — Apply deterministic byte-level mutations to a hex payload. Useful for protocol probing, boundary testing, and replay preparation.
- `ethernet_frame_build` — Build a deterministic Ethernet II frame from source/destination MAC addresses, EtherType, and payload bytes.
- `arp_build` — Build a deterministic ARP payload for Ethernet/IPv4 style address resolution packets.

## Full tool list (15)

| Tool | Description |
| --- | --- |
| `proto_define_pattern` | Define a protocol pattern with delimiter, byte order, and field layout |
| `proto_auto_detect` | Auto-detect a protocol pattern from one or more hex payload samples |
| `proto_infer_fields` | Infer likely protocol fields from repeated hex payload samples |
| `proto_infer_state_machine` | Infer a protocol state machine from captured message sequences |
| `proto_export_schema` | Export a protocol pattern to a .proto-like schema definition |
| `proto_visualize_state` | Generate a Mermaid state diagram from a protocol state machine definition |
| `payload_template_build` | Build a binary payload from declarative field definitions. Supports primitive numeric fields, raw bytes, and UTF-8 strings. |
| `payload_mutate` | Apply deterministic byte-level mutations to a hex payload. Useful for protocol probing, boundary testing, and replay preparation. |
| `ethernet_frame_build` | Build a deterministic Ethernet II frame from source/destination MAC addresses, EtherType, and payload bytes. |
| `arp_build` | Build a deterministic ARP payload for Ethernet/IPv4 style address resolution packets. |
| `raw_ip_packet_build` | Build a deterministic raw IPv4 or IPv6 packet header around an existing payload. IPv4 header checksum is computed automatically. |
| `icmp_echo_build` | Build a deterministic ICMPv4 echo request or reply payload with an automatically computed checksum. |
| `checksum_apply` | Apply a deterministic 16-bit Internet checksum across a payload slice, optionally zeroing and writing the checksum field back into the packet. |
| `pcap_write` | Write a compact classic PCAP file from deterministic packet byte records. |
| `pcap_read` | Read a classic PCAP file and return compact deterministic packet summaries. PCAPNG is intentionally not supported. |
