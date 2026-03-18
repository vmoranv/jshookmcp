import type { MsgPackDecodeResult } from '@server/domains/encoding/handlers.impl.core.runtime.shared';
import { bigIntToSafeValue } from '@server/domains/encoding/encoding-protobuf';

export function decodeMsgPack(buffer: Buffer): unknown {
  const decoded = decodeMsgPackValue(buffer, 0, 0);
  if (decoded.offset !== buffer.length) {
    throw new Error(
      `MessagePack decode ended early: consumed ${decoded.offset} of ${buffer.length} bytes`
    );
  }
  return decoded.value;
}

export function decodeMsgPackValue(
  buffer: Buffer,
  startOffset: number,
  depth: number
): MsgPackDecodeResult {
  if (depth > 64) {
    throw new Error('MessagePack decode depth exceeds safety limit');
  }

  const prefix = buffer[startOffset];
  if (prefix === undefined) {
    throw new Error(`Unexpected EOF at offset ${startOffset}`);
  }

  let offset = startOffset + 1;

  if (prefix <= 0x7f) {
    return { value: prefix, offset };
  }
  if (prefix >= 0xe0) {
    return { value: prefix - 0x100, offset };
  }
  if (prefix >= 0xa0 && prefix <= 0xbf) {
    const length = prefix & 0x1f;
    ensureRange(buffer, offset, length);
    const value = buffer.subarray(offset, offset + length).toString('utf8');
    return { value, offset: offset + length };
  }
  if (prefix >= 0x90 && prefix <= 0x9f) {
    const length = prefix & 0x0f;
    return decodeMsgPackArray(buffer, offset, length, depth + 1);
  }
  if (prefix >= 0x80 && prefix <= 0x8f) {
    const length = prefix & 0x0f;
    return decodeMsgPackMap(buffer, offset, length, depth + 1);
  }

  if (prefix === 0xc0) return { value: null, offset };
  if (prefix === 0xc2) return { value: false, offset };
  if (prefix === 0xc3) return { value: true, offset };

  if (prefix === 0xcc) {
    ensureRange(buffer, offset, 1);
    const value = buffer.readUInt8(offset);
    return { value, offset: offset + 1 };
  }
  if (prefix === 0xcd) {
    ensureRange(buffer, offset, 2);
    const value = buffer.readUInt16BE(offset);
    return { value, offset: offset + 2 };
  }
  if (prefix === 0xce) {
    ensureRange(buffer, offset, 4);
    const value = buffer.readUInt32BE(offset);
    return { value, offset: offset + 4 };
  }
  if (prefix === 0xcf) {
    ensureRange(buffer, offset, 8);
    const value = buffer.readBigUInt64BE(offset);
    return { value: bigIntToSafeValue(value), offset: offset + 8 };
  }

  if (prefix === 0xd0) {
    ensureRange(buffer, offset, 1);
    const value = buffer.readInt8(offset);
    return { value, offset: offset + 1 };
  }
  if (prefix === 0xd1) {
    ensureRange(buffer, offset, 2);
    const value = buffer.readInt16BE(offset);
    return { value, offset: offset + 2 };
  }
  if (prefix === 0xd2) {
    ensureRange(buffer, offset, 4);
    const value = buffer.readInt32BE(offset);
    return { value, offset: offset + 4 };
  }
  if (prefix === 0xd3) {
    ensureRange(buffer, offset, 8);
    const value = buffer.readBigInt64BE(offset);
    return { value: bigIntToSafeValue(value), offset: offset + 8 };
  }

  if (prefix === 0xca) {
    ensureRange(buffer, offset, 4);
    const value = buffer.readFloatBE(offset);
    return { value, offset: offset + 4 };
  }
  if (prefix === 0xcb) {
    ensureRange(buffer, offset, 8);
    const value = buffer.readDoubleBE(offset);
    return { value, offset: offset + 8 };
  }

  if (prefix === 0xd9) {
    ensureRange(buffer, offset, 1);
    const length = buffer.readUInt8(offset);
    offset += 1;
    ensureRange(buffer, offset, length);
    const value = buffer.subarray(offset, offset + length).toString('utf8');
    return { value, offset: offset + length };
  }
  if (prefix === 0xda) {
    ensureRange(buffer, offset, 2);
    const length = buffer.readUInt16BE(offset);
    offset += 2;
    ensureRange(buffer, offset, length);
    const value = buffer.subarray(offset, offset + length).toString('utf8');
    return { value, offset: offset + length };
  }
  if (prefix === 0xdb) {
    ensureRange(buffer, offset, 4);
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    ensureRange(buffer, offset, length);
    const value = buffer.subarray(offset, offset + length).toString('utf8');
    return { value, offset: offset + length };
  }

  if (prefix === 0xc4) {
    ensureRange(buffer, offset, 1);
    const length = buffer.readUInt8(offset);
    offset += 1;
    ensureRange(buffer, offset, length);
    const payload = buffer.subarray(offset, offset + length);
    return {
      value: { type: 'bytes', base64: payload.toString('base64'), hex: payload.toString('hex') },
      offset: offset + length,
    };
  }
  if (prefix === 0xc5) {
    ensureRange(buffer, offset, 2);
    const length = buffer.readUInt16BE(offset);
    offset += 2;
    ensureRange(buffer, offset, length);
    const payload = buffer.subarray(offset, offset + length);
    return {
      value: { type: 'bytes', base64: payload.toString('base64'), hex: payload.toString('hex') },
      offset: offset + length,
    };
  }
  if (prefix === 0xc6) {
    ensureRange(buffer, offset, 4);
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    ensureRange(buffer, offset, length);
    const payload = buffer.subarray(offset, offset + length);
    return {
      value: { type: 'bytes', base64: payload.toString('base64'), hex: payload.toString('hex') },
      offset: offset + length,
    };
  }

  if (prefix === 0xdc) {
    ensureRange(buffer, offset, 2);
    const length = buffer.readUInt16BE(offset);
    offset += 2;
    return decodeMsgPackArray(buffer, offset, length, depth + 1);
  }
  if (prefix === 0xdd) {
    ensureRange(buffer, offset, 4);
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    return decodeMsgPackArray(buffer, offset, length, depth + 1);
  }

  if (prefix === 0xde) {
    ensureRange(buffer, offset, 2);
    const length = buffer.readUInt16BE(offset);
    offset += 2;
    return decodeMsgPackMap(buffer, offset, length, depth + 1);
  }
  if (prefix === 0xdf) {
    ensureRange(buffer, offset, 4);
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    return decodeMsgPackMap(buffer, offset, length, depth + 1);
  }

  if (prefix >= 0xd4 && prefix <= 0xd8) {
    const sizeByPrefix: Record<number, number> = {
      0xd4: 1,
      0xd5: 2,
      0xd6: 4,
      0xd7: 8,
      0xd8: 16,
    };
    const size = sizeByPrefix[prefix]!;
    ensureRange(buffer, offset, 1 + size);
    const extType = buffer.readInt8(offset);
    const payload = buffer.subarray(offset + 1, offset + 1 + size);
    return {
      value: {
        type: 'ext',
        extType,
        base64: payload.toString('base64'),
        hex: payload.toString('hex'),
      },
      offset: offset + 1 + size,
    };
  }

  if (prefix === 0xc7 || prefix === 0xc8 || prefix === 0xc9) {
    const lengthBytes = prefix === 0xc7 ? 1 : prefix === 0xc8 ? 2 : 4;
    ensureRange(buffer, offset, lengthBytes);

    const length =
      lengthBytes === 1
        ? buffer.readUInt8(offset)
        : lengthBytes === 2
          ? buffer.readUInt16BE(offset)
          : buffer.readUInt32BE(offset);

    offset += lengthBytes;
    ensureRange(buffer, offset, 1 + length);

    const extType = buffer.readInt8(offset);
    const payload = buffer.subarray(offset + 1, offset + 1 + length);
    return {
      value: {
        type: 'ext',
        extType,
        base64: payload.toString('base64'),
        hex: payload.toString('hex'),
      },
      offset: offset + 1 + length,
    };
  }

  throw new Error(
    `Unsupported MessagePack prefix 0x${prefix.toString(16)} at offset ${startOffset}`
  );
}

export function decodeMsgPackArray(
  buffer: Buffer,
  startOffset: number,
  length: number,
  depth: number
): MsgPackDecodeResult {
  let offset = startOffset;
  const values: unknown[] = [];

  for (let index = 0; index < length; index += 1) {
    const decoded = decodeMsgPackValue(buffer, offset, depth);
    values.push(decoded.value);
    offset = decoded.offset;
  }

  return { value: values, offset };
}

export function decodeMsgPackMap(
  buffer: Buffer,
  startOffset: number,
  length: number,
  depth: number
): MsgPackDecodeResult {
  let offset = startOffset;
  const mapValue: Record<string, unknown> = {};

  for (let index = 0; index < length; index += 1) {
    const keyDecoded = decodeMsgPackValue(buffer, offset, depth);
    offset = keyDecoded.offset;

    const valueDecoded = decodeMsgPackValue(buffer, offset, depth);
    offset = valueDecoded.offset;

    const key = msgPackMapKey(keyDecoded.value);
    mapValue[key] = valueDecoded.value;
  }

  return { value: mapValue, offset };
}

export function msgPackMapKey(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null) return 'null';

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function ensureRange(buffer: Buffer, offset: number, length: number): void {
  if (offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(`Unexpected EOF while reading ${length} bytes at offset ${offset}`);
  }
}
