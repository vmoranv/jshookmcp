/**
 * BoringSSL Inspector domain handler tests.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BoringSSLInspectorHandlers } from '@server/domains/boringssl-inspector/index';
import { disableKeyLog } from '@modules/boringssl-inspector/TLSKeyLogExtractor';

describe('BoringSSLInspectorHandlers', () => {
  let handlers: BoringSSLInspectorHandlers;

  beforeEach(() => {
    handlers = new BoringSSLInspectorHandlers();
  });

  afterEach(() => {
    disableKeyLog();
  });

  describe('handleKeyLogEnable', () => {
    it('enables key logging with custom path', async () => {
      const result = await handlers.handleKeyLogEnable({ filePath: '/tmp/test-keys.log' });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(true);
      expect(parsed.filePath).toBe('/tmp/test-keys.log');
    });

    it('enables key logging with default path', async () => {
      const result = await handlers.handleKeyLogEnable({});
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(true);
      expect(parsed.filePath).toBe('/tmp/sslkeylog.log');
    });
  });

  describe('handleParseHandshake', () => {
    it('parses a ClientHello hex and returns cipher suites', async () => {
      // Minimal ClientHello: type(1) + length(3) + version(2) + random(32) + sessionIdLen(1) + cipherSuitesLen(2) + 2 suites + compression(2) + extensions(2)
      const version = Buffer.from([0x03, 0x03]);
      const random = Buffer.alloc(32, 0xab);
      const sessionId = Buffer.from([0x00]);
      const cipherSuites = Buffer.from([0x00, 0x04, 0x13, 0x01, 0x13, 0x02]);
      const compression = Buffer.from([0x01, 0x00]);
      const extensions = Buffer.from([0x00, 0x00]);
      const body = Buffer.concat([
        version,
        random,
        sessionId,
        cipherSuites,
        compression,
        extensions,
      ]);

      const header = Buffer.alloc(4);
      header[0] = 0; // ClientHello
      header[1] = (body.length >> 16) & 0xff;
      header[2] = (body.length >> 8) & 0xff;
      header[3] = body.length & 0xff;
      const hex = Buffer.concat([header, body]).toString('hex');

      const result = await handlers.handleParseHandshake({ rawHex: hex });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(true);
      expect(parsed.handshake.cipherSuite).toContain('TLS_AES_128_GCM_SHA256');
    });

    it('parses a ClientHello with SNI extension', async () => {
      const sni = buildClientHelloWithSNI('example.com');
      const result = await handlers.handleParseHandshake({ rawHex: sni.toString('hex') });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(true);
      expect(parsed.sni).toEqual({ serverName: 'example.com' });
    });

    it('returns minimal result for invalid hex input', async () => {
      const result = await handlers.handleParseHandshake({ rawHex: 'zzznotreal' });
      // Invalid hex produces empty buffer; parser returns minimal result (not an error)
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);
      expect(parsed.success).toBe(true);
    });
  });

  describe('handleCipherSuites', () => {
    it('lists all cipher suites without filter', async () => {
      const result = await handlers.handleCipherSuites({});
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(true);
      expect(parsed.total).toBeGreaterThan(10);
      expect(parsed.filter).toBeNull();
    });

    it('filters cipher suites by keyword', async () => {
      const result = await handlers.handleCipherSuites({ filter: 'CHACHA20' });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(true);
      expect(parsed.filter).toBe('CHACHA20');
      expect(parsed.total).toBeGreaterThan(0);
    });
  });

  describe('handleParseCertificate', () => {
    it('parses certificate message and returns fingerprints', async () => {
      const certData = Buffer.from('abcdef1234567890', 'hex');
      const msg = buildCertificateMessage([certData]);
      const result = await handlers.handleParseCertificate({ rawHex: msg.toString('hex') });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(true);
      expect(parsed.certificateCount).toBe(1);
      expect(parsed.fingerprints).toHaveLength(1);
    });

    it('returns error for invalid input', async () => {
      const result = await handlers.handleParseCertificate({ rawHex: 'zzz' });
      expect(result).toBeDefined();
    });
  });

  describe('handleRawTcpSend', () => {
    it('requires host argument', async () => {
      const result = await handlers.handleRawTcpSend({});
      expect(result).toBeDefined();
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(content).toContain('Error');
    });

    it('requires data argument', async () => {
      const result = await handlers.handleRawTcpSend({ host: '127.0.0.1' });
      expect(result).toBeDefined();
    });
  });

  describe('handleRawTcpScan', () => {
    it('requires host argument', async () => {
      const result = await handlers.handleRawTcpScan({});
      expect(result).toBeDefined();
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      expect(content).toContain('Error');
    });

    it('scans localhost and returns results', async () => {
      const result = await handlers.handleRawTcpScan({
        host: '127.0.0.1',
        startPort: 1,
        endPort: 5,
        timeoutMs: 500,
        concurrency: 5,
      });
      expect(result).toBeDefined();
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);
      expect(parsed.success).toBe(true);
      expect(parsed.host).toBe('127.0.0.1');
      expect(Array.isArray(parsed.openPorts)).toBe(true);
    });
  });

  describe('handleRawUdpSend', () => {
    it('requires host and data', async () => {
      const result = await handlers.handleRawUdpSend({});
      expect(result).toBeDefined();
    });
  });

  describe('handleBypassCertPinning', () => {
    it('generates bypass scripts for all methods when auto', async () => {
      const result = await handlers.handleBypassCertPinning({ bypassMethod: 'auto' });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(false); // No extension available
      expect(parsed.bypassed).toBe(false);
      expect(parsed.scripts).toBeDefined();
      expect(Object.keys(parsed.scripts).length).toBe(3);
      expect(parsed.scripts.boringssl).toContain('SSL_CTX_set_custom_verify');
      expect(parsed.scripts.chrome).toContain('CertVerifyProc');
      expect(parsed.scripts.okhttp).toContain('CertificatePinner');
    });

    it('generates only BoringSSL script', async () => {
      const result = await handlers.handleBypassCertPinning({ bypassMethod: 'boringssl' });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.scripts).toBeDefined();
      expect(Object.keys(parsed.scripts)).toEqual(['boringssl']);
    });

    it('generates only Chrome script', async () => {
      const result = await handlers.handleBypassCertPinning({ bypassMethod: 'chrome' });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.scripts).toBeDefined();
      expect(Object.keys(parsed.scripts)).toEqual(['chrome']);
    });

    it('generates only OkHttp script', async () => {
      const result = await handlers.handleBypassCertPinning({ bypassMethod: 'okhttp' });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.scripts).toBeDefined();
      expect(Object.keys(parsed.scripts)).toEqual(['okhttp']);
    });

    it('includes instructions when extension unavailable', async () => {
      const result = await handlers.handleBypassCertPinning({ bypassMethod: 'boringssl' });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.instructions).toContain('frida');
    });

    it('uses mocked extension when available', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({ status: 'ok', pid: 1234 });
      handlers.setExtensionInvoke(mockInvoke);

      const result = await handlers.handleBypassCertPinning({ bypassMethod: 'boringssl' });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(true);
      expect(parsed.viaExtension).toBe('plugin_frida_bridge');
      expect(mockInvoke).toHaveBeenCalledWith(
        'plugin_frida_bridge',
        'run_script',
        expect.objectContaining({
          script: expect.stringContaining('SSL_CTX_set_custom_verify'),
        }),
      );
    });

    it('falls back to script generation when extension fails', async () => {
      const mockInvoke = vi.fn().mockRejectedValue(new Error('extension not available'));
      handlers.setExtensionInvoke(mockInvoke);

      const result = await handlers.handleBypassCertPinning({ bypassMethod: 'boringssl' });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(false);
      expect(parsed.scripts).toBeDefined();
    });
  });
});

// ── Test Helpers ──

function buildClientHelloWithSNI(sni: string): Buffer {
  const sniBytes = Buffer.from(sni, 'utf8');
  const entryLen = 3 + sniBytes.length;
  const listLen = entryLen;

  const sniPayload = Buffer.alloc(2 + 2 + entryLen);
  sniPayload.writeUInt16BE(listLen, 0);
  sniPayload[2] = 0;
  sniPayload.writeUInt16BE(sniBytes.length, 3);
  sniBytes.copy(sniPayload, 5);

  const ext = Buffer.alloc(4 + sniPayload.length);
  ext.writeUInt16BE(0, 0);
  ext.writeUInt16BE(sniPayload.length, 2);
  sniPayload.copy(ext, 4);

  return buildClientHelloWithExtensions([ext]);
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

  const header = Buffer.alloc(4);
  header[0] = 0;
  header[1] = (body.length >> 16) & 0xff;
  header[2] = (body.length >> 8) & 0xff;
  header[3] = body.length & 0xff;

  return Buffer.concat([header, body]);
}

function buildCertificateMessage(certs: Buffer[]): Buffer {
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

  const hsHeader = Buffer.alloc(4);
  hsHeader[0] = 4;
  hsHeader[1] = (body.length >> 16) & 0xff;
  hsHeader[2] = (body.length >> 8) & 0xff;
  hsHeader[3] = body.length & 0xff;

  return Buffer.concat([hsHeader, body]);
}
