/**
 * BoringSSL Inspector domain handler tests.
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
import { BoringsslInspectorHandlers } from '@server/domains/boringssl-inspector/index';
import { disableKeyLog } from '@modules/boringssl-inspector/TLSKeyLogExtractor';

describe('BoringsslInspectorHandlers', () => {
  let handlers: BoringsslInspectorHandlers;
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
    handlers = new BoringsslInspectorHandlers();
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
      expect(parsed.filePath).toBe('/tmp/sslkeylog.log');
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
      const sni = buildClientHelloWithSNI('example.com');
      const result = await handlers.handleParseHandshake({ rawHex: sni.toString('hex') });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);

      expect(parsed.success).toBe(true);
      expect(parsed.sni).toEqual({ serverName: 'example.com' });
    });

    it('returns error result for invalid hex input', async () => {
      const result = await handlers.handleParseHandshake({ rawHex: 'zzznotreal' });
      const content = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
      const parsed = JSON.parse(content);
      expect(parsed.success).toBe(false);
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

const TEST_KEY_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAw5ph3jyxq4RKueHGkMvnKpysHDHd+UipLwLFT5j2tlaa6YFY
hxhYfQalHf8AtGTW74czhlX9R365GwlBHhE7fR4vcGsxWbnpd/re8AEmLiW9YLrY
C7Ecw/uBpWOEf7EbYp3mh0anTfU9Zbec5CXH1IYl+tFk5luwc0mW7IL/1uZVStBC
+ttSju0bsuFGduGlCpoQwgXAoMWgPkpFIAQJ8N4nOKoe1LlAYT3/s0uqX07C9x+b
BpxdSOu9GhVSAzZ3qq9zlXyzn4XanHEBow4JmyrD8yiEF4qj1GaZnoSASOp3duhg
bH4BCUBPEjpA95OsgUzHptDRKeK+GUfyRhVgFQIDAQABAoIBAA8qZNynfYoEFYwg
dHYNDSUJZTHBbwmxJ8boktZHUJeWEug4Wl4NFe1JqtsuxoX2DJEhPS409BCLQ3xU
ZRtY8DEU+k4fzYF8r9yY05itqiFpVSvPCMmtR4LteOGTG/aPi4VDo1hJMtcRRNui
VxR8VmhEp2SxP/65TK6/nadER+RIMEzk18BdLGerYMS5RfcPcDtU2zDm997niwh6
cOfUk7UqyrOZ7blO+7ZX2b8MYn20aMfTqW/w764tbbnA9CUK5tA4uRvPU9vW7Abm
ZyzGdOX53EIefWFdREXI1x0lCbgkZ3NtxTTDLww8XzBGzPgtahNhiXUmQA20z5fX
YAtQ+uECgYEA5rz4Y4D2zMIqVXyn8AjBBy/neEP3B9rHinWpFhkxvBSOLzmxfkgu
0ZQpjYw0WGb6pTVlfZLFKSKBAdZeFhIkM6ZptF19Y5YgjasEjl7ey5Z4GKZY8S7L
HlEWa3/JL8Wmi7n/Kt794atQm8GDki5EsmvXPlJ98hqoYjlYagwUr7UCgYEA2QSp
DH538zK7HpNTluBSTZVRcmDnZePVzvJPEWn5CGkHArhRRO5lYFZ6pwhwqCfEgUxd
3b16spBJqTs+H2NllBQ3XyPSpCCVB+39F1lp49OdDm0haxcQ+zBBAgZKA4ics1tp
eSM6BsjwC1lhNgk8UrPG1bXtUU0g018cvhZOauECgYAXpvtXR9sEtkqcpMCaTGtt
Dy4NF/p0paqauODyUPbWLs08bg+RwFh8R1HTHrIm9bdvw/95Vdg8FTtgMtdGL+ni
GYbwZDz8PmFr5EH9TiBMgkohTLwFTSSpIOrJbjnzWbFu1Uwg2ubvgR4sOTQBghis
qX1Q+CfM74qfNv2nMUHVmQKBgD7WOpyDgffJGKUhw3JMQYh1U7/qjxXRgncJcht4
s8LbpkwDUoTDAleCssDqkLQfz6Yglo097+kEHlAB91rfTOozcFT76mHbjUtefYnl
OePdwfwLXUHEzAXvUuNjLssXI0hLj56jtImCZP7kQmGDCxRnOYtnwe9ohbiuMYRY
sRwBAoGARZcKdUUPs5X+Q7DxMRg7f5Yv3i7aqiAi/dZysb5W5On+xFXIJx/OPdQC
WKWO8S/U+5KFZQkJ5yxUcJXezd+HguoB5CL6BEQbfxTvDQW+AesXtmiIpoWqIKx4
cDY9yGCvWTzQwOVjlsEOsOpdZPvxPdZ4pG0tR5aF8BkHf0fKa2g=
-----END RSA PRIVATE KEY-----
`;

const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDGjCCAgKgAwIBAgIBATANBgkqhkiG9w0BAQsFADAtMRIwEAYDVQQDEwlsb2Nh
bGhvc3QxFzAVBgNVBAoTDmpzaG9va21jcC10ZXN0MB4XDTI0MDEwMTAwMDAwMFoX
DTM0MDEwMTAwMDAwMFowLTESMBAGA1UEAxMJbG9jYWxob3N0MRcwFQYDVQQKEw5q
c2hvb2ttY3AtdGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMOa
Yd48sauESrnhxpDL5yqcrBwx3flIqS8CxU+Y9rZWmumBWIcYWH0GpR3/ALRk1u+H
M4ZV/Ud+uRsJQR4RO30eL3BrMVm56Xf63vABJi4lvWC62AuxHMP7gaVjhH+xG2Kd
5odGp031PWW3nOQlx9SGJfrRZOZbsHNJluyC/9bmVUrQQvrbUo7tG7LhRnbhpQqa
EMIFwKDFoD5KRSAECfDeJziqHtS5QGE9/7NLql9OwvcfmwacXUjrvRoVUgM2d6qv
c5V8s5+F2pxxAaMOCZsqw/MohBeKo9RmmZ6EgEjqd3boYGx+AQlATxI6QPeTrIFM
x6bQ0SnivhlH8kYVYBUCAwEAAaNFMEMwCQYDVR0TBAIwADALBgNVHQ8EBAMCBaAw
EwYDVR0lBAwwCgYIKwYBBQUHAwEwFAYDVR0RBA0wC4IJbG9jYWxob3N0MA0GCSqG
SIb3DQEBCwUAA4IBAQAImU5ZLT6Rqhd3rWfsipnplqg1SJ8HiS6zKXMYqZ6sh90s
0l3ycj/EM+YnStK+pgHT1g9IRJ+Js8SBqsbhdXHh80cyw82qN1gE8aaLWrcQJBRk
38Cad5dmX/K6r5XmzJ9sAmbumm/YD72HnKOmjRqGu077sgUxFRBKOVS9gkFtSHIW
5BQFM7EF8xLRpGo5ObdBYt2NZyLVyxxbggj3x3II+wCvAQgi8NXOGbL8FOgGWWDH
hYl+QoIs6H1FE3av1uQdZn9ILfBfiq8jj2j85p/WwizYvSDGa78bcuwh8u/T2KIr
2Sn1Vm9W0vOLfa5gF6/w138SPqk5/LSzYSgnNR9q
-----END CERTIFICATE-----
`;

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
