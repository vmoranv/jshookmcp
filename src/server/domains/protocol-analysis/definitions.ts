import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const protocolAnalysisTools: Tool[] = [
  tool('payload_template_build', (t) =>
    t
      .desc('Build a deterministic payload from field definitions.')
      .array(
        'fields',
        {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Field name' },
            type: {
              type: 'string',
              enum: ['u8', 'u16', 'u32', 'i8', 'i16', 'i32', 'string', 'bytes'],
              description: 'Field type',
            },
            value: { description: 'Numeric or string field value' },
            encoding: {
              type: 'string',
              enum: ['utf8', 'ascii', 'hex', 'base64'],
              description: 'String/bytes encoding override',
            },
            length: { type: 'number', description: 'Optional fixed length' },
            padByte: { type: 'number', description: 'Optional pad byte' },
          },
          required: ['name', 'type', 'value'],
        },
        'Field definitions in output order',
      )
      .enum('endian', ['big', 'little'], 'Integer byte order', { default: 'big' })
      .required('fields')
      .idempotent(),
  ),
  tool('payload_mutate', (t) =>
    t
      .desc('Apply deterministic byte-level mutations to a hex payload.')
      .string('hexPayload', 'Source payload as a hex string')
      .array(
        'mutations',
        {
          type: 'object',
          properties: {
            strategy: {
              type: 'string',
              enum: [
                'set_byte',
                'flip_bit',
                'overwrite_bytes',
                'append_bytes',
                'truncate',
                'increment_integer',
              ],
              description: 'Mutation strategy',
            },
            offset: { type: 'number', description: 'Zero-based byte offset' },
            value: { type: 'number', description: 'Byte value for set_byte' },
            bit: { type: 'number', description: 'Bit index for flip_bit' },
            data: { type: 'string', description: 'Mutation data for overwrite/append' },
            encoding: {
              type: 'string',
              enum: ['utf8', 'ascii', 'hex', 'base64'],
              description: 'Data encoding for overwrite/append',
            },
            length: {
              type: 'number',
              description: 'Target length for truncate',
            },
            width: { type: 'number', enum: [1, 2, 4], description: 'Integer width in bytes' },
            delta: { type: 'number', description: 'Increment/decrement delta' },
            endian: {
              type: 'string',
              enum: ['big', 'little'],
              description: 'Integer byte order',
            },
            signed: { type: 'boolean', description: 'Treat increment target as signed' },
          },
          required: ['strategy'],
        },
        'Byte-level mutations to apply in order',
      )
      .required('hexPayload', 'mutations'),
  ),
  tool('ethernet_frame_build', (t) =>
    t
      .desc(
        'Build a deterministic Ethernet II frame from source/destination MAC addresses, EtherType, and payload bytes.',
      )
      .string('destinationMac', 'Destination MAC address in colon, dash, dotted, or plain hex form')
      .string('sourceMac', 'Source MAC address in colon, dash, dotted, or plain hex form')
      .string(
        'etherType',
        'EtherType name (arp, ipv4, ipv6, vlan) or a 16-bit hex value such as 0800',
      )
      .string('payloadHex', 'Frame payload as a hex string')
      .required('destinationMac', 'sourceMac', 'etherType', 'payloadHex')
      .idempotent(),
  ),
  tool('arp_build', (t) =>
    t
      .desc('Build a deterministic ARP payload for Ethernet/IPv4 style address resolution packets.')
      .enum('operation', ['request', 'reply'], 'ARP operation code', {
        default: 'request',
      })
      .string('senderMac', 'Sender hardware address')
      .string('senderIp', 'Sender IPv4 address')
      .string('targetMac', 'Target hardware address (use zeros for requests)', {
        default: '00:00:00:00:00:00',
      })
      .string('targetIp', 'Target IPv4 address')
      .number('hardwareType', 'Hardware type number. Default: 1 (Ethernet)', { default: 1 })
      .string('protocolType', 'Protocol type name (ipv4) or 16-bit hex value. Default: ipv4', {
        default: 'ipv4',
      })
      .number('hardwareSize', 'Hardware address size in bytes. Default: 6', { default: 6 })
      .number('protocolSize', 'Protocol address size in bytes. Default: 4', { default: 4 })
      .required('senderMac', 'senderIp', 'targetIp')
      .idempotent(),
  ),
  tool('raw_ip_packet_build', (t) =>
    t
      .desc('Build a deterministic IPv4 or IPv6 packet.')
      .enum('version', ['ipv4', 'ipv6'], 'IP version', { default: 'ipv4' })
      .string('sourceIp', 'Source IPv4/IPv6 address')
      .string('destinationIp', 'Destination IPv4/IPv6 address')
      .string(
        'protocol',
        'Protocol/next-header name (icmp, tcp, udp, icmpv6) or an 8-bit integer string/hex value',
      )
      .string('payloadHex', 'Inner payload as a hex string', { default: '' })
      .number('ttl', 'IPv4 TTL or IPv6 hop limit fallback. Default: 64', { default: 64 })
      .number('hopLimit', 'Explicit IPv6 hop limit override')
      .number('identification', 'IPv4 identification field. Default: 0', { default: 0 })
      .boolean('dontFragment', 'Set the IPv4 DF flag', { default: false })
      .boolean('moreFragments', 'Set the IPv4 MF flag', { default: false })
      .number('fragmentOffset', 'IPv4 fragment offset in 8-byte units. Default: 0', {
        default: 0,
      })
      .number('dscp', 'IPv4 DSCP or IPv6 traffic-class DSCP value (0-63). Default: 0', {
        default: 0,
      })
      .number('ecn', 'IPv4/IPv6 ECN bits (0-3). Default: 0', { default: 0 })
      .number('flowLabel', 'IPv6 flow label (0-1048575). Default: 0', { default: 0 })
      .required('version', 'sourceIp', 'destinationIp', 'protocol')
      .idempotent(),
  ),
  tool('icmp_echo_build', (t) =>
    t
      .desc(
        'Build a deterministic ICMPv4 echo request or reply payload with an automatically computed checksum.',
      )
      .enum('operation', ['request', 'reply'], 'ICMP echo operation', { default: 'request' })
      .number('identifier', 'ICMP echo identifier field. Default: 0', { default: 0 })
      .number('sequenceNumber', 'ICMP echo sequence number field. Default: 0', { default: 0 })
      .string('payloadHex', 'Optional ICMP payload as a hex string', { default: '' })
      .idempotent(),
  ),
  tool('checksum_apply', (t) =>
    t
      .desc(
        'Apply a deterministic 16-bit Internet checksum across a payload slice, optionally zeroing and writing the checksum field back into the packet.',
      )
      .string('hexPayload', 'Source payload as a hex string')
      .number('startOffset', 'Inclusive start offset for checksum range. Default: 0', {
        default: 0,
      })
      .number('endOffset', 'Exclusive end offset for checksum range. Default: payload length')
      .number('zeroOffset', 'Optional checksum field offset to zero before calculation')
      .number('zeroLength', 'Checksum field width in bytes when zeroOffset is set. Default: 2', {
        default: 2,
      })
      .number(
        'writeOffset',
        'Optional destination offset for writing the computed checksum. Defaults to zeroOffset when provided',
      )
      .enum('endian', ['big', 'little'], 'Byte order used when writing the checksum back', {
        default: 'big',
      })
      .required('hexPayload')
      .idempotent(),
  ),
  tool('pcap_write', (t) =>
    t
      .desc('Write a compact classic PCAP file from deterministic packet byte records.')
      .string('path', 'Destination path for the PCAP file')
      .array(
        'packets',
        {
          type: 'object',
          properties: {
            dataHex: { type: 'string', description: 'Packet bytes as a hex string' },
            timestampSeconds: {
              type: 'number',
              description: 'Unix timestamp seconds. Defaults to 0 when omitted',
            },
            timestampFraction: {
              type: 'number',
              description: 'Microsecond or nanosecond fraction depending on timestampPrecision',
            },
            originalLength: {
              type: 'number',
              description: 'Original on-wire packet length. Defaults to included length',
            },
          },
          required: ['dataHex'],
        },
        'Packet records to serialize in order',
      )
      .enum('endianness', ['little', 'big'], 'PCAP byte order for numeric fields', {
        default: 'little',
      })
      .enum(
        'timestampPrecision',
        ['micro', 'nano'],
        'Timestamp precision marker in the PCAP magic',
        {
          default: 'micro',
        },
      )
      .number('snapLength', 'Global snapshot length. Default: 65535', { default: 65535 })
      .string('linkType', 'Link-layer type name (ethernet, raw, loopback) or integer string', {
        default: 'ethernet',
      })
      .required('path', 'packets')
      .idempotent(),
  ),
  tool('pcap_read', (t) =>
    t
      .desc(
        'Read a classic PCAP file and return compact deterministic packet summaries. PCAPNG is intentionally not supported.',
      )
      .string('path', 'Path to the PCAP file to parse')
      .number('maxPackets', 'Maximum number of packet records to decode')
      .number(
        'maxBytesPerPacket',
        'Maximum payload bytes to return per packet before truncating the reported hex payload',
      )
      .required('path')
      .query(),
  ),
  tool('proto_define_pattern', (t) =>
    t
      .desc('Define a protocol pattern with delimiter, byte order, and field layout')
      .string('name', 'Pattern name')
      .prop('spec', {
        type: 'object',
        description: 'Pattern specification object',
        additionalProperties: true,
      })
      .required('spec')
      .idempotent(),
  ),
  tool('proto_auto_detect', (t) =>
    t
      .desc('Auto-detect a protocol pattern from one or more hex payload samples')
      .array('hexPayloads', { type: 'string' }, 'Hex payload samples')
      .required('hexPayloads')
      .query(),
  ),
  tool('proto_export_schema', (t) =>
    t
      .desc('Export a protocol pattern to a .proto-like schema definition')
      .string('patternId', 'Pattern ID to export')
      .required('patternId')
      .query(),
  ),
  tool('proto_infer_fields', (t) =>
    t
      .desc('Infer likely protocol fields from repeated hex payload samples')
      .array('hexPayloads', { type: 'string' }, 'Hex payload samples')
      .required('hexPayloads')
      .query(),
  ),
  tool('proto_infer_state_machine', (t) =>
    t
      .desc('Infer a protocol state machine from captured message sequences')
      .array(
        'messages',
        {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['req', 'res'], description: 'Message direction' },
            timestamp: { type: 'number', description: 'Message timestamp' },
            fields: {
              type: 'object',
              description: 'Decoded message fields',
              additionalProperties: true,
            },
            raw: { type: 'string', description: 'Raw message or payload summary' },
          },
          required: ['direction', 'timestamp', 'fields', 'raw'],
        },
        'Captured protocol messages',
      )
      .required('messages')
      .query(),
  ),
  tool('proto_visualize_state', (t) =>
    t
      .desc('Generate a Mermaid state diagram from a protocol state machine definition')
      .prop('stateMachine', {
        type: 'object',
        description: 'State machine definition with states and transitions',
        additionalProperties: true,
      })
      .query(),
  ),
];
