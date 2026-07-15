/**
 * TLS ClientHello parser + JA3/JA4 fingerprint computation.
 *
 * Parses a raw TLS record (hex) containing a ClientHello handshake and extracts
 * the fields needed for JA3 (Salesforce) and JA4 (FoxIO/John Althouse) fingerprints.
 *
 * Spec references:
 *  - ClientHello structure: RFC 5246 §7.4.1.2, RFC 8446 §4.1.2 (TLS 1.3)
 *  - JA3: https://github.com/salesforce/ja3 (MD5 of "version,ciphers,exts,ecpf,ec")
 *  - JA4: https://github.com/FoxIO-LLC/ja4 (truncated sha256 segments, sorted, GREASE-stripped)
 *
 * This module is pure (no I/O, no browser). Lenient where reasonable: a truncated or
 * malformed record returns `{ valid: false, error }` instead of throwing, so analysis
 * pipelines can report the failure without losing the raw bytes upstream.
 */
import { createHash } from 'node:crypto';

import { computeTlsFingerprint } from './tls-fingerprint';
import { isGrease } from './fingerprint-utils';

export interface ParsedExtension {
  /** 4-char lowercase hex extension type, e.g. "0000" = server_name, "0010" = ALPN. */
  type: string;
  /** Raw extension value bytes as lowercase hex (without the 4-byte type+length header). */
  data: string;
}

export interface ParsedClientHello {
  /** Whether the record parsed successfully as a ClientHello. */
  valid: boolean;
  /** Present only when valid === false. */
  error?: string;
  /** 2-byte TLS record version, e.g. "0301". */
  recordVersion?: string;
  /** 2-byte ClientHello legacy_version field, e.g. "0303". */
  legacyVersion?: string;
  /** Cipher suites in wire order, 4-char lowercase hex, GREASE included. */
  ciphers?: string[];
  /** Extensions in wire order with their raw values. */
  extensions?: ParsedExtension[];
  /** Whether the server_name (SNI, 0x0000) extension is present. */
  hasSni?: boolean;
  /** ALPN protocol list from extension 0x0010, decoded as ASCII strings. */
  alpn?: string[];
  /** supported_versions (0x002b) raw 2-byte versions in wire order (empty if absent). */
  supportedVersions?: string[];
  /** Highest negotiated TLS version from supported_versions, or legacy_version as fallback. */
  negotiatedVersion?: string;
  /** Elliptic curves (supported_groups, 0x000a) in wire order — the JA3 "elliptic_curves" field. */
  ellipticCurves?: string[];
  /** EC point formats (0x000b) in wire order — the JA3 "ec_point_formats" field. */
  ecPointFormats?: string[];
  /** Signature algorithms (0x000d) in wire order. */
  signatureAlgorithms?: string[];
}

// Hex must be even-length and lowercase hex chars only (allow whitespace, stripped first).
function normalizeHex(raw: string): string {
  return raw.replace(/\s+/g, '').toLowerCase();
}

function readBytes(hex: string, offset: number, count: number): string | undefined {
  if (offset + count * 2 > hex.length) return undefined;
  return hex.slice(offset * 2, (offset + count) * 2);
}

function readUint8(hex: string, offset: number): number | undefined {
  const slice = readBytes(hex, offset, 1);
  if (slice === undefined) return undefined;
  return parseInt(slice, 16);
}

function readUint16Be(hex: string, offset: number): number | undefined {
  const slice = readBytes(hex, offset, 2);
  if (slice === undefined) return undefined;
  return parseInt(slice, 16);
}

function readUint24Be(hex: string, offset: number): number | undefined {
  const slice = readBytes(hex, offset, 3);
  if (slice === undefined) return undefined;
  return parseInt(slice, 16);
}

function parseListUint16(
  hex: string,
  offset: number,
): { values: string[]; nextOffset: number } | undefined {
  const listLen = readUint16Be(hex, offset);
  if (listLen === undefined) return undefined;
  const startByte = offset + 2;
  const endByte = startByte + listLen;
  if (endByte * 2 > hex.length) return undefined;
  const values: string[] = [];
  for (let b = startByte; b + 2 <= endByte; b += 2) {
    values.push(hex.slice(b * 2, (b + 2) * 2));
  }
  return { values, nextOffset: endByte };
}

/**
 * Parse a TLS record that is expected to contain a ClientHello handshake.
 * Returns a {@link ParsedClientHello}; on malformed input returns
 * `{ valid: false, error }` instead of throwing.
 */
export function parseClientHello(rawHex: string): ParsedClientHello {
  const hex = normalizeHex(rawHex);
  if (hex.length === 0) return { valid: false, error: 'empty input' };

  // ---- Record header (5 bytes): type(1) + version(2) + length(2) ----
  const recordType = readUint8(hex, 0);
  if (recordType !== 0x16) {
    return {
      valid: false,
      error: `not a TLS handshake record (type=0x${recordType?.toString(16) ?? '?'}, expected 0x16)`,
    };
  }
  const recordVersion = readBytes(hex, 1, 2);
  const recordLen = readUint16Be(hex, 3);
  if (recordVersion === undefined || recordLen === undefined) {
    return { valid: false, error: 'truncated record header' };
  }
  // The record body must contain at least recordLen bytes.
  if (5 * 2 + recordLen * 2 > hex.length) {
    return { valid: false, error: 'record length exceeds available bytes' };
  }

  // ---- Handshake header (4 bytes): type(1) + length(3) ----
  const hsType = readUint8(hex, 5);
  if (hsType !== 0x01) {
    return {
      valid: false,
      error: `not a ClientHello handshake (type=0x${hsType?.toString(16) ?? '?'}, expected 0x01)`,
    };
  }
  const hsLen = readUint24Be(hex, 6);
  if (hsLen === undefined) {
    return { valid: false, error: 'truncated handshake header' };
  }
  const hsBodyStart = 9; // byte offset
  if ((hsBodyStart + hsLen) * 2 > hex.length) {
    return { valid: false, error: 'handshake length exceeds available bytes' };
  }

  let off = hsBodyStart;

  // ---- legacy_version (2) ----
  const legacyVersion = readBytes(hex, off, 2);
  if (legacyVersion === undefined) return { valid: false, error: 'truncated legacy_version' };
  off += 2;

  // ---- random (32) ----
  if (off + 32 > hex.length / 2) return { valid: false, error: 'truncated random' };
  off += 32;

  // ---- session_id (1-byte length + bytes) ----
  const sessionIdLen = readUint8(hex, off);
  if (sessionIdLen === undefined) return { valid: false, error: 'truncated session_id length' };
  off += 1;
  if (off + sessionIdLen > hex.length / 2) return { valid: false, error: 'truncated session_id' };
  off += sessionIdLen;

  // ---- cipher_suites (2-byte length + 2-byte suites) ----
  const cipherList = parseListUint16(hex, off);
  if (cipherList === undefined) return { valid: false, error: 'truncated cipher_suites' };
  const ciphers = cipherList.values;
  off = cipherList.nextOffset;

  // ---- compression_methods (1-byte length + 1-byte methods) ----
  const compLen = readUint8(hex, off);
  if (compLen === undefined) return { valid: false, error: 'truncated compression_methods length' };
  off += 1;
  if (off + compLen > hex.length / 2)
    return { valid: false, error: 'truncated compression_methods' };
  off += compLen;

  // ---- extensions (2-byte total length + entries) [optional] ----
  const extensions: ParsedExtension[] = [];
  if (off + 2 <= hex.length / 2) {
    const extTotalLen = readUint16Be(hex, off);
    if (extTotalLen === undefined) return { valid: false, error: 'truncated extensions length' };
    off += 2;
    const extEnd = off + extTotalLen;
    if (extEnd > hex.length / 2)
      return { valid: false, error: 'extensions length exceeds available bytes' };
    while (off + 4 <= extEnd) {
      const extType = readBytes(hex, off, 2);
      const extLen = readUint16Be(hex, off + 2);
      if (extType === undefined || extLen === undefined) {
        return { valid: false, error: 'truncated extension header' };
      }
      off += 4;
      if (off + extLen > extEnd)
        return { valid: false, error: 'extension value exceeds extensions block' };
      const extData = readBytes(hex, off, extLen) ?? '';
      extensions.push({ type: extType, data: extData });
      off += extLen;
    }
  }

  return finalizeParsed({
    recordVersion,
    legacyVersion,
    ciphers,
    extensions,
  });
}

function finalizeParsed(base: {
  recordVersion: string;
  legacyVersion: string;
  ciphers: string[];
  extensions: ParsedExtension[];
}): ParsedClientHello {
  const hasExt = (type: string): ParsedExtension | undefined =>
    base.extensions.find((e) => e.type === type);

  // SNI presence
  const hasSni = base.extensions.some((e) => e.type === '0000');

  // ALPN (0x0010): 2-byte list length, then [1-byte proto_len + proto]*
  const alpn: string[] = [];
  const alpnExt = hasExt('0010');
  if (alpnExt) {
    const data = alpnExt.data;
    let o = 0;
    const listLen = readUint16Be(data, o);
    if (listLen !== undefined) {
      o += 2;
      const end = o + listLen;
      while (o + 1 <= end) {
        const pLen = readUint8(data, o);
        if (pLen === undefined) break;
        o += 1;
        const protoHex = data.slice(o * 2, (o + pLen) * 2);
        if (protoHex.length !== pLen * 2) break;
        alpn.push(Buffer.from(protoHex, 'hex').toString('ascii'));
        o += pLen;
      }
    }
  }

  // supported_versions (0x002b): 1-byte list length, then 2-byte versions*
  const supportedVersions: string[] = [];
  const svExt = hasExt('002b');
  if (svExt) {
    const data = svExt.data;
    let o = 0;
    const listLen = readUint8(data, o);
    if (listLen !== undefined) {
      o += 1;
      const end = o + listLen;
      while (o + 2 <= end) {
        supportedVersions.push(data.slice(o * 2, (o + 2) * 2));
        o += 2;
      }
    }
  }
  // Negotiated version: highest non-GREASE from supported_versions, else legacy
  const realVersions = supportedVersions.filter((v) => !isGrease(v) && v !== '0303');
  const negotiatedVersion =
    realVersions.length > 0 ? realVersions.toSorted().at(-1)! : base.legacyVersion;

  // supported_groups / elliptic_curves (0x000a): 2-byte list length + 2-byte groups*
  let ellipticCurves: string[] = [];
  const sgExt = hasExt('000a');
  if (sgExt) {
    const parsed = parseListUint16(sgExt.data, 0);
    if (parsed) ellipticCurves = parsed.values;
  }

  // ec_point_formats (0x000b): 1-byte length + 1-byte formats*
  const ecPointFormats: string[] = [];
  const epfExt = hasExt('000b');
  if (epfExt) {
    const data = epfExt.data;
    let o = 0;
    const listLen = readUint8(data, o);
    if (listLen !== undefined) {
      o += 1;
      const end = o + listLen;
      while (o < end) {
        ecPointFormats.push(data.slice(o * 2, (o + 1) * 2));
        o += 1;
      }
    }
  }

  // signature_algorithms (0x000d): 2-byte list length + 2-byte sigs*
  let signatureAlgorithms: string[] = [];
  const sigExt = hasExt('000d');
  if (sigExt) {
    const parsed = parseListUint16(sigExt.data, 0);
    if (parsed) signatureAlgorithms = parsed.values;
  }

  return {
    valid: true,
    recordVersion: base.recordVersion,
    legacyVersion: base.legacyVersion,
    ciphers: base.ciphers,
    extensions: base.extensions,
    hasSni,
    alpn,
    supportedVersions,
    negotiatedVersion,
    ellipticCurves,
    ecPointFormats,
    signatureAlgorithms,
  };
}

function stripGrease(values: string[] | undefined): string[] {
  return (values ?? []).filter((v) => !isGrease(v));
}

/**
 * Compute the JA3 fingerprint (Salesforce format) from a parsed ClientHello.
 *
 * Format: `TLSVersion,ciphers,extensions,ec_point_formats,elliptic_curves`
 *  - TLSVersion is the legacy client_version field (NOT supported_versions), per JA3 spec.
 *  - Each list is dash-joined 4-char lowercase hex, GREASE values removed entirely.
 *  - The returned `ja3` is the MD5 hex digest (32 chars); `ja3_raw` is the pre-hash string.
 *
 * Throws if the ClientHello failed to parse.
 */
export function computeJa3(parsed: ParsedClientHello): { ja3: string; ja3_raw: string } {
  if (!parsed.valid || !parsed.ciphers || !parsed.extensions) {
    throw new Error(`cannot compute JA3 from invalid ClientHello: ${parsed.error ?? 'unknown'}`);
  }
  const version = parsed.legacyVersion ?? '0303';
  const ciphers = stripGrease(parsed.ciphers).join('-');
  const extensions = stripGrease(parsed.extensions.map((e) => e.type)).join('-');
  const ecpf = stripGrease(parsed.ecPointFormats).join('-');
  const ec = stripGrease(parsed.ellipticCurves).join('-');
  const raw = `${version},${ciphers},${extensions},${ecpf},${ec}`;
  // CodeQL flags this as js/weak-cryptographic-algorithm (MD5 keyed by "sensitive" sessionId
  // data). Intentional and required by the JA3 specification (Salesforce format): JA3 is DEFINED
  // as the MD5 digest of the pre-hash string above. The MD5 output is a public, comparable
  // fingerprint, not a secrecy/integrity primitive — switching algorithms would produce a value
  // that matches no published JA3 dataset (ja3er, Censys, Shodan). The sessionId hop in the
  // alert is a false-positive taint edge: JA3's raw input never includes sessionId (only the
  // five fields above), so no sensitive data reaches this hash. Safe by design; dismissed.
  const ja3 = createHash('md5').update(raw).digest('hex');
  return { ja3, ja3_raw: raw };
}

/**
 * Compute the JA4 fingerprint (FoxIO/John Althouse format) from a parsed ClientHello.
 * Delegates the Part A/B/C assembly to {@link computeTlsFingerprint} using the parsed
 * wire fields — so JA4 here reflects the real ClientHello, not user-supplied lists.
 *
 * Version comes from supported_versions (TLS 1.3 → 0304) when present, else legacy.
 * Throws if the ClientHello failed to parse or has no real ciphers.
 */
export function computeJa4FromClientHello(parsed: ParsedClientHello): {
  ja4: string;
  ja4_raw: string;
} {
  if (!parsed.valid || !parsed.ciphers) {
    throw new Error(`cannot compute JA4 from invalid ClientHello: ${parsed.error ?? 'unknown'}`);
  }
  const ciphers = parsed.ciphers;
  const extensions = parsed.extensions?.map((e) => e.type) ?? [];
  const signatureAlgorithms = parsed.signatureAlgorithms ?? [];
  // ALPN: JA4 uses first/last char of the FIRST selected protocol (matches computeTlsFingerprint encoding).
  const alpn = parsed.alpn?.[0] ?? '';
  const { tls, tls_raw } = computeTlsFingerprint({
    protocol: 'tls',
    tlsVersion: parsed.negotiatedVersion ?? '0303',
    hasSni: parsed.hasSni ?? false,
    ciphers,
    extensions,
    signatureAlgorithms,
    alpn,
  });
  return { ja4: tls, ja4_raw: tls_raw };
}
