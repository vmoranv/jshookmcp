/**
 * Protocol-analysis domain benchmark.
 *
 * External vectors:
 *  - RFC 1071 §3 worked example (internet checksum: 00 01 f2 03 f4 f5 f6 f7 → 0x220d)
 *  - RFC 1035 §4.1.2-style DNS query (www.example.com A IN) — same wire layout as
 *    the "example.com" query in the RFC and in the Wireshark SampleCaptures dns.cards
 *  - RFC 7230 HTTP/1.1 GET request layout
 * Homemade fixtures:
 *  - Ethernet II frame build determinism
 *  - pcap write → read roundtrip
 *  - ICMP echo checksum self-consistency
 */
import { ProtocolAnalysisHandlers } from '@server/domains/protocol-analysis/handlers';
import { body, type BenchSuite } from '../harness';

const handlers = new ProtocolAnalysisHandlers();

// DNS query: id=0x1234, RD, 1 question, www.example.com A IN
const DNS_QUERY_HEX =
  '1234' + // id
  '0100' + // flags: RD
  '0001' + // qdcount
  '00000000000003777777076578616d706c6503636f6d00' + // www.example.com
  '00010001'; // QTYPE=A QCLASS=IN

const HTTP_REQUEST = 'GET /index.html HTTP/1.1\r\nHost: example.com\r\nUser-Agent: bench\r\n\r\n';
const HTTP_REQUEST_HEX = Buffer.from(HTTP_REQUEST, 'utf8').toString('hex');

export const protocolSuite: BenchSuite = {
  name: 'protocol-analysis',
  domain: 'protocol-analysis',
  description:
    'checksum/DNS/HTTP dissection + packet builders + pcap roundtrip — RFC vectors and deterministic builders',
  cases: [
    {
      name: 'checksum_apply/rfc1071-worked-example',
      tool: 'checksum_apply',
      origin: 'external-vector',
      reference: 'RFC 1071 §3 worked example (00 01 f2 03 f4 f5 f6 f7 ⇒ checksum 0x220d)',
      run: () => handlers.handleChecksumApply({ hexPayload: '0001f203f4f5f6f7' }),
      validate: (v) => {
        const b = v as {
          checksum?: number;
          checksumHex?: string;
          success?: boolean;
          error?: string;
        };
        if (b.success === false) return `tool failed: ${b.error}`;
        if (b.checksum !== 0x220d)
          return `expected 0x220d (8909), got ${b.checksum} (${b.checksumHex})`;
        return true;
      },
    },
    {
      name: 'proto_dissect_dns/example-com-query',
      tool: 'proto_dissect_dns',
      origin: 'external-vector',
      reference: 'RFC 1035 §4.1 query wire layout (www.example.com A IN, RD=1)',
      run: () => handlers.handleProtoDissectDns({ packetHex: DNS_QUERY_HEX }),
      validate: (v) => {
        const b = v as {
          message?: { questions?: Array<{ name?: string; qtype?: number }> };
          error?: string;
          success?: boolean;
        };
        if (b.success === false) return `tool failed: ${b.error}`;
        const q = b.message?.questions?.[0];
        if (!q) return 'no question parsed';
        if (q.name !== 'www.example.com') return `expected name www.example.com, got ${q.name}`;
        if (q.qtype !== 1) return `expected qtype 1 (A), got ${q.qtype}`;
        return true;
      },
    },
    {
      name: 'proto_dissect_http/get-request',
      tool: 'proto_dissect_http',
      origin: 'external-vector',
      reference: 'RFC 7230 request-line + headers wire layout',
      run: () => handlers.handleProtoDissectHttp({ packetHex: HTTP_REQUEST_HEX }),
      validate: (v) => {
        const b = v as {
          message?: { kind?: string; method?: string; requestTarget?: string; headers?: unknown[] };
          error?: string;
          success?: boolean;
        };
        if (b.success === false) return `tool failed: ${b.error}`;
        const m = b.message;
        if (!m) return 'no message parsed';
        if (m.kind !== 'request') return `expected kind=request, got ${m.kind}`;
        if (m.method !== 'GET') return `expected method GET, got ${m.method}`;
        if (m.requestTarget !== '/index.html')
          return `expected requestTarget /index.html, got ${m.requestTarget}`;
        if (!m.headers || m.headers.length !== 2)
          return `expected 2 headers, got ${m.headers?.length}`;
        return true;
      },
    },
    {
      name: 'ethernet_frame_build/deterministic-ipv4',
      tool: 'ethernet_frame_build',
      origin: 'homemade',
      reference: 'Ethernet II: 6B dst + 6B src + 2B etherType — layout is normative',
      run: () =>
        handlers.handleEthernetFrameBuild({
          destinationMac: 'AA:BB:CC:DD:EE:FF',
          sourceMac: '11:22:33:44:55:66',
          etherType: '0x0800',
          payloadHex: '45000014000000004011f9a5c0a80001c0a80002',
        }),
      validate: (v) => {
        const b = v as {
          frameHex?: string;
          byteLength?: number;
          success?: boolean;
          error?: string;
        };
        if (b.success === false) return `tool failed: ${b.error}`;
        const expected = 'aabbccddeeff112233445566080045000014000000004011f9a5c0a80001c0a80002';
        if (b.frameHex !== expected) return `frame mismatch, got ${b.frameHex}`;
        if (b.byteLength !== expected.length / 2) return `byteLength mismatch, got ${b.byteLength}`;
        return true;
      },
    },
    {
      name: 'icmp_echo_build/checksum-valid',
      tool: 'icmp_echo_build',
      origin: 'homemade',
      reference:
        'ICMP echo reply must carry the same checksum as the echo request (RFC 1072 layout)',
      run: async () => {
        const req = (await handlers.handleIcmpEchoBuild({
          operation: 'request',
          identifier: 0x1234,
          sequenceNumber: 7,
          payloadHex: '6a73686f6f6b',
        })) as { packetHex?: string; checksum?: number; success?: boolean; error?: string };
        const reply = (await handlers.handleIcmpEchoBuild({
          operation: 'reply',
          identifier: 0x1234,
          sequenceNumber: 7,
          payloadHex: '6a73686f6f6b',
        })) as { checksum?: number; success?: boolean; error?: string };
        return { req, reply };
      },
      validate: (v) => {
        const { req, reply } = v as {
          req: { checksum?: number; packetHex?: string };
          reply: { checksum?: number; packetHex?: string };
        };
        if (!req.checksum || !reply.checksum) return 'missing checksums';
        // RFC 1071: each packet's checksum must make its own 16-bit word sum 0xFFFF.
        // (Request vs reply checksums legitimately differ: the type byte is covered.)
        for (const [label, pkt] of [
          ['request', req],
          ['reply', reply],
        ] as const) {
          const bytes = Buffer.from(pkt.packetHex ?? '', 'hex');
          let sum = 0;
          for (let i = 0; i < bytes.length; i += 2) {
            sum += bytes.readUInt16BE(i);
          }
          while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
          if (sum !== 0xffff)
            return `${label} packet checksum sum is ${sum.toString(16)}, expected ffff`;
        }
        return true;
      },
    },
    {
      name: 'pcap_write+read/roundtrip',
      tool: 'pcap_write',
      origin: 'homemade',
      reference: 'classic pcap (libpcap) global header + per-packet headers must roundtrip',
      run: async () => {
        const path = `/tmp/jshook-bench-${process.pid}-${Date.now()}.pcap`;
        const eth = 'aabbccddeeff112233445566080045000014000000004011f9a5c0a80001c0a80002';
        const w = (await handlers.handlePcapWrite({
          path,
          packets: [{ dataHex: eth, timestampSeconds: 1700000000, timestampFraction: 123456 }],
        })) as { success?: boolean; error?: string; packetCount?: number };
        if (w.success === false) throw new Error(`pcap_write failed: ${w.error}`);
        return handlers.handlePcapRead({ path });
      },
      validate: (v) => {
        const b = v as {
          packets?: Array<{ dataHex?: string; capturedLength?: number }>;
          header?: { magic?: string };
          success?: boolean;
          error?: string;
        };
        if (b.success === false) return `read failed: ${b.error}`;
        if (!Array.isArray(b.packets) || b.packets.length !== 1)
          return `expected 1 packet, got ${b.packets?.length}`;
        const first = b.packets[0];
        if (!first?.dataHex?.startsWith('aabbccddeeff1122334455660800'))
          return `payload mismatch, got ${first?.dataHex?.slice(0, 30)}`;
        return true;
      },
    },
    {
      name: 'proto_fingerprint/dns-vs-http',
      tool: 'proto_fingerprint',
      origin: 'homemade',
      reference:
        'protocol identification: DNS query payload must not classify as HTTP and vice versa',
      run: async () => {
        const dns = (await handlers.handleProtoFingerprint({
          hexPayloads: [DNS_QUERY_HEX],
        })) as {
          fingerprints?: Array<{ protocolMatches?: Array<{ protocol?: string }> }>;
          success?: boolean;
          error?: string;
        };
        const http = (await handlers.handleProtoFingerprint({
          hexPayloads: [HTTP_REQUEST_HEX],
        })) as {
          fingerprints?: Array<{ protocolMatches?: Array<{ protocol?: string }> }>;
          success?: boolean;
          error?: string;
        };
        return { dns, http };
      },
      validate: (v) => {
        const { dns, http } = v as { dns: unknown; http: unknown };
        const protocolsOf = (r: unknown, i = 0) => {
          const parsed = body(r) as {
            fingerprints?: Array<{ protocolMatches?: Array<{ protocol?: string }> }>;
          };
          return (parsed.fingerprints?.[i]?.protocolMatches ?? []).map((m) =>
            (m.protocol ?? '').toLowerCase(),
          );
        };
        const httpProtos = protocolsOf(http);
        if (!httpProtos.some((p) => p.includes('http')))
          return `HTTP payload not matched as http: ${JSON.stringify(protocolsOf(http)).slice(0, 160)}`;
        const dnsProtos = protocolsOf(dns);
        if (dnsProtos.some((p) => p.includes('http')))
          return `DNS payload misclassified as http: ${JSON.stringify(dnsProtos).slice(0, 160)}`;
        if (!dnsProtos.some((p) => p.includes('dns')))
          return `DNS payload not matched as DNS: ${JSON.stringify(dnsProtos).slice(0, 160)}`;
        return true;
      },
    },
    {
      name: 'payload_template_build/structured-fields',
      tool: 'payload_template_build',
      origin: 'homemade',
      reference:
        'builds binary payload from field types (u16, u32, string) with big-endian encoding',
      run: () =>
        handlers.handlePayloadTemplateBuild({
          fields: [
            { name: 'magic', type: 'u16', value: 0x1234 },
            { name: 'length', type: 'u32', value: 4 },
            { name: 'cmd', type: 'string', value: 'PING' },
          ],
          endian: 'big',
        }),
      validate: (v: unknown) => {
        const b = v as {
          hexPayload?: string;
          byteLength?: number;
          success?: boolean;
          error?: string;
        };
        if (b.success === false) return `failed: ${b.error}`;
        // 0x1234 (2B) + 0x00000004 (4B) + 50494e47 (4B) = 10B
        if (b.byteLength !== 10) return `expected byteLength=10, got ${b.byteLength}`;
        if (b.hexPayload !== '12340000000450494e47') {
          return `hex mismatch, got: ${b.hexPayload}`;
        }
        return true;
      },
    },
    {
      name: 'payload_mutate/bit-flip-and-increment',
      tool: 'payload_mutate',
      origin: 'homemade',
      reference: 'applies flip_bit and increment_integer mutations sequentially to hex payload',
      run: () =>
        handlers.handlePayloadMutate({
          hexPayload: '0000',
          mutations: [
            { strategy: 'set_byte', offset: 0, value: 0x10 },
            { strategy: 'increment_integer', offset: 1, delta: 5, width: 1 },
          ],
        }),
      validate: (v: unknown) => {
        const b = v as { mutatedHex?: string; success?: boolean; error?: string };
        if (b.success === false) return `failed: ${b.error}`;
        if (b.mutatedHex !== '1005') return `expected mutatedHex=1005, got: ${b.mutatedHex}`;
        return true;
      },
    },
    {
      name: 'arp_build/request-packet',
      tool: 'arp_build',
      origin: 'homemade',
      reference: 'builds RFC 826 ARP request with sender/target hardware and protocol addresses',
      run: () =>
        handlers.handleArpBuild({
          operation: 'request',
          senderMac: '00:11:22:33:44:55',
          senderIp: '192.168.1.100',
          targetIp: '192.168.1.1',
        }),
      validate: (v: unknown) => {
        const b = v as {
          byteLength?: number;
          arpPayloadHex?: string;
          success?: boolean;
          error?: string;
        };
        if (b.success === false) return `failed: ${b.error}`;
        if (b.byteLength !== 28) return `expected standard ARP 28 bytes, got ${b.byteLength}`;
        return true;
      },
    },
    {
      name: 'raw_ip_packet_build/ipv4-with-checksum',
      tool: 'raw_ip_packet_build',
      origin: 'homemade',
      reference: 'builds standard 20-byte IPv4 header with calculated IP checksum and payload',
      run: () =>
        handlers.handleRawIpPacketBuild({
          version: 'ipv4',
          sourceIp: '192.168.1.10',
          destinationIp: '8.8.8.8',
          protocol: 'udp',
          payloadHex: '1234',
          ttl: 64,
        }),
      validate: (v: unknown) => {
        const b = v as {
          version?: string;
          byteLength?: number;
          checksumHex?: string;
          success?: boolean;
        };
        if (b.success === false) return 'failed building raw IP packet';
        if (b.version !== 'ipv4') return `expected ipv4, got ${b.version}`;
        if (b.byteLength !== 22)
          return `expected 22 bytes (20B header + 2B payload), got ${b.byteLength}`;
        if (!b.checksumHex) return 'missing checksumHex';
        return true;
      },
    },

    // ── Coverage batch 2026-11-10 (autoresearch): pcap/pcapng + pattern tools ──
    {
      name: 'pcapng_write/shb-magic-and-counts',
      tool: 'pcapng_write',
      origin: 'external-vector',
      reference:
        'PCAP-ng spec §3.1: file starts with the Section Header Block block-type 0x0A0D0D0A',
      run: async () => {
        const path = `/tmp/jshook-bench-pcapng-${process.pid}-${Date.now()}.pcapng`;
        const w = (await handlers.handlePcapngWrite({
          path,
          interfaces: [{ linkType: 1, snapshotLength: 65535 }],
          packets: [{ dataHex: 'aabbccddeeff1122334455660800', timestampLow: 123456 }],
        })) as {
          success?: boolean;
          error?: string;
          packetCount?: number;
          interfaceCount?: number;
          byteLength?: number;
        };
        const { readFile } = await import('node:fs/promises');
        const head = await readFile(path).catch(() => Buffer.alloc(0));
        return { write: w, magicHex: head.subarray(0, 4).toString('hex') };
      },
      validate: (v) => {
        const { write: w, magicHex } = v as {
          write?: {
            success?: boolean;
            error?: string;
            packetCount?: number;
            interfaceCount?: number;
            byteLength?: number;
          };
          magicHex?: string;
        };
        if (w?.success === false) return `pcapng_write failed: ${w.error}`;
        if (w?.packetCount !== 1) return `expected packetCount 1, got ${w?.packetCount}`;
        if (w?.interfaceCount !== 1) return `expected interfaceCount 1, got ${w?.interfaceCount}`;
        if (!w?.byteLength || w.byteLength <= 0)
          return `expected positive byteLength, got ${w?.byteLength}`;
        if (magicHex !== '0a0d0d0a') return `expected SHB magic 0a0d0d0a, got ${magicHex}`;
        return true;
      },
    },
    {
      name: 'pcapng_read/roundtrip-two-packets',
      tool: 'pcapng_read',
      origin: 'homemade',
      reference: 'PCAP-ng EPB encoding/decoding must preserve packet bytes in order',
      run: async () => {
        const path = `/tmp/jshook-bench-pcapng-r-${process.pid}-${Date.now()}.pcapng`;
        const p0 = 'aabbccddeeff112233445566080045000014000000004011f9a5c0a80001c0a80002';
        const p1 = 'ffffffffffffffffffffffff0806';
        const w = (await handlers.handlePcapngWrite({
          path,
          interfaces: [{ linkType: 1 }],
          packets: [
            { dataHex: p0, timestampLow: 1 },
            { dataHex: p1, timestampLow: 2 },
          ],
        })) as { success?: boolean; error?: string };
        if (w.success === false) throw new Error(`pcapng_write failed: ${w.error}`);
        return handlers.handlePcapngRead({ path });
      },
      validate: (v) => {
        const b = v as {
          packets?: Array<{ dataHex?: string; dataRef?: string }>;
          blockCount?: number;
          success?: boolean;
          error?: string;
        };
        if (b.success === false) return `pcapng_read failed: ${b.error}`;
        if (!Array.isArray(b.packets) || b.packets.length !== 2)
          return `expected 2 packets, got ${b.packets?.length}`;
        if (!b.packets[0]?.dataHex?.startsWith('aabbccddeeff112233445566080045'))
          return `packet[0] payload mismatch, got ${b.packets[0]?.dataHex?.slice(0, 30)}`;
        if (b.packets[1]?.dataHex !== 'ffffffffffffffffffffffff0806')
          return `packet[1] payload mismatch, got ${b.packets[1]?.dataHex}`;
        if (!b.blockCount || b.blockCount < 4)
          return `expected blockCount >= 4 (SHB+IDB+2xEPB), got ${b.blockCount}`;
        return true;
      },
    },
    {
      name: 'pcap_read/classic-roundtrip',
      tool: 'pcap_read',
      origin: 'homemade',
      reference:
        'classic pcap (libpcap) global header + per-packet headers must roundtrip via pcap_read',
      run: async () => {
        const path = `/tmp/jshook-bench-pcap-r-${process.pid}-${Date.now()}.pcap`;
        const eth = 'aabbccddeeff112233445566080045000014000000004011f9a5c0a80001c0a80002';
        const w = (await handlers.handlePcapWrite({
          path,
          packets: [{ dataHex: eth, timestampSeconds: 1700000001, timestampFraction: 654321 }],
        })) as { success?: boolean; error?: string };
        if (w.success === false) throw new Error(`pcap_write failed: ${w.error}`);
        return handlers.handlePcapRead({ path });
      },
      validate: (v) => {
        const b = v as {
          format?: string;
          packets?: Array<{ dataHex?: string }>;
          success?: boolean;
          error?: string;
        };
        if (b.success === false) return `pcap_read failed: ${b.error}`;
        if (b.format !== 'pcap') return `expected format pcap, got ${b.format}`;
        if (!Array.isArray(b.packets) || b.packets.length !== 1)
          return `expected 1 packet, got ${b.packets?.length}`;
        if (
          b.packets[0]?.dataHex !==
          'aabbccddeeff112233445566080045000014000000004011f9a5c0a80001c0a80002'
        )
          return `payload mismatch, got ${b.packets[0]?.dataHex?.slice(0, 30)}`;
        return true;
      },
    },
    {
      name: 'proto_define_pattern/spec-fields-roundtrip',
      tool: 'proto_define_pattern',
      origin: 'homemade',
      reference: 'defined pattern must be retrievable with the same field layout it was given',
      run: () =>
        handlers.handleDefinePattern({
          name: 'bench_define_pattern',
          spec: {
            byteOrder: 'be',
            fields: [
              { name: 'magic', offset: 0, length: 2, type: 'int' },
              { name: 'seq', offset: 2, length: 4, type: 'int' },
            ],
          },
        }),
      validate: (v) => {
        const b = v as {
          patternId?: string;
          pattern?: { name?: string; fields?: Array<{ name?: string }> };
          success?: boolean;
          error?: string;
        };
        if (b.success === false) return `define failed: ${b.error}`;
        if (b.patternId !== 'bench_define_pattern')
          return `expected patternId bench_define_pattern, got ${b.patternId}`;
        if (b.pattern?.fields?.length !== 2)
          return `expected 2 fields on stored pattern, got ${b.pattern?.fields?.length}`;
        if (b.pattern?.fields?.[0]?.name !== 'magic')
          return `expected first field magic, got ${b.pattern?.fields?.[0]?.name}`;
        return true;
      },
    },
    {
      name: 'proto_export_schema/three-formats',
      tool: 'proto_export_schema',
      origin: 'homemade',
      reference: 'proto / ksy / json-schema exports must reference the defined field names',
      run: async () => {
        const name = 'bench_export_schema';
        const d = await handlers.handleDefinePattern({
          name,
          spec: {
            byteOrder: 'be',
            fields: [
              { name: 'magic', offset: 0, length: 2, type: 'int' },
              { name: 'seq', offset: 2, length: 4, type: 'int' },
            ],
          },
        });
        if (d.success === false) throw new Error(`define failed: ${d.error}`);
        return {
          proto: await handlers.handleExportSchema({ patternId: name, format: 'proto' }),
          ksy: await handlers.handleExportSchema({ patternId: name, format: 'ksy' }),
          jsonSchema: await handlers.handleExportSchema({ patternId: name, format: 'json-schema' }),
        };
      },
      validate: (v) => {
        const b = v as {
          proto?: { schema?: string; format?: string };
          ksy?: { schema?: string };
          jsonSchema?: { schema?: string };
        };
        for (const [label, out] of [
          ['proto', b.proto],
          ['ksy', b.ksy],
          ['json-schema', b.jsonSchema],
        ] as const) {
          const schema = out?.schema ?? '';
          if (schema.startsWith('// Error'))
            return `${label} export failed: ${schema.slice(0, 60)}`;
          if (!schema.includes('seq') || !schema.includes('magic'))
            return `${label} schema missing defined field names (seq/magic)`;
        }
        if (b.proto?.format !== 'proto')
          return `expected format echo proto, got ${b.proto?.format}`;
        return true;
      },
    },
    {
      name: 'proto_auto_detect/fixed-layout-samples',
      tool: 'proto_auto_detect',
      origin: 'homemade',
      reference: 'three same-layout samples must auto-detect a pattern with the fixed fields',
      run: () =>
        handlers.handleAutoDetect({
          name: 'bench_auto_detect',
          hexPayloads: ['010200000001', '010200000002', '010200000003'],
        }),
      validate: (v) => {
        const b = v as {
          patterns?: Array<{ name?: string; fields?: Array<{ name?: string }> }>;
          success?: boolean;
          error?: string;
        };
        if (b.success === false) return `auto-detect failed: ${b.error}`;
        if (!Array.isArray(b.patterns) || b.patterns.length < 1)
          return `expected at least 1 detected pattern, got ${b.patterns?.length}`;
        if ((b.patterns[0]?.fields?.length ?? 0) < 1)
          return `expected detected pattern to carry inferred fields, got ${b.patterns[0]?.fields?.length}`;
        return true;
      },
    },
    {
      name: 'proto_infer_fields/deterministic-two-calls',
      tool: 'proto_infer_fields',
      origin: 'homemade',
      reference: 'field inference over identical samples must be deterministic',
      run: async () => {
        const hexPayloads = ['010200000001', '010200000002', '010200000003'];
        const a = await handlers.handleInferFields({ hexPayloads });
        const b = await handlers.handleInferFields({ hexPayloads });
        return { a, b };
      },
      validate: (v) => {
        const { a, b } = v as {
          a?: { fields?: unknown[]; success?: boolean; error?: string };
          b?: { fields?: unknown[] };
        };
        if (a?.success === false) return `infer failed: ${a.error}`;
        if (!Array.isArray(a?.fields) || (a?.fields?.length ?? 0) < 1)
          return `expected >= 1 inferred field, got ${a?.fields?.length}`;
        if (JSON.stringify(a?.fields) !== JSON.stringify(b?.fields))
          return 'field inference is not deterministic across identical calls';
        return true;
      },
    },
    {
      name: 'proto_infer_state_machine/req-res-sequence',
      tool: 'proto_infer_state_machine',
      origin: 'homemade',
      reference: 'a req/res message sequence must yield >= 2 states and >= 1 transition',
      run: () =>
        handlers.handleInferStateMachine({
          messages: [
            { direction: 'req', timestamp: 1, fields: {}, raw: 'req-1' },
            { direction: 'res', timestamp: 2, fields: {}, raw: 'res-1' },
            { direction: 'req', timestamp: 3, fields: {}, raw: 'req-2' },
            { direction: 'res', timestamp: 4, fields: {}, raw: 'res-2' },
          ],
        }),
      validate: (v) => {
        const b = v as {
          stateMachine?: { states?: Array<{ id?: string }>; transitions?: unknown[] };
          mermaid?: string;
          success?: boolean;
          error?: string;
        };
        if (b.success === false) return `state-machine inference failed: ${b.error}`;
        if ((b.stateMachine?.states?.length ?? 0) < 2)
          return `expected >= 2 states, got ${b.stateMachine?.states?.length}`;
        if ((b.stateMachine?.transitions?.length ?? 0) < 1)
          return `expected >= 1 transition, got ${b.stateMachine?.transitions?.length}`;
        if (!b.mermaid?.includes('stateDiagram'))
          return `mermaid output missing stateDiagram, got ${b.mermaid?.slice(0, 40)}`;
        return true;
      },
    },
    {
      name: 'proto_visualize_state/mermaid-hand-machine',
      tool: 'proto_visualize_state',
      origin: 'homemade',
      reference:
        'hand-built machine must render a Mermaid diagram naming its states (no empty fallback)',
      run: () =>
        handlers.handleVisualizeState({
          stateMachine: {
            initialState: 'idle',
            finalStates: ['done'],
            states: [
              { id: 'idle', name: 'idle' },
              { id: 'active', name: 'active' },
              { id: 'done', name: 'done', type: 'accept' },
            ],
            transitions: [
              { from: 'idle', to: 'active', event: 'req' },
              { from: 'active', to: 'done', event: 'res' },
            ],
          },
        }),
      validate: (v) => {
        const b = v as { mermaidDiagram?: string };
        const m = b.mermaidDiagram ?? '';
        if (!m.includes('stateDiagram'))
          return `missing stateDiagram header, got ${m.slice(0, 40)}`;
        if (m.includes('note right of empty'))
          return 'empty-machine fallback rendered — hand machine was not accepted';
        if (!m.includes('idle') || !m.includes('done'))
          return `diagram missing states, got ${m.slice(0, 80)}`;
        return true;
      },
    },
  ],
};
