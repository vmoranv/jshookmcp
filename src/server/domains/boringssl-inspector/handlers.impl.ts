import { readFile } from 'node:fs/promises';
import { createServer as createNetServer, isIP, Socket as NetSocket } from 'node:net';
import { createSocket as createUdpSocket } from 'node:dgram';
import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import {
  checkServerIdentity,
  connect as createTlsConnection,
  type DetailedPeerCertificate,
  type PeerCertificate,
  type TLSSocket,
} from 'node:tls';
import {
  TLSKeyLogExtractor,
  enableKeyLog,
  disableKeyLog,
  getKeyLogFilePath,
  parseKeyLog as parseKeyLogEntries,
  summarizeKeyLog as summarizeKeyLogEntries,
  lookupSecret as lookupSecretEntry,
  decryptPayload as decryptPayloadFunc,
} from '@modules/boringssl-inspector';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolResponse } from '@server/types';
import {
  argBool,
  argEnum,
  argNumber,
  argString,
  argStringArray,
} from '@server/domains/shared/parse-args';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { isLoopbackHost, isPrivateHost } from '@server/domains/network/ssrf-policy';

function validateNetworkTarget(host: string): { ok: false; error: string } | null {
  if (isPrivateHost(host) && !isLoopbackHost(host)) {
    return {
      ok: false,
      error: `Blocked: target host "${host}" resolves to a private/internal address. SSRF protection applies.`,
    };
  }
  return null;
}

const TLS_VERSION_SET = new Set(['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'] as const);
type ProbeTlsVersion = 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | 'TLSv1.3';

type ProbePeerCertificate = DetailedPeerCertificate | PeerCertificate;
type SessionKind = 'tcp' | 'tls';
type SessionSocket = NetSocket | TLSSocket;

type TlsPolicySummary = {
  allowInvalidCertificates: boolean;
  skipHostnameCheck: boolean;
  timeoutMs: number;
  minVersion: ProbeTlsVersion | null;
  maxVersion: ProbeTlsVersion | null;
  alpnProtocols: string[];
  customCa: {
    source: 'inline' | 'path' | null;
    path: string | null;
    bytes: number | null;
  };
};

type TlsTargetSummary = {
  host: string;
  port: number;
  requestedServername: string | null;
  validationTarget: string;
};

type BufferedSession<TSocket extends SessionSocket = SessionSocket> = {
  id: string;
  kind: SessionKind;
  socket: TSocket;
  host: string;
  port: number;
  createdAt: number;
  buffer: Buffer;
  ended: boolean;
  closed: boolean;
  error: string | null;
  waiters: Set<() => void>;
  activeRead: boolean;
};

type TcpSession = BufferedSession<NetSocket>;
type TlsSession = BufferedSession<TLSSocket> & {
  metadata: {
    target: TlsTargetSummary;
    policy: TlsPolicySummary;
    transport: {
      protocol: string | null;
      alpnProtocol: string | null;
      cipher: {
        name: string;
        standardName: string;
        version: string;
      };
      localAddress: string | null;
      localPort: number | null;
      remoteAddress: string | null;
      remotePort: number | null;
      servernameSent: string | null;
      sessionReused: boolean;
    };
    authorization: {
      socketAuthorized: boolean;
      authorizationError: string | null;
      hostnameValidation: {
        checked: boolean;
        target: string | null;
        matched: boolean | null;
        error: string | null;
      };
      policyAllowed: boolean;
      reasons: string[];
    };
    certificates: {
      leaf: ReturnType<typeof summarizePeerCertificate> | null;
      chain: Array<ReturnType<typeof summarizePeerCertificate>>;
    };
  };
};

type WebSocketScheme = 'ws' | 'wss';
type WebSocketFrameType = 'text' | 'binary' | 'close' | 'ping' | 'pong';

type WebSocketTargetSummary = {
  scheme: WebSocketScheme;
  url: string;
  host: string;
  port: number;
  path: string;
  requestedServername: string | null;
  validationTarget: string | null;
};

type WebSocketFrame = {
  type: WebSocketFrameType;
  fin: boolean;
  opcode: number;
  masked: boolean;
  data: Buffer;
  closeCode: number | null;
  closeReason: string | null;
  receivedAt: number;
};

type WebSocketSession = {
  id: string;
  kind: 'websocket';
  scheme: WebSocketScheme;
  socket: SessionSocket;
  host: string;
  port: number;
  path: string;
  createdAt: number;
  parserBuffer: Buffer;
  frames: WebSocketFrame[];
  ended: boolean;
  closed: boolean;
  error: string | null;
  waiters: Set<() => void>;
  activeRead: boolean;
  closeSent: boolean;
  closeReceived: boolean;
  metadata: {
    target: WebSocketTargetSummary;
    handshake: {
      requestKey: string;
      acceptKey: string;
      responseAcceptKey: string | null;
      subprotocol: string | null;
    };
    transport: {
      localAddress: string | null;
      localPort: number | null;
      remoteAddress: string | null;
      remotePort: number | null;
      protocol: string | null;
      alpnProtocol: string | null;
      servernameSent: string | null;
      sessionReused: boolean | null;
    };
    authorization: TlsSession['metadata']['authorization'] | null;
    certificates: TlsSession['metadata']['certificates'] | null;
  };
};

type WebSocketEventName =
  | 'websocket:session_opened'
  | 'websocket:session_written'
  | 'websocket:frame_read'
  | 'websocket:session_closed';

type ConsumedSessionBuffer = {
  data: Buffer;
  matchedDelimiter: boolean;
  stopReason: 'delimiter' | 'maxBytes' | 'closed' | 'error';
  delimiterHex: string | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSocketServername(servername: string | false | null | undefined): string | null {
  return typeof servername === 'string' && servername.length > 0 ? servername : null;
}

function normalizeAlpnProtocol(protocol: string | false | null | undefined): string | null {
  return typeof protocol === 'string' && protocol.length > 0 ? protocol : null;
}

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.keys(value).length > 0;
}

function hasPeerCertificate(value: unknown): value is ProbePeerCertificate {
  return isNonEmptyObject(value);
}

function summarizePeerCertificate(
  cert: ProbePeerCertificate,
  depth: number,
): {
  depth: number;
  subject: string | null;
  issuer: string | null;
  subjectAltName: string | null;
  serialNumber: string | null;
  validFrom: string | null;
  validTo: string | null;
  fingerprint256: string | null;
  fingerprint512: string | null;
  rawLength: number | null;
  isCA: boolean | null;
  selfIssued: boolean | null;
} {
  const raw = Buffer.isBuffer(cert.raw) ? cert.raw : null;
  const x509 = raw ? new X509Certificate(raw) : null;
  const subject = x509?.subject ?? null;
  const issuer = x509?.issuer ?? null;

  return {
    depth,
    subject,
    issuer,
    subjectAltName: x509?.subjectAltName ?? cert.subjectaltname ?? null,
    serialNumber: x509?.serialNumber ?? cert.serialNumber ?? null,
    validFrom: x509?.validFrom ?? cert.valid_from ?? null,
    validTo: x509?.validTo ?? cert.valid_to ?? null,
    fingerprint256: x509?.fingerprint256 ?? cert.fingerprint256 ?? null,
    fingerprint512: x509?.fingerprint512 ?? cert.fingerprint512 ?? null,
    rawLength: raw?.length ?? null,
    isCA: x509?.ca ?? cert.ca ?? null,
    selfIssued: subject && issuer ? subject === issuer : null,
  };
}

function buildPeerCertificateChain(
  peerCertificate: ProbePeerCertificate | null,
): Array<ReturnType<typeof summarizePeerCertificate>> {
  if (!peerCertificate) {
    return [];
  }

  const chain: Array<ReturnType<typeof summarizePeerCertificate>> = [];
  const seen = new Set<string>();
  let current: ProbePeerCertificate | null = peerCertificate;
  let depth = 0;

  while (current && hasPeerCertificate(current)) {
    const summary = summarizePeerCertificate(current, depth);
    const dedupeKey =
      summary.fingerprint256 ??
      `${summary.subject ?? 'unknown-subject'}:${summary.serialNumber ?? 'unknown-serial'}:${depth}`;
    if (seen.has(dedupeKey)) {
      break;
    }

    seen.add(dedupeKey);
    chain.push(summary);

    if (!('issuerCertificate' in current)) {
      break;
    }

    const issuerCertificate: ProbePeerCertificate | null = current.issuerCertificate;
    if (
      !issuerCertificate ||
      issuerCertificate === current ||
      !hasPeerCertificate(issuerCertificate)
    ) {
      break;
    }

    current = issuerCertificate;
    depth += 1;
  }

  return chain;
}

async function loadProbeCaBundle(args: Record<string, unknown>): Promise<
  | {
      ok: true;
      ca: string | undefined;
      source: 'inline' | 'path' | null;
      path: string | null;
      bytes: number | null;
    }
  | { ok: false; error: string }
> {
  const caPem = argString(args, 'caPem') ?? null;
  const caPath = argString(args, 'caPath') ?? null;

  if (caPem && caPath) {
    return { ok: false, error: 'caPem and caPath are mutually exclusive' };
  }

  if (caPem) {
    return {
      ok: true,
      ca: caPem,
      source: 'inline',
      path: null,
      bytes: Buffer.byteLength(caPem),
    };
  }

  if (caPath) {
    try {
      const ca = await readFile(caPath, 'utf8');
      return {
        ok: true,
        ca,
        source: 'path',
        path: caPath,
        bytes: Buffer.byteLength(ca),
      };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to read caPath "${caPath}": ${errorMessage(error)}`,
      };
    }
  }

  return {
    ok: true,
    ca: undefined,
    source: null,
    path: null,
    bytes: null,
  };
}

function makeSessionId(kind: SessionKind | 'websocket'): string {
  return `${kind}_${randomUUID()}`;
}

function serializeSocketAddresses(socket: SessionSocket): {
  localAddress: string | null;
  localPort: number | null;
  remoteAddress: string | null;
  remotePort: number | null;
} {
  return {
    localAddress: socket.localAddress ?? null,
    localPort: socket.localPort ?? null,
    remoteAddress: socket.remoteAddress ?? null,
    remotePort: socket.remotePort ?? null,
  };
}

function serializeSessionState(session: BufferedSession): {
  bufferedBytes: number;
  remoteEnded: boolean;
  socketClosed: boolean;
  error: string | null;
} {
  return {
    bufferedBytes: session.buffer.length,
    remoteEnded: session.ended,
    socketClosed: session.closed,
    error: session.error,
  };
}

function serializeWebSocketSessionState(session: WebSocketSession): {
  bufferedBytes: number;
  queuedFrames: number;
  remoteEnded: boolean;
  socketClosed: boolean;
  closeSent: boolean;
  closeReceived: boolean;
  error: string | null;
} {
  return {
    bufferedBytes: session.parserBuffer.length,
    queuedFrames: session.frames.length,
    remoteEnded: session.ended,
    socketClosed: session.closed,
    closeSent: session.closeSent,
    closeReceived: session.closeReceived,
    error: session.error,
  };
}

function normalizeWebSocketPath(path: string | null | undefined): string {
  if (!path || path.trim().length === 0) {
    return '/';
  }
  return path.startsWith('/') ? path : `/${path}`;
}

function websocketOpcodeName(opcode: number): WebSocketFrameType | null {
  switch (opcode) {
    case 0x1:
      return 'text';
    case 0x2:
      return 'binary';
    case 0x8:
      return 'close';
    case 0x9:
      return 'ping';
    case 0xa:
      return 'pong';
    default:
      return null;
  }
}

function computeWebSocketAccept(requestKey: string): string {
  return createHash('sha1')
    .update(`${requestKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, 'utf8')
    .digest('base64');
}

function encodeWebSocketFrame(
  type: WebSocketFrameType,
  payload: Buffer,
  closeCode?: number | null,
  closeReason?: string | null,
): Buffer {
  let opcode = 0x1;
  let framePayload = payload;
  if (type === 'binary') {
    opcode = 0x2;
  } else if (type === 'close') {
    opcode = 0x8;
    if (closeCode !== undefined && closeCode !== null) {
      const reasonBuffer = closeReason ? Buffer.from(closeReason, 'utf8') : Buffer.alloc(0);
      framePayload = Buffer.alloc(2 + reasonBuffer.length);
      framePayload.writeUInt16BE(closeCode, 0);
      reasonBuffer.copy(framePayload, 2);
    } else if (closeReason) {
      framePayload = Buffer.from(closeReason, 'utf8');
    }
  } else if (type === 'ping') {
    opcode = 0x9;
  } else if (type === 'pong') {
    opcode = 0xa;
  }

  const maskKey = randomBytes(4);
  const payloadLength = framePayload.length;
  let header: Buffer;
  if (payloadLength < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | payloadLength;
  } else if (payloadLength <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
  }
  header[0] = 0x80 | opcode;

  const maskedPayload = Buffer.alloc(payloadLength);
  for (let index = 0; index < payloadLength; index += 1) {
    maskedPayload[index] = framePayload[index]! ^ maskKey[index % 4]!;
  }

  return Buffer.concat([header, maskKey, maskedPayload]);
}

function tryConsumeWebSocketFrame(buffer: Buffer): {
  frame: WebSocketFrame;
  bytesConsumed: number;
} | null {
  if (buffer.length < 2) {
    return null;
  }

  const first = buffer[0]!;
  const second = buffer[1]!;
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
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
    const bigLength = buffer.readBigUInt64BE(cursor);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('WebSocket frame payload length exceeds supported limits');
    }
    payloadLength = Number(bigLength);
    cursor += 8;
  }

  const maskKey = masked ? buffer.subarray(cursor, cursor + 4) : null;
  if (masked) {
    if (buffer.length < cursor + 4) {
      return null;
    }
    cursor += 4;
  }

  if (buffer.length < cursor + payloadLength) {
    return null;
  }

  const payload = buffer.subarray(cursor, cursor + payloadLength);
  const data = Buffer.alloc(payload.length);
  if (masked && maskKey) {
    for (let index = 0; index < payload.length; index += 1) {
      data[index] = payload[index]! ^ maskKey[index % 4]!;
    }
  } else {
    payload.copy(data);
  }

  const type = websocketOpcodeName(opcode);
  if (!type) {
    throw new Error(`Unsupported WebSocket opcode 0x${opcode.toString(16)}`);
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
      fin,
      opcode,
      masked,
      data,
      closeCode,
      closeReason,
      receivedAt: Date.now(),
    },
    bytesConsumed: cursor + payloadLength,
  };
}

function wakeSessionWaiters(session: BufferedSession): void {
  for (const waiter of session.waiters) {
    waiter();
  }
  session.waiters.clear();
}

function attachBufferedSession(session: BufferedSession): void {
  session.socket.on('data', (chunk: Buffer) => {
    session.buffer = Buffer.concat([session.buffer, chunk]);
    wakeSessionWaiters(session);
  });

  session.socket.on('end', () => {
    session.ended = true;
    wakeSessionWaiters(session);
  });

  session.socket.on('close', () => {
    session.closed = true;
    wakeSessionWaiters(session);
  });

  session.socket.on('error', (error: Error) => {
    session.error = error.message;
    wakeSessionWaiters(session);
  });
}

function waitForSessionActivity(session: BufferedSession, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const onActivity = (): void => {
      clearTimeout(timer);
      session.waiters.delete(onActivity);
      resolve(true);
    };

    const timer = setTimeout(() => {
      session.waiters.delete(onActivity);
      resolve(false);
    }, timeoutMs);

    session.waiters.add(onActivity);
  });
}

function wakeWebSocketWaiters(session: WebSocketSession): void {
  for (const waiter of session.waiters) {
    waiter();
  }
  session.waiters.clear();
}

function waitForWebSocketActivity(session: WebSocketSession, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const onActivity = (): void => {
      clearTimeout(timer);
      session.waiters.delete(onActivity);
      resolve(true);
    };

    const timer = setTimeout(() => {
      session.waiters.delete(onActivity);
      resolve(false);
    }, timeoutMs);

    session.waiters.add(onActivity);
  });
}

function consumeSessionBuffer(
  session: BufferedSession,
  delimiter: Buffer | null,
  includeDelimiter: boolean,
  maxBytes: number | undefined,
): ConsumedSessionBuffer | null {
  if (delimiter) {
    const matchIndex = session.buffer.indexOf(delimiter);
    if (matchIndex >= 0) {
      const consumedBytes = matchIndex + delimiter.length;
      const data = includeDelimiter
        ? session.buffer.subarray(0, consumedBytes)
        : session.buffer.subarray(0, matchIndex);
      session.buffer = session.buffer.subarray(consumedBytes);
      return {
        data,
        matchedDelimiter: true,
        stopReason: 'delimiter',
        delimiterHex: delimiter.toString('hex').toUpperCase(),
      };
    }
  }

  if (typeof maxBytes === 'number' && session.buffer.length >= maxBytes) {
    const data = session.buffer.subarray(0, maxBytes);
    session.buffer = session.buffer.subarray(maxBytes);
    return {
      data,
      matchedDelimiter: false,
      stopReason: 'maxBytes',
      delimiterHex: delimiter ? delimiter.toString('hex').toUpperCase() : null,
    };
  }

  if ((session.error || session.ended || session.closed) && session.buffer.length > 0) {
    const data = session.buffer;
    session.buffer = Buffer.alloc(0);
    return {
      data,
      matchedDelimiter: false,
      stopReason: session.error ? 'error' : 'closed',
      delimiterHex: delimiter ? delimiter.toString('hex').toUpperCase() : null,
    };
  }

  return null;
}

function normalizeHex(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9A-F]+$/i.test(value);
}

function tlsVersionName(major: number, minor: number): string {
  if (major === 3 && minor === 1) {
    return 'TLS 1.0';
  }
  if (major === 3 && minor === 2) {
    return 'TLS 1.1';
  }
  if (major === 3 && minor === 3) {
    return 'TLS 1.2';
  }
  if (major === 3 && minor === 4) {
    return 'TLS 1.3';
  }

  return `0x${major.toString(16).padStart(2, '0')}${minor.toString(16).padStart(2, '0')}`;
}

function contentTypeName(contentType: number): string {
  if (contentType === 20) {
    return 'change_cipher_spec';
  }
  if (contentType === 21) {
    return 'alert';
  }
  if (contentType === 22) {
    return 'handshake';
  }
  if (contentType === 23) {
    return 'application_data';
  }
  if (contentType === 24) {
    return 'heartbeat';
  }

  return 'unknown';
}

function handshakeTypeName(handshakeType: number): string {
  if (handshakeType === 1) {
    return 'client_hello';
  }
  if (handshakeType === 2) {
    return 'server_hello';
  }
  if (handshakeType === 4) {
    return 'new_session_ticket';
  }
  if (handshakeType === 8) {
    return 'encrypted_extensions';
  }
  if (handshakeType === 11) {
    return 'certificate';
  }
  if (handshakeType === 13) {
    return 'certificate_request';
  }
  if (handshakeType === 15) {
    return 'certificate_verify';
  }
  if (handshakeType === 20) {
    return 'finished';
  }

  return 'unknown';
}

/**
 * Parse TLS ClientHello to extract SNI, cipher suites, and extensions.
 * Handles two input layouts:
 * - With handshake header: [type(1) + length(3) + version(2) + random(32) + ...]
 * - Without handshake header: [version(2) + random(32) + ...]
 */
function parseClientHello(payload: Buffer): {
  serverName?: string;
  cipherSuites: string[];
  extensions: Array<{ type: number; name: string; length: number }>;
} {
  const result: {
    serverName?: string;
    cipherSuites: string[];
    extensions: Array<{ type: number; name: string; length: number }>;
  } = {
    cipherSuites: [],
    extensions: [],
  };

  // Determine whether payload starts with handshake header or ClientHello body
  // Handshake header: first byte is handshake type (0..24), next 3 bytes are length
  // ClientHello body: first 2 bytes are version (0x03xx range)
  const startsWithHandshakeHeader = payload[0] !== undefined && payload[0]! < 25;
  const bodyOffset = startsWithHandshakeHeader ? 4 : 0;

  if (payload.length < bodyOffset + 38) {
    return result;
  }

  // Session ID length is 2 bytes after version + 32 bytes of random = offset 34
  const sessionIdOffset = bodyOffset + 34;
  const sessionIdLength = payload[sessionIdOffset] ?? 0;
  let cursor = sessionIdOffset + 1 + sessionIdLength;

  // Cipher suites length + suites
  if (cursor + 2 > payload.length) {
    return result;
  }
  const cipherSuitesLength = payload.readUInt16BE(cursor);
  cursor += 2;

  const cipherSuitesEnd = cursor + cipherSuitesLength;
  while (cursor + 2 <= cipherSuitesEnd) {
    const suiteId = payload.readUInt16BE(cursor);
    result.cipherSuites.push(
      CIPHER_SUITES_BY_ID[suiteId] ?? `0x${suiteId.toString(16).padStart(4, '0')}`,
    );
    cursor += 2;
  }

  // Skip to extensions (after compression methods)
  cursor = cipherSuitesEnd + 1; // compression methods length
  if (cursor < payload.length) {
    const compLength = payload[cursor];
    if (compLength !== undefined) {
      cursor += 1 + compLength;
    }
  }

  // Parse extensions
  if (cursor + 2 <= payload.length) {
    const extensionsLength = payload.readUInt16BE(cursor);
    cursor += 2;
    const extensionsEnd = cursor + extensionsLength;

    while (cursor + 4 <= extensionsEnd) {
      const extType = payload.readUInt16BE(cursor);
      const extLength = payload.readUInt16BE(cursor + 2);
      cursor += 4;

      const extName = EXTENSION_NAMES[extType] ?? `unknown(0x${extType.toString(16)})`;
      result.extensions.push({ type: extType, name: extName, length: extLength });

      // SNI extension (type 0)
      if (extType === 0 && cursor + 2 <= extensionsEnd) {
        const sniCursor = cursor + 2;
        if (sniCursor + 3 <= extensionsEnd) {
          const sniType = payload[sniCursor]; // 0 = host_name
          if (sniType === 0) {
            const sniLength = payload.readUInt16BE(sniCursor + 1);
            const sniStart = sniCursor + 3;
            if (sniStart + sniLength <= extensionsEnd) {
              result.serverName = payload.subarray(sniStart, sniStart + sniLength).toString('utf8');
            }
          }
        }
      }

      cursor += extLength;
    }
  }

  return result;
}

// IANA TLS cipher suite IDs
const CIPHER_SUITES_BY_ID: Record<number, string> = {
  0x009c: 'TLS_RSA_WITH_AES_128_GCM_SHA256',
  0x009d: 'TLS_RSA_WITH_AES_256_GCM_SHA384',
  0xcca8: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
  0xcca9: 'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
  0x1301: 'TLS_AES_128_GCM_SHA256',
  0x1302: 'TLS_AES_256_GCM_SHA384',
  0x1303: 'TLS_CHACHA20_POLY1305_SHA256',
  0x1304: 'TLS_AES_128_CCM_SHA256',
  0x1305: 'TLS_AES_128_CCM_8_SHA256',
  0xc02b: 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
  0xc02c: 'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
  0xc02f: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
  0xc030: 'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
};

const EXTENSION_NAMES: Record<number, string> = {
  0: 'server_name',
  1: 'max_fragment_length',
  5: 'status_request',
  10: 'supported_groups',
  13: 'signature_algorithms',
  16: 'application_layer_protocol_negotiation',
  18: 'signed_certificate_timestamp',
  23: 'record_size_limit',
  27: 'compress_certificate',
  35: 'session_ticket',
  43: 'supported_versions',
  44: 'cookie',
  45: 'psk_key_exchange_modes',
  49: 'post_handshake_auth',
  51: 'key_share',
};

/**
 * Parse a DER-encoded certificate to extract basic info.
 */
function parseDerCertificate(der: Buffer): {
  subject?: string;
  issuer?: string;
  serialNumber?: string;
  validFrom?: string;
  validTo?: string;
  sha256: string;
  length: number;
} {
  const sha256 = createHash('sha256').update(der).digest('hex').toUpperCase();

  // Try to parse as X509 certificate using node:crypto
  try {
    const cert = new X509Certificate(der);
    return {
      subject: cert.subject || undefined,
      issuer: cert.issuer || undefined,
      serialNumber: cert.serialNumber || undefined,
      validFrom: cert.validFrom || undefined,
      validTo: cert.validTo || undefined,
      sha256,
      length: der.length,
    };
  } catch {
    // Not a valid X509 certificate, fall back to minimal info
    return { sha256, length: der.length };
  }
}

/**
 * Parse a chain of DER certificates from hex.
 */
function parseCertificateChain(hexPayload: string): Array<{
  sha256: string;
  length: number;
}> {
  const buffer = Buffer.from(normalizeHex(hexPayload), 'hex');
  const certs: Array<{ sha256: string; length: number }> = [];

  // Try to find certificate boundaries (0x30 SEQUENCE tag)
  let cursor = 0;
  while (cursor < buffer.length - 4) {
    if (buffer[cursor] === 0x30) {
      // Found potential certificate start
      const certData = buffer.subarray(cursor);
      const info = parseDerCertificate(certData);
      certs.push({ sha256: info.sha256, length: info.length });
      cursor += info.length;
    } else {
      cursor += 1;
    }
  }

  // If no certs found but we have data, treat as single blob
  if (certs.length === 0 && buffer.length > 0) {
    certs.push({
      sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
      length: buffer.length,
    });
  }

  return certs;
}

export class BoringsslInspectorHandlers {
  private extensionInvoke?: (...args: unknown[]) => Promise<unknown>;
  private eventBus?: EventBus<ServerEventMap>;
  private readonly tcpSessions = new Map<string, TcpSession>();
  private readonly tlsSessions = new Map<string, TlsSession>();
  private readonly websocketSessions = new Map<string, WebSocketSession>();

  constructor(private keyLogExtractor: TLSKeyLogExtractor = new TLSKeyLogExtractor()) {}

  setExtensionInvoke(invoke: (...args: unknown[]) => Promise<unknown>): void {
    this.extensionInvoke = invoke;
  }

  setEventBus(eventBus: EventBus<ServerEventMap>): void {
    this.eventBus = eventBus;
  }

  private getTcpSession(sessionId: string): TcpSession | null {
    return this.tcpSessions.get(sessionId) ?? null;
  }

  private getTlsSession(sessionId: string): TlsSession | null {
    return this.tlsSessions.get(sessionId) ?? null;
  }

  private getWebSocketSession(sessionId: string): WebSocketSession | null {
    return this.websocketSessions.get(sessionId) ?? null;
  }

  private emitWebSocketEvent<K extends WebSocketEventName>(
    event: K,
    payload: ServerEventMap[K],
  ): void {
    void this.eventBus?.emit(event, payload);
  }

  private parseWritePayload(
    args: Record<string, unknown>,
  ): { ok: true; data: Buffer; inputEncoding: 'hex' | 'utf8' } | { ok: false; error: string } {
    const dataHex = argString(args, 'dataHex');
    const dataText = argString(args, 'dataText');

    if (!dataHex && !dataText) {
      return { ok: false, error: 'dataHex or dataText is required' };
    }
    if (dataHex && dataText) {
      return { ok: false, error: 'dataHex and dataText are mutually exclusive' };
    }

    if (dataHex) {
      const normalized = normalizeHex(dataHex);
      if (!isHex(normalized)) {
        return { ok: false, error: 'dataHex must be valid even-length hexadecimal data' };
      }
      return {
        ok: true,
        data: Buffer.from(normalized, 'hex'),
        inputEncoding: 'hex',
      };
    }

    return {
      ok: true,
      data: Buffer.from(dataText ?? '', 'utf8'),
      inputEncoding: 'utf8',
    };
  }

  private async writeBufferedSession(
    session: BufferedSession,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (session.socket.destroyed || session.closed) {
      return {
        ok: false,
        error: `Session "${session.id}" is already closed`,
        sessionId: session.id,
        kind: session.kind,
        state: serializeSessionState(session),
      };
    }

    const payload = this.parseWritePayload(args);
    if (!payload.ok) {
      return { ok: false, error: payload.error, sessionId: session.id, kind: session.kind };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    return new Promise<unknown>((resolve) => {
      let settled = false;
      const finish = (result: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        session.socket.off('error', onError);
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({
          ok: false,
          error: 'write timed out',
          sessionId: session.id,
          kind: session.kind,
          state: serializeSessionState(session),
        });
      }, timeoutMs);

      const onError = (error: Error): void => {
        finish({
          ok: false,
          error: error.message,
          sessionId: session.id,
          kind: session.kind,
          state: serializeSessionState(session),
        });
      };

      session.socket.once('error', onError);
      session.socket.write(payload.data, () => {
        if (session.kind === 'tcp') {
          void this.eventBus?.emit('tcp:session_written', {
            sessionId: session.id,
            byteLength: payload.data.length,
            timestamp: new Date().toISOString(),
          });
        } else {
          void this.eventBus?.emit('tls:session_written', {
            sessionId: session.id,
            byteLength: payload.data.length,
            timestamp: new Date().toISOString(),
          });
        }
        finish({
          ok: true,
          sessionId: session.id,
          kind: session.kind,
          inputEncoding: payload.inputEncoding,
          bytesWritten: payload.data.length,
          transport: serializeSocketAddresses(session.socket),
          state: serializeSessionState(session),
        });
      });
    });
  }

  private async readBufferedSessionUntil(
    session: BufferedSession,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const delimiterHex = argString(args, 'delimiterHex');
    const delimiterText = argString(args, 'delimiterText');
    if (delimiterHex && delimiterText) {
      return { ok: false, error: 'delimiterHex and delimiterText are mutually exclusive' };
    }

    let delimiter: Buffer | null = null;
    if (delimiterHex) {
      const normalized = normalizeHex(delimiterHex);
      if (!isHex(normalized)) {
        return { ok: false, error: 'delimiterHex must be valid even-length hexadecimal data' };
      }
      delimiter = Buffer.from(normalized, 'hex');
    } else if (delimiterText !== undefined) {
      delimiter = Buffer.from(delimiterText, 'utf8');
    }

    if (delimiter && delimiter.length === 0) {
      return { ok: false, error: 'delimiter must not be empty' };
    }

    const includeDelimiter = argBool(args, 'includeDelimiter') ?? true;
    const rawMaxBytes = argNumber(args, 'maxBytes');
    const maxBytes = rawMaxBytes === undefined ? undefined : Math.trunc(rawMaxBytes);
    if (maxBytes !== undefined && (!Number.isFinite(maxBytes) || maxBytes <= 0)) {
      return { ok: false, error: 'maxBytes must be a positive integer when provided' };
    }
    if (!delimiter && maxBytes === undefined) {
      return { ok: false, error: 'delimiterHex, delimiterText, or maxBytes is required' };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    if (session.activeRead) {
      return {
        ok: false,
        error: `Session "${session.id}" already has a pending read`,
        sessionId: session.id,
        kind: session.kind,
        state: serializeSessionState(session),
      };
    }

    session.activeRead = true;
    const startedAt = Date.now();

    try {
      while (true) {
        const consumed = consumeSessionBuffer(session, delimiter, includeDelimiter, maxBytes);
        if (consumed) {
          if (session.kind === 'tcp') {
            void this.eventBus?.emit('tcp:session_read', {
              sessionId: session.id,
              byteLength: consumed.data.length,
              matched: consumed.matchedDelimiter,
              timestamp: new Date().toISOString(),
            });
          } else {
            void this.eventBus?.emit('tls:session_read', {
              sessionId: session.id,
              byteLength: consumed.data.length,
              matched: consumed.matchedDelimiter,
              timestamp: new Date().toISOString(),
            });
          }
          return {
            ok: true,
            sessionId: session.id,
            kind: session.kind,
            bytesRead: consumed.data.length,
            matchedDelimiter: consumed.matchedDelimiter,
            stopReason: consumed.stopReason,
            delimiterHex: consumed.delimiterHex,
            dataHex: consumed.data.toString('hex').toUpperCase(),
            dataText: consumed.data.toString('utf8'),
            elapsedMs: Date.now() - startedAt,
            state: serializeSessionState(session),
          };
        }

        if (session.error) {
          return {
            ok: false,
            error: session.error,
            sessionId: session.id,
            kind: session.kind,
            state: serializeSessionState(session),
          };
        }

        if (session.ended || session.closed) {
          return {
            ok: false,
            error: 'socket closed before the requested read condition was satisfied',
            sessionId: session.id,
            kind: session.kind,
            state: serializeSessionState(session),
          };
        }

        const remainingMs = timeoutMs - (Date.now() - startedAt);
        if (remainingMs <= 0) {
          return {
            ok: false,
            error: 'read timed out',
            sessionId: session.id,
            kind: session.kind,
            state: serializeSessionState(session),
          };
        }

        const hadActivity = await waitForSessionActivity(session, remainingMs);
        if (!hadActivity) {
          return {
            ok: false,
            error: 'read timed out',
            sessionId: session.id,
            kind: session.kind,
            state: serializeSessionState(session),
          };
        }
      }
    } finally {
      session.activeRead = false;
    }
  }

  private attachWebSocketSession(session: WebSocketSession): void {
    const parseBufferedFrames = (): void => {
      while (session.parserBuffer.length > 0) {
        let consumed: ReturnType<typeof tryConsumeWebSocketFrame>;
        try {
          consumed = tryConsumeWebSocketFrame(session.parserBuffer);
        } catch (error) {
          session.error = errorMessage(error);
          session.socket.destroy();
          break;
        }

        if (!consumed) {
          break;
        }

        session.parserBuffer = session.parserBuffer.subarray(consumed.bytesConsumed);
        const frame = consumed.frame;
        session.frames.push(frame);

        if (frame.type === 'ping' && !session.closeSent && !session.socket.destroyed) {
          const pongFrame = encodeWebSocketFrame('pong', frame.data);
          session.socket.write(pongFrame);
          this.emitWebSocketEvent('websocket:session_written', {
            sessionId: session.id,
            frameType: 'pong',
            byteLength: frame.data.length,
            automatic: true,
            timestamp: new Date().toISOString(),
          });
        }

        if (frame.type === 'close') {
          session.closeReceived = true;
          if (!session.closeSent && !session.socket.destroyed) {
            session.closeSent = true;
            session.socket.write(
              encodeWebSocketFrame('close', frame.data, frame.closeCode, frame.closeReason),
            );
            this.emitWebSocketEvent('websocket:session_written', {
              sessionId: session.id,
              frameType: 'close',
              byteLength: frame.data.length,
              automatic: true,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      wakeWebSocketWaiters(session);
    };

    session.socket.on('data', (chunk: Buffer) => {
      session.parserBuffer = Buffer.concat([session.parserBuffer, chunk]);
      parseBufferedFrames();
    });

    session.socket.on('end', () => {
      session.ended = true;
      wakeWebSocketWaiters(session);
    });

    session.socket.on('close', () => {
      session.closed = true;
      wakeWebSocketWaiters(session);
    });

    session.socket.on('error', (error: Error) => {
      session.error = error.message;
      wakeWebSocketWaiters(session);
    });

    parseBufferedFrames();
  }

  private async readWebSocketFrame(
    session: WebSocketSession,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    if (session.activeRead) {
      return {
        ok: false,
        error: `Session "${session.id}" already has a pending read`,
        sessionId: session.id,
        kind: session.kind,
        state: serializeWebSocketSessionState(session),
      };
    }

    session.activeRead = true;
    const startedAt = Date.now();

    try {
      while (true) {
        const frame = session.frames.shift();
        if (frame) {
          this.emitWebSocketEvent('websocket:frame_read', {
            sessionId: session.id,
            frameType: frame.type,
            byteLength: frame.data.length,
            timestamp: new Date().toISOString(),
          });
          return {
            ok: true,
            sessionId: session.id,
            kind: session.kind,
            scheme: session.scheme,
            frameType: frame.type,
            fin: frame.fin,
            opcode: frame.opcode,
            masked: frame.masked,
            byteLength: frame.data.length,
            dataHex: frame.data.toString('hex').toUpperCase(),
            dataText: frame.type === 'binary' ? null : frame.data.toString('utf8'),
            closeCode: frame.closeCode,
            closeReason: frame.closeReason,
            elapsedMs: Date.now() - startedAt,
            state: serializeWebSocketSessionState(session),
          };
        }

        if (session.error) {
          return {
            ok: false,
            error: session.error,
            sessionId: session.id,
            kind: session.kind,
            state: serializeWebSocketSessionState(session),
          };
        }

        if (session.closed || session.ended) {
          return {
            ok: false,
            error: 'socket closed before a WebSocket frame was available',
            sessionId: session.id,
            kind: session.kind,
            state: serializeWebSocketSessionState(session),
          };
        }

        const remainingMs = timeoutMs - (Date.now() - startedAt);
        if (remainingMs <= 0) {
          return {
            ok: false,
            error: 'read timed out',
            sessionId: session.id,
            kind: session.kind,
            state: serializeWebSocketSessionState(session),
          };
        }

        const hadActivity = await waitForWebSocketActivity(session, remainingMs);
        if (!hadActivity) {
          return {
            ok: false,
            error: 'read timed out',
            sessionId: session.id,
            kind: session.kind,
            state: serializeWebSocketSessionState(session),
          };
        }
      }
    } finally {
      session.activeRead = false;
    }
  }

  private async sendWebSocketFrame(
    session: WebSocketSession,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (session.closed || session.socket.destroyed) {
      return {
        ok: false,
        error: `Session "${session.id}" is already closed`,
        sessionId: session.id,
        kind: session.kind,
        state: serializeWebSocketSessionState(session),
      };
    }

    const frameType = argEnum(
      args,
      'frameType',
      new Set<WebSocketFrameType>(['text', 'binary', 'ping', 'pong', 'close']),
    );
    if (!frameType) {
      return { ok: false, error: 'frameType is required' };
    }
    const dataHex = argString(args, 'dataHex');
    const dataText = argString(args, 'dataText');
    if (dataHex && dataText) {
      return { ok: false, error: 'dataHex and dataText are mutually exclusive' };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    let payload = Buffer.alloc(0);
    if (dataHex) {
      const normalized = normalizeHex(dataHex);
      if (!isHex(normalized)) {
        return { ok: false, error: 'dataHex must be valid even-length hexadecimal data' };
      }
      payload = Buffer.from(normalized, 'hex');
    } else if (dataText !== undefined) {
      payload = Buffer.from(dataText, 'utf8');
    }

    let closeCode: number | null = null;
    let closeReason: string | null = null;
    if (frameType === 'close') {
      const rawCloseCode = argNumber(args, 'closeCode');
      if (rawCloseCode !== undefined) {
        if (!Number.isInteger(rawCloseCode) || rawCloseCode < 1000 || rawCloseCode > 4999) {
          return { ok: false, error: 'closeCode must be an integer between 1000 and 4999' };
        }
        closeCode = rawCloseCode;
      }
      closeReason = argString(args, 'closeReason') ?? null;
      if (dataHex || dataText) {
        return {
          ok: false,
          error: 'close frames use closeCode/closeReason instead of dataHex/dataText',
        };
      }
      session.closeSent = true;
    }

    if (frameType === 'text' && dataHex) {
      return { ok: false, error: 'text frames require UTF-8 dataText instead of dataHex' };
    }

    const frameBuffer = encodeWebSocketFrame(frameType, payload, closeCode, closeReason);
    return new Promise<unknown>((resolve) => {
      let settled = false;
      const finish = (result: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        session.socket.off('error', onError);
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({
          ok: false,
          error: 'write timed out',
          sessionId: session.id,
          kind: session.kind,
          state: serializeWebSocketSessionState(session),
        });
      }, timeoutMs);

      const onError = (error: Error): void => {
        finish({
          ok: false,
          error: error.message,
          sessionId: session.id,
          kind: session.kind,
          state: serializeWebSocketSessionState(session),
        });
      };

      session.socket.once('error', onError);
      session.socket.write(frameBuffer, () => {
        this.emitWebSocketEvent('websocket:session_written', {
          sessionId: session.id,
          frameType,
          byteLength:
            frameType === 'close'
              ? closeReason
                ? Buffer.byteLength(closeReason) + 2
                : closeCode
                  ? 2
                  : 0
              : payload.length,
          automatic: false,
          timestamp: new Date().toISOString(),
        });
        finish({
          ok: true,
          sessionId: session.id,
          kind: session.kind,
          scheme: session.scheme,
          frameType,
          bytesWritten: frameBuffer.length,
          payloadBytes:
            frameType === 'close'
              ? closeReason
                ? Buffer.byteLength(closeReason) + 2
                : closeCode
                  ? 2
                  : 0
              : payload.length,
          state: serializeWebSocketSessionState(session),
        });
      });
    });
  }

  private async closeWebSocketSession(
    sessionId: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const session = this.websocketSessions.get(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown websocket sessionId "${sessionId}"` };
    }

    const force = argBool(args, 'force') ?? false;
    const timeoutMs = argNumber(args, 'timeoutMs') ?? 1000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const queuedFramesDiscarded = session.frames.length;
    if (session.closed || session.socket.destroyed) {
      this.websocketSessions.delete(sessionId);
      return {
        ok: true,
        sessionId,
        kind: session.kind,
        force,
        closed: true,
        queuedFramesDiscarded,
        state: serializeWebSocketSessionState(session),
      };
    }

    let closeCode: number | null = null;
    const rawCloseCode = argNumber(args, 'closeCode');
    if (rawCloseCode !== undefined) {
      if (!Number.isInteger(rawCloseCode) || rawCloseCode < 1000 || rawCloseCode > 4999) {
        return { ok: false, error: 'closeCode must be an integer between 1000 and 4999' };
      }
      closeCode = rawCloseCode;
    }
    const closeReason = argString(args, 'closeReason') ?? null;

    return new Promise<unknown>((resolve) => {
      let settled = false;
      const finish = (closed: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        session.socket.off('close', onClose);
        session.socket.off('error', onError);
        this.websocketSessions.delete(sessionId);
        this.emitWebSocketEvent('websocket:session_closed', {
          sessionId,
          reason: session.error,
          timestamp: new Date().toISOString(),
        });
        resolve({
          ok: true,
          sessionId,
          kind: session.kind,
          force,
          closed,
          queuedFramesDiscarded,
          state: serializeWebSocketSessionState(session),
        });
      };

      const onClose = (): void => finish(true);
      const onError = (): void => finish(session.socket.destroyed || session.closed);
      const timer = setTimeout(() => {
        session.socket.destroy();
        finish(session.socket.destroyed || session.closed);
      }, timeoutMs);

      session.socket.once('close', onClose);
      session.socket.once('error', onError);

      if (force) {
        session.socket.destroy();
        return;
      }

      if (!session.closeSent) {
        session.closeSent = true;
        session.socket.write(
          encodeWebSocketFrame('close', Buffer.alloc(0), closeCode, closeReason),
        );
        this.emitWebSocketEvent('websocket:session_written', {
          sessionId,
          frameType: 'close',
          byteLength: closeReason ? Buffer.byteLength(closeReason) + 2 : closeCode ? 2 : 0,
          automatic: false,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  private async closeBufferedSession<TSocket extends SessionSocket>(
    sessionId: string,
    sessions: Map<string, BufferedSession<TSocket>>,
    kind: SessionKind,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const session = sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown ${kind} sessionId "${sessionId}"` };
    }

    const force = argBool(args, 'force') ?? false;
    const timeoutMs = argNumber(args, 'timeoutMs') ?? 1000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const bufferedBytesDiscarded = session.buffer.length;
    if (session.closed || session.socket.destroyed) {
      sessions.delete(sessionId);
      return {
        ok: true,
        sessionId,
        kind,
        force,
        closed: true,
        bufferedBytesDiscarded,
        state: serializeSessionState(session),
      };
    }

    return new Promise<unknown>((resolve) => {
      let settled = false;
      const finish = (closed: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        session.socket.off('close', onClose);
        session.socket.off('error', onError);
        sessions.delete(sessionId);
        if (kind === 'tcp') {
          void this.eventBus?.emit('tcp:session_closed', {
            sessionId,
            reason: session.error,
            timestamp: new Date().toISOString(),
          });
        } else {
          void this.eventBus?.emit('tls:session_closed', {
            sessionId,
            reason: session.error,
            timestamp: new Date().toISOString(),
          });
        }
        resolve({
          ok: true,
          sessionId,
          kind,
          force,
          closed,
          bufferedBytesDiscarded,
          state: serializeSessionState(session),
        });
      };

      const onClose = (): void => finish(true);
      const onError = (): void => finish(session.socket.destroyed || session.closed);

      const timer = setTimeout(() => {
        session.socket.destroy();
        finish(session.socket.destroyed || session.closed);
      }, timeoutMs);

      session.socket.once('close', onClose);
      session.socket.once('error', onError);

      if (force) {
        session.socket.destroy();
        return;
      }

      session.socket.end();
    });
  }

  async handleTlsKeylogEnable(_args: Record<string, unknown>): Promise<unknown> {
    const keyLogPath = await this.keyLogExtractor.enableKeyLog();
    return {
      enabled: true,
      keyLogPath,
      environmentVariable: 'SSLKEYLOGFILE',
    };
  }

  async handleTlsKeylogDisable(args: Record<string, unknown>): Promise<unknown> {
    const path = argString(args, 'path') ?? null;
    if (path) {
      await this.keyLogExtractor.disableKeyLog();
    } else {
      disableKeyLog();
    }
    return {
      disabled: true,
      previousPath: path ?? getKeyLogFilePath(),
    };
  }

  async handleTlsKeylogParse(args: Record<string, unknown>): Promise<unknown> {
    const path = argString(args, 'path') ?? null;
    const entries = this.keyLogExtractor.parseKeyLog(path ?? undefined);
    const summary = this.keyLogExtractor.summarizeKeyLog(path ?? undefined);

    return {
      path: path ?? this.keyLogExtractor.getKeyLogFilePath(),
      entries,
      summary,
    };
  }

  async handleTlsDecryptPayload(args: Record<string, unknown>): Promise<unknown> {
    const encryptedHex = argString(args, 'encryptedHex') ?? null;
    const keyHex = argString(args, 'keyHex') ?? null;
    const nonceHex = argString(args, 'nonceHex') ?? null;
    const algorithm = argString(args, 'algorithm') ?? 'aes-256-gcm';
    const authTagHex = argString(args, 'authTagHex') ?? null;

    if (!encryptedHex || !keyHex || !nonceHex) {
      return { ok: false, error: 'encryptedHex, keyHex, and nonceHex are required' };
    }

    const decrypted = decryptPayloadFunc(
      encryptedHex,
      keyHex,
      nonceHex,
      algorithm,
      authTagHex ?? undefined,
    );
    return {
      ok: true,
      algorithm,
      decrypted,
      isFailed: decrypted.startsWith('DECRYPTION_FAILED:'),
    };
  }

  async handleTlsKeylogSummarize(args: Record<string, unknown>): Promise<unknown> {
    const content = argString(args, 'content') ?? null;
    if (content) {
      const entries = parseKeyLogEntries(content);
      return summarizeKeyLogEntries(entries);
    }

    this.keyLogExtractor.parseKeyLog();
    return this.keyLogExtractor.summarizeKeyLog();
  }

  async handleTlsKeylogLookupSecret(args: Record<string, unknown>): Promise<unknown> {
    const clientRandom = argString(args, 'clientRandom') ?? null;
    const label = argString(args, 'label') ?? undefined;

    if (!clientRandom) {
      return { ok: false, error: 'clientRandom is required' };
    }

    // Try the instance-level cache first
    const cached = this.keyLogExtractor.lookupSecret(clientRandom);
    if (cached) {
      return { ok: true, clientRandom: normalizeHex(clientRandom), secret: cached };
    }

    // Fall back to parsing the current keylog file
    const secret = lookupSecretEntry(this.keyLogExtractor.parseKeyLog(), clientRandom, label);
    return {
      ok: secret !== null,
      clientRandom: normalizeHex(clientRandom),
      secret: secret ?? null,
    };
  }

  async handleTlsCertPinBypass(args: Record<string, unknown>): Promise<unknown> {
    const target = argString(args, 'target') ?? null;
    if (target !== 'android' && target !== 'ios' && target !== 'desktop') {
      return {
        error: 'target must be one of android, ios, or desktop',
      };
    }

    const strategyByTarget: Record<'android' | 'ios' | 'desktop', string> = {
      android: 'hook-trust-manager',
      ios: 'replace-sec-trust-evaluation',
      desktop: 'patch-custom-verifier',
    };

    const instructionsByTarget: Record<'android' | 'ios' | 'desktop', string[]> = {
      android: [
        'Inject a Frida script that overrides X509TrustManager checks.',
        'Re-run the target flow after SSLKEYLOGFILE capture is enabled.',
      ],
      ios: [
        'Hook SecTrustEvaluateWithError and return success for the target session.',
        'Collect TLS keys after the app resumes the failing request.',
      ],
      desktop: [
        'Patch the custom verifier callback or disable pin comparison in the client.',
        'Capture a fresh handshake after the patched build starts.',
      ],
    };

    return {
      bypassStrategy: strategyByTarget[target],
      affectedDomains: ['*'],
      instructions: instructionsByTarget[target],
    };
  }

  async handleTlsHandshakeParse(args: Record<string, unknown>): Promise<unknown> {
    const hexPayload = argString(args, 'hexPayload') ?? null;
    if (!hexPayload) {
      return { error: 'hexPayload is required' };
    }

    const normalizedPayload = normalizeHex(hexPayload);
    if (!isHex(normalizedPayload)) {
      return { error: 'hexPayload must be a valid hex string' };
    }

    const record = Buffer.from(normalizedPayload, 'hex');
    if (record.length < 5) {
      return {
        error: 'TLS record is too short',
        length: record.length,
      };
    }

    const contentType = record[0] ?? 0;
    const versionMajor = record[1] ?? 0;
    const versionMinor = record[2] ?? 0;
    const declaredLength = record.readUInt16BE(3);
    const payload = record.subarray(5);
    const decrypted = this.keyLogExtractor.decryptPayload(
      normalizedPayload,
      this.keyLogExtractor.parseKeyLog(),
    );
    const handshakeType = contentType === 22 && payload.length > 0 ? payload[0] : undefined;

    // Parse ClientHello if handshake type is client_hello
    const clientHello = handshakeType === 1 ? parseClientHello(payload) : undefined;

    return {
      record: {
        contentType,
        contentTypeName: contentTypeName(contentType),
        version: tlsVersionName(versionMajor, versionMinor),
        declaredLength,
        actualLength: payload.length,
      },
      handshake:
        handshakeType === undefined
          ? undefined
          : {
              type: handshakeType,
              typeName: handshakeTypeName(handshakeType),
              ...(clientHello
                ? {
                    serverName: clientHello.serverName,
                    cipherSuites: clientHello.cipherSuites,
                    extensionCount: clientHello.extensions.length,
                    extensions: clientHello.extensions,
                  }
                : {}),
            },
      decryptedPreviewHex: decrypted
        ? decrypted.subarray(0, 16).toString('hex').toUpperCase()
        : null,
    };
  }

  async handleKeyLogEnable(args: Record<string, unknown>): Promise<ToolResponse> {
    const filePath = argString(args, 'filePath') ?? '/tmp/sslkeylog.log';
    enableKeyLog(filePath);
    void this.eventBus?.emit('tls:keylog_started', {
      filePath,
      timestamp: new Date().toISOString(),
    });
    return asJsonResponse({
      success: true,
      filePath,
      currentFilePath: getKeyLogFilePath(),
    });
  }

  async handleParseHandshake(args: Record<string, unknown>): Promise<ToolResponse> {
    const rawHex = argString(args, 'rawHex') ?? null;
    if (!rawHex) {
      return asJsonResponse({
        success: false,
        error: 'rawHex is required',
      });
    }

    const normalizedHex = normalizeHex(rawHex);
    if (!isHex(normalizedHex)) {
      return asJsonResponse({
        success: false,
        error: 'Invalid hex payload',
      });
    }

    const record = Buffer.from(normalizedHex, 'hex');
    if (record.length < 5) {
      return asJsonResponse({
        success: false,
        error: 'TLS record is too short',
      });
    }

    const contentType = record[0] ?? 0;
    const versionMajor = record[1] ?? 0;
    const versionMinor = record[2] ?? 0;
    const payload = record.subarray(5);

    const clientHello =
      contentType === 0x16 && payload.length > 0 && payload[0] === 1
        ? parseClientHello(payload)
        : undefined;

    return asJsonResponse({
      success: true,
      handshake: {
        version: tlsVersionName(versionMajor, versionMinor),
        contentType: contentTypeName(contentType),
        ...(clientHello
          ? {
              type: 'client_hello',
              serverName: clientHello.serverName,
              cipherSuites: clientHello.cipherSuites,
              extensions: clientHello.extensions,
            }
          : {
              cipherSuite: [],
              extensions: [],
            }),
      },
      sni: clientHello?.serverName ? { serverName: clientHello.serverName } : undefined,
    });
  }

  async handleCipherSuites(args: Record<string, unknown>): Promise<ToolResponse> {
    const filter = argString(args, 'filter') ?? null;
    const allSuites = [
      'TLS_AES_128_GCM_SHA256',
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_AES_128_CCM_SHA256',
      'TLS_AES_128_CCM_8_SHA256',
      'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
      'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
      'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
      'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
      'TLS_RSA_WITH_AES_128_GCM_SHA256',
      'TLS_RSA_WITH_AES_256_GCM_SHA384',
    ];
    const filteredSuites = filter ? allSuites.filter((suite) => suite.includes(filter)) : allSuites;
    return asJsonResponse({
      success: true,
      filter,
      total: filteredSuites.length,
      suites: filteredSuites,
    });
  }

  async handleParseCertificate(args: Record<string, unknown>): Promise<ToolResponse> {
    const rawHex = argString(args, 'rawHex') ?? null;
    if (!rawHex) {
      return asJsonResponse({
        success: false,
        error: 'rawHex is required',
      });
    }

    const certs = parseCertificateChain(rawHex);
    return asJsonResponse({
      success: true,
      certificateCount: certs.length,
      fingerprints: certs.map((c) => ({
        sha256: c.sha256,
        length: c.length,
      })),
    });
  }

  async handleTlsProbeEndpoint(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host')?.trim() ?? null;
    if (!host) {
      return { ok: false, error: 'host is required' };
    }

    const port = argNumber(args, 'port') ?? 443;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be an integer between 1 and 65535' };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const allowInvalidCertificates = argBool(args, 'allowInvalidCertificates') ?? false;
    const skipHostnameCheck = argBool(args, 'skipHostnameCheck') ?? false;
    const servernameArg = argString(args, 'servername')?.trim() ?? null;
    const alpnProtocols = [
      ...new Set(argStringArray(args, 'alpnProtocols').map((v) => v.trim())),
    ].filter((v) => v.length > 0);

    let minVersion: ProbeTlsVersion | undefined;
    let maxVersion: ProbeTlsVersion | undefined;
    try {
      minVersion = argEnum(args, 'minVersion', TLS_VERSION_SET);
      maxVersion = argEnum(args, 'maxVersion', TLS_VERSION_SET);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }

    const versionOrder: ProbeTlsVersion[] = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];
    if (
      minVersion &&
      maxVersion &&
      versionOrder.indexOf(minVersion) > versionOrder.indexOf(maxVersion)
    ) {
      return { ok: false, error: 'minVersion must not be greater than maxVersion' };
    }

    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) {
      return ssrfCheck;
    }

    const caBundle = await loadProbeCaBundle(args);
    if (!caBundle.ok) {
      return { ok: false, error: caBundle.error };
    }

    const validationTarget = servernameArg ?? host;
    const requestedServername = servernameArg ?? (isIP(host) === 0 ? host : undefined);
    const startedAt = Date.now();

    return new Promise<unknown>((resolve) => {
      let settled = false;
      const socket = createTlsConnection({
        host,
        port,
        servername: requestedServername,
        rejectUnauthorized: false,
        ...(minVersion ? { minVersion } : {}),
        ...(maxVersion ? { maxVersion } : {}),
        ...(alpnProtocols.length > 0 ? { ALPNProtocols: alpnProtocols } : {}),
        ...(caBundle.ca ? { ca: caBundle.ca } : {}),
      });

      const finish = (payload: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.destroy();
        resolve(payload);
      };

      const timer = setTimeout(() => {
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: false,
          timestamp: new Date().toISOString(),
        });
        finish({
          ok: false,
          error: 'TLS probe timed out',
          target: {
            host,
            port,
            requestedServername: requestedServername ?? null,
            validationTarget,
          },
          policy: {
            allowInvalidCertificates,
            skipHostnameCheck,
            timeoutMs,
            minVersion: minVersion ?? null,
            maxVersion: maxVersion ?? null,
            alpnProtocols,
            customCa: {
              source: caBundle.source,
              path: caBundle.path,
              bytes: caBundle.bytes,
            },
          },
        });
      }, timeoutMs);

      socket.once('error', (error: NodeJS.ErrnoException) => {
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: false,
          timestamp: new Date().toISOString(),
        });
        finish({
          ok: false,
          error: error.message,
          errorCode: error.code ?? null,
          target: {
            host,
            port,
            requestedServername: requestedServername ?? null,
            validationTarget,
          },
          policy: {
            allowInvalidCertificates,
            skipHostnameCheck,
            timeoutMs,
            minVersion: minVersion ?? null,
            maxVersion: maxVersion ?? null,
            alpnProtocols,
            customCa: {
              source: caBundle.source,
              path: caBundle.path,
              bytes: caBundle.bytes,
            },
          },
        });
      });

      socket.once('secureConnect', () => {
        const handshakeMs = Date.now() - startedAt;
        const peerCertificate = socket.getPeerCertificate(true);
        const hasLeafCertificate = hasPeerCertificate(peerCertificate);
        const certificateChain = hasLeafCertificate
          ? buildPeerCertificateChain(peerCertificate)
          : [];
        const leafCertificate = certificateChain[0] ?? null;
        const hostnameError =
          skipHostnameCheck || !hasLeafCertificate
            ? undefined
            : checkServerIdentity(validationTarget, peerCertificate);
        const hostnameValidation = {
          checked: !skipHostnameCheck,
          target: skipHostnameCheck ? null : validationTarget,
          matched: skipHostnameCheck ? null : hostnameError === undefined,
          error:
            !skipHostnameCheck && !hasLeafCertificate
              ? 'Peer certificate was not presented by the server'
              : (hostnameError?.message ?? null),
        };

        const authorizationReasons = [
          socket.authorized
            ? 'Certificate chain validated against the active trust store.'
            : `Certificate chain validation failed: ${socket.authorizationError ?? 'unknown_authority'}`,
          skipHostnameCheck
            ? 'Hostname validation was skipped by request.'
            : hostnameValidation.matched
              ? 'Hostname validation passed.'
              : `Hostname validation failed: ${hostnameValidation.error ?? 'unknown_error'}`,
          !socket.authorized && allowInvalidCertificates
            ? 'Policy allowed the probe to continue despite certificate trust failure.'
            : null,
        ].filter((reason): reason is string => Boolean(reason));

        const cipher = socket.getCipher();
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: true,
          timestamp: new Date().toISOString(),
        });

        finish({
          ok: true,
          target: {
            host,
            port,
            requestedServername: requestedServername ?? null,
            validationTarget,
          },
          policy: {
            allowInvalidCertificates,
            skipHostnameCheck,
            timeoutMs,
            minVersion: minVersion ?? null,
            maxVersion: maxVersion ?? null,
            alpnProtocols,
            customCa: {
              source: caBundle.source,
              path: caBundle.path,
              bytes: caBundle.bytes,
            },
          },
          transport: {
            protocol: socket.getProtocol() ?? null,
            alpnProtocol: normalizeAlpnProtocol(socket.alpnProtocol),
            cipher: {
              name: cipher.name,
              standardName: cipher.standardName,
              version: cipher.version,
            },
            localAddress: socket.localAddress ?? null,
            localPort: socket.localPort ?? null,
            remoteAddress: socket.remoteAddress ?? null,
            remotePort: socket.remotePort ?? null,
            servernameSent: normalizeSocketServername(socket.servername),
            sessionReused: socket.isSessionReused(),
          },
          authorization: {
            socketAuthorized: socket.authorized,
            authorizationError:
              typeof socket.authorizationError === 'string'
                ? socket.authorizationError
                : (socket.authorizationError?.message ?? null),
            hostnameValidation,
            policyAllowed:
              (socket.authorized || allowInvalidCertificates) &&
              (skipHostnameCheck || hostnameValidation.matched === true),
            reasons: authorizationReasons,
          },
          certificates: {
            leaf: leafCertificate,
            chain: certificateChain,
          },
          timing: {
            handshakeMs,
          },
        });
      });
    });
  }

  async handleTcpOpen(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host') ?? '127.0.0.1';
    const port = argNumber(args, 'port');
    if (port === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be an integer between 1 and 65535' };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const noDelay = argBool(args, 'noDelay') ?? true;
    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) {
      return ssrfCheck;
    }

    return new Promise<unknown>((resolve) => {
      let settled = false;
      const socket = new NetSocket();

      const finish = (payload: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('error', onError);
        resolve(payload);
      };

      const timer = setTimeout(() => {
        socket.destroy();
        finish({ ok: false, error: 'TCP connect timed out', target: { host, port } });
      }, timeoutMs);

      const onError = (error: Error): void => {
        finish({ ok: false, error: error.message, target: { host, port } });
      };

      const onConnect = (): void => {
        socket.setNoDelay(noDelay);
        const sessionId = makeSessionId('tcp');
        const session: TcpSession = {
          id: sessionId,
          kind: 'tcp',
          socket,
          host,
          port,
          createdAt: Date.now(),
          buffer: Buffer.alloc(0),
          ended: false,
          closed: false,
          error: null,
          waiters: new Set(),
          activeRead: false,
        };
        attachBufferedSession(session);
        this.tcpSessions.set(sessionId, session);
        void this.eventBus?.emit('tcp:session_opened', {
          sessionId,
          host,
          port,
          timestamp: new Date().toISOString(),
        });

        finish({
          ok: true,
          sessionId,
          kind: 'tcp',
          target: { host, port },
          createdAt: new Date(session.createdAt).toISOString(),
          transport: serializeSocketAddresses(socket),
          state: serializeSessionState(session),
        });
      };

      socket.once('connect', onConnect);
      socket.once('error', onError);
      socket.connect(port, host);
    });
  }

  async handleTcpWrite(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }

    const session = this.getTcpSession(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown tcp sessionId "${sessionId}"` };
    }

    return this.writeBufferedSession(session, args);
  }

  async handleTcpReadUntil(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }

    const session = this.getTcpSession(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown tcp sessionId "${sessionId}"` };
    }

    return this.readBufferedSessionUntil(session, args);
  }

  async handleTcpClose(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }

    return this.closeBufferedSession(sessionId, this.tcpSessions, 'tcp', args);
  }

  async handleTlsOpen(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host')?.trim() ?? null;
    if (!host) {
      return { ok: false, error: 'host is required' };
    }

    const port = argNumber(args, 'port') ?? 443;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be an integer between 1 and 65535' };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const allowInvalidCertificates = argBool(args, 'allowInvalidCertificates') ?? false;
    const skipHostnameCheck = argBool(args, 'skipHostnameCheck') ?? false;
    const servernameArg = argString(args, 'servername')?.trim() ?? null;
    const alpnProtocols = [
      ...new Set(argStringArray(args, 'alpnProtocols').map((value) => value.trim())),
    ].filter((value) => value.length > 0);

    let minVersion: ProbeTlsVersion | undefined;
    let maxVersion: ProbeTlsVersion | undefined;
    try {
      minVersion = argEnum(args, 'minVersion', TLS_VERSION_SET);
      maxVersion = argEnum(args, 'maxVersion', TLS_VERSION_SET);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }

    const versionOrder: ProbeTlsVersion[] = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];
    if (
      minVersion &&
      maxVersion &&
      versionOrder.indexOf(minVersion) > versionOrder.indexOf(maxVersion)
    ) {
      return { ok: false, error: 'minVersion must not be greater than maxVersion' };
    }

    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) {
      return ssrfCheck;
    }

    const caBundle = await loadProbeCaBundle(args);
    if (!caBundle.ok) {
      return { ok: false, error: caBundle.error };
    }

    const target: TlsTargetSummary = {
      host,
      port,
      requestedServername: servernameArg ?? (isIP(host) === 0 ? host : undefined) ?? null,
      validationTarget: servernameArg ?? host,
    };
    const policy: TlsPolicySummary = {
      allowInvalidCertificates,
      skipHostnameCheck,
      timeoutMs,
      minVersion: minVersion ?? null,
      maxVersion: maxVersion ?? null,
      alpnProtocols,
      customCa: {
        source: caBundle.source,
        path: caBundle.path,
        bytes: caBundle.bytes,
      },
    };
    const startedAt = Date.now();

    return new Promise<unknown>((resolve) => {
      let settled = false;
      const socket = createTlsConnection({
        host,
        port,
        servername: target.requestedServername ?? undefined,
        rejectUnauthorized: false,
        ...(minVersion ? { minVersion } : {}),
        ...(maxVersion ? { maxVersion } : {}),
        ...(alpnProtocols.length > 0 ? { ALPNProtocols: alpnProtocols } : {}),
        ...(caBundle.ca ? { ca: caBundle.ca } : {}),
      });

      const finish = (payload: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.off('error', onError);
        socket.off('secureConnect', onSecureConnect);
        resolve(payload);
      };

      const timer = setTimeout(() => {
        socket.destroy();
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: false,
          timestamp: new Date().toISOString(),
        });
        finish({
          ok: false,
          error: 'TLS open timed out',
          target,
          policy,
        });
      }, timeoutMs);

      const onError = (error: NodeJS.ErrnoException): void => {
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: false,
          timestamp: new Date().toISOString(),
        });
        finish({
          ok: false,
          error: error.message,
          errorCode: error.code ?? null,
          target,
          policy,
        });
      };

      const onSecureConnect = (): void => {
        const handshakeMs = Date.now() - startedAt;
        const peerCertificate = socket.getPeerCertificate(true);
        const hasLeafCertificate = hasPeerCertificate(peerCertificate);
        const certificateChain = hasLeafCertificate
          ? buildPeerCertificateChain(peerCertificate)
          : [];
        const leafCertificate = certificateChain[0] ?? null;
        const hostnameError =
          skipHostnameCheck || !hasLeafCertificate
            ? undefined
            : checkServerIdentity(target.validationTarget, peerCertificate);
        const hostnameValidation = {
          checked: !skipHostnameCheck,
          target: skipHostnameCheck ? null : target.validationTarget,
          matched: skipHostnameCheck ? null : hostnameError === undefined,
          error:
            !skipHostnameCheck && !hasLeafCertificate
              ? 'Peer certificate was not presented by the server'
              : (hostnameError?.message ?? null),
        };

        const authorizationReasons = [
          socket.authorized
            ? 'Certificate chain validated against the active trust store.'
            : `Certificate chain validation failed: ${socket.authorizationError ?? 'unknown_authority'}`,
          skipHostnameCheck
            ? 'Hostname validation was skipped by request.'
            : hostnameValidation.matched
              ? 'Hostname validation passed.'
              : `Hostname validation failed: ${hostnameValidation.error ?? 'unknown_error'}`,
          !socket.authorized && allowInvalidCertificates
            ? 'Policy allowed the session to continue despite certificate trust failure.'
            : null,
        ].filter((reason): reason is string => Boolean(reason));

        const cipher = socket.getCipher();
        const metadata: TlsSession['metadata'] = {
          target,
          policy,
          transport: {
            protocol: socket.getProtocol() ?? null,
            alpnProtocol: normalizeAlpnProtocol(socket.alpnProtocol),
            cipher: {
              name: cipher.name,
              standardName: cipher.standardName,
              version: cipher.version,
            },
            localAddress: socket.localAddress ?? null,
            localPort: socket.localPort ?? null,
            remoteAddress: socket.remoteAddress ?? null,
            remotePort: socket.remotePort ?? null,
            servernameSent: normalizeSocketServername(socket.servername),
            sessionReused: socket.isSessionReused(),
          },
          authorization: {
            socketAuthorized: socket.authorized,
            authorizationError:
              typeof socket.authorizationError === 'string'
                ? socket.authorizationError
                : (socket.authorizationError?.message ?? null),
            hostnameValidation,
            policyAllowed:
              (socket.authorized || allowInvalidCertificates) &&
              (skipHostnameCheck || hostnameValidation.matched === true),
            reasons: authorizationReasons,
          },
          certificates: {
            leaf: leafCertificate,
            chain: certificateChain,
          },
        };

        if (!metadata.authorization.policyAllowed) {
          socket.destroy();
          void this.eventBus?.emit('tls:probe_completed', {
            host,
            port,
            success: false,
            timestamp: new Date().toISOString(),
          });
          finish({
            ok: false,
            error: 'TLS session authorization failed',
            ...metadata,
            timing: {
              handshakeMs,
            },
          });
          return;
        }

        const sessionId = makeSessionId('tls');
        const session: TlsSession = {
          id: sessionId,
          kind: 'tls',
          socket,
          host,
          port,
          createdAt: Date.now(),
          buffer: Buffer.alloc(0),
          ended: false,
          closed: false,
          error: null,
          waiters: new Set(),
          activeRead: false,
          metadata,
        };
        attachBufferedSession(session);
        this.tlsSessions.set(sessionId, session);
        void this.eventBus?.emit('tls:session_opened', {
          sessionId,
          host,
          port,
          timestamp: new Date().toISOString(),
        });
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: true,
          timestamp: new Date().toISOString(),
        });

        finish({
          ok: true,
          sessionId,
          kind: 'tls',
          ...metadata,
          timing: {
            handshakeMs,
          },
          state: serializeSessionState(session),
        });
      };

      socket.once('error', onError);
      socket.once('secureConnect', onSecureConnect);
    });
  }

  async handleTlsWrite(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }

    const session = this.getTlsSession(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown tls sessionId "${sessionId}"` };
    }

    return this.writeBufferedSession(session, args);
  }

  async handleTlsReadUntil(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }

    const session = this.getTlsSession(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown tls sessionId "${sessionId}"` };
    }

    return this.readBufferedSessionUntil(session, args);
  }

  async handleTlsClose(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }

    return this.closeBufferedSession(sessionId, this.tlsSessions, 'tls', args);
  }

  async handleWebSocketOpen(args: Record<string, unknown>): Promise<unknown> {
    const rawUrl = argString(args, 'url')?.trim() ?? null;
    const rawHost = argString(args, 'host')?.trim() ?? null;
    const rawPath = argString(args, 'path')?.trim() ?? null;
    const rawPort = argNumber(args, 'port');
    const rawScheme = argString(args, 'scheme')?.trim() ?? null;
    if (rawUrl && (rawHost || rawPath || rawPort !== undefined || rawScheme)) {
      return {
        ok: false,
        error: 'url is mutually exclusive with explicit scheme/host/port/path inputs',
      };
    }

    let scheme: WebSocketScheme = 'ws';
    let host = rawHost;
    let port = rawPort ?? undefined;
    let path = normalizeWebSocketPath(rawPath);
    let url: string;

    if (rawUrl) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawUrl);
      } catch (error) {
        return { ok: false, error: `Invalid url: ${errorMessage(error)}` };
      }
      if (parsedUrl.protocol !== 'ws:' && parsedUrl.protocol !== 'wss:') {
        return { ok: false, error: 'url must use ws:// or wss:// protocol' };
      }
      scheme = parsedUrl.protocol === 'wss:' ? 'wss' : 'ws';
      host = parsedUrl.hostname;
      port = parsedUrl.port.length > 0 ? Number(parsedUrl.port) : scheme === 'wss' ? 443 : 80;
      path = normalizeWebSocketPath(`${parsedUrl.pathname}${parsedUrl.search}`);
      url = `${scheme}://${parsedUrl.host}${path}`;
    } else {
      if (!host) {
        return { ok: false, error: 'host or url is required' };
      }
      if (rawScheme) {
        if (rawScheme !== 'ws' && rawScheme !== 'wss') {
          return { ok: false, error: 'scheme must be ws or wss' };
        }
        scheme = rawScheme;
      }
      port ??= scheme === 'wss' ? 443 : 80;
      const authority = port === (scheme === 'wss' ? 443 : 80) ? host : `${host}:${String(port)}`;
      url = `${scheme}://${authority}${path}`;
    }

    if (!host || !port || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be an integer between 1 and 65535' };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const subprotocols = [
      ...new Set(argStringArray(args, 'subprotocols').map((value) => value.trim())),
    ].filter((value) => value.length > 0);

    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) {
      return ssrfCheck;
    }

    const allowInvalidCertificates = argBool(args, 'allowInvalidCertificates') ?? false;
    const skipHostnameCheck = argBool(args, 'skipHostnameCheck') ?? false;
    const servernameArg = argString(args, 'servername')?.trim() ?? null;
    const alpnProtocols = [
      ...new Set(argStringArray(args, 'alpnProtocols').map((value) => value.trim())),
    ].filter((value) => value.length > 0);

    let minVersion: ProbeTlsVersion | undefined;
    let maxVersion: ProbeTlsVersion | undefined;
    try {
      minVersion = argEnum(args, 'minVersion', TLS_VERSION_SET);
      maxVersion = argEnum(args, 'maxVersion', TLS_VERSION_SET);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }

    const versionOrder: ProbeTlsVersion[] = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];
    if (
      minVersion &&
      maxVersion &&
      versionOrder.indexOf(minVersion) > versionOrder.indexOf(maxVersion)
    ) {
      return { ok: false, error: 'minVersion must not be greater than maxVersion' };
    }

    const caBundle =
      scheme === 'wss'
        ? await loadProbeCaBundle(args)
        : { ok: true as const, ca: undefined, source: null, path: null, bytes: null };
    if (!caBundle.ok) {
      return { ok: false, error: caBundle.error };
    }

    const target: WebSocketTargetSummary = {
      scheme,
      url,
      host,
      port,
      path,
      requestedServername:
        scheme === 'wss' ? (servernameArg ?? (isIP(host) === 0 ? host : undefined) ?? null) : null,
      validationTarget: scheme === 'wss' ? (servernameArg ?? host) : null,
    };
    const requestKey = randomBytes(16).toString('base64');
    const acceptKey = computeWebSocketAccept(requestKey);
    const startedAt = Date.now();

    return new Promise<unknown>((resolve) => {
      let settled = false;
      let handshakeBuffer = Buffer.alloc(0);
      let transport: WebSocketSession['metadata']['transport'] | null = null;
      let authorization: WebSocketSession['metadata']['authorization'] = null;
      let certificates: WebSocketSession['metadata']['certificates'] = null;
      const socket: SessionSocket =
        scheme === 'wss'
          ? createTlsConnection({
              host,
              port,
              servername: target.requestedServername ?? undefined,
              rejectUnauthorized: false,
              ...(minVersion ? { minVersion } : {}),
              ...(maxVersion ? { maxVersion } : {}),
              ...(alpnProtocols.length > 0 ? { ALPNProtocols: alpnProtocols } : {}),
              ...(caBundle.ca ? { ca: caBundle.ca } : {}),
            })
          : new NetSocket();

      const finish = (payload: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.off('error', onError);
        socket.off('connect', onConnect);
        socket.off('secureConnect', onSecureConnect);
        socket.off('data', onHandshakeData);
        resolve(payload);
      };

      const buildHandshakeRequest = (): Buffer => {
        const defaultPort = scheme === 'wss' ? 443 : 80;
        const hostHeader = port === defaultPort ? host : `${host}:${String(port)}`;
        const lines = [
          `GET ${path} HTTP/1.1`,
          `Host: ${hostHeader}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${requestKey}`,
          'Sec-WebSocket-Version: 13',
        ];
        if (subprotocols.length > 0) {
          lines.push(`Sec-WebSocket-Protocol: ${subprotocols.join(', ')}`);
        }
        lines.push('', '');
        return Buffer.from(lines.join('\r\n'), 'utf8');
      };

      const timer = setTimeout(() => {
        socket.destroy();
        finish({
          ok: false,
          error: 'WebSocket open timed out',
          target,
        });
      }, timeoutMs);

      const onError = (error: NodeJS.ErrnoException): void => {
        finish({
          ok: false,
          error: error.message,
          errorCode: error.code ?? null,
          target,
        });
      };

      const sendHandshake = (): void => {
        socket.write(buildHandshakeRequest());
      };

      const onConnect = (): void => {
        if (socket instanceof NetSocket) {
          socket.setNoDelay(true);
        }
        transport = {
          ...serializeSocketAddresses(socket),
          protocol: null,
          alpnProtocol: null,
          servernameSent: null,
          sessionReused: null,
        };
        sendHandshake();
      };

      const onSecureConnect = (): void => {
        if (!(socket instanceof Object) || !('getPeerCertificate' in socket)) {
          finish({ ok: false, error: 'Expected a TLS socket for wss session', target });
          return;
        }
        const tlsSocket = socket as TLSSocket;
        const peerCertificate = tlsSocket.getPeerCertificate(true);
        const hasLeafCertificate = hasPeerCertificate(peerCertificate);
        const certificateChain = hasLeafCertificate
          ? buildPeerCertificateChain(peerCertificate)
          : [];
        const leafCertificate = certificateChain[0] ?? null;
        const hostnameError =
          skipHostnameCheck || !hasLeafCertificate || !target.validationTarget
            ? undefined
            : checkServerIdentity(target.validationTarget, peerCertificate);
        const hostnameValidation = {
          checked: !skipHostnameCheck,
          target: skipHostnameCheck ? null : target.validationTarget,
          matched: skipHostnameCheck ? null : hostnameError === undefined,
          error:
            !skipHostnameCheck && !hasLeafCertificate
              ? 'Peer certificate was not presented by the server'
              : (hostnameError?.message ?? null),
        };
        const authorizationReasons = [
          tlsSocket.authorized
            ? 'Certificate chain validated against the active trust store.'
            : `Certificate chain validation failed: ${tlsSocket.authorizationError ?? 'unknown_authority'}`,
          skipHostnameCheck
            ? 'Hostname validation was skipped by request.'
            : hostnameValidation.matched
              ? 'Hostname validation passed.'
              : `Hostname validation failed: ${hostnameValidation.error ?? 'unknown_error'}`,
          !tlsSocket.authorized && allowInvalidCertificates
            ? 'Policy allowed the session to continue despite certificate trust failure.'
            : null,
        ].filter((reason): reason is string => Boolean(reason));

        authorization = {
          socketAuthorized: tlsSocket.authorized,
          authorizationError:
            typeof tlsSocket.authorizationError === 'string'
              ? tlsSocket.authorizationError
              : (tlsSocket.authorizationError?.message ?? null),
          hostnameValidation,
          policyAllowed:
            (tlsSocket.authorized || allowInvalidCertificates) &&
            (skipHostnameCheck || hostnameValidation.matched === true),
          reasons: authorizationReasons,
        };
        certificates = {
          leaf: leafCertificate,
          chain: certificateChain,
        };
        transport = {
          ...serializeSocketAddresses(tlsSocket),
          protocol: tlsSocket.getProtocol() ?? null,
          alpnProtocol: normalizeAlpnProtocol(tlsSocket.alpnProtocol),
          servernameSent: normalizeSocketServername(tlsSocket.servername),
          sessionReused: tlsSocket.isSessionReused(),
        };

        if (!authorization.policyAllowed) {
          tlsSocket.destroy();
          finish({
            ok: false,
            error: 'WebSocket TLS authorization failed',
            target,
            authorization,
            certificates,
          });
          return;
        }

        sendHandshake();
      };

      const onHandshakeData = (chunk: Buffer): void => {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
        const headerEnd = handshakeBuffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) {
          return;
        }

        const headerText = handshakeBuffer.subarray(0, headerEnd).toString('utf8');
        const lines = headerText.split('\r\n');
        const statusLine = lines.shift() ?? '';
        if (!/^HTTP\/1\.1 101\b/.test(statusLine)) {
          socket.destroy();
          finish({
            ok: false,
            error: `Unexpected WebSocket upgrade response: ${statusLine}`,
            target,
          });
          return;
        }

        const headers = new Map<string, string>();
        for (const line of lines) {
          const separator = line.indexOf(':');
          if (separator <= 0) {
            continue;
          }
          const name = line.slice(0, separator).trim().toLowerCase();
          const value = line.slice(separator + 1).trim();
          headers.set(name, value);
        }

        const upgrade = headers.get('upgrade')?.toLowerCase() ?? '';
        const connection = headers.get('connection')?.toLowerCase() ?? '';
        const responseAcceptKey = headers.get('sec-websocket-accept') ?? null;
        if (upgrade !== 'websocket') {
          socket.destroy();
          finish({ ok: false, error: 'Upgrade header did not confirm websocket', target });
          return;
        }
        if (
          !connection
            .split(',')
            .map((part) => part.trim())
            .includes('upgrade')
        ) {
          socket.destroy();
          finish({ ok: false, error: 'Connection header did not confirm upgrade', target });
          return;
        }
        if (responseAcceptKey !== acceptKey) {
          socket.destroy();
          finish({ ok: false, error: 'sec-websocket-accept did not match the client key', target });
          return;
        }

        const negotiatedSubprotocol = headers.get('sec-websocket-protocol') ?? null;
        if (negotiatedSubprotocol && !subprotocols.includes(negotiatedSubprotocol)) {
          socket.destroy();
          finish({
            ok: false,
            error: `Server selected unexpected subprotocol "${negotiatedSubprotocol}"`,
            target,
          });
          return;
        }

        const sessionId = makeSessionId('websocket');
        const session: WebSocketSession = {
          id: sessionId,
          kind: 'websocket',
          scheme,
          socket,
          host,
          port,
          path,
          createdAt: Date.now(),
          parserBuffer: handshakeBuffer.subarray(headerEnd + 4),
          frames: [],
          ended: false,
          closed: false,
          error: null,
          waiters: new Set(),
          activeRead: false,
          closeSent: false,
          closeReceived: false,
          metadata: {
            target,
            handshake: {
              requestKey,
              acceptKey,
              responseAcceptKey,
              subprotocol: negotiatedSubprotocol,
            },
            transport:
              transport ??
              ({
                ...serializeSocketAddresses(socket),
                protocol: null,
                alpnProtocol: null,
                servernameSent: null,
                sessionReused: null,
              } satisfies WebSocketSession['metadata']['transport']),
            authorization,
            certificates,
          },
        };
        this.attachWebSocketSession(session);
        this.websocketSessions.set(sessionId, session);
        this.emitWebSocketEvent('websocket:session_opened', {
          sessionId,
          scheme,
          host,
          port,
          path,
          timestamp: new Date().toISOString(),
        });

        finish({
          ok: true,
          sessionId,
          kind: session.kind,
          scheme,
          target,
          handshake: session.metadata.handshake,
          transport: session.metadata.transport,
          authorization: session.metadata.authorization,
          certificates: session.metadata.certificates,
          timing: {
            handshakeMs: Date.now() - startedAt,
          },
          state: serializeWebSocketSessionState(session),
        });
      };

      socket.once('error', onError);
      socket.on('data', onHandshakeData);
      if (scheme === 'wss') {
        socket.once('secureConnect', onSecureConnect);
      } else {
        socket.once('connect', onConnect);
        (socket as NetSocket).connect(port, host);
      }
    });
  }

  async handleWebSocketSendFrame(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }
    const session = this.getWebSocketSession(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown websocket sessionId "${sessionId}"` };
    }
    return this.sendWebSocketFrame(session, args);
  }

  async handleWebSocketReadFrame(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }
    const session = this.getWebSocketSession(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown websocket sessionId "${sessionId}"` };
    }
    return this.readWebSocketFrame(session, args);
  }

  async handleWebSocketClose(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }
    return this.closeWebSocketSession(sessionId, args);
  }

  async handleBypassCertPinning(args: Record<string, unknown>): Promise<ToolResponse> {
    if (this.extensionInvoke) {
      try {
        const result = await this.extensionInvoke(args);
        if (result) {
          return asJsonResponse({
            success: true,
            strategy: 'frida-injection',
            result,
          });
        }
      } catch {
        // Extension invoke failed, fall through to instructions
      }
    }

    return asJsonResponse({
      success: true,
      strategy: 'manual-bypass',
      instructions: {
        android: [
          'Use Frida to hook X509TrustManager.checkServerTrusted and return without throwing.',
          'Alternatively, use OkHttp CertificatePinner.Builder().add() with the target cert.',
        ],
        ios: [
          'Hook SecTrustEvaluateWithError to always return true.',
          'Or use SSLSetSessionOption to disable certificate validation.',
        ],
        desktop: [
          'Set NODE_TLS_REJECT_UNAUTHORIZED=0 for Node.js targets.',
          'Or patch the certificate comparison function in the HTTP client.',
        ],
      },
      args,
    });
  }

  // Raw TCP/UDP Socket Handlers

  async handleRawTcpSend(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host') ?? '127.0.0.1';
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    // SECURITY: SSRF protection
    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) return ssrfCheck;

    const dataHex = argString(args, 'dataHex');
    const dataText = argString(args, 'dataText');
    if (!dataHex && !dataText) {
      return { ok: false, error: 'dataHex or dataText is required' };
    }

    const data = dataHex
      ? Buffer.from(normalizeHex(dataHex), 'hex')
      : Buffer.from(dataText ?? '', 'utf8');
    const timeout = argNumber(args, 'timeout') ?? 5000;

    return new Promise<unknown>((resolve) => {
      const socket = new NetSocket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ ok: false, error: 'Connection timed out' });
      }, timeout);

      socket.on('connect', () => {
        socket.write(data, () => {
          socket.end();
        });
      });

      socket.on('data', (chunk: Buffer) => {
        clearTimeout(timer);
        resolve({
          ok: true,
          host,
          port,
          sentBytes: data.length,
          responseHex: chunk.toString('hex').toUpperCase(),
          responseText: chunk.toString('utf8'),
        });
        socket.destroy();
      });

      socket.on('error', (error: Error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: error.message });
      });

      socket.connect(port, host);
    });
  }

  async handleRawTcpListen(args: Record<string, unknown>): Promise<unknown> {
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    const timeout = argNumber(args, 'timeout') ?? 10000;

    return new Promise<unknown>((resolve) => {
      const server = createNetServer();
      const timer = setTimeout(() => {
        server.close();
        resolve({ ok: false, error: 'Listen timed out — no connection received' });
      }, timeout);

      server.on('connection', (socket: NetSocket) => {
        clearTimeout(timer);
        const chunks: Buffer[] = [];

        socket.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        socket.on('end', () => {
          const data = Buffer.concat(chunks);
          server.close();
          resolve({
            ok: true,
            port,
            receivedBytes: data.length,
            dataHex: data.toString('hex').toUpperCase(),
            dataText: data.toString('utf8'),
          });
        });

        socket.on('error', (error: Error) => {
          clearTimeout(timer);
          server.close();
          resolve({ ok: false, error: error.message });
        });
      });

      server.on('error', (error: Error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: error.message });
      });

      server.listen(port, '127.0.0.1');
    });
  }

  async handleRawUdpSend(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host') ?? '127.0.0.1';
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    // SECURITY: SSRF protection
    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) return ssrfCheck;

    const dataHex = argString(args, 'dataHex');
    const dataText = argString(args, 'dataText');
    if (!dataHex && !dataText) {
      return { ok: false, error: 'dataHex or dataText is required' };
    }

    const data = dataHex
      ? Buffer.from(normalizeHex(dataHex), 'hex')
      : Buffer.from(dataText ?? '', 'utf8');
    const timeout = argNumber(args, 'timeout') ?? 5000;

    return new Promise<unknown>((resolve) => {
      const socket = createUdpSocket('udp4');
      const timer = setTimeout(() => {
        socket.close();
        resolve({ ok: false, error: 'UDP response timed out' });
      }, timeout);

      socket.on('message', (msg: Buffer) => {
        clearTimeout(timer);
        socket.close();
        resolve({
          ok: true,
          host,
          port,
          sentBytes: data.length,
          responseHex: msg.toString('hex').toUpperCase(),
          responseText: msg.toString('utf8'),
        });
      });

      socket.on('error', (error: Error) => {
        clearTimeout(timer);
        socket.close();
        resolve({ ok: false, error: error.message });
      });

      socket.send(data, 0, data.length, port, host);
    });
  }

  async handleRawUdpListen(args: Record<string, unknown>): Promise<unknown> {
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    const timeout = argNumber(args, 'timeout') ?? 10000;

    return new Promise<unknown>((resolve) => {
      const socket = createUdpSocket('udp4');
      const timer = setTimeout(() => {
        socket.close();
        resolve({ ok: false, error: 'UDP listen timed out' });
      }, timeout);

      socket.on('message', (msg: Buffer, rinfo: { address: string; port: number }) => {
        clearTimeout(timer);
        socket.close();
        resolve({
          ok: true,
          localPort: port,
          receivedBytes: msg.length,
          from: rinfo,
          dataHex: msg.toString('hex').toUpperCase(),
          dataText: msg.toString('utf8'),
        });
      });

      socket.on('error', (error: Error) => {
        clearTimeout(timer);
        socket.close();
        resolve({ ok: false, error: error.message });
      });

      socket.bind(port, '127.0.0.1');
    });
  }

  async handleRawTcpScan(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host') ?? '127.0.0.1';
    const startPort = argNumber(args, 'startPort') ?? 1;
    const endPort = argNumber(args, 'endPort') ?? 1024;

    if (startPort < 1 || endPort > 65535 || startPort > endPort) {
      return { ok: false, error: 'Invalid port range' };
    }

    if (endPort - startPort > 1000) {
      return { ok: false, error: 'Port range too large (max 1000 ports)' };
    }

    const timeout = argNumber(args, 'timeout') ?? 1000;
    const openPorts: number[] = [];
    const scanPromises: Promise<void>[] = [];

    for (let p = startPort; p <= endPort; p++) {
      scanPromises.push(
        new Promise<void>((resolve) => {
          const socket = new NetSocket();
          const timer = setTimeout(() => {
            socket.destroy();
            resolve();
          }, timeout);

          socket.on('connect', () => {
            clearTimeout(timer);
            openPorts.push(p);
            socket.destroy();
            resolve();
          });

          socket.on('error', () => {
            clearTimeout(timer);
            resolve();
          });

          socket.connect(p, host);
        }),
      );
    }

    await Promise.all(scanPromises);

    return {
      ok: true,
      host,
      portRange: { start: startPort, end: endPort },
      openPorts: openPorts.toSorted((a, b) => a - b),
      openCount: openPorts.length,
      scannedCount: endPort - startPort + 1,
    };
  }
}
