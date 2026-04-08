/**
 * TLS Packet Parser — binary-level parsing for TLS records, handshakes,
 * certificates, and cipher suite lookup.
 */

import { createHash } from 'node:crypto';

function normalizeHexInput(input: Uint8Array | string): Buffer {
  if (typeof input === 'string') {
    const cleaned = input.replace(/\s+/g, '');
    return Buffer.from(cleaned, 'hex');
  }
  return Buffer.from(input);
}

// IANA TLS cipher suites
const CIPHER_SUITE_MAP: Array<{ id: number; name: string }> = [
  { id: 0x009c, name: 'TLS_RSA_WITH_AES_128_GCM_SHA256' },
  { id: 0x009d, name: 'TLS_RSA_WITH_AES_256_GCM_SHA384' },
  { id: 0x1301, name: 'TLS_AES_128_GCM_SHA256' },
  { id: 0x1302, name: 'TLS_AES_256_GCM_SHA384' },
  { id: 0x1303, name: 'TLS_CHACHA20_POLY1305_SHA256' },
  { id: 0x1304, name: 'TLS_AES_128_CCM_SHA256' },
  { id: 0x1305, name: 'TLS_AES_128_CCM_8_SHA256' },
  { id: 0xc009, name: 'TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA' },
  { id: 0xc00a, name: 'TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA' },
  { id: 0xc013, name: 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA' },
  { id: 0xc014, name: 'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA' },
  { id: 0xc02b, name: 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256' },
  { id: 0xc02c, name: 'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384' },
  { id: 0xc02f, name: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256' },
  { id: 0xc030, name: 'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384' },
  { id: 0xcca8, name: 'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256' },
  { id: 0xcca9, name: 'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256' },
];

const CIPHER_SUITE_BY_ID = new Map(CIPHER_SUITE_MAP.map((cs) => [cs.id, cs]));

const NAMED_GROUPS: Record<number, string> = {
  0x0017: 'secp256r1',
  0x0018: 'secp384r1',
  0x0019: 'secp521r1',
  0x001d: 'x25519',
  0x001e: 'x448',
  0x0100: 'ffdhe2048',
  0x0101: 'ffdhe3072',
};

function tlsVersionString(major: number, minor: number): string {
  if (major === 3 && minor === 1) return 'TLS 1.0';
  if (major === 3 && minor === 2) return 'TLS 1.1';
  if (major === 3 && minor === 3) return 'TLS 1.2';
  if (major === 3 && minor === 4) return 'TLS 1.3';
  return `0x${major.toString(16)}`;
}

function contentTypeString(ct: number): string {
  if (ct === 0x14) return 'ChangeCipherSpec';
  if (ct === 0x15) return 'Alert';
  if (ct === 0x16) return 'Handshake';
  if (ct === 0x17) return 'ApplicationData';
  return `Unknown(${ct})`;
}

function extractKeyExchange(cipherName: string): string | undefined {
  if (cipherName.includes('ECDHE_ECDSA')) return 'ECDHE_ECDSA';
  if (cipherName.includes('ECDHE_RSA')) return 'ECDHE_RSA';
  if (cipherName.includes('DHE_RSA')) return 'DHE_RSA';
  if (cipherName.startsWith('TLS_RSA_')) return 'RSA';
  return undefined;
}

interface ParsedExtension {
  type: number;
  data?: unknown;
}

function parseSNIExtensionData(payload: Buffer): { serverName: string } | undefined {
  if (payload.length < 5) return undefined;
  // server_name_list_length (2) + name_type (1) + name_length (2)
  const nameType = payload[2];
  if (nameType !== 0) return undefined;
  const nameLen = payload.readUInt16BE(3);
  if (5 + nameLen > payload.length) return undefined;
  return { serverName: payload.subarray(5, 5 + nameLen).toString('utf8') };
}

function parseALPNExtensionData(payload: Buffer): { protocols: string[] } | undefined {
  if (payload.length < 2) return undefined;
  const listLen = payload.readUInt16BE(0);
  const protocols: string[] = [];
  let cursor = 2;
  const end = 2 + listLen;
  while (cursor < end && cursor < payload.length) {
    const pLen = payload[cursor];
    if (pLen === undefined) break;
    cursor += 1;
    if (cursor + pLen > payload.length) break;
    protocols.push(payload.subarray(cursor, cursor + pLen).toString('utf8'));
    cursor += pLen;
  }
  return { protocols };
}

function parseSupportedGroupsData(payload: Buffer): { groups: string[] } | undefined {
  if (payload.length < 2) return undefined;
  const listLen = payload.readUInt16BE(0);
  const groups: string[] = [];
  let cursor = 2;
  const end = 2 + listLen;
  while (cursor + 2 <= end && cursor + 2 <= payload.length) {
    const groupId = payload.readUInt16BE(cursor);
    groups.push(NAMED_GROUPS[groupId] ?? `0x${groupId.toString(16).padStart(4, '0')}`);
    cursor += 2;
  }
  return { groups };
}

function parseExtensionPayload(extType: number, payload: Buffer): unknown | undefined {
  if (extType === 0) return parseSNIExtensionData(payload);
  if (extType === 16) return parseALPNExtensionData(payload);
  if (extType === 10) return parseSupportedGroupsData(payload);
  return undefined;
}

export interface HandshakeResult {
  version?: string;
  cipherSuite?: string[] | string;
  sessionResumed?: boolean;
  keyExchange?: string;
  extensions: ParsedExtension[];
}

/**
 * Parse a TLS handshake message (ClientHello or ServerHello) from raw bytes.
 */
export function parseHandshake(input: Uint8Array | string): HandshakeResult {
  const buf = normalizeHexInput(input);

  if (buf.length < 4) {
    return { version: '0x0', cipherSuite: 'none', extensions: [] };
  }

  const handshakeType = buf[0] ?? 0;
  // const handshakeLength = (buf[1]! << 16) | (buf[2]! << 8) | buf[3]!;
  const body = buf.subarray(4);

  // ClientHello = 0 (in our building convention)
  if (handshakeType === 0) {
    return parseClientHello(body);
  }

  // ServerHello = 1 (in our building convention, maps to standard TLS ServerHello type 2)
  if (handshakeType === 1) {
    return parseServerHello(body);
  }

  // type 2 = ServerHello (standard TLS type) or other unknown
  if (handshakeType === 2) {
    return { version: 'unknown', cipherSuite: 'unknown', extensions: [] };
  }

  return { version: 'unknown', cipherSuite: 'unknown', extensions: [] };
}

function parseClientHello(body: Buffer): HandshakeResult {
  if (body.length < 2) {
    return { version: '0x0', cipherSuite: 'none', extensions: [] };
  }

  const major = body[0] ?? 0;
  const minor = body[1] ?? 0;
  const version = tlsVersionString(major, minor);

  if (body.length < 34) {
    return { version, cipherSuite: 'none', extensions: [] };
  }

  // Skip random (32 bytes)
  let cursor = 34;

  // Session ID
  if (cursor >= body.length) return { version, cipherSuite: 'none', extensions: [] };
  const sessionIdLen = body[cursor] ?? 0;
  cursor += 1 + sessionIdLen;

  // Cipher suites
  if (cursor + 2 > body.length) return { version, cipherSuite: 'none', extensions: [] };
  const csLen = body.readUInt16BE(cursor);
  cursor += 2;
  const cipherSuites: string[] = [];
  const csEnd = cursor + csLen;
  while (cursor + 2 <= csEnd && cursor + 2 <= body.length) {
    const csId = body.readUInt16BE(cursor);
    const known = CIPHER_SUITE_BY_ID.get(csId);
    cipherSuites.push(known?.name ?? `0x${csId.toString(16).padStart(4, '0')}`);
    cursor += 2;
  }
  cursor = csEnd;

  // Compression methods
  if (cursor >= body.length) return { version, cipherSuite: cipherSuites, extensions: [] };
  const compLen = body[cursor] ?? 0;
  cursor += 1 + compLen;

  // Extensions
  const extensions: ParsedExtension[] = [];
  let sessionResumed = false;

  if (cursor + 2 <= body.length) {
    const extTotalLen = body.readUInt16BE(cursor);
    cursor += 2;
    const extEnd = cursor + extTotalLen;

    while (cursor + 4 <= extEnd && cursor + 4 <= body.length) {
      const extType = body.readUInt16BE(cursor);
      const extLen = body.readUInt16BE(cursor + 2);
      cursor += 4;

      const extPayload = body.subarray(cursor, cursor + extLen);
      const parsedData = parseExtensionPayload(extType, extPayload);

      // session_ticket extension (type 35)
      if (extType === 35) {
        sessionResumed = true;
      }

      extensions.push({
        type: extType,
        ...(parsedData ? { data: parsedData } : {}),
      });

      cursor += extLen;
    }
  }

  return {
    version,
    cipherSuite: cipherSuites,
    sessionResumed: sessionResumed || undefined,
    extensions,
  };
}

function parseServerHello(body: Buffer): HandshakeResult {
  if (body.length < 2) {
    return { version: '0x0', cipherSuite: 'none', extensions: [] };
  }

  const major = body[0] ?? 0;
  const minor = body[1] ?? 0;
  const version = tlsVersionString(major, minor);

  if (body.length < 34) {
    return { version, cipherSuite: 'none', extensions: [] };
  }

  // Skip random (32 bytes)
  let cursor = 34;

  // Session ID
  if (cursor >= body.length) return { version, cipherSuite: 'none', extensions: [] };
  const sessionIdLen = body[cursor] ?? 0;
  cursor += 1 + sessionIdLen;

  // Single cipher suite (2 bytes)
  if (cursor + 2 > body.length) return { version, cipherSuite: 'none', extensions: [] };
  const csId = body.readUInt16BE(cursor);
  cursor += 2;

  const known = CIPHER_SUITE_BY_ID.get(csId);
  const cipherSuiteName = known?.name ?? `0x${csId.toString(16).padStart(4, '0')}`;
  const keyExchange = known ? extractKeyExchange(known.name) : undefined;

  // Compression method (1 byte)
  if (cursor < body.length) {
    cursor += 1;
  }

  // Extensions
  const extensions: ParsedExtension[] = [];
  if (cursor + 2 <= body.length) {
    const extTotalLen = body.readUInt16BE(cursor);
    cursor += 2;
    const extEnd = cursor + extTotalLen;

    while (cursor + 4 <= extEnd && cursor + 4 <= body.length) {
      const extType = body.readUInt16BE(cursor);
      const extLen = body.readUInt16BE(cursor + 2);
      cursor += 4;

      const extPayload = body.subarray(cursor, cursor + extLen);
      const parsedData = parseExtensionPayload(extType, extPayload);

      extensions.push({
        type: extType,
        ...(parsedData ? { data: parsedData } : {}),
      });

      cursor += extLen;
    }
  }

  return {
    version,
    cipherSuite: cipherSuiteName,
    keyExchange,
    extensions,
  };
}

/**
 * Parse a TLS record header from raw bytes.
 */
export function parseTLSRecord(input: Uint8Array): {
  contentType: string;
  version: string;
  length: number;
} | null {
  const buf = Buffer.from(input);
  if (buf.length < 5) return null;

  const contentType = buf[0] ?? 0;
  const major = buf[1] ?? 0;
  const minor = buf[2] ?? 0;
  const length = buf.readUInt16BE(3);

  return {
    contentType: contentTypeString(contentType),
    version: tlsVersionString(major, minor),
    length,
  };
}

/**
 * List all known IANA cipher suites, optionally filtered by keyword.
 */
export function listCipherSuites(filter?: string): Array<{ id: number; name: string }> {
  const sorted = [...CIPHER_SUITE_MAP].toSorted((a, b) => a.id - b.id);
  if (!filter) return sorted;
  const lowerFilter = filter.toLowerCase();
  return sorted.filter((cs) => cs.name.toLowerCase().includes(lowerFilter));
}

/**
 * Look up a single cipher suite by ID or name.
 */
export function lookupCipherSuite(input: string | number): { id: number; name: string } | null {
  if (typeof input === 'number') {
    return CIPHER_SUITE_BY_ID.get(input) ?? null;
  }
  const lowerInput = input.toLowerCase();
  return CIPHER_SUITE_MAP.find((cs) => cs.name.toLowerCase() === lowerInput) ?? null;
}

/**
 * Parse a TLS Certificate handshake message from raw bytes.
 */
export function parseCertificate(input: Uint8Array | string): {
  count: number;
  fingerprints: Array<{ sha256?: string }>;
  rawLengths: number[];
} {
  const buf = normalizeHexInput(input);

  // Handshake header: type (1) + length (3)
  if (buf.length < 4) {
    return { count: 0, fingerprints: [], rawLengths: [] };
  }

  const body = buf.subarray(4);
  if (body.length < 3) {
    return { count: 0, fingerprints: [], rawLengths: [] };
  }

  // Certificate list length (3 bytes)
  const certListLen = ((body[0] ?? 0) << 16) | ((body[1] ?? 0) << 8) | (body[2] ?? 0);
  let cursor = 3;
  const end = 3 + certListLen;

  const fingerprints: Array<{ sha256?: string }> = [];
  const rawLengths: number[] = [];

  while (cursor + 3 <= end && cursor + 3 <= body.length) {
    const certLen =
      ((body[cursor] ?? 0) << 16) | ((body[cursor + 1] ?? 0) << 8) | (body[cursor + 2] ?? 0);
    cursor += 3;
    if (cursor + certLen > body.length) break;

    const certData = body.subarray(cursor, cursor + certLen);
    rawLengths.push(certLen);

    // Compute SHA-256 fingerprint
    try {
      const sha256 = createHash('sha256').update(certData).digest('hex').toUpperCase();
      fingerprints.push({ sha256 });
    } catch {
      fingerprints.push({});
    }

    cursor += certLen;
  }

  return {
    count: fingerprints.length,
    fingerprints,
    rawLengths,
  };
}
