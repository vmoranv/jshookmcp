# Protocol Analysis

Domain: `protocol-analysis`

Custom protocol analysis domain supporting protocol pattern definition, automatic field detection from hex payloads, state machine inference from captured messages, and Mermaid diagram visualization.

## Profiles

- full

## Typical scenarios

- Custom protocol pattern definition
- Automatic field boundary detection from hex payloads
- State machine inference from captured message sequences
- Mermaid state diagram generation

## Common combinations

- network + protocol-analysis
- encoding + protocol-analysis

## Full tool list (20)

| Tool | Description |
| --- | --- |
| `proto_define_pattern` | Define a protocol pattern with delimiter, byte order, and field layout. |
| `proto_auto_detect` | Auto-detect a protocol pattern from one or more hex payload samples. |
| `proto_infer_fields` | Infer likely protocol fields from repeated hex payload samples. |
| `proto_infer_state_machine` | Infer a protocol state machine from captured message sequences. |
| `proto_export_schema` | Export a protocol pattern to a schema definition. format: proto (default, .proto-like text), ksy (Kaitai Struct for Wireshark/010 Editor), json-schema (draft-07). |
| `proto_visualize_state` | Generate a Mermaid state diagram from a protocol state machine definition. |
| `payload_template_build` | Build a deterministic payload from field definitions. |
| `payload_mutate` | Apply deterministic byte-level mutations to a hex payload. |
| `ethernet_frame_build` | Build a deterministic Ethernet II frame from source/destination MAC addresses, EtherType, and payload bytes. |
| `arp_build` | Build a deterministic ARP payload for Ethernet/IPv4. |
| `raw_ip_packet_build` | Build a deterministic IPv4 or IPv6 packet. |
| `icmp_echo_build` | Build a deterministic ICMPv4 echo request or reply payload with an automatically computed checksum. |
| `checksum_apply` | Apply a deterministic 16-bit Internet checksum across a payload slice, optionally zeroing and writing the checksum field back into the packet. |
| `pcap_write` | Write a compact classic PCAP file from deterministic packet byte records. |
| `pcap_read` | Read a classic PCAP file and return compact deterministic packet summaries. PCAPNG is intentionally not supported. |
| `pcapng_write` | Write a PCAPNG (pcap-ng) capture file from one or more interfaces and deterministic packet byte records. Emits a Section Header Block, an Interface Description Block per interface, and an Enhanced Packet Block per packet. |
| `pcapng_read` | Read a PCAPNG (pcap-ng) capture file and return structured Section/Interface/Packet blocks. Supports Section Header, Interface Description, Enhanced/Simple Packet, Name Resolution, and Interface Statistics blocks; unknown block types are surfaced as warnings. For multi-MB captures pass async:true to parse in a background task (MCP 2.0 Tasks) and poll with tasks_get/tasks_result instead of blocking this call. |
| `proto_dissect_dns` | Dissect a raw DNS payload (RFC 1035 + EDNS(0)) into header flags, questions, answers, authorities, and additionals with full compression-pointer handling and OPT pseudo-record decoding. |
| `proto_dissect_http` | Dissect a raw HTTP/1.x request or response payload (RFC 7230) into the start line, headers, and body. Unwinds chunked transfer-encoding and reports Content-Length / Content-Type / Content-Encoding hints. |
| `proto_fingerprint` | Identify protocol type from hex payload samples. |
