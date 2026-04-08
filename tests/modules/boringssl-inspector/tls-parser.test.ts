/**
 * TLS Packet Parser tests.
 */

import { describe, expect, it } from 'vitest';
import {
  parseHandshake,
  parseCertificate,
  listCipherSuites,
  lookupCipherSuite,
  parseTLSRecord,
} from '@modules/boringssl-inspector/TLSPacketParser';

describe('TLSPacketParser', () => {
  describe('parseHandshake', () => {
    it('parses a minimal ClientHello from hex', () => {
      // Build a minimal ClientHello manually
      const buf = buildMinimalClientHello();
      const result = parseHandshake(buf);

      expect(result.version).toBeDefined();
      expect(result.cipherSuite).toBeDefined();
      expect(result.extensions).toBeDefined();
      expect(Array.isArray(result.extensions)).toBe(true);
    });

    it('parses a ClientHello with SNI extension', () => {
      const buf = buildClientHelloWithSNI('example.com');
      const result = parseHandshake(buf);

      const sniExt = result.extensions.find((e) => e.type === 0);
      expect(sniExt).toBeDefined();
      expect(sniExt?.data).toEqual({ serverName: 'example.com' });
    });

    it('parses a ClientHello with ALPN extension', () => {
      const buf = buildClientHelloWithALPN(['h2', 'http/1.1']);
      const result = parseHandshake(buf);

      const alpnExt = result.extensions.find((e) => e.type === 16);
      expect(alpnExt).toBeDefined();
      expect(alpnExt?.data).toEqual({ protocols: ['h2', 'http/1.1'] });
    });

    it('parses a ClientHello with supported_groups extension', () => {
      const buf = buildClientHelloWithGroups([0x001d, 0x0017, 0x0018]); // x25519, secp256r1, secp384r1
      const result = parseHandshake(buf);

      const groupsExt = result.extensions.find((e) => e.type === 10);
      expect(groupsExt).toBeDefined();
      expect(groupsExt?.data).toEqual({ groups: ['x25519', 'secp256r1', 'secp384r1'] });
    });

    it('detects session_ticket extension as session resumption', () => {
      const buf = buildClientHelloWithSessionTicket();
      const result = parseHandshake(buf);

      expect(result.sessionResumed).toBe(true);
    });

    it('parses a ServerHello with selected cipher suite', () => {
      const buf = buildServerHello(0xc02f); // TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
      const result = parseHandshake(buf);

      expect(result.cipherSuite).toBe('TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256');
      expect(result.keyExchange).toBe('ECDHE_RSA');
    });

    it('parses TLS 1.3 handshake from hex string', () => {
      // TLS 1.3 ClientHello with supported_versions
      const buf = buildTLS13ClientHello();
      const result = parseHandshake(buf);

      expect(result.version).toBe('TLS 1.2'); // legacy_version in TLS 1.3 is still 0x0303
    });

    it('returns unknown for unrecognized handshake type', () => {
      // Handshake type 2 (NewSessionTicket) — we only parse ClientHello/ServerHello
      const buf = Buffer.from([0x02, 0x00, 0x00, 0x00]);
      const result = parseHandshake(buf);

      expect(result.version).toBe('unknown');
      expect(result.cipherSuite).toBe('unknown');
    });

    it('handles empty buffer gracefully (returns minimal result)', () => {
      const result = parseHandshake(Buffer.alloc(0));
      // Empty buffer: readUint8 returns 0 (ClientHello), but has no data to parse
      expect(result.version).toBe('0x0'); // version is read from offset 0/1 which are both 0
      expect(result.cipherSuite).toBe('none');
    });

    it('handles whitespace in hex string', () => {
      const hex = '01 00 00 00';
      const result = parseHandshake(hex);
      expect(result.version).toBeDefined();
    });
  });

  describe('parseTLSRecord', () => {
    it('parses a valid TLS record header', () => {
      const buf = Buffer.from([
        0x16, // Handshake
        0x03,
        0x03, // TLS 1.2
        0x00,
        0x10, // length 16
        ...Array.from({ length: 16 }, () => 0), // payload
      ]);

      const result = parseTLSRecord(buf);
      expect(result).not.toBeNull();
      expect(result?.contentType).toBe('Handshake');
      expect(result?.version).toBe('TLS 1.2');
      expect(result?.length).toBe(16);
    });

    it('returns null for buffer too short', () => {
      const result = parseTLSRecord(Buffer.from([0x16, 0x03, 0x03]));
      expect(result).toBeNull();
    });
  });

  describe('listCipherSuites', () => {
    it('returns a sorted array of cipher suites', () => {
      const suites = listCipherSuites();
      expect(suites.length).toBeGreaterThan(10);
      // Should be sorted by ID
      for (let i = 1; i < suites.length; i++) {
        expect(suites[i]!.id).toBeGreaterThanOrEqual(suites[i - 1]!.id);
      }
    });

    it('includes well-known cipher suites', () => {
      const suites = listCipherSuites();
      const names = suites.map((s) => s.name);
      expect(names).toContain('TLS_AES_128_GCM_SHA256');
      expect(names).toContain('TLS_CHACHA20_POLY1305_SHA256');
      expect(names).toContain('TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256');
    });
  });

  describe('lookupCipherSuite', () => {
    it('returns cipher suite by ID', () => {
      const cs = lookupCipherSuite(0x1301);
      expect(cs).not.toBeNull();
      expect(cs?.name).toBe('TLS_AES_128_GCM_SHA256');
    });

    it('returns null for unknown ID', () => {
      const cs = lookupCipherSuite(0xffff);
      expect(cs).toBeNull();
    });
  });

  describe('parseCertificate', () => {
    it('returns empty result for short buffer', () => {
      const result = parseCertificate(Buffer.from([0x04, 0x00, 0x00, 0x01]));
      expect(result.count).toBe(0);
      expect(result.fingerprints).toEqual([]);
    });

    it('parses a certificate message with one cert', () => {
      const certData = Buffer.from('abcdef1234567890', 'hex');
      const msg = buildCertificateMessage([certData]);
      const result = parseCertificate(msg);

      expect(result.count).toBe(1);
      expect(result.fingerprints).toHaveLength(1);
      expect(result.rawLengths).toEqual([certData.length]);
    });

    it('parses a certificate message with multiple certs', () => {
      const cert1 = Buffer.from('aaaa', 'hex');
      const cert2 = Buffer.from('bbbb', 'hex');
      const msg = buildCertificateMessage([cert1, cert2]);
      const result = parseCertificate(msg);

      expect(result.count).toBe(2);
      expect(result.fingerprints).toHaveLength(2);
      expect(result.rawLengths).toEqual([2, 2]);
    });

    it('handles hex string input', () => {
      const certData = Buffer.from('abcdef', 'hex');
      const msg = buildCertificateMessage([certData]);
      const result = parseCertificate(msg.toString('hex'));

      expect(result.count).toBe(1);
    });
  });
});

// ── Test Helpers ──

function buildMinimalClientHello(): Buffer {
  const version = Buffer.from([0x03, 0x03]); // TLS 1.2
  const random = Buffer.alloc(32, 0xab);
  const sessionId = Buffer.from([0x00]); // no session ID
  const cipherSuites = Buffer.from([
    0x00,
    0x04, // length 4 (2 cipher suites)
    0x13,
    0x01, // TLS_AES_128_GCM_SHA256
    0x13,
    0x02, // TLS_AES_256_GCM_SHA384
  ]);
  const compression = Buffer.from([0x01, 0x00]); // null compression
  const extensions = Buffer.from([0x00, 0x00]); // no extensions

  const body = Buffer.concat([version, random, sessionId, cipherSuites, compression, extensions]);
  return buildHandshake(0, body);
}

function buildClientHelloWithSNI(sni: string): Buffer {
  const sniBuf = buildSNIExtension(sni);
  return buildClientHelloWithExtensions([sniBuf]);
}

function buildClientHelloWithALPN(protocols: string[]): Buffer {
  const alpnBuf = buildALPNExtension(protocols);
  return buildClientHelloWithExtensions([alpnBuf]);
}

function buildClientHelloWithGroups(groups: number[]): Buffer {
  const groupsBuf = buildSupportedGroupsExtension(groups);
  return buildClientHelloWithExtensions([groupsBuf]);
}

function buildClientHelloWithSessionTicket(): Buffer {
  // Extension type 35 (session_ticket), length 0
  const extBuf = Buffer.from([0x00, 0x23, 0x00, 0x00]);
  return buildClientHelloWithExtensions([extBuf]);
}

function buildTLS13ClientHello(): Buffer {
  // TLS 1.3 ClientHello with supported_versions extension (type 43)
  const versionsBuf = Buffer.from([
    0x00,
    0x2b, // type 43 (supported_versions)
    0x00,
    0x03, // length 3
    0x02, // version count
    0x03,
    0x04, // TLS 1.3
    0x03,
    0x03, // TLS 1.2
  ]);
  return buildClientHelloWithExtensions([versionsBuf]);
}

function buildClientHelloWithExtensions(extBuffers: Buffer[]): Buffer {
  const version = Buffer.from([0x03, 0x03]);
  const random = Buffer.alloc(32, 0xab);
  const sessionId = Buffer.from([0x00]);
  const cipherSuites = Buffer.from([0x00, 0x04, 0x13, 0x01, 0x13, 0x02]);
  const compression = Buffer.from([0x01, 0x00]);

  const extsLen = extBuffers.reduce((sum, b) => sum + b.length, 0);
  const extLenBuf = Buffer.from([(extsLen >> 8) & 0xff, extsLen & 0xff]);
  const extensions = Buffer.concat([extLenBuf, ...extBuffers]);

  const body = Buffer.concat([version, random, sessionId, cipherSuites, compression, extensions]);
  return buildHandshake(0, body);
}

function buildServerHello(cipherSuiteId: number): Buffer {
  const version = Buffer.from([0x03, 0x03]);
  const random = Buffer.alloc(32, 0xcd);
  const sessionId = Buffer.from([0x00]);
  const cs = Buffer.from([(cipherSuiteId >> 8) & 0xff, cipherSuiteId & 0xff]);
  const compression = Buffer.from([0x00]);
  const extensions = Buffer.from([0x00, 0x00]);

  const body = Buffer.concat([version, random, sessionId, cs, compression, extensions]);
  return buildHandshake(1, body); // type 1 = ServerHello
}

function buildHandshake(type: number, body: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header[0] = type;
  header[1] = (body.length >> 16) & 0xff;
  header[2] = (body.length >> 8) & 0xff;
  header[3] = body.length & 0xff;
  return Buffer.concat([header, body]);
}

function buildSNIExtension(sni: string): Buffer {
  const sniBytes = Buffer.from(sni, 'utf8');
  // server_name_list length + name_type(1) + name_len(2) + name
  const entryLen = 3 + sniBytes.length;
  const listLen = entryLen;

  const buf = Buffer.alloc(2 + 2 + entryLen);
  buf.writeUInt16BE(listLen, 0); // server_name_list length
  buf[2] = 0; // name_type = host_name
  buf.writeUInt16BE(sniBytes.length, 3);
  sniBytes.copy(buf, 5);

  // Extension header
  const ext = Buffer.alloc(4 + buf.length);
  ext.writeUInt16BE(0, 0); // type 0 = server_name
  ext.writeUInt16BE(buf.length, 2);
  buf.copy(ext, 4);
  return ext;
}

function buildALPNExtension(protocols: string[]): Buffer {
  const protocolBufs = protocols.map((p) => {
    const pb = Buffer.from(p, 'utf8');
    return Buffer.concat([Buffer.from([pb.length]), pb]);
  });
  const alpnList = Buffer.concat(protocolBufs);

  const listLenBuf = Buffer.alloc(2);
  listLenBuf.writeUInt16BE(alpnList.length, 0);

  const payload = Buffer.concat([listLenBuf, alpnList]);

  const ext = Buffer.alloc(4 + payload.length);
  ext.writeUInt16BE(16, 0); // type 16 = ALPN
  ext.writeUInt16BE(payload.length, 2);
  payload.copy(ext, 4);
  return ext;
}

function buildSupportedGroupsExtension(groups: number[]): Buffer {
  const groupsBuf = Buffer.alloc(groups.length * 2);
  for (let i = 0; i < groups.length; i++) {
    groupsBuf.writeUInt16BE(groups[i]!, i * 2);
  }

  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(groupsBuf.length, 0);

  const payload = Buffer.concat([lenBuf, groupsBuf]);

  const ext = Buffer.alloc(4 + payload.length);
  ext.writeUInt16BE(10, 0); // type 10 = supported_groups
  ext.writeUInt16BE(payload.length, 2);
  payload.copy(ext, 4);
  return ext;
}

function buildCertificateMessage(certs: Buffer[]): Buffer {
  // Certificate list length (3 bytes)
  let totalCertLen = 0;
  const certParts: Buffer[] = [];
  for (const cert of certs) {
    const lenPrefix = Buffer.alloc(3);
    lenPrefix[0] = (cert.length >> 16) & 0xff;
    lenPrefix[1] = (cert.length >> 8) & 0xff;
    lenPrefix[2] = cert.length & 0xff;
    certParts.push(lenPrefix);
    certParts.push(cert);
    totalCertLen += 3 + cert.length;
  }

  const certsListLen = Buffer.alloc(3);
  certsListLen[0] = (totalCertLen >> 16) & 0xff;
  certsListLen[1] = (totalCertLen >> 8) & 0xff;
  certsListLen[2] = totalCertLen & 0xff;

  const body = Buffer.concat([certsListLen, ...certParts]);

  // Handshake header (type 4 = Certificate)
  const hsHeader = Buffer.alloc(4);
  hsHeader[0] = 4;
  hsHeader[1] = (body.length >> 16) & 0xff;
  hsHeader[2] = (body.length >> 8) & 0xff;
  hsHeader[3] = body.length & 0xff;

  return Buffer.concat([hsHeader, body]);
}
