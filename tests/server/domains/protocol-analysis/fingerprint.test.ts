import { beforeAll, describe, expect, it } from 'vitest';

import { ProtocolAnalysisHandlers } from '@server/domains/protocol-analysis/handlers/handler-class';

function parseContent(res: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(res.content[0]!.text);
}

describe('ProtocolAnalysisHandlers — handleProtoFingerprint behavioral tests', () => {
  let handlers: ProtocolAnalysisHandlers;

  beforeAll(() => {
    handlers = new ProtocolAnalysisHandlers();
  });

  describe('TLS ClientHello detection', () => {
    it('detects TLS ClientHello and parses extensions', async () => {
      const tlsCh =
        '1603010035' +
        '01000031' +
        '0304' +
        '00'.repeat(32) +
        '00' +
        '0004' +
        '13011302' +
        '01' +
        '00' +
        '0004' +
        '00000000';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [tlsCh] });
      const json = parseContent(res);
      expect(json.success).toBe(true);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('TLS ClientHello');
      expect(fp.protocolMatches[0].confidence).toBe(0.95);
    });
  });

  describe('DNS detection', () => {
    it('detects DNS query with valid count fields', async () => {
      const dns = '123401000001000000000000';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [dns] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('DNS');
    });

    it('accepts DNS query headers where only the 16-bit txid and flags are zero', async () => {
      const dns = '000000000001000000000000';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [dns] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('DNS');
    });

    it('detects DNS response with reasonable answer count', async () => {
      const dns = 'abcd81800001000200000000';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [dns] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches.some((m: any) => m.protocol === 'DNS')).toBe(true);
    });

    it('rejects unlikely DNS responses with reserved response codes', async () => {
      const dns = 'dead80ff123456789abcdef0';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [dns] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('unknown');
    });

    it('accepts DNS with 16-bit answer count values', async () => {
      // ancount at bytes 6-7 = 0x0100 = 256, which is valid for a 16-bit DNS count field.
      // txid=bcd2, flags=8180, qdcount=0001, ancount=0100, nscount=0000, arcount=0000
      const dns = 'bcd281800001010000000000';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [dns] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches.some((m: any) => m.protocol === 'DNS')).toBe(true);
    });

    it('rejects random 12-byte buffers that only satisfy trivial count checks', async () => {
      const dns = '0302030405060708090a0b0c';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [dns] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('unknown');
    });
  });

  describe('HTTP detection', () => {
    it('detects GET request', async () => {
      const http = Buffer.from('GET / HTTP/1.1\r\nHost: example.com').toString('hex');
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [http] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('HTTP/1.x');
      if (fp.parsedFields) {
        expect(fp.parsedFields.method).toBe('GET');
      }
    });
  });

  describe('SSH detection', () => {
    it('detects SSH banner', async () => {
      const ssh = Buffer.from('SSH-2.0-OpenSSH_9.0').toString('hex');
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [ssh] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('SSH');
      expect(fp.parsedFields.banner).toContain('SSH-2.0');
    });
  });

  describe('WebSocket detection', () => {
    it('detects text frame with FIN=1', async () => {
      const ws = '810548656c6c6f';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [ws] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('WebSocket');
      if (fp.parsedFields) {
        expect(fp.parsedFields.fin).toBe(1);
        expect(fp.parsedFields.opcodeName).toBe('text');
        expect(fp.parsedFields.payloadLength).toBe(5);
      }
    });

    it('detects close frame', async () => {
      const ws = '880203e8';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [ws] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('WebSocket');
      if (fp.parsedFields) {
        expect(fp.parsedFields.opcodeName).toBe('close');
      }
    });

    it('detects extended payload length (126)', async () => {
      const ws = '827e00c8' + '00'.repeat(200);
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [ws] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('WebSocket');
      if (fp.parsedFields) {
        expect(fp.parsedFields.payloadLength).toBe(200);
        expect(fp.parsedFields.headerSize).toBe(4);
      }
    });

    it('detects extended payload length (127) with 64KiB frame', async () => {
      // 64KiB = 65536 = 0x0000000000010000 in big-endian 64-bit
      // Byte 0: FIN=1, opcode=2 (binary) → 0x82
      // Byte 1: payload len marker 127 → 0x7F
      // Bytes 2-9: 0x0000000000010000
      const ws = '827f0000000000010000' + '00'.repeat(65536);
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [ws] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('WebSocket');
      if (fp.parsedFields) {
        expect(fp.parsedFields.payloadLength).toBe(65536);
        expect(fp.parsedFields.headerSize).toBe(10);
      }
    });

    it('detects frame with RSV1=1 (permessage-deflate)', async () => {
      const ws = 'c10448656c6c';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [ws] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('WebSocket');
      if (fp.parsedFields) {
        expect(fp.parsedFields.rsv1).toBe(1);
      }
    });

    it('detects fragmented frames with FIN=0', async () => {
      // FIN=0, opcode=1 (text), payload len=5 → a valid non-final fragmented frame.
      const ws = '010548656c6c6f';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [ws] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches.some((m: any) => m.protocol === 'WebSocket')).toBe(true);
      if (fp.parsedFields) {
        expect(fp.parsedFields.fin).toBe(0);
        expect(fp.parsedFields.opcodeName).toBe('text');
      }
    });

    it('rejects truncated 126 extended length frame (insufficient data)', async () => {
      // FIN=1, opcode=2, len=126 but only 2 header bytes provided (no extended length field)
      const ws = '827e';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [ws] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches.some((m: any) => m.protocol === 'WebSocket')).toBe(false);
    });

    it('rejects truncated 127 extended length frame (insufficient data)', async () => {
      // FIN=1, opcode=2, len=127 but not enough bytes for 8-byte length field
      const ws = '827f0000000000';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [ws] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches.some((m: any) => m.protocol === 'WebSocket')).toBe(false);
    });

    it('rejects truncated masked frame without payload bytes', async () => {
      // FIN=1, opcode=1 (text), MASK=1, len=4, mask key present, payload body missing
      const ws = '8184aabbccdd';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [ws] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches.some((m: any) => m.protocol === 'WebSocket')).toBe(false);
    });

    it('does not treat context-free continuation-looking zero buffers as WebSocket', async () => {
      const ws = '000000000000000000000000';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [ws] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('unknown');
    });

    it('detects masked binary frame with mask key', async () => {
      // FIN=1, opcode=2 (binary), MASK=1, len=4, mask key=0xAABBCCDD, masked payload
      const ws = '8284aabbccdd11223344';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [ws] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('WebSocket');
      if (fp.parsedFields) {
        expect(fp.parsedFields.masked).toBe(true);
        expect(fp.parsedFields.payloadLength).toBe(4);
        expect(fp.parsedFields.headerSize).toBe(6); // 2 + 4 mask key
      }
    });
  });

  describe('edge cases', () => {
    it('rejects truncated TLS record with zero length as ClientHello', async () => {
      // 6 bytes: content_type=0x16, version=0x0301, length=0x0000, handshake_type=0x01
      // Record declares 0 bytes of payload but a handshake type byte is present — truncated.
      const truncated = '160301000001';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [truncated] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches.some((m: any) => m.protocol === 'TLS ClientHello')).toBe(false);
    });

    it('rejects truncated TLS record with small positive length as ClientHello', async () => {
      // 7 bytes: content_type=0x16, version=0x0301, length=0x0001, handshake_type=0x01, extra=0x01
      // Record declares 1 byte of payload — too short for a valid handshake header (type+3-byte length = 4).
      const truncated = '16030100010101';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [truncated] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches.some((m: any) => m.protocol === 'TLS ClientHello')).toBe(false);
    });

    it('rejects truncated TLS record that declares length=4 but sample is too short', async () => {
      // 6 bytes: content_type=0x16, version=0x0303, length=0x0004, handshake_type=0x01
      // Declares 4 bytes of payload, but only 1 byte is present in sample.
      const truncated = '160303000401';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [truncated] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches.some((m: any) => m.protocol === 'TLS ClientHello')).toBe(false);
    });

    it('rejects a TLS record whose declared length exceeds the captured sample', async () => {
      const truncated = '160303ffff01';
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [truncated] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches.some((m: any) => m.protocol === 'TLS ClientHello')).toBe(false);
      expect(fp.protocolMatches.some((m: any) => m.protocol === 'TLS Record')).toBe(false);
    });

    it('returns unknown for unrecognized payloads', async () => {
      const res = await handlers.handleProtoFingerprint({ hexPayloads: ['deadbeef'] });
      const json = parseContent(res);
      const fp = json.fingerprints[0];
      expect(fp.protocolMatches[0].protocol).toBe('unknown');
      expect(fp.protocolMatches[0].confidence).toBe(0);
    });

    it('fails when hexPayloads is empty', async () => {
      const res = await handlers.handleProtoFingerprint({ hexPayloads: [] });
      const json = parseContent(res);
      expect(json.success).toBe(false);
    });
  });
});
