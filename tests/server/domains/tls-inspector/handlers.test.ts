/**
 * TLS Inspector domain handler tests.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer as createTlsServer, type Server as TlsServer } from 'node:tls';
import {
  createServer as createNetServer,
  type AddressInfo,
  type Server as NetServer,
  type Socket as NetSocket,
} from 'node:net';
import { describe, expect, it, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { TlsInspectorHandlers } from '@server/domains/tls-inspector/index';
import { disableKeyLog } from '@modules/tls-inspector/TLSKeyLogExtractor';
import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { TEST_HOSTS } from '@tests/shared/test-urls';
import { TEST_CERT_PEM, TEST_KEY_PEM } from '@tests/fixtures/tls-self-signed';
import { TLS_KEYLOG_PATH } from '@src/constants';

describe('TlsInspectorHandlers', () => {
  let handlers: TlsInspectorHandlers;
  const eventBus = { emit: vi.fn() } as any;
  let tcpServer: NetServer;
  let tcpPort: number;
  let tlsServer: TlsServer;
  let tlsPort: number;
  let tlsSessionServer: TlsServer;
  let tlsSessionPort: number;
  let wsServer: NetServer;
  let wsPort: number;
  let wssServer: TlsServer;
  let wssPort: number;
  let tlsCertPem: string;
  let caDir: string;
  let caPath: string;

  beforeAll(async () => {
    tcpServer = createNetServer((socket) => {
      socket.on('data', (chunk) => {
        const data = chunk.toString('utf8');
        if (data === 'ping') {
          socket.write('po');
          setTimeout(() => socket.write('ng\n'), 10);
          return;
        }
        socket.write(`echo:${data}\n`);
      });
    });
    await new Promise<void>((resolve, reject) => {
      tcpServer.once('error', reject);
      tcpServer.listen(0, '127.0.0.1', () => {
        tcpServer.off('error', reject);
        resolve();
      });
    });
    tcpPort = (tcpServer.address() as AddressInfo).port;

    tlsCertPem = TEST_CERT_PEM;
    tlsServer = createTlsServer(
      {
        key: TEST_KEY_PEM,
        cert: TEST_CERT_PEM,
        ALPNProtocols: ['h2', 'http/1.1'],
      },
      (socket) => {
        socket.end();
      },
    );

    await new Promise<void>((resolve, reject) => {
      tlsServer.once('error', reject);
      tlsServer.listen(0, '127.0.0.1', () => {
        tlsServer.off('error', reject);
        resolve();
      });
    });

    tlsPort = (tlsServer.address() as AddressInfo).port;
    tlsSessionServer = createTlsServer(
      {
        key: TEST_KEY_PEM,
        cert: TEST_CERT_PEM,
        ALPNProtocols: ['h2', 'http/1.1'],
      },
      (socket) => {
        socket.on('data', (chunk) => {
          const data = chunk.toString('utf8');
          if (data === 'hello') {
            socket.write('wor');
            setTimeout(() => socket.write('ld\n'), 10);
            return;
          }
          socket.write(`echo:${data}\n`);
        });
      },
    );
    await new Promise<void>((resolve, reject) => {
      tlsSessionServer.once('error', reject);
      tlsSessionServer.listen(0, '127.0.0.1', () => {
        tlsSessionServer.off('error', reject);
        resolve();
      });
    });
    tlsSessionPort = (tlsSessionServer.address() as AddressInfo).port;

    wsServer = createNetServer(createWebSocketTestServer());
    await new Promise<void>((resolve, reject) => {
      wsServer.once('error', reject);
      wsServer.listen(0, '127.0.0.1', () => {
        wsServer.off('error', reject);
        resolve();
      });
    });
    wsPort = (wsServer.address() as AddressInfo).port;

    wssServer = createTlsServer(
      {
        key: TEST_KEY_PEM,
        cert: TEST_CERT_PEM,
      },
      createWebSocketTestServer(),
    );
    await new Promise<void>((resolve, reject) => {
      wssServer.once('error', reject);
      wssServer.listen(0, '127.0.0.1', () => {
        wssServer.off('error', reject);
        resolve();
      });
    });
    wssPort = (wssServer.address() as AddressInfo).port;

    caDir = await mkdtemp(join(tmpdir(), 'jshookmcp-tlsprobe-'));
    caPath = join(caDir, 'ca.pem');
    await writeFile(caPath, tlsCertPem, 'utf8');
  });

  beforeEach(() => {
    handlers = new TlsInspectorHandlers();
    handlers.setEventBus(eventBus);
    eventBus.emit.mockClear();
  });

  afterAll(async () => {
    if (tcpServer) {
      await new Promise<void>((resolve, reject) => {
        tcpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    if (!tlsServer) {
      throw new Error('tlsServer was not initialized');
    }
    await new Promise<void>((resolve, reject) => {
      tlsServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    if (tlsSessionServer) {
      await new Promise<void>((resolve, reject) => {
        tlsSessionServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    if (wsServer) {
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    if (wssServer) {
      await new Promise<void>((resolve, reject) => {
        wssServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    if (caDir) {
      await rm(caDir, { recursive: true, force: true });
    }
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
      expect(parsed.filePath).toBe(TLS_KEYLOG_PATH);
    });
  });

  describe('handleParseHandshake', () => {
    it('parses a ClientHello hex and returns cipher suites', async () => {
      const version = Buffer.from([0x03, 0x03]);
      const random = Buffer.alloc(32, 0xab);
      const sessionId = Buffer.from([0x00]);
      const cipherSuites = Buffer.from([0x00, 0x04, 0x13, 0x01, 0x13, 0x02]);
      const compression = Buffer.from([0x01, 0x00]);
      const extensions = Buffer.from([0x00, 0x00]);
      const bodyContent = Buffer.concat([
        version,
        random,
        sessionId,
        cipherSuites,
        compression,
        extensions,
      ]);

      // Handshake header: type (1 = client_hello) + 3-byte length
      const handshakeHeader = Buffer.alloc(4);
      handshakeHeader[0] = 1; // client_hello
      handshakeHeader[1] = (bodyContent.length >> 16) & 0xff;
      handshakeHeader[2] = (bodyContent.length >> 8) & 0xff;
      handshakeHeader[3] = bodyContent.length & 0xff;
      const body = Buffer.concat([handshakeHeader, bodyContent]);

      const header = Buffer.alloc(5);
      header[0] = 0x16; // TLS handshake content type
      header[1] = 0x03; // TLS major version
      header[2] = 0x03; // TLS minor version
      header.writeUInt16BE(body.length, 3); // 2-byte record length
      const hex = Buffer.concat([header, body]).toString('hex');

      const result = await handlers.handleParseHandshake({ rawHex: hex });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(true);
      expect(parsed.handshake.cipherSuites).toContain('TLS_AES_128_GCM_SHA256');
    });

    it('parses a ClientHello with SNI extension', async () => {
      const sni = buildClientHelloWithSNI(TEST_HOSTS.root);
      const result = await handlers.handleParseHandshake({ rawHex: sni.toString('hex') });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(true);
      expect(parsed.sni).toEqual({ serverName: TEST_HOSTS.root });
    });

    it('returns error result for invalid hex input', async () => {
      const result = await handlers.handleParseHandshake({ rawHex: 'zzznotreal' });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);
      expect(parsed.success).toBe(false);
    });

    // Regression: the previous implementation called a no-op decryptPayload stub
    // when `decrypt:true` was passed and reported ciphertext bytes as
    // "decryptedPreviewHex". The arg is removed and the field must never appear.
    it('never returns a fabricated decryptedPreviewHex (decrypt stub removed)', async () => {
      const sni = buildClientHelloWithSNI(TEST_HOSTS.root);
      const result = await handlers.handleParseHandshake({
        rawHex: sni.toString('hex'),
        decrypt: true,
      } as Record<string, unknown>);
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(true);
      expect(parsed.decryptedPreviewHex).toBeUndefined();
    });
  });

  describe('handleTlsKeylogEnable', () => {
    it('surfaces the browser_launch --ssl-key-log flag with the Node keylog path', async () => {
      const body = (await handlers.handleTlsKeylogEnable({})) as {
        enabled: boolean;
        keyLogPath: string;
        environmentVariable: string;
        scope: string;
        browserLaunch: { flag: string; hint: string };
      };
      expect(body.enabled).toBe(true);
      expect(body.environmentVariable).toBe('SSLKEYLOGFILE');
      expect(body.scope).toBe('node-process');
      expect(body.browserLaunch.flag).toContain('--ssl-key-log=');
      expect(body.browserLaunch.flag).toContain(body.keyLogPath);
      expect(body.browserLaunch.hint.length).toBeGreaterThan(0);
    });
  });

  describe('handleCipherSuites', () => {
    it('lists all cipher suites without filter', async () => {
      const result = await handlers.handleCipherSuites({});
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(true);
      expect(parsed.total).toBeGreaterThan(0);
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

    it('enriches every suite with id, protocol, kx/auth/enc/mac and aead flag', async () => {
      const parsed = parseJson<any>(await handlers.handleCipherSuites({}));
      const first = parsed.suites[0];
      expect(first).toBeDefined();
      expect(first.idHex).toMatch(/^0x[0-9a-f]{4}$/);
      expect(['TLS1.3', 'TLS1.2']).toContain(first.protocol);
      expect(typeof first.aead).toBe('boolean');
      expect(first.name).toMatch(/^TLS_/);
    });

    it('filters by TLS 1.3 protocol only', async () => {
      const parsed = parseJson<any>(await handlers.handleCipherSuites({ protocol: '1.3' }));
      expect(parsed.protocol).toBe('1.3');
      expect(parsed.total).toBeGreaterThan(0);
      expect(parsed.suites.every((s: any) => s.protocol === 'TLS1.3')).toBe(true);
    });

    it('combines protocol and keyword filters', async () => {
      const parsed = parseJson<any>(
        await handlers.handleCipherSuites({ protocol: '1.3', filter: 'GCM' }),
      );
      expect(parsed.suites.length).toBeGreaterThan(0);
      expect(
        parsed.suites.every((s: any) => s.protocol === 'TLS1.3' && s.name.includes('GCM')),
      ).toBe(true);
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

    it('returns empty result for invalid input', async () => {
      const result = await handlers.handleParseCertificate({ rawHex: 'zzz' });
      expect(result).toBeDefined();
    });

    it('extracts X.509 subject/issuer/validity and SPKI pin from a real certificate', async () => {
      const der = pemToDer(TEST_CERT_PEM);
      const msg = buildCertificateMessage([der]);
      const parsed = parseJson<any>(
        await handlers.handleParseCertificate({ rawHex: msg.toString('hex') }),
      );

      expect(parsed.success).toBe(true);
      expect(parsed.certificateCount).toBe(1);
      const cert = parsed.certificates[0];
      expect(cert).toBeDefined();
      expect(cert.subject).toContain('localhost');
      expect(cert.issuer).toContain('localhost');
      expect(cert.validFrom).toBeTruthy();
      expect(cert.validTo).toBeTruthy();
      expect(cert.subjectAltName).toContain('localhost');
      expect(cert.publicKeyAlgorithm).toBe('rsa');
      expect(cert.publicKeySpkiSha256).toMatch(/^[0-9A-F]{64}$/);
      expect(cert.publicKeyPinBase64).toBeTruthy();
      // fingerprints keep sha256/length for backwards compat and gain the pin hash
      expect(parsed.fingerprints[0].sha256).toBe(cert.sha256);
      expect(parsed.fingerprints[0].publicKeySpkiSha256).toBe(cert.publicKeySpkiSha256);
    });
  });

  describe('handleTlsProbeEndpoint', () => {
    it('probes a TLS endpoint and reports transport plus authorization details', async () => {
      const result = await handlers.handleTlsProbeEndpoint({
        host: '127.0.0.1',
        port: tlsPort,
        servername: 'localhost',
        alpnProtocols: ['h2', 'http/1.1'],
        allowInvalidCertificates: true,
      });

      expect(result).toMatchObject({
        ok: true,
        target: {
          host: '127.0.0.1',
          port: tlsPort,
          requestedServername: 'localhost',
          validationTarget: 'localhost',
        },
        policy: {
          allowInvalidCertificates: true,
          skipHostnameCheck: false,
          alpnProtocols: ['h2', 'http/1.1'],
          customCa: {
            source: null,
          },
        },
        transport: {
          alpnProtocol: 'h2',
          servernameSent: 'localhost',
        },
        authorization: {
          socketAuthorized: false,
          policyAllowed: true,
          hostnameValidation: {
            checked: true,
            matched: true,
            target: 'localhost',
            error: null,
          },
        },
      });

      expect((result as { transport: { protocol: string | null } }).transport.protocol).toMatch(
        /^TLS/,
      );
      expect(
        (result as { transport: { cipher: { standardName: string } } }).transport.cipher
          .standardName,
      ).toBeTruthy();
      expect(
        (result as { certificates: { chain: Array<{ subjectAltName: string | null }> } })
          .certificates.chain[0]?.subjectAltName,
      ).toContain('DNS:localhost');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tls:probe_completed',
        expect.objectContaining({ host: '127.0.0.1', port: tlsPort, success: true }),
      );
    });

    it('marks hostname validation failure when the requested name does not match', async () => {
      const result = await handlers.handleTlsProbeEndpoint({
        host: '127.0.0.1',
        port: tlsPort,
        servername: 'mismatch.example.test',
        allowInvalidCertificates: true,
      });

      expect(result).toMatchObject({
        ok: true,
        authorization: {
          socketAuthorized: false,
          policyAllowed: false,
          hostnameValidation: {
            checked: true,
            matched: false,
            target: 'mismatch.example.test',
          },
        },
      });
    });

    it('can skip hostname validation explicitly while preserving the audit trail', async () => {
      const result = await handlers.handleTlsProbeEndpoint({
        host: '127.0.0.1',
        port: tlsPort,
        servername: 'mismatch.example.test',
        allowInvalidCertificates: true,
        skipHostnameCheck: true,
      });

      expect(result).toMatchObject({
        ok: true,
        authorization: {
          policyAllowed: true,
          hostnameValidation: {
            checked: false,
            matched: null,
            target: null,
          },
        },
      });
    });

    it('trusts a supplied CA bundle path and reports the authorization result', async () => {
      const result = await handlers.handleTlsProbeEndpoint({
        host: '127.0.0.1',
        port: tlsPort,
        servername: 'localhost',
        caPath,
      });

      expect(result).toMatchObject({
        ok: true,
        policy: {
          customCa: {
            source: 'path',
            path: caPath,
          },
        },
        authorization: {
          socketAuthorized: true,
          authorizationError: null,
          policyAllowed: true,
          hostnameValidation: {
            checked: true,
            matched: true,
            target: 'localhost',
          },
        },
      });
    });
  });

  describe('atomic TCP sessions', () => {
    it('opens, writes, reads until a delimiter, and closes a TCP session', async () => {
      const opened = await handlers.handleTcpOpen({
        host: '127.0.0.1',
        port: tcpPort,
      });

      expect(opened).toMatchObject({
        ok: true,
        kind: 'tcp',
        target: {
          host: '127.0.0.1',
          port: tcpPort,
        },
        transport: {
          remotePort: tcpPort,
        },
      });

      const sessionId = (opened as { sessionId: string }).sessionId;
      expect(sessionId).toMatch(/^tcp_/);

      const writeResult = await handlers.handleTcpWrite({
        sessionId,
        dataText: 'ping',
      });
      expect(writeResult).toMatchObject({
        ok: true,
        sessionId,
        kind: 'tcp',
        bytesWritten: 4,
      });

      const readResult = await handlers.handleTcpReadUntil({
        sessionId,
        delimiterText: '\n',
        includeDelimiter: false,
      });
      expect(readResult).toMatchObject({
        ok: true,
        sessionId,
        kind: 'tcp',
        matchedDelimiter: true,
        stopReason: 'delimiter',
        dataText: 'pong',
      });

      const closeResult = await handlers.handleTcpClose({ sessionId });
      expect(closeResult).toMatchObject({
        ok: true,
        sessionId,
        kind: 'tcp',
        closed: true,
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tcp:session_opened',
        expect.objectContaining({ sessionId, host: '127.0.0.1', port: tcpPort }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tcp:session_written',
        expect.objectContaining({ sessionId, byteLength: 4 }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tcp:session_read',
        expect.objectContaining({ sessionId, matched: true }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tcp:session_closed',
        expect.objectContaining({ sessionId }),
      );
    });
  });

  describe('atomic TLS sessions', () => {
    it('opens, writes, reads until a delimiter, and closes a TLS session', async () => {
      const opened = await handlers.handleTlsOpen({
        host: '127.0.0.1',
        port: tlsSessionPort,
        servername: 'localhost',
        caPath,
        alpnProtocols: ['h2', 'http/1.1'],
      });

      expect(opened).toMatchObject({
        ok: true,
        kind: 'tls',
        target: {
          host: '127.0.0.1',
          port: tlsSessionPort,
          requestedServername: 'localhost',
          validationTarget: 'localhost',
        },
        authorization: {
          socketAuthorized: true,
          policyAllowed: true,
        },
      });

      const sessionId = (opened as { sessionId: string }).sessionId;
      expect(sessionId).toMatch(/^tls_/);

      const writeResult = await handlers.handleTlsWrite({
        sessionId,
        dataText: 'hello',
      });
      expect(writeResult).toMatchObject({
        ok: true,
        sessionId,
        kind: 'tls',
        bytesWritten: 5,
      });

      const readResult = await handlers.handleTlsReadUntil({
        sessionId,
        delimiterText: '\n',
        includeDelimiter: false,
      });
      expect(readResult).toMatchObject({
        ok: true,
        sessionId,
        kind: 'tls',
        matchedDelimiter: true,
        stopReason: 'delimiter',
        dataText: 'world',
      });

      const closeResult = await handlers.handleTlsClose({ sessionId });
      expect(closeResult).toMatchObject({
        ok: true,
        sessionId,
        kind: 'tls',
        closed: true,
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tls:session_opened',
        expect.objectContaining({ sessionId, host: '127.0.0.1', port: tlsSessionPort }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tls:session_written',
        expect.objectContaining({ sessionId, byteLength: 5 }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tls:session_read',
        expect.objectContaining({ sessionId, matched: true }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'tls:session_closed',
        expect.objectContaining({ sessionId }),
      );
    });
  });

  describe('atomic WebSocket sessions', () => {
    it('opens a ws session from a URL, exchanges text frames, and closes cleanly', async () => {
      const opened = await handlers.handleWebSocketOpen({
        url: `ws://127.0.0.1:${String(wsPort)}/chat?room=test`,
        subprotocols: ['chat.v1'],
      });

      expect(opened).toMatchObject({
        ok: true,
        kind: 'websocket',
        scheme: 'ws',
        target: {
          scheme: 'ws',
          host: '127.0.0.1',
          port: wsPort,
          path: '/chat?room=test',
        },
        authorization: null,
      });

      const sessionId = (opened as { sessionId: string }).sessionId;
      expect(sessionId).toMatch(/^websocket_/);

      const writeResult = await handlers.handleWebSocketSendFrame({
        sessionId,
        frameType: 'text',
        dataText: 'hello',
      });
      expect(writeResult).toMatchObject({
        ok: true,
        sessionId,
        kind: 'websocket',
        frameType: 'text',
      });

      const readResult = await handlers.handleWebSocketReadFrame({ sessionId });
      expect(readResult).toMatchObject({
        ok: true,
        sessionId,
        kind: 'websocket',
        frameType: 'text',
        dataText: 'world',
      });

      const closeResult = await handlers.handleWebSocketClose({
        sessionId,
        closeCode: 1000,
        closeReason: 'done',
      });
      expect(closeResult).toMatchObject({
        ok: true,
        sessionId,
        kind: 'websocket',
        closed: true,
      });

      expect(eventBus.emit).toHaveBeenCalledWith(
        'websocket:session_opened',
        expect.objectContaining({ sessionId, scheme: 'ws', host: '127.0.0.1', port: wsPort }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'websocket:session_written',
        expect.objectContaining({ sessionId, frameType: 'text', automatic: false }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'websocket:frame_read',
        expect.objectContaining({ sessionId, frameType: 'text' }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'websocket:session_closed',
        expect.objectContaining({ sessionId }),
      );
    });

    it('opens a wss session from explicit host/path inputs and exchanges a ping/pong frame', async () => {
      const opened = await handlers.handleWebSocketOpen({
        scheme: 'wss',
        host: '127.0.0.1',
        port: wssPort,
        path: '/secure',
        servername: 'localhost',
        caPath,
        subprotocols: ['chat.v1'],
      });

      expect(opened).toMatchObject({
        ok: true,
        kind: 'websocket',
        scheme: 'wss',
        target: {
          scheme: 'wss',
          host: '127.0.0.1',
          port: wssPort,
          path: '/secure',
          requestedServername: 'localhost',
          validationTarget: 'localhost',
        },
        authorization: {
          socketAuthorized: true,
          policyAllowed: true,
        },
      });

      const sessionId = (opened as { sessionId: string }).sessionId;

      const writeResult = await handlers.handleWebSocketSendFrame({
        sessionId,
        frameType: 'ping',
        dataText: 'hi',
      });
      expect(writeResult).toMatchObject({
        ok: true,
        sessionId,
        frameType: 'ping',
      });

      const readResult = await handlers.handleWebSocketReadFrame({ sessionId });
      expect(readResult).toMatchObject({
        ok: true,
        sessionId,
        frameType: 'pong',
        dataText: 'hi',
      });

      const closeResult = await handlers.handleWebSocketClose({ sessionId, force: true });
      expect(closeResult).toMatchObject({
        ok: true,
        sessionId,
        kind: 'websocket',
      });
    });
  });

  describe('ToolResponse wrappers', () => {
    it('preserves cipher suite ToolResponse results without double wrapping', async () => {
      const body = parseJson<any>(await handlers.handleCipherSuitesTool({ filter: 'TLS_AES' }));

      expect(body.success).toBe(true);
      expect(body.total).toBeGreaterThan(0);
      expect(body.content).toBeUndefined();
    });

    it('converts thrown socket handler errors into structured ToolResponse failures', async () => {
      vi.spyOn(handlers, 'handleTcpOpen').mockRejectedValueOnce(new Error('tcp failed'));

      const body = parseJson<any>(
        await handlers.handleTcpOpenTool({
          host: '127.0.0.1',
          port: tcpPort,
        }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toBe('tcp failed');
      expect(body.message).toBe('tcp failed');
    });

    it('reports ok:false handler records as success:false envelopes', async () => {
      const body = parseJson<any>(await handlers.handleWebSocketOpenTool({}));

      expect(body.success).toBe(false);
      expect(body.ok).toBe(false);
      expect(body.error).toBe('host or url is required');
    });

    it('does not claim a Frida injection when the runner returns bare-text validation failure', async () => {
      handlers.setExtensionInvoke(async () => ({
        content: [{ type: 'text', text: 'Missing required string argument: sessionId' }],
      }));

      const body = parseJson<any>(
        await handlers.handleBypassCertPinningTool({ target: 'android' }),
      );

      expect(body.success).toBe(false);
      expect(body.strategy).toBe('frida-injection');
      expect(body.error).toContain('sessionId');
      expect(body.result).toBeUndefined();
    });

    it('does not claim a Frida injection when the runner reports success:false', async () => {
      handlers.setExtensionInvoke(async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: false, error: 'Unknown Frida session: abc' }),
          },
        ],
      }));

      const body = parseJson<any>(
        await handlers.handleBypassCertPinningTool({ target: 'android' }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toBe('Unknown Frida session: abc');
    });

    it('reports a successful Frida injection when the runner succeeds', async () => {
      handlers.setExtensionInvoke(async () => ({
        content: [{ type: 'text', text: JSON.stringify({ success: true, output: 'hooked' }) }],
      }));

      const body = parseJson<any>(
        await handlers.handleBypassCertPinningTool({ target: 'android' }),
      );

      expect(body.success).toBe(true);
      expect(body.strategy).toBe('frida-injection');
      expect(body.result).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ success: true, output: 'hooked' }) }],
      });
    });

    it('reports an invalid cert-pin target as success:false', async () => {
      const body = parseJson<any>(await handlers.handleTlsCertPinBypassTool({ target: 'beos' }));

      expect(body.success).toBe(false);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('target must be one of');
    });

    it('falls back to manual guidance (not injection) when no runner is wired', async () => {
      const body = parseJson<any>(
        await handlers.handleBypassCertPinningTool({ target: 'android' }),
      );

      expect(body.success).toBe(true);
      expect(body.strategy).toBe('manual-bypass');
      expect(body.available).toBe(false);
      expect(Array.isArray(body.instructions.android)).toBe(true);
    });
  });
});

// ── Test Helpers ──

function createWebSocketTestServer(): (socket: NetSocket) => void {
  return (socket) => {
    let upgraded = false;
    let handshakeBuffer = Buffer.alloc(0);
    let frameBuffer = Buffer.alloc(0);

    const drainFrames = (): void => {
      while (frameBuffer.length > 0) {
        const consumed = tryConsumeClientFrame(frameBuffer);
        if (!consumed) {
          return;
        }
        frameBuffer = frameBuffer.subarray(consumed.bytesConsumed);
        const frame = consumed.frame;

        if (frame.type === 'text' && frame.data.toString('utf8') === 'hello') {
          socket.write(encodeServerFrame('text', Buffer.from('world', 'utf8')));
          continue;
        }

        if (frame.type === 'ping') {
          socket.write(encodeServerFrame('pong', frame.data));
          continue;
        }

        if (frame.type === 'close') {
          socket.write(
            encodeServerFrame('close', frame.data, frame.closeCode ?? undefined, frame.closeReason),
          );
          socket.end();
          return;
        }

        socket.write(encodeServerFrame(frame.type, frame.data));
      }
    };

    socket.on('data', (chunk: Buffer) => {
      if (!upgraded) {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
        const headerEnd = handshakeBuffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) {
          return;
        }

        const headerText = handshakeBuffer.subarray(0, headerEnd).toString('utf8');
        const keyMatch = headerText.match(/^sec-websocket-key:\s*(.+)$/im);
        if (!keyMatch?.[1]) {
          socket.destroy();
          return;
        }

        const protocolMatch = headerText.match(/^sec-websocket-protocol:\s*(.+)$/im);
        const accept = computeAcceptForTest(keyMatch[1].trim());
        const responseLines = [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
        ];
        if (protocolMatch?.[1]) {
          responseLines.push(`Sec-WebSocket-Protocol: ${protocolMatch[1].split(',')[0]!.trim()}`);
        }
        responseLines.push('', '');
        socket.write(Buffer.from(responseLines.join('\r\n'), 'utf8'));

        upgraded = true;
        frameBuffer = handshakeBuffer.subarray(headerEnd + 4);
        handshakeBuffer = Buffer.alloc(0);
        drainFrames();
        return;
      }

      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      drainFrames();
    });
  };
}

function computeAcceptForTest(requestKey: string): string {
  return createHash('sha1')
    .update(`${requestKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, 'utf8')
    .digest('base64');
}

function encodeServerFrame(
  type: 'text' | 'binary' | 'close' | 'ping' | 'pong',
  payload: Buffer,
  closeCode?: number,
  closeReason?: string | null,
): Buffer {
  let opcode = 0x1;
  let framePayload = payload;
  if (type === 'binary') {
    opcode = 0x2;
  } else if (type === 'close') {
    opcode = 0x8;
    if (closeCode !== undefined) {
      const reasonBuffer = closeReason ? Buffer.from(closeReason, 'utf8') : Buffer.alloc(0);
      framePayload = Buffer.alloc(2 + reasonBuffer.length);
      framePayload.writeUInt16BE(closeCode, 0);
      reasonBuffer.copy(framePayload, 2);
    }
  } else if (type === 'ping') {
    opcode = 0x9;
  } else if (type === 'pong') {
    opcode = 0xa;
  }

  const payloadLength = framePayload.length;
  let header: Buffer;
  if (payloadLength < 126) {
    header = Buffer.alloc(2);
    header[1] = payloadLength;
  } else if (payloadLength <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, framePayload]);
}

function tryConsumeClientFrame(buffer: Buffer): {
  frame: {
    type: 'text' | 'binary' | 'close' | 'ping' | 'pong';
    data: Buffer;
    closeCode: number | null;
    closeReason: string | null;
  };
  bytesConsumed: number;
} | null {
  if (buffer.length < 2) {
    return null;
  }

  const first = buffer[0]!;
  const second = buffer[1]!;
  const opcode = first & 0x0f;
  let payloadLength = second & 0x7f;
  let cursor = 2;
  if (payloadLength === 126) {
    if (buffer.length < cursor + 2) {
      return null;
    }
    payloadLength = buffer.readUInt16BE(cursor);
    cursor += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < cursor + 8) {
      return null;
    }
    payloadLength = Number(buffer.readBigUInt64BE(cursor));
    cursor += 8;
  }

  const masked = (second & 0x80) !== 0;
  if (!masked || buffer.length < cursor + 4) {
    return null;
  }
  const maskKey = buffer.subarray(cursor, cursor + 4);
  cursor += 4;
  if (buffer.length < cursor + payloadLength) {
    return null;
  }

  const payload = buffer.subarray(cursor, cursor + payloadLength);
  const data = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    data[index] = payload[index]! ^ maskKey[index % 4]!;
  }

  const type =
    opcode === 0x1
      ? 'text'
      : opcode === 0x2
        ? 'binary'
        : opcode === 0x8
          ? 'close'
          : opcode === 0x9
            ? 'ping'
            : opcode === 0xa
              ? 'pong'
              : null;
  if (!type) {
    throw new Error(`Unsupported opcode ${opcode}`);
  }

  let closeCode: number | null = null;
  let closeReason: string | null = null;
  if (type === 'close' && data.length >= 2) {
    closeCode = data.readUInt16BE(0);
    closeReason = data.subarray(2).toString('utf8');
  }

  return {
    frame: {
      type,
      data,
      closeCode,
      closeReason,
    },
    bytesConsumed: cursor + payloadLength,
  };
}

function buildClientHelloWithSNI(sni: string): Buffer {
  const sniBytes = Buffer.from(sni, 'utf8');
  const entryLen = 3 + sniBytes.length;
  const listLen = entryLen;

  const sniPayload = Buffer.alloc(5 + sniBytes.length); // listLen(2) + nameType(1) + nameLen(2) + hostname
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

  const bodyContent = Buffer.concat([
    version,
    random,
    sessionId,
    cipherSuites,
    compression,
    extensions,
  ]);

  // Handshake header: type (1 = client_hello) + 3-byte length
  const handshakeHeader = Buffer.alloc(4);
  handshakeHeader[0] = 1; // client_hello
  handshakeHeader[1] = (bodyContent.length >> 16) & 0xff;
  handshakeHeader[2] = (bodyContent.length >> 8) & 0xff;
  handshakeHeader[3] = bodyContent.length & 0xff;
  const body = Buffer.concat([handshakeHeader, bodyContent]);

  const header = Buffer.alloc(5);
  header[0] = 0x16; // TLS handshake content type
  header[1] = 0x03; // TLS major version
  header[2] = 0x03; // TLS minor version
  header.writeUInt16BE(body.length, 3); // 2-byte record length

  return Buffer.concat([header, body]);
}

function pemToDer(pem: string): Buffer {
  const b64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  return Buffer.from(b64, 'base64');
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
