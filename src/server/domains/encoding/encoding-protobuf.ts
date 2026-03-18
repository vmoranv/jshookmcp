import type {
  ProtobufFieldNode,
  ProtobufParseResult,
} from '@server/domains/encoding/handlers.impl.core.runtime.shared';

export function parseProtobufMessage(
  buffer: Buffer,
  depth: number,
  maxDepth: number
): ProtobufParseResult {
  const fields: ProtobufFieldNode[] = [];
  let offset = 0;
  let fieldIndex = 0;

  while (offset < buffer.length) {
    const keyInfo = tryParseVarint(buffer, offset);
    if (keyInfo.error) {
      return {
        fields,
        bytesConsumed: offset,
        error: keyInfo.error,
      };
    }

    const keyValue = keyInfo.value as bigint;
    offset = keyInfo.offset as number;

    const fieldNumber = Number(keyValue >> 3n);
    const wireType = Number(keyValue & 0x07n);

    if (fieldNumber <= 0) {
      return {
        fields,
        bytesConsumed: offset,
        error: `Invalid field number ${fieldNumber} at offset ${offset}`,
      };
    }

    if (wireType === 0) {
      const varintInfo = tryParseVarint(buffer, offset);
      if (varintInfo.error) {
        return {
          fields,
          bytesConsumed: offset,
          error: varintInfo.error,
        };
      }
      offset = varintInfo.offset as number;
      fields.push({
        index: fieldIndex,
        fieldNumber,
        wireType,
        wireTypeName: protobufWireTypeName(wireType),
        value: bigIntToSafeValue(varintInfo.value as bigint),
      });
    } else if (wireType === 1) {
      if (offset + 8 > buffer.length) {
        return {
          fields,
          bytesConsumed: offset,
          error: `Unexpected EOF for fixed64 at offset ${offset}`,
        };
      }
      const raw = buffer.subarray(offset, offset + 8);
      const fixed64 = raw.readBigUInt64LE(0);
      offset += 8;
      fields.push({
        index: fieldIndex,
        fieldNumber,
        wireType,
        wireTypeName: protobufWireTypeName(wireType),
        value: {
          uint64: bigIntToSafeValue(fixed64),
          hex: raw.toString('hex'),
        },
      });
    } else if (wireType === 2) {
      const lengthInfo = tryParseVarint(buffer, offset);
      if (lengthInfo.error) {
        return {
          fields,
          bytesConsumed: offset,
          error: lengthInfo.error,
        };
      }

      offset = lengthInfo.offset as number;
      const lengthBigInt = lengthInfo.value as bigint;
      if (lengthBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
        return {
          fields,
          bytesConsumed: offset,
          error: `Length-delimited field is too large at offset ${offset}`,
        };
      }

      const length = Number(lengthBigInt);
      if (length < 0 || offset + length > buffer.length) {
        return {
          fields,
          bytesConsumed: offset,
          error: `Invalid length-delimited field length=${length} at offset ${offset}`,
        };
      }

      const payload = buffer.subarray(offset, offset + length);
      offset += length;

      fields.push({
        index: fieldIndex,
        fieldNumber,
        wireType,
        wireTypeName: protobufWireTypeName(wireType),
        value: decodeLengthDelimited(payload, depth, maxDepth),
      });
    } else if (wireType === 5) {
      if (offset + 4 > buffer.length) {
        return {
          fields,
          bytesConsumed: offset,
          error: `Unexpected EOF for fixed32 at offset ${offset}`,
        };
      }
      const raw = buffer.subarray(offset, offset + 4);
      const fixed32 = raw.readUInt32LE(0);
      offset += 4;
      fields.push({
        index: fieldIndex,
        fieldNumber,
        wireType,
        wireTypeName: protobufWireTypeName(wireType),
        value: {
          uint32: fixed32,
          hex: raw.toString('hex'),
        },
      });
    } else {
      return {
        fields,
        bytesConsumed: offset,
        error: `Unsupported wire type ${wireType} at offset ${offset}`,
      };
    }

    fieldIndex += 1;
  }

  return {
    fields,
    bytesConsumed: offset,
  };
}

export function decodeLengthDelimited(payload: Buffer, depth: number, maxDepth: number): unknown {
  if (payload.length === 0) {
    return { kind: 'empty', length: 0 };
  }

  if (depth < maxDepth) {
    const nested = parseProtobufMessage(payload, depth + 1, maxDepth);
    if (!nested.error && nested.bytesConsumed === payload.length && nested.fields.length > 0) {
      return {
        kind: 'message',
        fields: nested.fields,
      };
    }
  }

  const text = toSafeUtf8(payload);
  if (text !== null && isMostlyPrintableText(text)) {
    return {
      kind: 'string',
      value: text,
    };
  }

  return {
    kind: 'bytes',
    length: payload.length,
    hex: payload.toString('hex'),
    base64: payload.toString('base64'),
  };
}

export function tryParseVarint(
  buffer: Buffer,
  startOffset: number
): { value?: bigint; offset?: number; error?: string } {
  let result = 0n;
  let shift = 0n;
  let offset = startOffset;

  for (let index = 0; index < 10; index += 1) {
    const current = buffer[offset];
    if (current === undefined) {
      return { error: `Unexpected EOF while parsing varint at offset ${offset}` };
    }

    const byte = BigInt(current);
    result |= (byte & 0x7fn) << shift;
    offset += 1;

    if ((byte & 0x80n) === 0n) {
      return { value: result, offset };
    }

    shift += 7n;
  }

  return { error: `Varint exceeds 10 bytes at offset ${startOffset}` };
}

export function protobufWireTypeName(wireType: number): string {
  if (wireType === 0) return 'varint';
  if (wireType === 1) return 'fixed64';
  if (wireType === 2) return 'length-delimited';
  if (wireType === 5) return 'fixed32';
  return 'unknown';
}

export function bigIntToSafeValue(value: bigint): number | string {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const min = BigInt(Number.MIN_SAFE_INTEGER);
  if (value <= max && value >= min) {
    return Number(value);
  }
  return value.toString();
}

function toSafeUtf8(buffer: Buffer): string | null {
  const text = buffer.toString('utf8');
  if ((text.match(/\uFFFD/g) ?? []).length > 0) {
    return null;
  }
  return text;
}

function isMostlyPrintableText(text: string): boolean {
  if (text.length === 0) {
    return true;
  }

  let printable = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if ((code >= 0x20 && code <= 0x7e) || code === 0x09 || code === 0x0a || code === 0x0d) {
      printable += 1;
    }
  }
  return printable / text.length >= 0.85;
}
