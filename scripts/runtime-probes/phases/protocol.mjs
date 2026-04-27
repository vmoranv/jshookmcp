import { join } from 'node:path';

export async function runProtocolPhase(ctx) {
  const { report, clients, helpers, state } = ctx;
  const { client } = clients;
  const { callTool } = helpers;

  const pcapPath = join(state.platformProbeDir, 'runtime-audit.pcap');
  report.protocol.payloadTemplate = await callTool(
    client,
    'payload_template_build',
    {
      fields: [
        { name: 'magic', type: 'u16', value: 0x1234 },
        { name: 'tag', type: 'string', value: 'OK', encoding: 'ascii', length: 4, padByte: 0x20 },
        { name: 'tail', type: 'bytes', value: 'aabb', encoding: 'hex' },
      ],
      endian: 'big',
    },
    15000,
  );
  report.protocol.payloadMutate = await callTool(
    client,
    'payload_mutate',
    {
      hexPayload: '001020',
      mutations: [
        { strategy: 'set_byte', offset: 1, value: 255 },
        { strategy: 'flip_bit', offset: 2, bit: 0 },
        { strategy: 'append_bytes', data: 'aa', encoding: 'hex' },
      ],
    },
    15000,
  );
  report.protocol.ethernet = await callTool(
    client,
    'ethernet_frame_build',
    {
      destinationMac: 'aa:bb:cc:dd:ee:ff',
      sourceMac: '11:22:33:44:55:66',
      etherType: 'ipv4',
      payloadHex: '4500',
    },
    15000,
  );
  report.protocol.arp = await callTool(
    client,
    'arp_build',
    {
      operation: 'request',
      senderMac: '11:22:33:44:55:66',
      senderIp: '192.0.2.10',
      targetIp: '192.0.2.1',
    },
    15000,
  );
  report.protocol.rawIp = await callTool(
    client,
    'raw_ip_packet_build',
    {
      version: 'ipv4',
      sourceIp: '192.0.2.1',
      destinationIp: '198.51.100.2',
      protocol: 'icmp',
      identification: 1,
      dontFragment: true,
      ttl: 64,
      payloadHex: '08000000',
    },
    15000,
  );
  report.protocol.icmpEcho = await callTool(
    client,
    'icmp_echo_build',
    {
      operation: 'request',
      identifier: 1,
      sequenceNumber: 2,
      payloadHex: 'aabb',
    },
    15000,
  );
  report.protocol.checksum = await callTool(
    client,
    'checksum_apply',
    {
      hexPayload: '0800000000010002aabb',
      zeroOffset: 2,
      zeroLength: 2,
      writeOffset: 2,
    },
    15000,
  );
  report.protocol.pcapWrite = await callTool(
    client,
    'pcap_write',
    {
      path: pcapPath,
      packets: [
        {
          dataHex: '001122334455aabbccddeeff08000102',
          timestampSeconds: 1700000000,
          timestampFraction: 1234,
        },
        {
          dataHex: '08004d4100010002aabb',
          timestampSeconds: 1700000001,
          timestampFraction: 5678,
          originalLength: 10,
        },
      ],
      linkType: 'ethernet',
    },
    15000,
  );
  report.protocol.pcapRead = await callTool(
    client,
    'pcap_read',
    { path: pcapPath, maxPackets: 2 },
    15000,
  );
  const protocolSamples = ['aa550110beef', 'aa550111be00', 'aa550112be01'];
  report.protocol.definePattern = await callTool(
    client,
    'proto_define_pattern',
    {
      name: 'runtime_audit_proto',
      spec: {
        fields: [
          { name: 'magic', offset: 0, length: 2, type: 'int' },
          { name: 'opcode', offset: 2, length: 1, type: 'int' },
          { name: 'sequence', offset: 3, length: 1, type: 'int' },
          { name: 'payload', offset: 4, length: 2, type: 'bytes' },
        ],
        byteOrder: 'be',
      },
    },
    15000,
  );
  report.protocol.autoDetect = await callTool(
    client,
    'proto_auto_detect',
    { hexPayloads: protocolSamples, name: 'runtime_audit_auto' },
    15000,
  );
  report.protocol.inferFields = await callTool(
    client,
    'proto_infer_fields',
    { hexPayloads: protocolSamples },
    15000,
  );
  report.protocol.exportSchema = await callTool(
    client,
    'proto_export_schema',
    { patternId: 'runtime_audit_proto' },
    15000,
  );
  report.protocol.inferStateMachine = await callTool(
    client,
    'proto_infer_state_machine',
    {
      messages: [
        {
          direction: 'req',
          timestamp: 1,
          fields: { opcode: 'hello', sequence: 1 },
          raw: 'HELLO',
        },
        {
          direction: 'res',
          timestamp: 2,
          fields: { opcode: 'ack', sequence: 1 },
          raw: 'ACK',
        },
      ],
    },
    15000,
  );
  report.protocol.visualizeState = await callTool(
    client,
    'proto_visualize_state',
    { stateMachine: report.protocol.inferStateMachine?.stateMachine ?? null },
    15000,
  );
}
