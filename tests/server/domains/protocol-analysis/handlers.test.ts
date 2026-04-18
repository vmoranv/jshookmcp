import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtocolAnalysisHandlers } from '@server/domains/protocol-analysis/handlers';

describe('ProtocolAnalysisHandlers', () => {
  let handlers: ProtocolAnalysisHandlers;
  const eventBus = { emit: vi.fn() } as any;
  const tempDirs: string[] = [];

  beforeEach(() => {
    eventBus.emit.mockClear();
    handlers = new ProtocolAnalysisHandlers(undefined, undefined, eventBus);
  });

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  describe('handleDefinePattern', () => {
    it('defines a pattern and returns patternId', async () => {
      const result = await handlers.handleDefinePattern({
        name: 'test_proto',
        fields: [
          { name: 'magic', type: 'uint16', offset: 0, length: 2 },
          { name: 'data', type: 'string', offset: 2, length: 10 },
        ],
        byteOrder: 'big',
      });

      expect(result.patternId).toBe('test_proto');
      expect(result.pattern.name).toBe('test_proto');
      expect(result.pattern.fields).toHaveLength(2);
    });

    it('uses default name when not provided', async () => {
      const result = await handlers.handleDefinePattern({
        fields: [],
      });

      expect(result.patternId).toBe('unnamed_pattern');
    });

    it('handles empty fields', async () => {
      const result = await handlers.handleDefinePattern({
        name: 'empty',
        fields: [],
      });

      expect(result.pattern.fields).toEqual([]);
    });

    it('applies little endian byte order', async () => {
      const result = await handlers.handleDefinePattern({
        name: 'le',
        fields: [],
        byteOrder: 'little',
      });

      expect(result.pattern.byteOrder).toBe('little');
    });

    it('includes encryption info', async () => {
      const result = await handlers.handleDefinePattern({
        name: 'encrypted',
        fields: [],
        encryption: { type: 'aes', key: 'test', notes: 'AES-256' },
      });

      expect(result.pattern.encryption?.type).toBe('aes');
    });
  });

  describe('handleAutoDetect', () => {
    it('detects pattern from hex payloads', async () => {
      const result = await handlers.handleAutoDetect({
        payloads: ['deadc0de0100', 'deadc0de0200'],
      });

      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0]?.fields.length).toBeGreaterThan(0);
    });

    it('returns empty fields for no common structure', async () => {
      const result = await handlers.handleAutoDetect({
        payloads: ['aa', 'bb'],
      });

      expect(result.patterns).toHaveLength(1);
    });

    it('handles empty payloads array', async () => {
      const result = await handlers.handleAutoDetect({
        payloads: [],
      });

      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0]?.fields).toHaveLength(0);
    });

    it('uses optional name', async () => {
      const result = await handlers.handleAutoDetect({
        payloads: ['aabbcc'],
        name: 'custom_name',
      });

      expect(result.patterns[0]?.name).toBe('custom_name');
    });
  });

  describe('handleExportSchema', () => {
    it('exports schema for defined pattern', async () => {
      await handlers.handleDefinePattern({
        name: 'exportable',
        fields: [{ name: 'version', type: 'uint8', offset: 0, length: 1 }],
      });

      const result = await handlers.handleExportSchema({
        patternId: 'exportable',
      });

      expect(result.schema).toContain('message Exportable');
      expect(result.schema).toContain('uint32 version = 1');
    });

    it('returns error for unknown pattern', async () => {
      const result = await handlers.handleExportSchema({
        patternId: 'nonexistent',
      });

      expect(result.schema).toContain('not found');
    });

    it('exports empty pattern', async () => {
      await handlers.handleDefinePattern({
        name: 'empty_proto',
        fields: [],
      });

      const result = await handlers.handleExportSchema({
        patternId: 'empty_proto',
      });

      expect(result.schema).toContain('message EmptyProto');
    });
  });

  describe('handleInferStateMachine', () => {
    it('infers state machine from messages', async () => {
      const result = await handlers.handleInferStateMachine({
        messages: [
          { direction: 'out', payloadHex: '0100', timestamp: 1000 },
          { direction: 'in', payloadHex: '0200', timestamp: 1100 },
          { direction: 'out', payloadHex: '0300', timestamp: 1200 },
        ],
      });

      expect(result.stateMachine.states.length).toBeGreaterThan(0);
      expect(result.stateMachine.initialState).toBeDefined();
    });

    it('handles empty messages', async () => {
      const result = await handlers.handleInferStateMachine({
        messages: [],
      });

      expect(result.stateMachine.states).toEqual([]);
    });

    it('applies simplify option', async () => {
      const messages = [
        { direction: 'out', payloadHex: 'aaaa000011112222', timestamp: 1000 },
        { direction: 'in', payloadHex: 'aaaa0000abcdef01', timestamp: 1100 },
        { direction: 'out', payloadHex: 'bbbb000011223344', timestamp: 1200 },
      ];

      const resultWithoutSimplify = await handlers.handleInferStateMachine({
        messages,
        simplify: false,
      });

      const resultWithSimplify = await handlers.handleInferStateMachine({
        messages,
        simplify: true,
      });

      // Simplified version may have fewer states
      expect(resultWithSimplify.stateMachine.states.length).toBeLessThanOrEqual(
        resultWithoutSimplify.stateMachine.states.length,
      );
    });

    it('handles invalid hex gracefully', async () => {
      const result = await handlers.handleInferStateMachine({
        messages: [
          { direction: 'out', payloadHex: 'invalid' },
          { direction: 'in', payloadHex: 'also_invalid' },
        ],
      });

      // Should still produce a state machine (with empty buffers)
      expect(result.stateMachine).toBeDefined();
    });

    it('infers confidence scores', async () => {
      const result = await handlers.handleInferStateMachine({
        messages: [
          { direction: 'out', payloadHex: 'aa' },
          { direction: 'in', payloadHex: 'bb' },
          { direction: 'out', payloadHex: 'cc' },
        ],
      });

      for (const t of result.stateMachine.transitions) {
        expect(t.confidence).toBeGreaterThanOrEqual(0);
        expect(t.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('handleVisualizeState', () => {
    it('generates mermaid diagram', async () => {
      const result = await handlers.handleVisualizeState({
        stateMachine: {
          states: [
            { id: 's0', name: 'init' },
            { id: 's1', name: 'process' },
          ],
          transitions: [{ from: 's0', to: 's1', trigger: 'send', confidence: 1.0 }],
          initialState: 's0',
          finalStates: ['s1'],
        },
      });

      expect(result.mermaidDiagram).toContain('stateDiagram-v2');
      expect(result.mermaidDiagram).toContain('[*] --> s0');
      expect(result.mermaidDiagram).toContain('s0 --> s1');
    });

    it('returns empty diagram for undefined state machine', async () => {
      const result = await handlers.handleVisualizeState({});

      expect(result.mermaidDiagram).toContain('stateDiagram-v2');
      expect(result.mermaidDiagram).toContain('[*] --> empty');
    });

    it('returns empty diagram for null state machine', async () => {
      const result = await handlers.handleVisualizeState({
        stateMachine: null,
      });

      expect(result.mermaidDiagram).toContain('[*] --> empty');
    });
  });

  describe('handlePayloadTemplateBuild', () => {
    it('builds a deterministic payload from mixed field types', async () => {
      const result = await handlers.handlePayloadTemplateBuild({
        fields: [
          { name: 'magic', type: 'u16', value: 0x1234 },
          { name: 'tag', type: 'string', value: 'OK', encoding: 'ascii', length: 4, padByte: 0x20 },
          { name: 'tail', type: 'bytes', value: 'aabb', encoding: 'hex' },
        ],
        endian: 'big',
      });

      expect(result.success).toBe(true);
      expect(result.hexPayload).toBe('12344f4b2020aabb');
      expect(result.byteLength).toBe(8);
      expect(result.fields).toEqual([
        { name: 'magic', offset: 0, length: 2, hex: '1234' },
        { name: 'tag', offset: 2, length: 4, hex: '4f4b2020' },
        { name: 'tail', offset: 6, length: 2, hex: 'aabb' },
      ]);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'protocol:payload_built',
        expect.objectContaining({ byteLength: 8, fieldCount: 3 }),
      );
    });

    it('applies little endian encoding and deterministic truncation', async () => {
      const result = await handlers.handlePayloadTemplateBuild({
        fields: [
          { name: 'counter', type: 'u16', value: 0x1234 },
          { name: 'label', type: 'string', value: 'hello', length: 3 },
        ],
        endian: 'little',
      });

      expect(result.success).toBe(true);
      expect(result.hexPayload).toBe('341268656c');
    });

    it('returns an error for out-of-range numeric values', async () => {
      const result = await handlers.handlePayloadTemplateBuild({
        fields: [{ name: 'bad', type: 'u8', value: 999 }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('out of range');
      expect(result.hexPayload).toBe('');
    });
  });

  describe('handlePayloadMutate', () => {
    it('applies mutations in order and reports applied strategies', async () => {
      const result = await handlers.handlePayloadMutate({
        hexPayload: '001020',
        mutations: [
          { strategy: 'set_byte', offset: 1, value: 255 },
          { strategy: 'flip_bit', offset: 2, bit: 0 },
          { strategy: 'append_bytes', data: 'aa', encoding: 'hex' },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.originalHex).toBe('001020');
      expect(result.mutatedHex).toBe('00ff21aa');
      expect(result.appliedMutations.map((entry) => entry.strategy)).toEqual([
        'set_byte',
        'flip_bit',
        'append_bytes',
      ]);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'protocol:payload_mutated',
        expect.objectContaining({ byteLength: 4, mutationCount: 3 }),
      );
    });

    it('supports signed little-endian integer mutation', async () => {
      const result = await handlers.handlePayloadMutate({
        hexPayload: 'feff',
        mutations: [
          {
            strategy: 'increment_integer',
            offset: 0,
            width: 2,
            delta: 1,
            endian: 'little',
            signed: true,
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.mutatedHex).toBe('ffff');
    });

    it('returns a structured error for invalid payload hex', async () => {
      const result = await handlers.handlePayloadMutate({
        hexPayload: 'xyz',
        mutations: [{ strategy: 'truncate', length: 0 }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('valid even-length hex string');
      expect(result.mutatedHex).toBe('');
    });
  });

  describe('handleEthernetFrameBuild', () => {
    it('builds a deterministic Ethernet II frame and emits an event', async () => {
      const result = await handlers.handleEthernetFrameBuild({
        destinationMac: 'aa:bb:cc:dd:ee:ff',
        sourceMac: '11:22:33:44:55:66',
        etherType: 'ipv4',
        payloadHex: '4500',
      });

      expect(result.success).toBe(true);
      expect(result.headerHex).toBe('aabbccddeeff1122334455660800');
      expect(result.frameHex).toBe('aabbccddeeff11223344556608004500');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'protocol:ethernet_frame_built',
        expect.objectContaining({ byteLength: 16, etherType: '0x0800' }),
      );
    });
  });

  describe('handleArpBuild', () => {
    it('builds an ARP request payload and emits an event', async () => {
      const result = await handlers.handleArpBuild({
        operation: 'request',
        senderMac: '11:22:33:44:55:66',
        senderIp: '192.0.2.10',
        targetIp: '192.0.2.1',
      });

      expect(result.success).toBe(true);
      expect(result.payloadHex).toBe('0001080006040001112233445566c000020a000000000000c0000201');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'protocol:arp_built',
        expect.objectContaining({ operation: 'request', byteLength: 28 }),
      );
    });
  });

  describe('handleRawIpPacketBuild', () => {
    it('builds an IPv4 packet with a computed header checksum', async () => {
      const result = await handlers.handleRawIpPacketBuild({
        version: 'ipv4',
        sourceIp: '192.0.2.1',
        destinationIp: '198.51.100.2',
        protocol: 'icmp',
        identification: 1,
        dontFragment: true,
        ttl: 64,
        payloadHex: '08000000',
      });

      expect(result.success).toBe(true);
      expect(result.headerHex).toBe('450000180001400040014eadc0000201c6336402');
      expect(result.packetHex).toBe('450000180001400040014eadc0000201c633640208000000');
      expect(result.checksumHex).toBe('4ead');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'protocol:ip_packet_built',
        expect.objectContaining({ version: 'ipv4', protocol: 1, byteLength: 24 }),
      );
    });

    it('builds an IPv6 packet without a header checksum', async () => {
      const result = await handlers.handleRawIpPacketBuild({
        version: 'ipv6',
        sourceIp: '2001:db8::1',
        destinationIp: '2001:db8::2',
        protocol: 'udp',
        hopLimit: 32,
        payloadHex: '0001',
      });

      expect(result.success).toBe(true);
      expect(result.headerHex).toBe(
        '600000000002112020010db800000000000000000000000120010db8000000000000000000000002',
      );
      expect(result.checksumHex).toBeNull();
    });
  });

  describe('handleChecksumApply', () => {
    it('computes and inserts an Internet checksum deterministically', async () => {
      const result = await handlers.handleChecksumApply({
        hexPayload: '450000730000400040110000c0a80001c0a800c7',
        zeroOffset: 10,
        writeOffset: 10,
      });

      expect(result.success).toBe(true);
      expect(result.checksumHex).toBe('b861');
      expect(result.mutatedHex).toBe('45000073000040004011b861c0a80001c0a800c7');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'protocol:checksum_applied',
        expect.objectContaining({ checksumHex: 'b861', byteLength: 20 }),
      );
    });
  });

  describe('handlePcapWrite/handlePcapRead', () => {
    it('writes and reads a compact classic PCAP file', async () => {
      const path = join(tmpdir(), `protocol-analysis-${Date.now()}-${Math.random()}.pcap`);

      try {
        const writeResult = await handlers.handlePcapWrite({
          path,
          packets: [
            {
              dataHex: 'aabbccdd',
              timestampSeconds: 1,
              timestampFraction: 2,
            },
          ],
        });

        expect(writeResult.success).toBe(true);
        expect(writeResult.packetCount).toBe(1);
        expect(eventBus.emit).toHaveBeenCalledWith(
          'protocol:pcap_written',
          expect.objectContaining({ path, packetCount: 1 }),
        );

        eventBus.emit.mockClear();

        const readResult = await handlers.handlePcapRead({
          path,
          maxPackets: 1,
          maxBytesPerPacket: 4,
        });

        expect(readResult.success).toBe(true);
        expect(readResult.header?.endianness).toBe('little');
        expect(readResult.header?.linkType).toBe(1);
        expect(readResult.packets).toEqual([
          {
            index: 0,
            timestampSeconds: 1,
            timestampFraction: 2,
            includedLength: 4,
            originalLength: 4,
            dataHex: 'aabbccdd',
            truncated: false,
          },
        ]);
        expect(eventBus.emit).toHaveBeenCalledWith(
          'protocol:pcap_read',
          expect.objectContaining({ path, packetCount: 1 }),
        );
      } finally {
        await rm(path, { force: true });
      }
    });
  });

  describe('low-level packet builders', () => {
    it('builds an Ethernet II frame deterministically', async () => {
      const result = await handlers.handleEthernetFrameBuild({
        destinationMac: '00:11:22:33:44:55',
        sourceMac: 'aa-bb-cc-dd-ee-ff',
        etherType: 'ipv4',
        payloadHex: '0102',
      });

      expect(result.success).toBe(true);
      expect(result.frameHex).toBe('001122334455aabbccddeeff08000102');
      expect(result.headerHex).toBe('001122334455aabbccddeeff0800');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'protocol:ethernet_frame_built',
        expect.objectContaining({ byteLength: 16, etherType: '0x0800' }),
      );
    });

    it('builds an ARP request payload deterministically', async () => {
      const result = await handlers.handleArpBuild({
        operation: 'request',
        senderMac: '02:00:00:00:00:01',
        senderIp: '192.168.0.10',
        targetIp: '192.168.0.1',
      });

      expect(result.success).toBe(true);
      expect(result.payloadHex).toBe('0001080006040001020000000001c0a8000a000000000000c0a80001');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'protocol:arp_built',
        expect.objectContaining({ operation: 'request', byteLength: 28 }),
      );
    });

    it('builds IPv4 and IPv6 packets with deterministic headers', async () => {
      const ipv4 = await handlers.handleRawIpPacketBuild({
        version: 'ipv4',
        sourceIp: '192.0.2.1',
        destinationIp: '198.51.100.2',
        protocol: 'icmp',
        payloadHex: 'aabb',
        ttl: 32,
        identification: 0x1234,
        dontFragment: true,
      });
      const ipv6 = await handlers.handleRawIpPacketBuild({
        version: 'ipv6',
        sourceIp: '2001:db8::1',
        destinationIp: '2001:db8::2',
        protocol: 'icmpv6',
        payloadHex: '01020304',
        hopLimit: 12,
        flowLabel: 0x12345,
      });

      expect(ipv4.success).toBe(true);
      expect(ipv4.version).toBe('ipv4');
      expect(ipv4.headerLength).toBe(20);
      expect(ipv4.payloadHex).toBe('aabb');
      expect(ipv4.packetHex.endsWith('aabb')).toBe(true);
      expect(ipv4.checksumHex).toHaveLength(4);

      expect(ipv6.success).toBe(true);
      expect(ipv6.version).toBe('ipv6');
      expect(ipv6.headerLength).toBe(40);
      expect(ipv6.payloadHex).toBe('01020304');
      expect(ipv6.packetHex.endsWith('01020304')).toBe(true);
      expect(ipv6.checksumHex).toBeNull();

      expect(eventBus.emit).toHaveBeenCalledWith(
        'protocol:ip_packet_built',
        expect.objectContaining({ version: 'ipv4', protocol: 1 }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'protocol:ip_packet_built',
        expect.objectContaining({ version: 'ipv6', protocol: 58 }),
      );
    });

    it('builds ICMP echo messages and computes the checksum', async () => {
      const result = await handlers.handleIcmpEchoBuild({
        operation: 'request',
        identifier: 1,
        sequenceNumber: 2,
        payloadHex: 'aabb',
      });

      expect(result.success).toBe(true);
      expect(result.packetHex).toBe('08004d4100010002aabb');
      expect(result.checksumHex).toBe('4d41');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'protocol:icmp_echo_built',
        expect.objectContaining({ operation: 'request', checksumHex: '4d41' }),
      );
    });

    it('applies and writes Internet checksums deterministically', async () => {
      const result = await handlers.handleChecksumApply({
        hexPayload: '0800000000010002aabb',
        zeroOffset: 2,
        zeroLength: 2,
        writeOffset: 2,
      });

      expect(result.success).toBe(true);
      expect(result.checksumHex).toBe('4d41');
      expect(result.mutatedHex).toBe('08004d4100010002aabb');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'protocol:checksum_applied',
        expect.objectContaining({ checksumHex: '4d41', byteLength: 10 }),
      );
    });

    it('writes and reads classic PCAP files deterministically', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'protocol-analysis-'));
      tempDirs.push(dir);
      const path = join(dir, 'sample.pcap');

      const writeResult = await handlers.handlePcapWrite({
        path,
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
      });
      const readResult = await handlers.handlePcapRead({
        path,
        maxPackets: 2,
      });

      expect(writeResult.success).toBe(true);
      expect(writeResult.packetCount).toBe(2);
      expect(readResult.success).toBe(true);
      expect(readResult.header?.linkType).toBe(1);
      expect(readResult.header?.endianness).toBe('little');
      expect(readResult.packets).toHaveLength(2);
      expect(readResult.packets[0]?.dataHex).toBe('001122334455aabbccddeeff08000102');
      expect(readResult.packets[1]?.dataHex).toBe('08004d4100010002aabb');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'protocol:pcap_written',
        expect.objectContaining({ path, packetCount: 2 }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'protocol:pcap_read',
        expect.objectContaining({ path, packetCount: 2 }),
      );
    });
  });
});
