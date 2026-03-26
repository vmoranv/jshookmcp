import { describe, it, expect } from 'vitest';
import {
  bigIntToSafeValue,
  decodeLengthDelimited,
  parseProtobufMessage,
  protobufWireTypeName,
  tryParseVarint,
} from '@server/domains/encoding/encoding-protobuf';

const tool = {
  parseProtobufMessage,
  decodeLengthDelimited,
  tryParseVarint,
  protobufWireTypeName,
  bigIntToSafeValue,
};

function encodeVarint(value: number | bigint): Buffer {
  let remaining = typeof value === 'bigint' ? value : BigInt(value);
  if (remaining < 0n) {
    throw new Error('encodeVarint expects a non-negative value');
  }

  const bytes: number[] = [];
  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return Buffer.from(bytes);
}

function encodeKey(fieldNumber: number, wireType: number): Buffer {
  const key = (BigInt(fieldNumber) << 3n) | BigInt(wireType);
  return encodeVarint(key);
}

function fieldVarint(fieldNumber: number, value: number | bigint): Buffer {
  return Buffer.concat([encodeKey(fieldNumber, 0), encodeVarint(value)]);
}

function fieldLengthDelimited(fieldNumber: number, payload: Buffer): Buffer {
  return Buffer.concat([encodeKey(fieldNumber, 2), encodeVarint(payload.length), payload]);
}

function fieldFixed32(fieldNumber: number, value: number): Buffer {
  const raw = Buffer.alloc(4);
  raw.writeUInt32LE(value, 0);
  return Buffer.concat([encodeKey(fieldNumber, 5), raw]);
}

function fieldFixed64(fieldNumber: number, value: bigint): Buffer {
  const raw = Buffer.alloc(8);
  raw.writeBigUInt64LE(value, 0);
  return Buffer.concat([encodeKey(fieldNumber, 1), raw]);
}

describe('EncodingToolHandlersProtobuf.tryParseVarint', () => {
  it('parses single-byte varint 0', () => {
    const result = tool.tryParseVarint(Buffer.from([0x00]), 0);
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(0n);
    expect(result.offset).toBe(1);
  });

  it('parses single-byte varint 1', () => {
    const result = tool.tryParseVarint(Buffer.from([0x01]), 0);
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(1n);
    expect(result.offset).toBe(1);
  });

  it('parses single-byte varint 127', () => {
    const result = tool.tryParseVarint(Buffer.from([0x7f]), 0);
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(127n);
    expect(result.offset).toBe(1);
  });

  it('parses multi-byte varint 128', () => {
    const result = tool.tryParseVarint(Buffer.from([0x80, 0x01]), 0);
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(128n);
    expect(result.offset).toBe(2);
  });

  it('parses multi-byte varint 300', () => {
    const result = tool.tryParseVarint(Buffer.from([0xac, 0x02]), 0);
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(300n);
    expect(result.offset).toBe(2);
  });

  it('parses a varint at a non-zero startOffset', () => {
    const buffer = Buffer.from([0x00, 0x00, 0xac, 0x02, 0xff]);
    const result = tool.tryParseVarint(buffer, 2);
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(300n);
    expect(result.offset).toBe(4);
  });

  it('parses the maximum 10-byte uint64 varint (2^64-1)', () => {
    const buffer = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
    const result = tool.tryParseVarint(buffer, 0);
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(18446744073709551615n);
    expect(result.offset).toBe(10);
  });

  it('returns error for empty buffer', () => {
    const result = tool.tryParseVarint(Buffer.alloc(0), 0);
    expect(result.value).toBeUndefined();
    expect(result.offset).toBeUndefined();
    expect(result.error).toBe('Unexpected EOF while parsing varint at offset 0');
  });

  it('returns error for truncated varint (continuation bit set then EOF)', () => {
    const result = tool.tryParseVarint(Buffer.from([0x80]), 0);
    expect(result.value).toBeUndefined();
    expect(result.offset).toBeUndefined();
    expect(result.error).toBe('Unexpected EOF while parsing varint at offset 1');
  });

  it('returns error when varint exceeds 10 bytes (never terminates)', () => {
    const buffer = Buffer.alloc(10, 0x80);
    const result = tool.tryParseVarint(buffer, 0);
    expect(result.value).toBeUndefined();
    expect(result.offset).toBeUndefined();
    expect(result.error).toBe('Varint exceeds 10 bytes at offset 0');
  });

  it('returns error for multi-byte truncated varint', () => {
    const result = tool.tryParseVarint(Buffer.from([0x80, 0x80]), 0);
    expect(result.value).toBeUndefined();
    expect(result.offset).toBeUndefined();
    expect(result.error).toBe('Unexpected EOF while parsing varint at offset 2');
  });
});

describe('EncodingToolHandlersProtobuf.protobufWireTypeName', () => {
  it('returns "varint" for wire type 0', () => {
    expect(tool.protobufWireTypeName(0)).toBe('varint');
  });

  it('returns "fixed64" for wire type 1', () => {
    expect(tool.protobufWireTypeName(1)).toBe('fixed64');
  });

  it('returns "length-delimited" for wire type 2', () => {
    expect(tool.protobufWireTypeName(2)).toBe('length-delimited');
  });

  it('returns "fixed32" for wire type 5', () => {
    expect(tool.protobufWireTypeName(5)).toBe('fixed32');
  });

  it('returns "unknown" for wire type 3 (unsupported)', () => {
    expect(tool.protobufWireTypeName(3)).toBe('unknown');
  });

  it('returns "unknown" for wire type -1', () => {
    expect(tool.protobufWireTypeName(-1)).toBe('unknown');
  });
});

describe('EncodingToolHandlersProtobuf.bigIntToSafeValue', () => {
  it('returns number for 0n', () => {
    const value = tool.bigIntToSafeValue(0n);
    expect(value).toBe(0);
    expect(typeof value).toBe('number');
  });

  it('returns number for 42n', () => {
    const value = tool.bigIntToSafeValue(42n);
    expect(value).toBe(42);
    expect(typeof value).toBe('number');
  });

  it('returns number for Number.MAX_SAFE_INTEGER', () => {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const value = tool.bigIntToSafeValue(max);
    expect(value).toBe(Number.MAX_SAFE_INTEGER);
    expect(typeof value).toBe('number');
  });

  it('returns number for Number.MIN_SAFE_INTEGER', () => {
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    const value = tool.bigIntToSafeValue(min);
    expect(value).toBe(Number.MIN_SAFE_INTEGER);
    expect(typeof value).toBe('number');
  });

  it('returns string when above Number.MAX_SAFE_INTEGER', () => {
    const value = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(tool.bigIntToSafeValue(value)).toBe(value.toString());
  });

  it('returns string when below Number.MIN_SAFE_INTEGER', () => {
    const value = BigInt(Number.MIN_SAFE_INTEGER) - 1n;
    expect(tool.bigIntToSafeValue(value)).toBe(value.toString());
  });

  it('returns string for a very large magnitude bigint', () => {
    const value = 1n << 62n;
    expect(tool.bigIntToSafeValue(value)).toBe(value.toString());
  });
});

describe('EncodingToolHandlersProtobuf.decodeLengthDelimited', () => {
  it('returns kind=empty for empty payload', () => {
    expect(tool.decodeLengthDelimited(Buffer.alloc(0), 0, 5)).toEqual({ kind: 'empty', length: 0 });
  });

  it('returns kind=message for a valid nested protobuf message', () => {
    const payload = fieldVarint(1, 150);
    const decoded = tool.decodeLengthDelimited(payload, 0, 5) as any;
    expect(decoded.kind).toBe('message');
    expect(decoded.fields).toHaveLength(1);
    expect(decoded.fields[0]).toMatchObject({
      index: 0,
      fieldNumber: 1,
      wireType: 0,
      wireTypeName: 'varint',
      value: 150,
    });
  });

  it('does not treat payload as message when nested parsing is disabled by depth/maxDepth', () => {
    const payload = fieldVarint(1, 150);
    const decoded = tool.decodeLengthDelimited(payload, 5, 5);
    expect(decoded).toEqual({
      kind: 'bytes',
      length: payload.length,
      hex: payload.toString('hex'),
      base64: payload.toString('base64'),
    });
  });

  it('returns kind=string for valid UTF-8 when nested message parsing is skipped', () => {
    const payload = Buffer.from('hello world', 'utf8');
    const decoded = tool.decodeLengthDelimited(payload, 1, 1);
    expect(decoded).toEqual({ kind: 'string', value: 'hello world' });
  });

  it('treats printable ratio 0.85 as string', () => {
    const payload = Buffer.from(`${'a'.repeat(17)}\x01\x02\x03`, 'utf8');
    const decoded = tool.decodeLengthDelimited(payload, 1, 1);
    expect(decoded).toEqual({ kind: 'string', value: payload.toString('utf8') });
  });

  it('treats printable ratio below 0.85 as bytes', () => {
    const payload = Buffer.from(`${'a'.repeat(16)}\x01\x02\x03\x04`, 'utf8');
    const decoded = tool.decodeLengthDelimited(payload, 1, 1);
    expect(decoded).toEqual({
      kind: 'bytes',
      length: payload.length,
      hex: payload.toString('hex'),
      base64: payload.toString('base64'),
    });
  });

  it('returns kind=bytes for valid UTF-8 that is mostly non-printable', () => {
    const payload = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
    const decoded = tool.decodeLengthDelimited(payload, 1, 1);
    expect(decoded).toEqual({
      kind: 'bytes',
      length: payload.length,
      hex: payload.toString('hex'),
      base64: payload.toString('base64'),
    });
  });

  it('returns kind=bytes for invalid UTF-8', () => {
    const payload = Buffer.from([0xff, 0xfe, 0xfd]);
    const decoded = tool.decodeLengthDelimited(payload, 1, 1);
    expect(decoded).toEqual({
      kind: 'bytes',
      length: payload.length,
      hex: payload.toString('hex'),
      base64: payload.toString('base64'),
    });
  });

  it('requires nested parsing to consume all bytes before returning kind=message', () => {
    const payload = Buffer.concat([fieldVarint(1, 1), Buffer.from([0x00])]);
    const decoded = tool.decodeLengthDelimited(payload, 0, 5);
    expect(decoded).toEqual({
      kind: 'bytes',
      length: payload.length,
      hex: payload.toString('hex'),
      base64: payload.toString('base64'),
    });
  });

  it('prefers nested message decoding over string when nested parsing succeeds', () => {
    const payload = Buffer.from('hi', 'utf8');
    const decoded = tool.decodeLengthDelimited(payload, 0, 5) as any;
    expect(decoded.kind).toBe('message');
    expect(decoded.fields).toHaveLength(1);
  });
});

describe('EncodingToolHandlersProtobuf.parseProtobufMessage', () => {
  it('parses empty buffer', () => {
    const result = tool.parseProtobufMessage(Buffer.alloc(0), 0, 5);
    expect(result.error).toBeUndefined();
    expect(result.bytesConsumed).toBe(0);
    expect(result.fields).toEqual([]);
  });

  it('parses a simple varint field', () => {
    const buffer = fieldVarint(1, 150);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.error).toBeUndefined();
    expect(result.bytesConsumed).toBe(buffer.length);
    expect(result.fields).toEqual([
      {
        index: 0,
        fieldNumber: 1,
        wireType: 0,
        wireTypeName: 'varint',
        value: 150,
      },
    ]);
  });

  it('parses multiple varint fields and assigns incremental indices', () => {
    const buffer = Buffer.concat([fieldVarint(1, 1), fieldVarint(2, 300)]);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.error).toBeUndefined();
    expect(result.bytesConsumed).toBe(buffer.length);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0]!).toMatchObject({ index: 0, fieldNumber: 1, wireType: 0, value: 1 });
    expect(result.fields[1]!).toMatchObject({ index: 1, fieldNumber: 2, wireType: 0, value: 300 });
  });

  it('parses a varint that exceeds JS safe integer as string value', () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER) + 123n;
    const buffer = fieldVarint(1, big);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.error).toBeUndefined();
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]!.value).toBe(big.toString());
  });

  it('parses a length-delimited field as string when payload is printable UTF-8', () => {
    const buffer = fieldLengthDelimited(1, Buffer.from('hello', 'utf8'));
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.error).toBeUndefined();
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]!.value).toEqual({ kind: 'string', value: 'hello' });
  });

  it('parses a length-delimited field with empty payload as kind=empty', () => {
    const buffer = fieldLengthDelimited(1, Buffer.alloc(0));
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.error).toBeUndefined();
    expect(result.fields[0]!.value).toEqual({ kind: 'empty', length: 0 });
  });

  it('parses a nested message inside a length-delimited field', () => {
    const inner = fieldVarint(2, 7);
    const outer = fieldLengthDelimited(1, inner);
    const result = tool.parseProtobufMessage(outer, 0, 5);
    expect(result.error).toBeUndefined();
    expect(result.fields).toHaveLength(1);
    const decoded = result.fields[0]!.value as any;
    expect(decoded.kind).toBe('message');
    expect(decoded.fields).toHaveLength(1);
    expect(decoded.fields[0]).toMatchObject({
      fieldNumber: 2,
      wireType: 0,
      wireTypeName: 'varint',
      value: 7,
    });
  });

  it('does not parse nested message when max depth is exceeded (falls back to bytes)', () => {
    const inner = fieldVarint(2, 7);
    const outer = fieldLengthDelimited(1, inner);
    const result = tool.parseProtobufMessage(outer, 0, 0);
    expect(result.error).toBeUndefined();
    const decoded = result.fields[0]!.value as any;
    expect(decoded.kind).toBe('bytes');
    expect(decoded.length).toBe(inner.length);
    expect(decoded.hex).toBe(inner.toString('hex'));
  });

  it('parses fixed32 fields', () => {
    const buffer = fieldFixed32(3, 0xdeadbeef);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.error).toBeUndefined();
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]!.wireTypeName).toBe('fixed32');
    expect(result.fields[0]!.value).toEqual({ uint32: 0xdeadbeef, hex: 'efbeadde' });
  });

  it('parses fixed64 fields with safe uint64 as number', () => {
    const buffer = fieldFixed64(4, 42n);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.error).toBeUndefined();
    expect(result.fields).toHaveLength(1);
    const value = result.fields[0]!.value as any;
    expect(value).toEqual({ uint64: 42, hex: '2a00000000000000' });
  });

  it('parses fixed64 fields with unsafe uint64 as string', () => {
    const unsafe = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    const buffer = fieldFixed64(4, unsafe);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.error).toBeUndefined();
    const value = result.fields[0]!.value as any;
    expect(value.uint64).toBe(unsafe.toString());
    const expectedRaw = Buffer.alloc(8);
    expectedRaw.writeBigUInt64LE(unsafe, 0);
    expect(value.hex).toBe(expectedRaw.toString('hex'));
  });

  it('returns error for unsupported wire type', () => {
    const buffer = Buffer.concat([encodeKey(1, 3)]);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.fields).toEqual([]);
    expect(result.bytesConsumed).toBe(1);
    expect(result.error).toBe('Unsupported wire type 3 at offset 1');
  });

  it('returns error for invalid field number 0', () => {
    const buffer = encodeVarint(0);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.fields).toEqual([]);
    expect(result.bytesConsumed).toBe(1);
    expect(result.error).toBe('Invalid field number 0 at offset 1');
  });

  it('returns error for truncated key varint', () => {
    const buffer = Buffer.from([0x80]);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.fields).toEqual([]);
    expect(result.bytesConsumed).toBe(0);
    expect(result.error).toBe('Unexpected EOF while parsing varint at offset 1');
  });

  it('returns error for truncated varint value', () => {
    const buffer = Buffer.from([0x08, 0x80]);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.fields).toEqual([]);
    expect(result.bytesConsumed).toBe(1);
    expect(result.error).toBe('Unexpected EOF while parsing varint at offset 2');
  });

  it('returns error for invalid length-delimited field length that exceeds buffer', () => {
    const buffer = Buffer.concat([
      encodeKey(1, 2),
      encodeVarint(5),
      Buffer.from([0x01, 0x02, 0x03]),
    ]);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.fields).toEqual([]);
    expect(result.bytesConsumed).toBe(2);
    expect(result.error).toBe('Invalid length-delimited field length=5 at offset 2');
  });

  it('returns error for truncated length varint in length-delimited field', () => {
    const buffer = Buffer.from([0x0a, 0x80]);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.fields).toEqual([]);
    expect(result.bytesConsumed).toBe(1);
    expect(result.error).toBe('Unexpected EOF while parsing varint at offset 2');
  });

  it('returns error when fixed32 runs past EOF', () => {
    const buffer = Buffer.concat([encodeKey(1, 5), Buffer.from([0x01, 0x02])]);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.fields).toEqual([]);
    expect(result.bytesConsumed).toBe(1);
    expect(result.error).toBe('Unexpected EOF for fixed32 at offset 1');
  });

  it('returns previously parsed fields when a later field is malformed', () => {
    const okField = fieldVarint(1, 1);
    const badField = Buffer.from([0x0b]); // field 1, wire type 3 (unsupported)
    const buffer = Buffer.concat([okField, badField]);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]!).toMatchObject({ fieldNumber: 1, wireType: 0, value: 1 });
    expect(result.error).toBe('Unsupported wire type 3 at offset 3');
    expect(result.bytesConsumed).toBe(3);
  });

  it('returns error when length-delimited field length is too large', () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    const buffer = Buffer.concat([encodeKey(1, 2), encodeVarint(huge)]);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.fields).toEqual([]);
    expect(result.error).toBe(`Length-delimited field is too large at offset ${buffer.length}`);
  });

  it('returns error when fixed64 runs past EOF', () => {
    const buffer = Buffer.concat([encodeKey(1, 1), Buffer.from([0x01, 0x02, 0x03])]);
    const result = tool.parseProtobufMessage(buffer, 0, 5);
    expect(result.fields).toEqual([]);
    expect(result.bytesConsumed).toBe(1);
    expect(result.error).toBe('Unexpected EOF for fixed64 at offset 1');
  });
});
