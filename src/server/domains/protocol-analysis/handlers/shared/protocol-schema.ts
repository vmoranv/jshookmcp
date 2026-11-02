import type {
  EncryptionInfo,
  FieldSpec,
  PatternSpec,
  ProtocolField,
  ProtocolMessage,
} from '@modules/protocol-analysis';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseFieldSpec(value: unknown, index: number): FieldSpec {
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
