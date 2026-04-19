import { readFile } from 'node:fs/promises';
import { Socket as NetSocket } from 'node:net';
import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { type DetailedPeerCertificate, type PeerCertificate, type TLSSocket } from 'node:tls';
import { argString } from '@server/domains/shared/parse-args';
import { isLoopbackHost, isPrivateHost } from '@server/domains/network/ssrf-policy';

export function validateNetworkTarget(host: string): { ok: false; error: string } | null {
  if (isPrivateHost(host) && !isLoopbackHost(host)) {
    return {
      ok: false,
      error: `Blocked: target host "${host}" resolves to a private/internal address. SSRF protection applies.`,
    };
  }
  return null;
}

export const TLS_VERSION_SET = new Set(['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'] as const);
export type ProbeTlsVersion = 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | 'TLSv1.3';

export type ProbePeerCertificate = DetailedPeerCertificate | PeerCertificate;
export type SessionKind = 'tcp' | 'tls';
export type SessionSocket = NetSocket | TLSSocket;

export type TlsPolicySummary = {
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

export type TlsTargetSummary = {
  host: string;
  port: number;
  requestedServername: string | null;
  validationTarget: string;
};

export type BufferedSession<TSocket extends SessionSocket = SessionSocket> = {
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

export type TcpSession = BufferedSession<NetSocket>;
export type TlsSession = BufferedSession<TLSSocket> & {
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

export type WebSocketScheme = 'ws' | 'wss';
export type WebSocketFrameType = 'text' | 'binary' | 'close' | 'ping' | 'pong';

export type WebSocketTargetSummary = {
  scheme: WebSocketScheme;
  url: string;
  host: string;
  port: number;
  path: string;
  requestedServername: string | null;
  validationTarget: string | null;
};

export type WebSocketFrame = {
  type: WebSocketFrameType;
  fin: boolean;
  opcode: number;
  masked: boolean;
  data: Buffer;
  closeCode: number | null;
  closeReason: string | null;
  receivedAt: number;
};

export type WebSocketSession = {
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

export type WebSocketEventName =
  | 'websocket:session_opened'
  | 'websocket:session_written'
  | 'websocket:frame_read'
  | 'websocket:session_closed';

export type ConsumedSessionBuffer = {
  data: Buffer;
  matchedDelimiter: boolean;
  stopReason: 'delimiter' | 'maxBytes' | 'closed' | 'error';
  delimiterHex: string | null;
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeSocketServername(
  servername: string | false | null | undefined,
): string | null {
  return typeof servername === 'string' && servername.length > 0 ? servername : null;
}

export function normalizeAlpnProtocol(protocol: string | false | null | undefined): string | null {
  return typeof protocol === 'string' && protocol.length > 0 ? protocol : null;
}

export function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.keys(value).length > 0;
}

export function hasPeerCertificate(value: unknown): value is ProbePeerCertificate {
  return isNonEmptyObject(value);
}

export function summarizePeerCertificate(
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

export function buildPeerCertificateChain(
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

export async function loadProbeCaBundle(args: Record<string, unknown>): Promise<
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

export function makeSessionId(kind: SessionKind | 'websocket'): string {
  return `${kind}_${randomUUID()}`;
}

export function serializeSocketAddresses(socket: SessionSocket): {
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

export function serializeSessionState(session: BufferedSession): {
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

export function serializeWebSocketSessionState(session: WebSocketSession): {
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

export function normalizeWebSocketPath(path: string | null | undefined): string {
  if (!path || path.trim().length === 0) {
    return '/';
  }
  return path.startsWith('/') ? path : `/${path}`;
}

export function websocketOpcodeName(opcode: number): WebSocketFrameType | null {
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

export function computeWebSocketAccept(requestKey: string): string {
  return createHash('sha1')
    .update(`${requestKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, 'utf8')
    .digest('base64');
}

export function encodeWebSocketFrame(
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

export function tryConsumeWebSocketFrame(buffer: Buffer): {
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

export function wakeSessionWaiters(session: BufferedSession): void {
  for (const waiter of session.waiters) {
    waiter();
  }
  session.waiters.clear();
}

export function attachBufferedSession(session: BufferedSession): void {
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

export function waitForSessionActivity(
  session: BufferedSession,
  timeoutMs: number,
): Promise<boolean> {
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

export function wakeWebSocketWaiters(session: WebSocketSession): void {
  for (const waiter of session.waiters) {
    waiter();
  }
  session.waiters.clear();
}

export function waitForWebSocketActivity(
  session: WebSocketSession,
  timeoutMs: number,
): Promise<boolean> {
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

export function consumeSessionBuffer(
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

export function normalizeHex(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9A-F]+$/i.test(value);
}

export function tlsVersionName(major: number, minor: number): string {
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

export function contentTypeName(contentType: number): string {
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

export function handshakeTypeName(handshakeType: number): string {
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
export function parseClientHello(payload: Buffer): {
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
export function parseDerCertificate(der: Buffer): {
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
export function parseCertificateChain(hexPayload: string): Array<{
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
