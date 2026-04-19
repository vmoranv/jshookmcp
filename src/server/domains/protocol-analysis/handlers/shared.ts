export { readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import type {
  EncryptionInfo,
  FieldSpec,
  PatternSpec,
  ProtocolField,
  ProtocolMessage,
} from '@modules/protocol-analysis';
import type { EventBus, ServerEventMap } from '@server/EventBus';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseFieldSpec(value: unknown, index: number): FieldSpec {
  if (!isRecord(value)) {
    throw new Error(`fields[${index}] must be an object`);
  }

  const name = value.name;
  const offset = value.offset;
  const length = value.length;
  const type = value.type;

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(`fields[${index}].name must be a non-empty string`);
  }

  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw new Error(`fields[${index}].offset must be a non-negative integer`);
  }

  if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
    throw new Error(`fields[${index}].length must be a positive integer`);
  }

  if (
    type !== 'int' &&
    type !== 'string' &&
    type !== 'bytes' &&
    type !== 'bool' &&
    type !== 'float'
  ) {
    throw new Error(`fields[${index}].type is invalid`);
  }

  return { name, offset, length, type };
}

export function parseLegacyField(value: unknown, index: number): ProtocolField {
  if (!isRecord(value)) {
    throw new Error(`fields[${index}] must be an object`);
  }

  const name = value.name;
  const offset = value.offset;
  const length = value.length;
  const type = value.type;
  const description = value.description;

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(`fields[${index}].name must be a non-empty string`);
  }

  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw new Error(`fields[${index}].offset must be a non-negative integer`);
  }

  if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
    throw new Error(`fields[${index}].length must be a positive integer`);
  }

  if (
    type !== 'uint8' &&
    type !== 'uint16' &&
    type !== 'uint32' &&
    type !== 'int64' &&
    type !== 'float' &&
    type !== 'string' &&
    type !== 'bytes'
  ) {
    throw new Error(`fields[${index}].type is invalid`);
  }

  return {
    name,
    offset,
    length,
    type,
    ...(typeof description === 'string' ? { description } : {}),
  };
}

export function parsePatternSpec(name: string, value: Record<string, unknown>): PatternSpec {
  const rawFields = value.fields;
  if (!Array.isArray(rawFields)) {
    throw new Error('spec.fields must be an array');
  }

  const fieldDelimiter =
    typeof value.fieldDelimiter === 'string' && value.fieldDelimiter.length > 0
      ? value.fieldDelimiter
      : undefined;
  const byteOrderValue = value.byteOrder;
  const byteOrder = byteOrderValue === 'le' || byteOrderValue === 'be' ? byteOrderValue : undefined;

  return {
    name,
    ...(fieldDelimiter ? { fieldDelimiter } : {}),
    ...(byteOrder ? { byteOrder } : {}),
    fields: rawFields.map((field, index) => parseFieldSpec(field, index)),
  };
}

export function parseEncryptionInfo(value: unknown): EncryptionInfo | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const type = value.type;
  if (type !== 'aes' && type !== 'xor' && type !== 'rc4' && type !== 'custom') {
    return undefined;
  }

  const key = typeof value.key === 'string' ? value.key : undefined;
  const iv = typeof value.iv === 'string' ? value.iv : undefined;
  const notes = typeof value.notes === 'string' ? value.notes : undefined;

  return {
    type,
    ...(key ? { key } : {}),
    ...(iv ? { iv } : {}),
    ...(notes ? { notes } : {}),
  };
}

export function parseProtocolMessage(value: unknown, index: number): ProtocolMessage {
  if (!isRecord(value)) {
    throw new Error(`messages[${index}] must be an object`);
  }

  const direction = value.direction;
  const timestamp = value.timestamp;
  const fields = value.fields;
  const raw = value.raw;

  if (direction !== 'req' && direction !== 'res') {
    throw new Error(`messages[${index}].direction must be "req" or "res"`);
  }

  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    throw new Error(`messages[${index}].timestamp must be a number`);
  }

  if (!isRecord(fields)) {
    throw new Error(`messages[${index}].fields must be an object`);
  }

  if (typeof raw !== 'string') {
    throw new Error(`messages[${index}].raw must be a string`);
  }

  return { direction, timestamp, fields, raw };
}

export type PayloadEndian = 'big' | 'little';
export type PayloadDataEncoding = 'utf8' | 'ascii' | 'hex' | 'base64';
export type PayloadFieldType = 'u8' | 'u16' | 'u32' | 'i8' | 'i16' | 'i32' | 'string' | 'bytes';
export type PayloadMutationStrategy =
  | 'set_byte'
  | 'flip_bit'
  | 'overwrite_bytes'
  | 'append_bytes'
  | 'truncate'
  | 'increment_integer';

export type PayloadTemplateField =
  | {
      name: string;
      type: 'u8' | 'u16' | 'u32' | 'i8' | 'i16' | 'i32';
      value: number;
    }
  | {
      name: string;
      type: 'string';
      value: string;
      encoding: 'utf8' | 'ascii';
      length?: number;
      padByte: number;
    }
  | {
      name: string;
      type: 'bytes';
      value: string;
      encoding: PayloadDataEncoding;
      length?: number;
      padByte: number;
    };

export type PayloadMutation =
  | {
      strategy: 'set_byte';
      offset: number;
      value: number;
    }
  | {
      strategy: 'flip_bit';
      offset: number;
      bit: number;
    }
  | {
      strategy: 'overwrite_bytes';
      offset: number;
      data: Buffer;
    }
  | {
      strategy: 'append_bytes';
      data: Buffer;
    }
  | {
      strategy: 'truncate';
      length: number;
    }
  | {
      strategy: 'increment_integer';
      offset: number;
      width: 1 | 2 | 4;
      delta: number;
      endian: PayloadEndian;
      signed: boolean;
    };

export type PayloadFieldSegment = {
  name: string;
  offset: number;
  length: number;
  hex: string;
};

export type PayloadMutationSummary = {
  index: number;
  strategy: PayloadMutationStrategy;
  detail: string;
};

export type ParsedMacAddress = {
  canonical: string;
  bytes: Buffer;
};

export type ChecksumEndian = 'big' | 'little';
export type PacketEndianness = 'little' | 'big';
export type PacketTimestampPrecision = 'micro' | 'nano';

export type PcapPacketInput = {
  data: Buffer;
  timestampSeconds: number;
  timestampFraction: number;
  originalLength: number;
};

export type PcapHeader = {
  endianness: PacketEndianness;
  timestampPrecision: PacketTimestampPrecision;
  versionMajor: number;
  versionMinor: number;
  snapLength: number;
  linkType: number;
};

export type PcapPacketSummary = {
  index: number;
  timestampSeconds: number;
  timestampFraction: number;
  includedLength: number;
  originalLength: number;
  dataHex: string;
  truncated: boolean;
};

export type ProtocolAtomicEvent =
  | 'protocol:payload_built'
  | 'protocol:payload_mutated'
  | 'protocol:ethernet_frame_built'
  | 'protocol:arp_built'
  | 'protocol:ip_packet_built'
  | 'protocol:icmp_echo_built'
  | 'protocol:checksum_applied'
  | 'protocol:pcap_written'
  | 'protocol:pcap_read';

export type ProtocolAtomicEventPayload<K extends ProtocolAtomicEvent> = Omit<
  ServerEventMap[K],
  'timestamp'
>;

export const TEXT_ENCODINGS = ['utf8', 'ascii'] as const;
export const BINARY_ENCODINGS = ['utf8', 'ascii', 'hex', 'base64'] as const;
export const PAYLOAD_FIELD_TYPES = [
  'u8',
  'u16',
  'u32',
  'i8',
  'i16',
  'i32',
  'string',
  'bytes',
] as const;
export const MUTATION_STRATEGIES = [
  'set_byte',
  'flip_bit',
  'overwrite_bytes',
  'append_bytes',
  'truncate',
  'increment_integer',
] as const;
export const ETHER_TYPE_MAP = Object.freeze({
  arp: 0x0806,
  ipv4: 0x0800,
  ipv6: 0x86dd,
  vlan: 0x8100,
});
export const IP_PROTOCOL_MAP = Object.freeze({
  icmp: 1,
  igmp: 2,
  tcp: 6,
  udp: 17,
  gre: 47,
  esp: 50,
  ah: 51,
  icmpv6: 58,
  ospf: 89,
});
export const PCAP_LINK_TYPE_MAP = Object.freeze({
  loopback: 0,
  ethernet: 1,
  raw: 101,
});

export function parseEndian(value: unknown, fallback: PayloadEndian = 'big'): PayloadEndian {
  return value === 'little' ? 'little' : fallback;
}

export function parseNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }

  return value;
}

export function parsePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return value;
}

export function parseInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }

  return value;
}

export function parseByte(value: unknown, label: string): number {
  const parsed = parseInteger(value, label);
  if (parsed < 0 || parsed > 0xff) {
    throw new Error(`${label} must be between 0 and 255`);
  }

  return parsed;
}

export function parseOptionalLength(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : parsePositiveInteger(value, label);
}

export function parseEncoding<TEncoding extends string>(
  value: unknown,
  allowed: readonly TEncoding[],
  fallback: TEncoding,
  label: string,
): TEncoding {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== 'string' || !allowed.includes(value as TEncoding)) {
    throw new Error(`${label} is invalid`);
  }

  return value as TEncoding;
}

export function normalizeHexString(value: string, label: string): string {
  const normalized = value.replace(/^0x/i, '').replace(/\s+/g, '');
  if (normalized.length === 0) {
    return normalized;
  }

  if (normalized.length % 2 !== 0 || /[^0-9a-f]/i.test(normalized)) {
    throw new Error(`${label} must be a valid even-length hex string`);
  }

  return normalized.toLowerCase();
}

export function decodeBinaryValue(
  value: string,
  encoding: PayloadDataEncoding,
  label: string,
): Buffer {
  switch (encoding) {
    case 'utf8':
    case 'ascii':
      return Buffer.from(value, encoding);
    case 'hex':
      return Buffer.from(normalizeHexString(value, label), 'hex');
    case 'base64':
      return Buffer.from(value, 'base64');
  }
}

export function getNumericRange(width: 1 | 2 | 4, signed: boolean): { min: number; max: number } {
  const bits = width * 8;
  if (signed) {
    return {
      min: -(2 ** (bits - 1)),
      max: 2 ** (bits - 1) - 1,
    };
  }

  return {
    min: 0,
    max: 2 ** bits - 1,
  };
}

export function getFieldNumericMetadata(type: PayloadFieldType): {
  width: 1 | 2 | 4;
  signed: boolean;
} | null {
  switch (type) {
    case 'u8':
      return { width: 1, signed: false };
    case 'u16':
      return { width: 2, signed: false };
    case 'u32':
      return { width: 4, signed: false };
    case 'i8':
      return { width: 1, signed: true };
    case 'i16':
      return { width: 2, signed: true };
    case 'i32':
      return { width: 4, signed: true };
    default:
      return null;
  }
}

export function writeIntegerToBuffer(
  buffer: Buffer,
  value: number,
  width: 1 | 2 | 4,
  signed: boolean,
  endian: PayloadEndian,
): void {
  if (signed) {
    switch (width) {
      case 1:
        buffer.writeInt8(value, 0);
        return;
      case 2:
        if (endian === 'little') {
          buffer.writeInt16LE(value, 0);
        } else {
          buffer.writeInt16BE(value, 0);
        }
        return;
      case 4:
        if (endian === 'little') {
          buffer.writeInt32LE(value, 0);
        } else {
          buffer.writeInt32BE(value, 0);
        }
        return;
    }
  }

  switch (width) {
    case 1:
      buffer.writeUInt8(value, 0);
      return;
    case 2:
      if (endian === 'little') {
        buffer.writeUInt16LE(value, 0);
      } else {
        buffer.writeUInt16BE(value, 0);
      }
      return;
    case 4:
      if (endian === 'little') {
        buffer.writeUInt32LE(value, 0);
      } else {
        buffer.writeUInt32BE(value, 0);
      }
      return;
  }
}

export function readIntegerFromBuffer(
  buffer: Buffer,
  offset: number,
  width: 1 | 2 | 4,
  signed: boolean,
  endian: PayloadEndian,
): number {
  if (signed) {
    switch (width) {
      case 1:
        return buffer.readInt8(offset);
      case 2:
        return endian === 'little' ? buffer.readInt16LE(offset) : buffer.readInt16BE(offset);
      case 4:
        return endian === 'little' ? buffer.readInt32LE(offset) : buffer.readInt32BE(offset);
    }
  }

  switch (width) {
    case 1:
      return buffer.readUInt8(offset);
    case 2:
      return endian === 'little' ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
    case 4:
      return endian === 'little' ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  }
}

export function applyFixedLength(
  encoded: Buffer,
  length: number | undefined,
  padByte: number,
): Buffer {
  if (length === undefined || encoded.length === length) {
    return encoded;
  }

  if (encoded.length > length) {
    return encoded.subarray(0, length);
  }

  return Buffer.concat([encoded, Buffer.alloc(length - encoded.length, padByte)]);
}

export function parsePayloadTemplateField(value: unknown, index: number): PayloadTemplateField {
  if (!isRecord(value)) {
    throw new Error(`fields[${index}] must be an object`);
  }

  const name = value.name;
  const type = value.type;
  const rawValue = value.value;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(`fields[${index}].name must be a non-empty string`);
  }

  if (typeof type !== 'string' || !PAYLOAD_FIELD_TYPES.includes(type as PayloadFieldType)) {
    throw new Error(`fields[${index}].type is invalid`);
  }

  const fieldType = type as PayloadFieldType;
  const numericMetadata = getFieldNumericMetadata(fieldType);
  if (numericMetadata) {
    const numericValue = parseInteger(rawValue, `fields[${index}].value`);
    const range = getNumericRange(numericMetadata.width, numericMetadata.signed);
    if (numericValue < range.min || numericValue > range.max) {
      throw new Error(
        `fields[${index}].value is out of range for ${type} (${range.min}..${range.max})`,
      );
    }

    if (value.length !== undefined || value.padByte !== undefined || value.encoding !== undefined) {
      throw new Error(`fields[${index}] does not support length, padByte, or encoding`);
    }

    return {
      name,
      type: fieldType as 'u8' | 'u16' | 'u32' | 'i8' | 'i16' | 'i32',
      value: numericValue,
    };
  }

  if (typeof rawValue !== 'string') {
    throw new Error(`fields[${index}].value must be a string`);
  }

  const length = parseOptionalLength(value.length, `fields[${index}].length`);
  const padByte =
    value.padByte === undefined ? 0 : parseByte(value.padByte, `fields[${index}].padByte`);

  if (type === 'string') {
    const encoding = parseEncoding(
      value.encoding,
      TEXT_ENCODINGS,
      'utf8',
      `fields[${index}].encoding`,
    );
    return {
      name,
      type: 'string',
      value: rawValue,
      encoding,
      ...(length !== undefined ? { length } : {}),
      padByte,
    };
  }

  const encoding = parseEncoding(
    value.encoding,
    BINARY_ENCODINGS,
    'hex',
    `fields[${index}].encoding`,
  );
  return {
    name,
    type: 'bytes',
    value: rawValue,
    encoding,
    ...(length !== undefined ? { length } : {}),
    padByte,
  };
}

export function encodePayloadTemplateField(
  field: PayloadTemplateField,
  endian: PayloadEndian,
): Buffer {
  switch (field.type) {
    case 'u8':
    case 'u16':
    case 'u32':
    case 'i8':
    case 'i16':
    case 'i32': {
      const numericMetadata = getFieldNumericMetadata(field.type);
      if (!numericMetadata) {
        throw new Error(`Unsupported numeric field type: ${field.type}`);
      }

      const buffer = Buffer.alloc(numericMetadata.width);
      writeIntegerToBuffer(
        buffer,
        field.value,
        numericMetadata.width,
        numericMetadata.signed,
        endian,
      );
      return buffer;
    }
    case 'string': {
      const encoded = Buffer.from(field.value, field.encoding);
      return applyFixedLength(encoded, field.length, field.padByte);
    }
    case 'bytes': {
      const encoded = decodeBinaryValue(field.value, field.encoding, `field ${field.name}`);
      return applyFixedLength(encoded, field.length, field.padByte);
    }
  }
}

export function buildPayloadFromTemplate(
  fields: PayloadTemplateField[],
  endian: PayloadEndian,
): { payload: Buffer; segments: PayloadFieldSegment[] } {
  const buffers: Buffer[] = [];
  const segments: PayloadFieldSegment[] = [];
  let offset = 0;

  for (const field of fields) {
    const encoded = encodePayloadTemplateField(field, endian);
    buffers.push(encoded);
    segments.push({
      name: field.name,
      offset,
      length: encoded.length,
      hex: encoded.toString('hex'),
    });
    offset += encoded.length;
  }

  return {
    payload: Buffer.concat(buffers),
    segments,
  };
}

export function parsePayloadMutation(value: unknown, index: number): PayloadMutation {
  if (!isRecord(value)) {
    throw new Error(`mutations[${index}] must be an object`);
  }

  const strategy = value.strategy;
  if (
    typeof strategy !== 'string' ||
    !MUTATION_STRATEGIES.includes(strategy as PayloadMutationStrategy)
  ) {
    throw new Error(`mutations[${index}].strategy is invalid`);
  }

  switch (strategy as PayloadMutationStrategy) {
    case 'set_byte':
      return {
        strategy: 'set_byte',
        offset: parseNonNegativeInteger(value.offset, `mutations[${index}].offset`),
        value: parseByte(value.value, `mutations[${index}].value`),
      };
    case 'flip_bit':
      return {
        strategy: 'flip_bit',
        offset: parseNonNegativeInteger(value.offset, `mutations[${index}].offset`),
        bit: (() => {
          const bit = parseInteger(value.bit, `mutations[${index}].bit`);
          if (bit < 0 || bit > 7) {
            throw new Error(`mutations[${index}].bit must be between 0 and 7`);
          }
          return bit;
        })(),
      };
    case 'overwrite_bytes':
      return {
        strategy: 'overwrite_bytes',
        offset: parseNonNegativeInteger(value.offset, `mutations[${index}].offset`),
        data: decodeBinaryValue(
          typeof value.data === 'string'
            ? value.data
            : (() => {
                throw new Error(`mutations[${index}].data must be a string`);
              })(),
          parseEncoding(value.encoding, BINARY_ENCODINGS, 'hex', `mutations[${index}].encoding`),
          `mutations[${index}].data`,
        ),
      };
    case 'append_bytes':
      return {
        strategy: 'append_bytes',
        data: decodeBinaryValue(
          typeof value.data === 'string'
            ? value.data
            : (() => {
                throw new Error(`mutations[${index}].data must be a string`);
              })(),
          parseEncoding(value.encoding, BINARY_ENCODINGS, 'hex', `mutations[${index}].encoding`),
          `mutations[${index}].data`,
        ),
      };
    case 'truncate':
      return {
        strategy: 'truncate',
        length: parseNonNegativeInteger(value.length, `mutations[${index}].length`),
      };
    case 'increment_integer': {
      const width = value.width;
      if (width !== 1 && width !== 2 && width !== 4) {
        throw new Error(`mutations[${index}].width must be 1, 2, or 4`);
      }

      return {
        strategy: 'increment_integer',
        offset: parseNonNegativeInteger(value.offset, `mutations[${index}].offset`),
        width,
        delta: parseInteger(value.delta, `mutations[${index}].delta`),
        endian: parseEndian(value.endian),
        signed: value.signed === true,
      };
    }
  }
}

export function applyPayloadMutation(
  payload: Buffer,
  mutation: PayloadMutation,
  index: number,
): { payload: Buffer; summary: PayloadMutationSummary } {
  const working = Buffer.from(payload);
  switch (mutation.strategy) {
    case 'set_byte':
      if (mutation.offset >= working.length) {
        throw new Error(`mutations[${index}] offset is outside the payload`);
      }
      working[mutation.offset] = mutation.value;
      return {
        payload: working,
        summary: {
          index,
          strategy: mutation.strategy,
          detail: `set payload[${mutation.offset}] to ${mutation.value}`,
        },
      };
    case 'flip_bit':
      if (mutation.offset >= working.length) {
        throw new Error(`mutations[${index}] offset is outside the payload`);
      }
      {
        const currentByte = working.at(mutation.offset);
        if (currentByte === undefined) {
          throw new Error(`mutations[${index}] offset is outside the payload`);
        }
        working[mutation.offset] = currentByte ^ (1 << mutation.bit);
      }
      return {
        payload: working,
        summary: {
          index,
          strategy: mutation.strategy,
          detail: `flipped bit ${mutation.bit} at offset ${mutation.offset}`,
        },
      };
    case 'overwrite_bytes':
      if (mutation.offset + mutation.data.length > working.length) {
        throw new Error(`mutations[${index}] overwrite exceeds payload length`);
      }
      mutation.data.copy(working, mutation.offset);
      return {
        payload: working,
        summary: {
          index,
          strategy: mutation.strategy,
          detail: `overwrote ${mutation.data.length} bytes at offset ${mutation.offset}`,
        },
      };
    case 'append_bytes':
      return {
        payload: Buffer.concat([working, mutation.data]),
        summary: {
          index,
          strategy: mutation.strategy,
          detail: `appended ${mutation.data.length} bytes`,
        },
      };
    case 'truncate':
      if (mutation.length > working.length) {
        throw new Error(`mutations[${index}] length exceeds payload size`);
      }
      return {
        payload: working.subarray(0, mutation.length),
        summary: {
          index,
          strategy: mutation.strategy,
          detail: `truncated payload to ${mutation.length} bytes`,
        },
      };
    case 'increment_integer': {
      if (mutation.offset + mutation.width > working.length) {
        throw new Error(`mutations[${index}] integer range exceeds payload length`);
      }
      const current = readIntegerFromBuffer(
        working,
        mutation.offset,
        mutation.width,
        mutation.signed,
        mutation.endian,
      );
      const next = current + mutation.delta;
      const range = getNumericRange(mutation.width, mutation.signed);
      if (next < range.min || next > range.max) {
        throw new Error(`mutations[${index}] integer overflow (${range.min}..${range.max})`);
      }
      const slice = working.subarray(mutation.offset, mutation.offset + mutation.width);
      writeIntegerToBuffer(slice, next, mutation.width, mutation.signed, mutation.endian);
      return {
        payload: working,
        summary: {
          index,
          strategy: mutation.strategy,
          detail: `incremented ${mutation.signed ? 'signed' : 'unsigned'} ${mutation.width}-byte integer at offset ${mutation.offset} by ${mutation.delta}`,
        },
      };
    }
  }
}

export function parseMacAddress(value: unknown, label: string): ParsedMacAddress {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty MAC address string`);
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^0x/, '')
    .replace(/[:\-.\s]/g, '');
  if (!/^[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(`${label} must be a valid 6-byte MAC address`);
  }

  const canonical = normalized.match(/.{2}/g)?.join(':');
  if (!canonical) {
    throw new Error(`${label} must be a valid 6-byte MAC address`);
  }

  return {
    canonical,
    bytes: Buffer.from(normalized, 'hex'),
  };
}

export function parseNamedOrNumericValue(
  value: unknown,
  label: string,
  map: Readonly<Record<string, number>>,
  max: number,
): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw new Error(`${label} must be an integer between 0 and ${max}`);
    }
    return value;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string or integer`);
  }

  const normalized = value.trim().toLowerCase();
  const mapped = map[normalized];
  if (mapped !== undefined) {
    return mapped;
  }

  if (/^\d+$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10);
    if (parsed > max) {
      throw new Error(`${label} must be less than or equal to ${max}`);
    }
    return parsed;
  }

  const hex = normalizeHexString(normalized, label);
  const parsed = Number.parseInt(hex, 16);
  if (parsed > max) {
    throw new Error(`${label} must be less than or equal to ${max}`);
  }
  return parsed;
}

export function parseIpv4Address(value: unknown, label: string): Buffer {
  if (typeof value !== 'string' || isIP(value.trim()) !== 4) {
    throw new Error(`${label} must be a valid IPv4 address`);
  }

  const octets = value
    .trim()
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  return Buffer.from(octets);
}

export function parseIpv6Groups(value: string, label: string): string[] {
  if (value.length === 0) {
    return [];
  }

  return value.split(':').flatMap((part) => {
    if (part.length === 0) {
      return [];
    }
    if (part.includes('.')) {
      const ipv4 = parseIpv4Address(part, label);
      return [ipv4.readUInt16BE(0).toString(16), ipv4.readUInt16BE(2).toString(16)];
    }
    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      throw new Error(`${label} contains an invalid IPv6 group`);
    }
    return [part];
  });
}

export function parseIpv6Address(value: unknown, label: string): Buffer {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a valid IPv6 address`);
  }

  const normalized = value.trim().toLowerCase().split('%')[0] ?? '';
  if (isIP(normalized) !== 6) {
    throw new Error(`${label} must be a valid IPv6 address`);
  }

  const segments = normalized.split('::');
  if (segments.length > 2) {
    throw new Error(`${label} must be a valid IPv6 address`);
  }

  const head = parseIpv6Groups(segments[0] ?? '', label);
  const tail = parseIpv6Groups(segments[1] ?? '', label);
  const groups =
    segments.length === 2
      ? [...head, ...Array.from({ length: 8 - head.length - tail.length }, () => '0'), ...tail]
      : head;

  if (groups.length !== 8) {
    throw new Error(`${label} must expand to exactly 8 IPv6 groups`);
  }

  const output = Buffer.alloc(16);
  for (const [index, group] of groups.entries()) {
    output.writeUInt16BE(Number.parseInt(group, 16), index * 2);
  }
  return output;
}

export function parseIpAddress(value: unknown, version: 'ipv4' | 'ipv6', label: string): Buffer {
  return version === 'ipv4' ? parseIpv4Address(value, label) : parseIpv6Address(value, label);
}

export function parseEtherType(value: unknown, label: string): number {
  return parseNamedOrNumericValue(value, label, ETHER_TYPE_MAP, 0xffff);
}

export function parseIpProtocol(value: unknown, label: string): number {
  return parseNamedOrNumericValue(value, label, IP_PROTOCOL_MAP, 0xff);
}

export function parsePcapLinkType(value: unknown, label: string): number {
  return parseNamedOrNumericValue(value, label, PCAP_LINK_TYPE_MAP, 0xffffffff);
}

export function parseChecksumEndian(value: unknown): ChecksumEndian {
  return value === 'little' ? 'little' : 'big';
}

export function parsePacketEndianness(value: unknown): PacketEndianness {
  return value === 'big' ? 'big' : 'little';
}

export function parseTimestampPrecision(value: unknown): PacketTimestampPrecision {
  return value === 'nano' ? 'nano' : 'micro';
}

export function parseHexPayload(value: unknown, label: string): Buffer {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a hex string`);
  }
  return Buffer.from(normalizeHexString(value, label), 'hex');
}

export function computeInternetChecksum(buffer: Buffer): number {
  let sum = 0;
  for (let offset = 0; offset < buffer.length; offset += 2) {
    const high = buffer[offset] ?? 0;
    const low = buffer[offset + 1] ?? 0;
    sum += (high << 8) | low;
    while (sum > 0xffff) {
      sum = (sum & 0xffff) + (sum >>> 16);
    }
  }
  return ~sum & 0xffff;
}

export function buildEthernetFrame(
  destinationMac: ParsedMacAddress,
  sourceMac: ParsedMacAddress,
  etherType: number,
  payload: Buffer,
): Buffer {
  const header = Buffer.alloc(14);
  destinationMac.bytes.copy(header, 0);
  sourceMac.bytes.copy(header, 6);
  header.writeUInt16BE(etherType, 12);
  return Buffer.concat([header, payload]);
}

export function buildArpPayload(args: {
  operation: 'request' | 'reply';
  hardwareType: number;
  protocolType: number;
  hardwareSize: number;
  protocolSize: number;
  senderMac: ParsedMacAddress;
  senderIp: Buffer;
  targetMac: ParsedMacAddress;
  targetIp: Buffer;
}): Buffer {
  if (
    args.hardwareSize !== args.senderMac.bytes.length ||
    args.hardwareSize !== args.targetMac.bytes.length
  ) {
    throw new Error('hardwareSize must match the provided MAC address lengths');
  }
  if (args.protocolSize !== args.senderIp.length || args.protocolSize !== args.targetIp.length) {
    throw new Error('protocolSize must match the provided IP address lengths');
  }

  const buffer = Buffer.alloc(8 + args.hardwareSize * 2 + args.protocolSize * 2);
  let offset = 0;
  buffer.writeUInt16BE(args.hardwareType, offset);
  offset += 2;
  buffer.writeUInt16BE(args.protocolType, offset);
  offset += 2;
  buffer.writeUInt8(args.hardwareSize, offset++);
  buffer.writeUInt8(args.protocolSize, offset++);
  buffer.writeUInt16BE(args.operation === 'reply' ? 2 : 1, offset);
  offset += 2;
  args.senderMac.bytes.copy(buffer, offset);
  offset += args.hardwareSize;
  args.senderIp.copy(buffer, offset);
  offset += args.protocolSize;
  args.targetMac.bytes.copy(buffer, offset);
  offset += args.hardwareSize;
  args.targetIp.copy(buffer, offset);
  return buffer;
}

export function buildIpv4Packet(args: {
  sourceIp: Buffer;
  destinationIp: Buffer;
  protocol: number;
  payload: Buffer;
  ttl: number;
  identification: number;
  dontFragment: boolean;
  moreFragments: boolean;
  fragmentOffset: number;
  dscp: number;
  ecn: number;
}): { packet: Buffer; checksum: number } {
  const header = Buffer.alloc(20);
  header[0] = 0x45;
  header[1] = ((args.dscp & 0x3f) << 2) | (args.ecn & 0x03);
  header.writeUInt16BE(header.length + args.payload.length, 2);
  header.writeUInt16BE(args.identification, 4);
  const flags = ((args.dontFragment ? 1 : 0) << 1) | (args.moreFragments ? 1 : 0);
  header.writeUInt16BE(((flags & 0x7) << 13) | (args.fragmentOffset & 0x1fff), 6);
  header[8] = args.ttl;
  header[9] = args.protocol;
  header.writeUInt16BE(0, 10);
  args.sourceIp.copy(header, 12);
  args.destinationIp.copy(header, 16);
  const checksum = computeInternetChecksum(header);
  header.writeUInt16BE(checksum, 10);
  return {
    packet: Buffer.concat([header, args.payload]),
    checksum,
  };
}

export function buildIpv6Packet(args: {
  sourceIp: Buffer;
  destinationIp: Buffer;
  protocol: number;
  payload: Buffer;
  hopLimit: number;
  dscp: number;
  ecn: number;
  flowLabel: number;
}): Buffer {
  const header = Buffer.alloc(40);
  const trafficClass = ((args.dscp & 0x3f) << 2) | (args.ecn & 0x03);
  const versionTrafficFlow =
    (6 << 28) | ((trafficClass & 0xff) << 20) | (args.flowLabel & 0x000fffff);
  header.writeUInt32BE(versionTrafficFlow >>> 0, 0);
  header.writeUInt16BE(args.payload.length, 4);
  header.writeUInt8(args.protocol, 6);
  header.writeUInt8(args.hopLimit, 7);
  args.sourceIp.copy(header, 8);
  args.destinationIp.copy(header, 24);
  return Buffer.concat([header, args.payload]);
}

export function buildIcmpEcho(args: {
  operation: 'request' | 'reply';
  identifier: number;
  sequenceNumber: number;
  payload: Buffer;
}): { packet: Buffer; checksum: number } {
  const packet = Buffer.alloc(8 + args.payload.length);
  packet[0] = args.operation === 'reply' ? 0 : 8;
  packet[1] = 0;
  packet.writeUInt16BE(0, 2);
  packet.writeUInt16BE(args.identifier, 4);
  packet.writeUInt16BE(args.sequenceNumber, 6);
  args.payload.copy(packet, 8);
  const checksum = computeInternetChecksum(packet);
  packet.writeUInt16BE(checksum, 2);
  return { packet, checksum };
}

export function writeUint32(
  buffer: Buffer,
  offset: number,
  value: number,
  endianness: PacketEndianness,
): void {
  if (endianness === 'little') {
    buffer.writeUInt32LE(value, offset);
  } else {
    buffer.writeUInt32BE(value, offset);
  }
}

export function writeUint16(
  buffer: Buffer,
  offset: number,
  value: number,
  endianness: PacketEndianness,
): void {
  if (endianness === 'little') {
    buffer.writeUInt16LE(value, offset);
  } else {
    buffer.writeUInt16BE(value, offset);
  }
}

export function readUint32(buffer: Buffer, offset: number, endianness: PacketEndianness): number {
  return endianness === 'little' ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

export function readUint16(buffer: Buffer, offset: number, endianness: PacketEndianness): number {
  return endianness === 'little' ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

export function getPcapMagic(
  endianness: PacketEndianness,
  precision: PacketTimestampPrecision,
): Buffer {
  const hex =
    endianness === 'little'
      ? precision === 'nano'
        ? '4d3cb2a1'
        : 'd4c3b2a1'
      : precision === 'nano'
        ? 'a1b23c4d'
        : 'a1b2c3d4';
  return Buffer.from(hex, 'hex');
}

export function parsePcapHeader(buffer: Buffer): PcapHeader {
  if (buffer.length < 24) {
    throw new Error('PCAP file is too small to contain a global header');
  }

  const magic = buffer.subarray(0, 4).toString('hex');
  let endianness: PacketEndianness;
  let timestampPrecision: PacketTimestampPrecision;
  switch (magic) {
    case 'd4c3b2a1':
      endianness = 'little';
      timestampPrecision = 'micro';
      break;
    case '4d3cb2a1':
      endianness = 'little';
      timestampPrecision = 'nano';
      break;
    case 'a1b2c3d4':
      endianness = 'big';
      timestampPrecision = 'micro';
      break;
    case 'a1b23c4d':
      endianness = 'big';
      timestampPrecision = 'nano';
      break;
    default:
      throw new Error('Unsupported capture format: only classic PCAP files are supported');
  }

  return {
    endianness,
    timestampPrecision,
    versionMajor: readUint16(buffer, 4, endianness),
    versionMinor: readUint16(buffer, 6, endianness),
    snapLength: readUint32(buffer, 16, endianness),
    linkType: readUint32(buffer, 20, endianness),
  };
}

export function parsePcapPacketInput(value: unknown, index: number): PcapPacketInput {
  if (!isRecord(value)) {
    throw new Error(`packets[${index}] must be an object`);
  }

  const data = parseHexPayload(value.dataHex, `packets[${index}].dataHex`);
  const timestampSeconds =
    value.timestampSeconds === undefined
      ? 0
      : parseNonNegativeInteger(value.timestampSeconds, `packets[${index}].timestampSeconds`);
  const timestampFraction =
    value.timestampFraction === undefined
      ? 0
      : parseNonNegativeInteger(value.timestampFraction, `packets[${index}].timestampFraction`);
  const originalLength =
    value.originalLength === undefined
      ? data.length
      : parsePositiveInteger(value.originalLength, `packets[${index}].originalLength`);
  if (originalLength < data.length) {
    throw new Error(`packets[${index}].originalLength must be >= included packet length`);
  }

  return {
    data,
    timestampSeconds,
    timestampFraction,
    originalLength,
  };
}

export function buildClassicPcap(args: {
  packets: PcapPacketInput[];
  endianness: PacketEndianness;
  timestampPrecision: PacketTimestampPrecision;
  snapLength: number;
  linkType: number;
}): Buffer {
  const globalHeader = Buffer.alloc(24);
  getPcapMagic(args.endianness, args.timestampPrecision).copy(globalHeader, 0);
  writeUint16(globalHeader, 4, 2, args.endianness);
  writeUint16(globalHeader, 6, 4, args.endianness);
  writeUint32(globalHeader, 8, 0, args.endianness);
  writeUint32(globalHeader, 12, 0, args.endianness);
  writeUint32(globalHeader, 16, args.snapLength, args.endianness);
  writeUint32(globalHeader, 20, args.linkType, args.endianness);

  const records = args.packets.map((packet) => {
    const header = Buffer.alloc(16);
    writeUint32(header, 0, packet.timestampSeconds, args.endianness);
    writeUint32(header, 4, packet.timestampFraction, args.endianness);
    writeUint32(header, 8, packet.data.length, args.endianness);
    writeUint32(header, 12, packet.originalLength, args.endianness);
    return Buffer.concat([header, packet.data]);
  });

  return Buffer.concat([globalHeader, ...records]);
}

export function readClassicPcap(
  buffer: Buffer,
  maxPackets: number | undefined,
  maxBytesPerPacket: number | undefined,
): { header: PcapHeader; packets: PcapPacketSummary[] } {
  const header = parsePcapHeader(buffer);
  const packets: PcapPacketSummary[] = [];
  let offset = 24;

  while (offset < buffer.length) {
    if (maxPackets !== undefined && packets.length >= maxPackets) {
      break;
    }
    if (offset + 16 > buffer.length) {
      throw new Error('PCAP file ends with an incomplete packet header');
    }

    const timestampSeconds = readUint32(buffer, offset, header.endianness);
    const timestampFraction = readUint32(buffer, offset + 4, header.endianness);
    const includedLength = readUint32(buffer, offset + 8, header.endianness);
    const originalLength = readUint32(buffer, offset + 12, header.endianness);
    offset += 16;

    if (offset + includedLength > buffer.length) {
      throw new Error('PCAP file ends with an incomplete packet payload');
    }

    const packetBytes = buffer.subarray(offset, offset + includedLength);
    offset += includedLength;
    const limit = maxBytesPerPacket === undefined ? packetBytes.length : maxBytesPerPacket;
    const visibleLength = Math.min(limit, packetBytes.length);
    packets.push({
      index: packets.length,
      timestampSeconds,
      timestampFraction,
      includedLength,
      originalLength,
      dataHex: packetBytes.subarray(0, visibleLength).toString('hex'),
      truncated: visibleLength < packetBytes.length,
    });
  }

  return { header, packets };
}

// ── Shared state for sub-handlers ──

import {
  ProtocolPatternEngine as _Engine,
  StateMachineInferrer as _Inferrer,
} from '@modules/protocol-analysis';

export interface ProtocolSharedState {
  engine?: _Engine;
  inferrer?: _Inferrer;
  eventBus?: EventBus<ServerEventMap>;
}

export function getEngine(state: ProtocolSharedState): _Engine {
  if (!state.engine) {
    state.engine = new _Engine();
  }
  return state.engine;
}

export function getInferrer(state: ProtocolSharedState): _Inferrer {
  if (!state.inferrer) {
    state.inferrer = new _Inferrer();
  }
  return state.inferrer;
}

export function emitProtocolEvent<K extends ProtocolAtomicEvent>(
  state: ProtocolSharedState,
  event: K,
  payload: ProtocolAtomicEventPayload<K>,
): void {
  void state.eventBus?.emit(event, {
    ...payload,
    timestamp: new Date().toISOString(),
  } as ServerEventMap[K]);
}
