/**
 * DNS message dissection (RFC 1035 + RFC 3596 AAAA + RFC 6891 EDNS(0)).
 *
 * Decoding is delegated to the `dns-packet` package (the DNS-over-HTTPS
 * ecosystem's reference decoder); a lightweight offset scanner keeps the
 * reverse-engineering extras `dns-packet` doesn't expose: raw `rdataHex` and
 * `rdlength` for every record, including known types.
 *
 * Failure mode: `dns-packet` decodes atomically — malformed input throws and
 * no partial records survive. We catch that and surface it as a warning
 * (all-or-nothing), replacing the previous per-record fail-soft walker.
 */

import * as dnsPacket from 'dns-packet';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DnsQuestion {
  name: string;
  qtype: number;
  qtypeMnemonic: string;
  qclass: number;
  qclassMnemonic: string;
}

export interface DnsResourceRecord {
  name: string;
  type: number;
  typeMnemonic: string;
  class: number;
  classMnemonic: string;
  ttl: number;
  rdlength: number;
  rdataHex: string;
  /** Decoded RDATA for common types; null for unsupported types. */
  decoded?: Record<string, unknown> | null;
}

export interface DnsHeader {
  id: number;
  flags: number;
  qr: 0 | 1;
  opcode: number;
  opcodeMnemonic: string;
  authoritativeAnswer: boolean;
  truncation: boolean;
  recursionDesired: boolean;
  recursionAvailable: boolean;
  z: number;
  authenticData: boolean;
  checkingDisabled: boolean;
  rcode: number;
  rcodeMnemonic: string;
}

export interface DnsMessage {
  byteLength: number;
  header: DnsHeader;
  questionCount: number;
  answerCount: number;
  authorityCount: number;
  additionalCount: number;
  questions: DnsQuestion[];
  answers: DnsResourceRecord[];
  authorities: DnsResourceRecord[];
  additionals: DnsResourceRecord[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Mnemonic tables
// ---------------------------------------------------------------------------

const TYPE_TABLE: Record<number, string> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  41: 'OPT',
  46: 'RRSIG',
  48: 'DNSKEY',
  257: 'CAA',
};

const CLASS_TABLE: Record<number, string> = {
  1: 'IN',
  3: 'CH',
  4: 'HS',
  254: 'NONE',
  255: 'ANY',
};

const OPCODE_MNEMONIC: Record<number, string> = {
  0: 'QUERY',
  1: 'IQUERY',
  2: 'STATUS',
  4: 'NOTIFY',
  5: 'UPDATE',
};

const RCODE_TABLE: Record<number, string> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
  6: 'YXDOMAIN',
};

function mnemonicOf(table: Record<number, string>, value: number): string {
  return table[value] ?? `TYPE${value}`;
}

function classMnemonic(value: number): string {
  return CLASS_TABLE[value] ?? `CLASS${value}`;
}

/** Map `dns-packet`'s `UNKNOWN_65` label to the project's `TYPE65` mnemonic. */
function typeMnemonicOf(typeStr: string): string {
  const match = /^UNKNOWN_(\d+)$/.exec(typeStr);
  if (match) return `TYPE${match[1]}`;
  return typeStr;
}

// ---------------------------------------------------------------------------
// Offset scanner (rdataHex / rdlength — the bits dns-packet doesn't expose)
// ---------------------------------------------------------------------------

const POINTER_BASE = 0x3fff;

interface RdataSlice {
  /** Numeric record type read straight off the wire (never 0 for real records). */
  type: number;
  /** Numeric class read straight off the wire (OPT carries udpPayloadSize here). */
  class: number;
  rdlength: number;
  rdataHex: string;
}

/** Domain-name walker with compression-pointer support (mirrors RFC 1035 §4.1.4). */
function readName(
  buffer: Buffer,
  offset: number,
  warnings: string[],
  maxPointerDepth: number,
): { name: string; nextOffset: number } {
  const labels: string[] = [];
  let cursor = offset;
  let jumps = 0;
  let nextOffset: number | null = null;

  while (cursor < buffer.length) {
    const lengthOrPointer = buffer[cursor]!;
    if (lengthOrPointer === 0) {
      cursor += 1;
      if (nextOffset === null) nextOffset = cursor;
      break;
    }
    if ((lengthOrPointer & 0xc0) === 0xc0) {
      if (cursor + 2 > buffer.length) {
        throw new Error('compression pointer truncated');
      }
      const pointer = buffer.readUInt16BE(cursor) & POINTER_BASE;
      if (pointer >= buffer.length) {
        throw new Error('compression pointer out of bounds');
      }
      if (nextOffset === null) nextOffset = cursor + 2;
      cursor = pointer;
      jumps += 1;
      if (jumps > maxPointerDepth) {
        warnings.push(`compression pointer depth exceeded ${maxPointerDepth}`);
        labels.push('<truncated>');
        break;
      }
      continue;
    }
    if ((lengthOrPointer & 0xc0) !== 0) {
      throw new Error(`invalid label length byte 0x${lengthOrPointer.toString(16)}`);
    }
    cursor += 1;
    if (cursor + lengthOrPointer > buffer.length) {
      throw new Error(`label of length ${lengthOrPointer} exceeds buffer`);
    }
    labels.push(buffer.subarray(cursor, cursor + lengthOrPointer).toString('ascii'));
    cursor += lengthOrPointer;
  }

  if (nextOffset === null) nextOffset = cursor;
  const name = labels.length === 0 ? '.' : labels.join('.');
  return { name, nextOffset };
}

/**
 * Walk the record sections and collect each record's raw RDATA. The walker
 * only needs record boundaries (name + 10-byte fixed header + rdlength), so
 * it stays ~40 lines instead of re-implementing full decoding.
 */
function scanRdataSlices(
  buffer: Buffer,
  count: number,
  startOffset: number,
  warnings: string[],
  maxPointerDepth: number,
): { slices: RdataSlice[]; nextOffset: number } {
  const slices: RdataSlice[] = [];
  let cursor = startOffset;
  for (let i = 0; i < count; i++) {
    const { nextOffset } = readName(buffer, cursor, warnings, maxPointerDepth);
    cursor = nextOffset;
    if (cursor + 10 > buffer.length) {
      throw new Error(`resource record ${i} truncated before TYPE/CLASS/TTL/RDLENGTH`);
    }
    // Numeric type/class come straight from the wire: `dns-packet` decodes every
    // record but only re-exposes mnemonic strings, so round-tripping through its
    // string labels would silently collapse ~45 known-but-unlisted types to 0.
    const type = buffer.readUInt16BE(cursor);
    const recordClass = buffer.readUInt16BE(cursor + 2);
    const rdlength = buffer.readUInt16BE(cursor + 8);
    cursor += 10;
    if (cursor + rdlength > buffer.length) {
      throw new Error(`resource record ${i} RDATA exceeds payload (rdlength=${rdlength})`);
    }
    slices.push({
      type,
      class: recordClass,
      rdlength,
      rdataHex: buffer.subarray(cursor, cursor + rdlength).toString('hex'),
    });
    cursor += rdlength;
  }
  return { slices, nextOffset: cursor };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface DnsParseOptions {
  /** Max recursion depth for compression pointers (default 10). */
  maxPointerDepth?: number;
  /** Maximum number of records per section before bailing (default 256). */
  maxRecordsPerSection?: number;
}

interface RawRecord {
  name?: string;
  type?: string;
  class?: string;
  ttl?: number;
  data?: unknown;
  flush?: boolean;
}

export function parseDnsMessage(payload: Buffer, options: DnsParseOptions = {}): DnsMessage {
  const warnings: string[] = [];
  const maxPointerDepth = options.maxPointerDepth ?? 10;
  const maxRecordsPerSection = options.maxRecordsPerSection ?? 256;

  // Short payloads are a hard error (not fail-soft): no records can be
  // recovered and callers need the structured failure.
  if (payload.length < 12) {
    throw new Error('DNS payload too short: header requires 12 bytes');
  }

  const id = payload.readUInt16BE(0);
  const flags = payload.readUInt16BE(2);
  const questionCount = payload.readUInt16BE(4);
  const answerCount = payload.readUInt16BE(6);
  const authorityCount = payload.readUInt16BE(8);
  const additionalCount = payload.readUInt16BE(10);

  const header: DnsHeader = {
    id,
    flags,
    qr: (((flags >>> 15) & 0x1) === 1 ? 1 : 0) as 0 | 1,
    opcode: (flags >>> 11) & 0xf,
    opcodeMnemonic: OPCODE_MNEMONIC[(flags >>> 11) & 0xf] ?? 'UNKNOWN',
    authoritativeAnswer: ((flags >>> 10) & 0x1) === 1,
    truncation: ((flags >>> 9) & 0x1) === 1,
    recursionDesired: ((flags >>> 8) & 0x1) === 1,
    recursionAvailable: ((flags >>> 7) & 0x1) === 1,
    z: (flags >>> 6) & 0x1,
    authenticData: ((flags >>> 5) & 0x1) === 1,
    checkingDisabled: ((flags >>> 4) & 0x1) === 1,
    rcode: flags & 0xf,
    rcodeMnemonic: RCODE_TABLE[flags & 0xf] ?? 'UNKNOWN',
  };

  const questions: DnsQuestion[] = [];
  const answers: DnsResourceRecord[] = [];
  const authorities: DnsResourceRecord[] = [];
  const additionals: DnsResourceRecord[] = [];

  try {
    const decoded = dnsPacket.decode(payload);

    // Questions come from the wire scanner too: numeric qtype/qclass must be
    // exact, and the scanner applies the `maxRecordsPerSection` cap.
    const scannedQuestions = scanQuestions(
      payload,
      Math.min(questionCount, maxRecordsPerSection),
      warnings,
      maxPointerDepth,
    );
    questions.push(...scannedQuestions.questions);

    // Record sections: zip dns-packet's decoded records with raw RDATA slices
    // from the offset scanner (preserves rdataHex/rdlength for known types).
    const answerSlices = scanRdataSlices(
      payload,
      Math.min(answerCount, maxRecordsPerSection),
      scannedQuestions.nextOffset,
      warnings,
      maxPointerDepth,
    );
    const authoritySlices = scanRdataSlices(
      payload,
      Math.min(authorityCount, maxRecordsPerSection),
      answerSlices.nextOffset,
      warnings,
      maxPointerDepth,
    );
    const additionalSlices = scanRdataSlices(
      payload,
      Math.min(additionalCount, maxRecordsPerSection),
      authoritySlices.nextOffset,
      warnings,
      maxPointerDepth,
    );

    zipRecords(decoded.answers ?? [], answerSlices.slices, answers);
    zipRecords(decoded.authorities ?? [], authoritySlices.slices, authorities);
    zipRecords(decoded.additionals ?? [], additionalSlices.slices, additionals);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'DNS decode failed');
  }

  return {
    byteLength: payload.length,
    header,
    questionCount,
    answerCount,
    authorityCount,
    additionalCount,
    questions,
    answers,
    authorities,
    additionals,
    warnings,
  };
}

function scanQuestions(
  buffer: Buffer,
  count: number,
  warnings: string[],
  maxPointerDepth: number,
): { questions: DnsQuestion[]; nextOffset: number } {
  const questions: DnsQuestion[] = [];
  let cursor = 12;
  for (let i = 0; i < count; i++) {
    const { name, nextOffset } = readName(buffer, cursor, warnings, maxPointerDepth);
    cursor = nextOffset;
    if (cursor + 4 > buffer.length) {
      throw new Error(`question ${i} truncated before QTYPE/QCLASS`);
    }
    // Numeric qtype/qclass straight off the wire — same rationale as the
    // record scanner: never round-trip through mnemonic strings.
    const qtype = buffer.readUInt16BE(cursor);
    const qclass = buffer.readUInt16BE(cursor + 2);
    cursor += 4;
    questions.push({
      name,
      qtype,
      qtypeMnemonic: mnemonicOf(TYPE_TABLE, qtype),
      qclass,
      qclassMnemonic: classMnemonic(qclass),
    });
  }
  return { questions, nextOffset: cursor };
}

/** Merge one decoded record with its raw slice, adding decoded RDATA fields. */
function zipRecords(rawRecords: RawRecord[], slices: RdataSlice[], out: DnsResourceRecord[]): void {
  // Cap semantics: the scanner walks at most `maxRecordsPerSection` records,
  // so truncate the decoded list to match (restores the legacy truncation
  // behaviour instead of fabricating rdlength: 0 for the overflow records).
  const capped = rawRecords.slice(0, slices.length);
  for (let i = 0; i < capped.length; i++) {
    const raw = capped[i]!;
    const slice = slices[i]!;
    const typeNum = slice.type;
    const record: DnsResourceRecord = {
      name: raw.name ?? '',
      type: typeNum,
      typeMnemonic: typeNum === 41 ? 'OPT' : typeMnemonicOf(raw.type ?? ''),
      class: slice.class,
      classMnemonic: classMnemonic(slice.class),
      ttl: raw.ttl ?? 0,
      rdlength: slice.rdlength,
      rdataHex: slice.rdataHex,
    };
    const decoded = decodeRecordData(raw, typeNum);
    if (decoded) {
      record.decoded = decoded;
    }
    out.push(record);
  }
}

/** Project `dns-packet`'s decoded `data` into the project's `decoded` shape. */
function decodeRecordData(raw: RawRecord, typeNum: number): Record<string, unknown> | null {
  const data = raw.data;
  switch (typeNum) {
    case 1: // A
      return typeof data === 'string' ? { address: data } : null;
    case 28: // AAAA
      return typeof data === 'string' ? { address: data } : null;
    case 5: // CNAME
    case 2: // NS
    case 12: // PTR
      return typeof data === 'string' ? { target: data } : null;
    case 15: // MX
      if (data && typeof data === 'object' && 'preference' in data) {
        const mx = data as unknown as { preference: number; exchange: string };
        return { preference: mx.preference, exchange: mx.exchange };
      }
      return null;
    case 16: // TXT — dns-packet yields Buffer[] (raw character-strings)
      return Array.isArray(data)
        ? { entries: data.map((entry) => Buffer.from(entry).toString('utf8')) }
        : null;
    case 33: // SRV
      if (data && typeof data === 'object' && 'port' in data) {
        const srv = data as unknown as {
          priority: number;
          weight: number;
          port: number;
          target: string;
        };
        return {
          priority: srv.priority,
          weight: srv.weight,
          port: srv.port,
          target: srv.target,
        };
      }
      return null;
    case 41: {
      // OPT (EDNS(0)) — dns-packet spreads these fields on the record itself,
      // not under `data`. Map back to the project's legacy decoded shape.
      const rawOpt = raw as unknown as {
        udpPayloadSize?: number;
        extendedRcode?: number;
        ednsVersion?: number;
        flags?: number;
        flag_do?: boolean;
      };
      if (rawOpt.udpPayloadSize === undefined) return null;
      return {
        udpPayloadSize: rawOpt.udpPayloadSize,
        extendedRcode: rawOpt.extendedRcode ?? 0,
        version: rawOpt.ednsVersion ?? 0,
        flags: rawOpt.flags ?? 0,
        dnssecOk: rawOpt.flag_do === true,
      };
    }
    default:
      return null;
  }
}
