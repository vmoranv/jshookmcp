import { describe, it, expect } from 'vitest';

import {
  buildPatternBytesAndMask,
  patternToBytesMac,
} from '@modules/process/memory/scanner.patterns';

describe('scanner.patterns', () => {
  describe('buildPatternBytesAndMask', () => {
    it('parses hex pattern with concrete bytes', () => {
      const result = buildPatternBytesAndMask('AA BB CC', 'hex');
      expect(result.patternBytes).toEqual([0xaa, 0xbb, 0xcc]);
      expect(result.mask).toEqual([1, 1, 1]);
    });

    it('handles wildcard bytes in hex patterns', () => {
      const result = buildPatternBytesAndMask('AA ?? BB ** CC ?', 'hex');
      expect(result.patternBytes).toEqual([0xaa, 0, 0xbb, 0, 0xcc, 0]);
      expect(result.mask).toEqual([1, 0, 1, 0, 1, 0]);
    });

    it('parses int32 into little-endian bytes', () => {
      const result = buildPatternBytesAndMask('256', 'int32');
      // 256 = 0x00000100 LE => [0x00, 0x01, 0x00, 0x00]
      expect(result.patternBytes).toEqual([0, 1, 0, 0]);
      expect(result.mask).toEqual([1, 1, 1, 1]);
    });

    it('parses negative int32 values', () => {
      const result = buildPatternBytesAndMask('-1', 'int32');
      // -1 in int32 LE => [0xFF, 0xFF, 0xFF, 0xFF]
      expect(result.patternBytes).toEqual([0xff, 0xff, 0xff, 0xff]);
      expect(result.mask).toEqual([1, 1, 1, 1]);
    });

    it('parses int64 into 8-byte little-endian', () => {
      const result = buildPatternBytesAndMask('1', 'int64');
      expect(result.patternBytes).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
      expect(result.mask).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    });

    it('parses float into 4-byte LE representation', () => {
      const result = buildPatternBytesAndMask('1.0', 'float');
      // 1.0f = 0x3F800000 LE => [0x00, 0x00, 0x80, 0x3F]
      expect(result.patternBytes).toEqual([0x00, 0x00, 0x80, 0x3f]);
      expect(result.mask).toEqual([1, 1, 1, 1]);
    });

    it('parses double into 8-byte LE representation', () => {
      const result = buildPatternBytesAndMask('1.0', 'double');
      // 1.0d = 0x3FF0000000000000 LE => [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xF0, 0x3F]
      expect(result.patternBytes).toEqual([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f]);
      expect(result.mask).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    });

    it('parses string into UTF-8 bytes', () => {
      const result = buildPatternBytesAndMask('AB', 'string');
      expect(result.patternBytes).toEqual([0x41, 0x42]);
      expect(result.mask).toEqual([1, 1]);
    });

    it('throws on empty hex pattern', () => {
      expect(() => buildPatternBytesAndMask('', 'hex')).toThrow('Invalid pattern');
    });

    it('throws on invalid int32', () => {
      expect(() => buildPatternBytesAndMask('notanumber', 'int32')).toThrow('Invalid pattern');
    });

    it('throws on invalid float', () => {
      expect(() => buildPatternBytesAndMask('notanumber', 'float')).toThrow('Invalid pattern');
    });

    it('throws on invalid double', () => {
      expect(() => buildPatternBytesAndMask('notanumber', 'double')).toThrow('Invalid pattern');
    });
  });

  describe('patternToBytesMac', () => {
    it('parses hex pattern with wildcards', () => {
      const result = patternToBytesMac('AA ?? CC', 'hex');
      expect(result.bytes).toEqual([0xaa, 0, 0xcc]);
      expect(result.mask).toEqual([1, 0, 1]);
    });

    it('handles all wildcard forms (?, ??, **)', () => {
      const result = patternToBytesMac('FF ? ?? ** 00', 'hex');
      expect(result.bytes).toEqual([0xff, 0, 0, 0, 0]);
      expect(result.mask).toEqual([1, 0, 0, 0, 1]);
    });

    it('throws on invalid hex byte', () => {
      expect(() => patternToBytesMac('AA ZZ CC', 'hex')).toThrow('Invalid hex byte: ZZ');
    });

    it('throws on empty hex pattern', () => {
      // Empty string splits into [''] which is an invalid hex byte
      expect(() => patternToBytesMac('', 'hex')).toThrow('Invalid hex byte');
    });

    it('parses int32 correctly', () => {
      const result = patternToBytesMac('42', 'int32');
      const expected = Buffer.allocUnsafe(4);
      expected.writeInt32LE(42, 0);
      expect(result.bytes).toEqual(Array.from(expected));
      expect(result.mask).toEqual([1, 1, 1, 1]);
    });

    it('throws on invalid int32', () => {
      expect(() => patternToBytesMac('abc', 'int32')).toThrow('Invalid int32 value');
    });

    it('parses int64 correctly', () => {
      const result = patternToBytesMac('100', 'int64');
      const expected = Buffer.allocUnsafe(8);
      expected.writeBigInt64LE(100n, 0);
      expect(result.bytes).toEqual(Array.from(expected));
      expect(result.mask).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    });

    it('parses float correctly', () => {
      const result = patternToBytesMac('3.14', 'float');
      const expected = Buffer.allocUnsafe(4);
      expected.writeFloatLE(3.14, 0);
      expect(result.bytes).toEqual(Array.from(expected));
    });

    it('throws on invalid float', () => {
      expect(() => patternToBytesMac('xyz', 'float')).toThrow('Invalid float value');
    });

    it('parses double correctly', () => {
      const result = patternToBytesMac('2.718', 'double');
      const expected = Buffer.allocUnsafe(8);
      expected.writeDoubleLE(2.718, 0);
      expect(result.bytes).toEqual(Array.from(expected));
    });

    it('throws on invalid double', () => {
      expect(() => patternToBytesMac('xyz', 'double')).toThrow('Invalid double value');
    });

    it('parses string into UTF-8 bytes', () => {
      const result = patternToBytesMac('Hello', 'string');
      expect(result.bytes).toEqual([72, 101, 108, 108, 111]);
      expect(result.mask).toEqual([1, 1, 1, 1, 1]);
    });

    it('throws on unsupported pattern type', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(() => patternToBytesMac('test', 'binary' as any)).toThrow('Unsupported pattern type');
    });
  });
});
