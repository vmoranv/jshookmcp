import { isRecord } from '../protocol-schema';
import {
  applyFixedLength,
  BINARY_ENCODINGS,
  decodeBinaryValue,
  getFieldNumericMetadata,
  getNumericRange,
  parseByte,
  parseEncoding,
  parseInteger,
  parseOptionalLength,
  PAYLOAD_FIELD_TYPES,
  TEXT_ENCODINGS,
  type PayloadEndian,
  type PayloadFieldSegment,
  type PayloadFieldType,
  type PayloadTemplateField,
  writeIntegerToBuffer,
  expectString,
} from './core';

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

  const stringValue = expectString(rawValue, `fields[${index}].value`);
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
      value: stringValue,
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
    value: stringValue,
    encoding,
    ...(length !== undefined ? { length } : {}),
    padByte,
  };
}

function encodePayloadTemplateField(field: PayloadTemplateField, endian: PayloadEndian): Buffer {
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
