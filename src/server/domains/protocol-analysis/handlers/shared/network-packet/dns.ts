/**
 * DNS message parser (RFC 1035 + RFC 3596 AAAA + RFC 6891 EDNS(0)).
 *
 * Decodes a raw UDP/TCP DNS payload into structured fields with full RR
 * coverage, compression-pointer handling, and EDNS OPT pseudo-record support.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DnsRecordType =
  | 'A'
  | 'NS'
  | 'CNAME'
  | 'SOA'
  | 'PTR'
  | 'MX'
  | 'TXT'
  | 'AAAA'
  | 'SRV'
  | 'OPT'
  | 'RRSIG'
  | 'DNSKEY'
  | 'UNKNOWN';

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
// Mnemonic tables (subset)
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

const OPCODE_TABLE: Record<number, string> = {
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

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const POINTER_BASE = 0x3fff;

interface ParseContext {
  buffer: Buffer;
  warnings: string[];
  maxPointerDepth: number;
}

export interface DnsParseOptions {
  /** Max recursion depth for compression pointers (default 10). */
  maxPointerDepth?: number;
  /** Maximum number of records per section before bailing (default 256). */
  maxRecordsPerSection?: number;
}

export function parseDnsMessage(payload: Buffer, options: DnsParseOptions = {}): DnsMessage {
  const ctx: ParseContext = {
    buffer: payload,
    warnings: [],
    maxPointerDepth: options.maxPointerDepth ?? 10,
  };
  const maxRecordsPerSection = options.maxRecordsPerSection ?? 256;

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
    opcodeMnemonic: OPCODE_TABLE[(flags >>> 11) & 0xf] ?? 'UNKNOWN',
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

  let offset = 12;
  const questions: DnsQuestion[] = [];
  const answers: DnsResourceRecord[] = [];
  const authorities: DnsResourceRecord[] = [];
  const additionals: DnsResourceRecord[] = [];

  try {
    offset = readQuestions(ctx, offset, Math.min(questionCount, maxRecordsPerSection), questions);
    offset = readResourceRecords(ctx, offset, Math.min(answerCount, maxRecordsPerSection), answers);
    offset = readResourceRecords(
      ctx,
      offset,
      Math.min(authorityCount, maxRecordsPerSection),
      authorities,
    );
    offset = readResourceRecords(
      ctx,
      offset,
      Math.min(additionalCount, maxRecordsPerSection),
      additionals,
    );
  } catch (error) {
    ctx.warnings.push(error instanceof Error ? error.message : `parse error at offset ${offset}`);
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
    warnings: ctx.warnings,
  };
}

function readQuestions(
  ctx: ParseContext,
  offset: number,
  count: number,
  out: DnsQuestion[],
): number {
  let cursor = offset;
  for (let i = 0; i < count; i++) {
    const { name, nextOffset } = readName(ctx, cursor);
    cursor = nextOffset;
    if (cursor + 4 > ctx.buffer.length) {
      throw new Error(`question ${i} truncated before QTYPE/QCLASS`);
    }
    const qtype = ctx.buffer.readUInt16BE(cursor);
    const qclass = ctx.buffer.readUInt16BE(cursor + 2);
    cursor += 4;
    out.push({
      name,
      qtype,
      qtypeMnemonic: mnemonicOf(TYPE_TABLE, qtype),
      qclass,
      qclassMnemonic: classMnemonic(qclass),
    });
  }
  return cursor;
}

function readResourceRecords(
  ctx: ParseContext,
  offset: number,
  count: number,
  out: DnsResourceRecord[],
): number {
  let cursor = offset;
  for (let i = 0; i < count; i++) {
    const { name, nextOffset } = readName(ctx, cursor);
    cursor = nextOffset;
    if (cursor + 10 > ctx.buffer.length) {
      throw new Error(`resource record ${i} truncated before TYPE/CLASS/TTL/RDLENGTH`);
    }
    const type = ctx.buffer.readUInt16BE(cursor);
    const recordClass = ctx.buffer.readUInt16BE(cursor + 2);
    const ttl = ctx.buffer.readUInt32BE(cursor + 4);
    const rdlength = ctx.buffer.readUInt16BE(cursor + 8);
    cursor += 10;
    if (cursor + rdlength > ctx.buffer.length) {
      throw new Error(`resource record ${i} RDATA exceeds payload (rdlength=${rdlength})`);
    }
    const rdata = ctx.buffer.subarray(cursor, cursor + rdlength);
    cursor += rdlength;
    const record: DnsResourceRecord = {
      name,
      type,
      typeMnemonic: type === 41 ? 'OPT' : mnemonicOf(TYPE_TABLE, type),
      class: recordClass,
      classMnemonic: classMnemonic(recordClass),
      ttl,
      rdlength,
      rdataHex: rdata.toString('hex'),
    };
    const decoded = decodeRdata(ctx, type, cursor - rdlength, rdlength, recordClass, ttl);
    if (decoded) {
      record.decoded = decoded;
    }
    out.push(record);
  }
  return cursor;
}

/**
 * Read a domain name starting at `offset`, following compression pointers.
 * Returns the offset immediately after the first label run (not after any
 * pointed-to data) so the caller can continue parsing sequentially.
 */
function readName(ctx: ParseContext, offset: number): { name: string; nextOffset: number } {
  const labels: string[] = [];
  let cursor = offset;
  let jumps = 0;
  let nextOffset: number | null = null;

  while (cursor < ctx.buffer.length) {
    const lengthOrPointer = ctx.buffer[cursor]!;
    if (lengthOrPointer === 0) {
      cursor += 1;
      if (nextOffset === null) {
        nextOffset = cursor;
      }
      break;
    }
    if ((lengthOrPointer & 0xc0) === 0xc0) {
      if (cursor + 2 > ctx.buffer.length) {
        throw new Error('compression pointer truncated');
      }
      const pointer = ctx.buffer.readUInt16BE(cursor) & POINTER_BASE;
      if (nextOffset === null) {
        nextOffset = cursor + 2;
      }
      cursor = pointer;
      jumps += 1;
      if (jumps > ctx.maxPointerDepth) {
        ctx.warnings.push(`compression pointer depth exceeded ${ctx.maxPointerDepth}`);
        labels.push('<truncated>');
        break;
      }
      continue;
    }
    if ((lengthOrPointer & 0xc0) !== 0) {
      throw new Error(`invalid label length byte 0x${lengthOrPointer.toString(16)}`);
    }
    cursor += 1;
    if (cursor + lengthOrPointer > ctx.buffer.length) {
      throw new Error(`label of length ${lengthOrPointer} exceeds buffer`);
    }
    labels.push(ctx.buffer.subarray(cursor, cursor + lengthOrPointer).toString('ascii'));
    cursor += lengthOrPointer;
  }

  if (nextOffset === null) {
    nextOffset = cursor;
  }
  const name = labels.length === 0 ? '.' : labels.join('.');
  return { name, nextOffset };
}

function decodeRdata(
  ctx: ParseContext,
  type: number,
  rdataOffset: number,
  rdlength: number,
  recordClass: number,
  ttl: number,
): Record<string, unknown> | null {
  const buffer = ctx.buffer;
  switch (type) {
    case 1: // A
      if (rdlength >= 4) {
        const a = buffer[rdataOffset]!;
        const b = buffer[rdataOffset + 1]!;
        const c = buffer[rdataOffset + 2]!;
        const d = buffer[rdataOffset + 3]!;
        return { address: `${a}.${b}.${c}.${d}` };
      }
      return null;
    case 28: // AAAA
      if (rdlength >= 16) {
        const groups: string[] = [];
        for (let i = 0; i < 16; i += 2) {
          groups.push(
            ((buffer[rdataOffset + i]! << 8) | buffer[rdataOffset + i + 1]!)
              .toString(16)
              .replace(/^0+/u, '') || '0',
          );
        }
        return { address: groups.join(':') };
      }
      return null;
    case 5: // CNAME
    case 2: // NS
    case 12: {
      // PTR
      const { name } = readName(ctx, rdataOffset);
      return { target: name };
    }
    case 15: {
      // MX
      if (rdlength < 3) return null;
      const preference = buffer.readUInt16BE(rdataOffset);
      const { name } = readName(ctx, rdataOffset + 2);
      return { preference, exchange: name };
    }
    case 16: {
      // TXT
      const entries: string[] = [];
      let cursor = rdataOffset;
      const end = rdataOffset + rdlength;
      while (cursor < end) {
        const len = buffer[cursor]!;
        cursor += 1;
        if (cursor + len > end) break;
        entries.push(buffer.subarray(cursor, cursor + len).toString('utf8'));
        cursor += len;
      }
      return { entries };
    }
    case 33: {
      // SRV
      if (rdlength < 7) return null;
      const priority = buffer.readUInt16BE(rdataOffset);
      const weight = buffer.readUInt16BE(rdataOffset + 2);
      const port = buffer.readUInt16BE(rdataOffset + 4);
      const { name } = readName(ctx, rdataOffset + 6);
      return { priority, weight, port, target: name };
    }
    case 41: {
      // OPT (EDNS(0))
      // For OPT the class field is the requestor's UDP payload size and the
      // TTL field carries extended RCODE + flags.
      const extendedRcode = (ttl >>> 24) & 0xff;
      const version = (ttl >>> 16) & 0xff;
      const flags = ttl & 0xffff;
      const doBit = (flags >>> 15) & 0x1;
      return {
        udpPayloadSize: recordClass,
        extendedRcode,
        version,
        flags,
        dnssecOk: doBit === 1,
      };
    }
    default:
      return null;
  }
}
