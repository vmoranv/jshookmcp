import { describe, it, expect } from 'vitest';
import {
  decodeMsgPack,
  decodeMsgPackArray,
  decodeMsgPackMap,
  decodeMsgPackValue,
  ensureRange,
  msgPackMapKey,
} from '@server/domains/encoding/encoding-msgpack';

const tool = {
  decodeMsgPack,
  decodeMsgPackValue,
  decodeMsgPackArray,
  decodeMsgPackMap,
  msgPackMapKey,
  ensureRange,
};

const b = (...bytes: number[]) => Buffer.from(bytes);
const concat = (...parts: Buffer[]) => Buffer.concat(parts);

function u16be(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value, 0);
  return buf;
}

function u32be(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value, 0);
  return buf;
}

function i16be(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeInt16BE(value, 0);
  return buf;
}

function i32be(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(value, 0);
  return buf;
}

function u64be(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(value, 0);
  return buf;
}

function i64be(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(value, 0);
  return buf;
}

function f32be(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(value, 0);
  return buf;
}

function f64be(value: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeDoubleBE(value, 0);
  return buf;
}

function encodeFixStr(value: string): Buffer {
  const payload = Buffer.from(value, 'utf8');
  if (payload.length > 31) {
    throw new Error('encodeFixStr payload too large for fixstr');
  }
  return concat(b(0xa0 | payload.length), payload);
}

function encodeStr8(value: string): Buffer {
  const payload = Buffer.from(value, 'utf8');
  if (payload.length > 0xff) {
    throw new Error('encodeStr8 payload too large for str8');
  }
  return concat(b(0xd9, payload.length), payload);
}

function encodeStr16(value: string): Buffer {
  const payload = Buffer.from(value, 'utf8');
  if (payload.length > 0xffff) {
    throw new Error('encodeStr16 payload too large for str16');
  }
  return concat(b(0xda), u16be(payload.length), payload);
}

function encodeStr32(value: string): Buffer {
  const payload = Buffer.from(value, 'utf8');
  return concat(b(0xdb), u32be(payload.length), payload);
}

function encodeBin8(payload: Buffer): Buffer {
  if (payload.length > 0xff) {
    throw new Error('encodeBin8 payload too large for bin8');
  }
  return concat(b(0xc4, payload.length), payload);
}

function encodeBin16(payload: Buffer): Buffer {
  if (payload.length > 0xffff) {
    throw new Error('encodeBin16 payload too large for bin16');
  }
  return concat(b(0xc5), u16be(payload.length), payload);
}

function encodeBin32(payload: Buffer): Buffer {
  return concat(b(0xc6), u32be(payload.length), payload);
}

function encodeFixArray(items: Buffer[]): Buffer {
  if (items.length > 15) {
    throw new Error('encodeFixArray too long for fixarray');
  }
  return concat(b(0x90 | items.length), ...items);
}

function encodeArray16(items: Buffer[]): Buffer {
  return concat(b(0xdc), u16be(items.length), ...items);
}

function encodeArray32(items: Buffer[]): Buffer {
  return concat(b(0xdd), u32be(items.length), ...items);
}

function encodeFixMap(entries: Array<[Buffer, Buffer]>): Buffer {
  if (entries.length > 15) {
    throw new Error('encodeFixMap too large for fixmap');
  }
  const parts: Buffer[] = [b(0x80 | entries.length)];
  for (const [key, value] of entries) {
    parts.push(key, value);
  }
  return concat(...parts);
}

function encodeMap16(entries: Array<[Buffer, Buffer]>): Buffer {
  const parts: Buffer[] = [b(0xde), u16be(entries.length)];
  for (const [key, value] of entries) {
    parts.push(key, value);
  }
  return concat(...parts);
}

function encodeMap32(entries: Array<[Buffer, Buffer]>): Buffer {
  const parts: Buffer[] = [b(0xdf), u32be(entries.length)];
  for (const [key, value] of entries) {
    parts.push(key, value);
  }
  return concat(...parts);
}

describe('EncodingToolHandlersMsgPack.ensureRange', () => {
  it('allows a valid range', () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02]);
    expect(() => tool.ensureRange(buffer, 1, 2)).not.toThrow();
  });

  it('throws when offset is out of bounds', () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02]);
    expect(() => tool.ensureRange(buffer, 4, 0)).toThrow(
      'Unexpected EOF while reading 0 bytes at offset 4'
    );
  });

  it('throws when length exceeds buffer', () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02]);
    expect(() => tool.ensureRange(buffer, 2, 2)).toThrow(
      'Unexpected EOF while reading 2 bytes at offset 2'
    );
  });

  it('throws on negative values', () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02]);
    expect(() => tool.ensureRange(buffer, -1, 1)).toThrow(
      'Unexpected EOF while reading 1 bytes at offset -1'
    );
    expect(() => tool.ensureRange(buffer, 0, -1)).toThrow(
      'Unexpected EOF while reading -1 bytes at offset 0'
    );
  });
});

describe('EncodingToolHandlersMsgPack.msgPackMapKey', () => {
  it('returns string keys unchanged', () => {
    expect(tool.msgPackMapKey('alpha')).toBe('alpha');
  });

  it('stringifies number keys', () => {
    expect(tool.msgPackMapKey(123)).toBe('123');
  });

  it('stringifies boolean keys', () => {
    expect(tool.msgPackMapKey(true)).toBe('true');
    expect(tool.msgPackMapKey(false)).toBe('false');
  });

  it('stringifies null key as "null"', () => {
    expect(tool.msgPackMapKey(null)).toBe('null');
  });

  it('JSON-stringifies object keys', () => {
    expect(tool.msgPackMapKey({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
  });

  it('falls back to String(value) when JSON.stringify throws', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(tool.msgPackMapKey(circular)).toBe('[object Object]');
  });
});

describe('EncodingToolHandlersMsgPack.decodeMsgPack (single value)', () => {
  it('decodes positive fixint (0x00-0x7f)', () => {
    expect(tool.decodeMsgPack(b(0x00))).toBe(0);
    expect(tool.decodeMsgPack(b(0x7f))).toBe(127);
    expect(tool.decodeMsgPack(b(0x2a))).toBe(42);
  });

  it('decodes negative fixint (0xe0-0xff)', () => {
    expect(tool.decodeMsgPack(b(0xe0))).toBe(-32);
    expect(tool.decodeMsgPack(b(0xff))).toBe(-1);
  });

  it('decodes nil / false / true', () => {
    expect(tool.decodeMsgPack(b(0xc0))).toBeNull();
    expect(tool.decodeMsgPack(b(0xc2))).toBe(false);
    expect(tool.decodeMsgPack(b(0xc3))).toBe(true);
  });

  it('decodes fixstr', () => {
    expect(tool.decodeMsgPack(concat(b(0xa2), Buffer.from('hi', 'utf8')))).toBe('hi');
  });

  it('decodes fixarray', () => {
    const buf = encodeFixArray([b(0x01), encodeFixStr('a')]);
    expect(tool.decodeMsgPack(buf)).toEqual([1, 'a']);
  });

  it('decodes fixmap', () => {
    const buf = encodeFixMap([[encodeFixStr('a'), b(0x01)]]);
    expect(tool.decodeMsgPack(buf)).toEqual({ a: 1 });
  });

  it('decodes uint8', () => {
    expect(tool.decodeMsgPack(b(0xcc, 0xff))).toBe(255);
  });

  it('decodes uint16', () => {
    expect(tool.decodeMsgPack(concat(b(0xcd), u16be(0x1234)))).toBe(0x1234);
  });

  it('decodes uint32', () => {
    expect(tool.decodeMsgPack(concat(b(0xce), u32be(0x89abcdef)))).toBe(0x89abcdef);
  });

  it('decodes uint64 within Number.MAX_SAFE_INTEGER as number', () => {
    const value = 42n;
    expect(tool.decodeMsgPack(concat(b(0xcf), u64be(value)))).toBe(42);
  });

  it('decodes uint64 beyond Number.MAX_SAFE_INTEGER as string', () => {
    const value = 9_007_199_254_740_993n;
    expect(tool.decodeMsgPack(concat(b(0xcf), u64be(value)))).toBe('9007199254740993');
  });

  it('decodes int8', () => {
    expect(tool.decodeMsgPack(b(0xd0, 0xfb))).toBe(-5);
  });

  it('decodes int16', () => {
    expect(tool.decodeMsgPack(concat(b(0xd1), i16be(-300)))).toBe(-300);
  });

  it('decodes int32', () => {
    expect(tool.decodeMsgPack(concat(b(0xd2), i32be(-70_000)))).toBe(-70_000);
  });

  it('decodes int64 within safe range as number', () => {
    const value = -42n;
    expect(tool.decodeMsgPack(concat(b(0xd3), i64be(value)))).toBe(-42);
  });

  it('decodes int64 beyond safe range as string', () => {
    const value = -9_007_199_254_740_993n;
    expect(tool.decodeMsgPack(concat(b(0xd3), i64be(value)))).toBe('-9007199254740993');
  });

  it('decodes float32', () => {
    const buf = concat(b(0xca), f32be(1.5));
    expect(tool.decodeMsgPack(buf)).toBeCloseTo(1.5, 6);
  });

  it('decodes float64', () => {
    const buf = concat(b(0xcb), f64be(1.2345));
    expect(tool.decodeMsgPack(buf)).toBeCloseTo(1.2345, 12);
  });

  it('decodes str8', () => {
    expect(tool.decodeMsgPack(encodeStr8('hey'))).toBe('hey');
  });

  it('decodes str16', () => {
    const text = 'a'.repeat(256);
    expect(tool.decodeMsgPack(encodeStr16(text))).toBe(text);
  });

  it('decodes str32', () => {
    expect(tool.decodeMsgPack(encodeStr32('hello'))).toBe('hello');
  });

  it('decodes bin8', () => {
    const payload = Buffer.from([0x01, 0x02, 0x03]);
    const decoded = tool.decodeMsgPack(encodeBin8(payload));
    expect(decoded).toEqual({
      type: 'bytes',
      base64: payload.toString('base64'),
      hex: payload.toString('hex'),
    });
  });

  it('decodes bin16', () => {
    const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00]);
    const decoded = tool.decodeMsgPack(encodeBin16(payload));
    expect(decoded).toEqual({
      type: 'bytes',
      base64: payload.toString('base64'),
      hex: payload.toString('hex'),
    });
  });

  it('decodes bin32', () => {
    const payload = Buffer.from([0x10, 0x20, 0x30, 0x40]);
    const decoded = tool.decodeMsgPack(encodeBin32(payload));
    expect(decoded).toEqual({
      type: 'bytes',
      base64: payload.toString('base64'),
      hex: payload.toString('hex'),
    });
  });

  it('decodes array16', () => {
    const buf = encodeArray16([encodeFixStr('a')]);
    expect(tool.decodeMsgPack(buf)).toEqual(['a']);
  });

  it('decodes array32', () => {
    const buf = encodeArray32([b(0x01), b(0x02)]);
    expect(tool.decodeMsgPack(buf)).toEqual([1, 2]);
  });

  it('decodes map16', () => {
    const buf = encodeMap16([[encodeFixStr('k'), b(0x01)]]);
    expect(tool.decodeMsgPack(buf)).toEqual({ k: 1 });
  });

  it('decodes map32', () => {
    const buf = encodeMap32([[encodeFixStr('k'), encodeFixStr('v')]]);
    expect(tool.decodeMsgPack(buf)).toEqual({ k: 'v' });
  });

  it('throws when decode does not consume the whole buffer', () => {
    expect(() => tool.decodeMsgPack(b(0x01, 0x00))).toThrow(
      'MessagePack decode ended early: consumed 1 of 2 bytes'
    );
  });
});

describe('EncodingToolHandlersMsgPack.decodeMsgPackValue (offset + safety)', () => {
  it('throws when depth exceeds safety limit', () => {
    expect(() => tool.decodeMsgPackValue(b(0x01), 0, 65)).toThrow(
      'MessagePack decode depth exceeds safety limit'
    );
  });

  it('throws on unexpected EOF when startOffset is beyond buffer', () => {
    expect(() => tool.decodeMsgPackValue(Buffer.alloc(0), 0, 0)).toThrow(
      'Unexpected EOF at offset 0'
    );
    expect(() => tool.decodeMsgPackValue(b(0x01), 2, 0)).toThrow('Unexpected EOF at offset 2');
  });

  it('returns value + next offset without requiring full-buffer consumption', () => {
    const buf = concat(b(0xcc, 0xff), b(0x01));
    const decoded = tool.decodeMsgPackValue(buf, 0, 0);
    expect(decoded).toEqual({ value: 255, offset: 2 });
  });

  it('decodes from a non-zero startOffset', () => {
    const buf = concat(b(0x01), encodeFixStr('a'), b(0x02));
    const decoded = tool.decodeMsgPackValue(buf, 1, 0);
    expect(decoded).toEqual({ value: 'a', offset: 3 });
  });

  it('throws on unsupported prefix', () => {
    expect(() => tool.decodeMsgPackValue(b(0xc1), 0, 0)).toThrow(
      'Unsupported MessagePack prefix 0xc1 at offset 0'
    );
  });

  it('throws on truncated fixstr payload (ensureRange)', () => {
    // fixstr length=2 but only 1 byte present
    expect(() => tool.decodeMsgPackValue(b(0xa2, 0x61), 0, 0)).toThrow(
      'Unexpected EOF while reading 2 bytes at offset 1'
    );
  });

  it('decodes fixext1', () => {
    const payload = Buffer.from([0xab]);
    const buf = concat(b(0xd4), b(0x05), payload);
    expect(tool.decodeMsgPackValue(buf, 0, 0)).toEqual({
      value: {
        type: 'ext',
        extType: 5,
        base64: payload.toString('base64'),
        hex: payload.toString('hex'),
      },
      offset: 3,
    });
  });

  it('decodes ext8', () => {
    const payload = Buffer.from([0xde, 0xad, 0xbe]);
    const buf = concat(b(0xc7, payload.length), b(0xff), payload);
    const decoded = tool.decodeMsgPackValue(buf, 0, 0);
    expect(decoded).toEqual({
      value: {
        type: 'ext',
        extType: -1,
        base64: payload.toString('base64'),
        hex: payload.toString('hex'),
      },
      offset: 1 + 1 + 1 + payload.length,
    });
  });
});

describe('EncodingToolHandlersMsgPack.decodeMsgPackArray', () => {
  it('decodes an empty array when length=0', () => {
    const decoded = tool.decodeMsgPackArray(Buffer.alloc(0), 0, 0, 0);
    expect(decoded).toEqual({ value: [], offset: 0 });
  });

  it('decodes an array with mixed types', () => {
    const buf = concat(b(0x01), encodeFixStr('a'), b(0xc0), b(0xc3));
    const decoded = tool.decodeMsgPackArray(buf, 0, 4, 0);
    expect(decoded).toEqual({ value: [1, 'a', null, true], offset: buf.length });
  });
});

describe('EncodingToolHandlersMsgPack.decodeMsgPackMap', () => {
  it('decodes an empty map when length=0', () => {
    const decoded = tool.decodeMsgPackMap(Buffer.alloc(0), 0, 0, 0);
    expect(decoded).toEqual({ value: {}, offset: 0 });
  });

  it('decodes a map with various key/value types', () => {
    const buf = concat(
      encodeFixStr('a'),
      b(0x01),
      b(0x02),
      b(0xc2),
      b(0xc3),
      encodeFixStr('yes'),
      b(0xc0),
      b(0x00)
    );
    const decoded = tool.decodeMsgPackMap(buf, 0, 4, 0);
    expect(decoded).toEqual({
      value: { a: 1, '2': false, true: 'yes', null: 0 },
      offset: buf.length,
    });
  });
});

describe('Roundtrip (manually encoded bytes -> decodeMsgPack)', () => {
  it('decodes a nested structure with arrays, maps, and bytes', () => {
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const nested = encodeFixMap([
      [encodeFixStr('arr'), encodeFixArray([b(0x01), b(0x02), encodeFixStr('x')])],
      [encodeFixStr('bin'), encodeBin8(bytes)],
      [encodeFixStr('nested'), encodeFixMap([[b(0xc3), b(0xc2)]])],
    ]);

    expect(tool.decodeMsgPack(nested)).toEqual({
      arr: [1, 2, 'x'],
      bin: { type: 'bytes', base64: bytes.toString('base64'), hex: bytes.toString('hex') },
      nested: { true: false },
    });
  });

  it('decodes numbers across multiple integer widths consistently', () => {
    const asFixInt = b(0x2a);
    const asUint8 = concat(b(0xcc), b(0x2a));
    const asUint16 = concat(b(0xcd), u16be(0x2a));
    const asUint32 = concat(b(0xce), u32be(0x2a));
    const asUint64 = concat(b(0xcf), u64be(42n));

    expect(tool.decodeMsgPack(asFixInt)).toBe(42);
    expect(tool.decodeMsgPack(asUint8)).toBe(42);
    expect(tool.decodeMsgPack(asUint16)).toBe(42);
    expect(tool.decodeMsgPack(asUint32)).toBe(42);
    expect(tool.decodeMsgPack(asUint64)).toBe(42);
  });

  it('decodes strings across str8/str16/str32 consistently', () => {
    expect(tool.decodeMsgPack(encodeStr8('ok'))).toBe('ok');
    expect(tool.decodeMsgPack(encodeStr16('ok'))).toBe('ok');
    expect(tool.decodeMsgPack(encodeStr32('ok'))).toBe('ok');
  });
});
