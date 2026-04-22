import { describe, it, expect } from 'vitest';
import { EncodingHandlersBase } from '@server/domains/encoding/handlers.base';

class TestableFormat extends EncodingHandlersBase {
  constructor() {
    super(null as any);
  }

  public isMostlyPrintableText(text: string) {
    return super.isMostlyPrintableText(text);
  }
  public previewHex(buffer: Buffer, maxBytes: number) {
    return super.previewHex(buffer, maxBytes);
  }
  public hexDump(buffer: Buffer, bytesPerRow?: number) {
    return super.hexDump(buffer, bytesPerRow);
  }
  public decodeHexString(value: string) {
    return super.decodeHexString(value);
  }
  public decodeBase64String(value: string) {
    return super.decodeBase64String(value);
  }
  public decodeBinaryAuto(value: string) {
    return super.decodeBinaryAuto(value);
  }
  public looksLikeHex(value: string) {
    return super.looksLikeHex(value);
  }
  public looksLikeBase64(value: string) {
    return super.looksLikeBase64(value);
  }
  public looksLikeUrlEncoded(value: string) {
    return super.looksLikeUrlEncoded(value);
  }
  public decodeUrl(value: string) {
    return super.decodeUrl(value);
  }
  public encodeUrlBytes(buffer: Buffer) {
    return super.encodeUrlBytes(buffer);
  }
  public toSafeUtf8(buffer: Buffer) {
    return super.toSafeUtf8(buffer);
  }
  public tryParseJson(text: string) {
    return super.tryParseJson(text);
  }

  // Not part of the requested "pure utility" list, but still protected on the class.
  public renderDecodedOutput(params: any) {
    return super.renderDecodedOutput(params);
  }
  public ok(payload: Record<string, unknown>) {
    return super.ok(payload);
  }
  public fail(tool: string, error: any) {
    return super.fail(tool, error);
  }
}

const format = new TestableFormat();

describe('EncodingHandlersBase (format utilities)', () => {
  describe('isMostlyPrintableText', () => {
    it('returns true for empty string', async () => {
      expect(format.isMostlyPrintableText('')).toBe(true);
    });

    it('returns true for all printable ASCII text', async () => {
      expect(format.isMostlyPrintableText('Hello, world!')).toBe(true);
    });

    it('treats tab/newline/carriage-return as printable', async () => {
      expect(format.isMostlyPrintableText('line1\nline2\tend\r')).toBe(true);
    });

    it('returns false when printable ratio is below 85%', async () => {
      const text = 'A'.repeat(16) + '\u0000'.repeat(4); // 16/20 = 0.8
      expect(format.isMostlyPrintableText(text)).toBe(false);
    });

    it('returns true exactly at the 85% boundary', async () => {
      const text = 'A'.repeat(17) + '\u0000'.repeat(3); // 17/20 = 0.85
      expect(format.isMostlyPrintableText(text)).toBe(true);
    });

    it('does not count non-ASCII unicode as printable', async () => {
      expect(format.isMostlyPrintableText('你好')).toBe(false);
    });
  });

  describe('previewHex', () => {
    it('returns empty string for empty buffer', async () => {
      expect(format.previewHex(Buffer.alloc(0), 16)).toBe('');
    });

    it('returns empty string when maxBytes is 0', async () => {
      expect(format.previewHex(Buffer.from([0x00, 0x01]), 0)).toBe('');
    });

    it('formats short buffer as two-digit lowercase hex bytes separated by spaces', async () => {
      expect(format.previewHex(Buffer.from([0x00, 0x01, 0xff]), 10)).toBe('00 01 ff');
    });

    it('truncates output at maxBytes', async () => {
      expect(format.previewHex(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]), 3)).toBe('00 01 02');
    });

    it('does not add extra spaces for a single byte', async () => {
      expect(format.previewHex(Buffer.from([0xab]), 1)).toBe('ab');
    });
  });

  describe('hexDump', () => {
    it('returns empty string for empty buffer', async () => {
      expect(format.hexDump(Buffer.alloc(0))).toBe('');
    });

    it('dumps a single 16-byte row with correct offset, hex, and ASCII columns', async () => {
      const buffer = Buffer.from('0123456789abcdef', 'ascii');
      const expected =
        '00000000  30 31 32 33 34 35 36 37 38 39 61 62 63 64 65 66  |0123456789abcdef|';
      expect(format.hexDump(buffer)).toBe(expected);
    });

    it("renders non-printable bytes as '.' in ASCII column", async () => {
      const buffer = Buffer.from([0x41, 0x00, 0x42, 0x7f, 0x20, 0xff]);
      const dump = format.hexDump(buffer);
      expect(dump).toMatch(/^00000000  41 00 42 7f 20 ff\s+\|A\.B\. \.\|$/);
    });

    it('produces multiple rows when buffer exceeds bytesPerRow', async () => {
      const buffer = Buffer.from(Array.from({ length: 20 }, (_, i) => i));
      const dump = format.hexDump(buffer);
      const lines = dump.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('00000000');
      expect(lines[0]).toContain('|................|');
      expect(lines[1]).toContain('00000010');
      expect(lines[1]).toContain('|....|');
    });

    it('supports custom bytesPerRow', async () => {
      const buffer = Buffer.from(Array.from({ length: 9 }, (_, i) => i));
      const dump = format.hexDump(buffer, 8);
      const lines = dump.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('00000000');
      expect(lines[1]).toContain('00000008');
    });

    it('uses lowercase hex in the hex column', async () => {
      const dump = format.hexDump(Buffer.from([0xab]));
      expect(dump).toContain('ab');
    });

    it('pads the hex column for short rows before the ASCII column', async () => {
      const dump = format.hexDump(Buffer.from('Hi', 'ascii'));
      expect(dump).toMatch(/00000000  48 69\s{2,}\|Hi\|$/);
    });

    it('does not end with a trailing newline', async () => {
      const buffer = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
      const dump = format.hexDump(buffer);
      expect(dump.endsWith('\n')).toBe(false);
    });
  });

  describe('decodeHexString', () => {
    it('decodes a plain hex string', async () => {
      expect(format.decodeHexString('deadbeef')).toEqual(Buffer.from('deadbeef', 'hex'));
    });

    it('decodes uppercase hex string', async () => {
      expect(format.decodeHexString('DEADBEEF')).toEqual(Buffer.from('deadbeef', 'hex'));
    });

    it('decodes hex with 0x prefix', async () => {
      expect(format.decodeHexString('0xdeadbeef')).toEqual(Buffer.from('deadbeef', 'hex'));
    });

    it('decodes hex with 0X prefix and embedded spaces', async () => {
      expect(format.decodeHexString('0XDE AD BE EF')).toEqual(Buffer.from('deadbeef', 'hex'));
    });

    it('decodes colon-separated hex', async () => {
      expect(format.decodeHexString('de:ad:be:ef')).toEqual(Buffer.from('deadbeef', 'hex'));
    });

    it('decodes hex with mixed separators (spaces, hyphens, commas)', async () => {
      expect(format.decodeHexString('de-ad be,ef')).toEqual(Buffer.from('deadbeef', 'hex'));
    });

    it('returns empty buffer for empty string', async () => {
      expect(format.decodeHexString('')).toEqual(Buffer.alloc(0));
    });

    it('returns empty buffer for whitespace-only string', async () => {
      expect(format.decodeHexString('   \n\t  ')).toEqual(Buffer.alloc(0));
    });

    it('returns empty buffer for only 0x prefix', async () => {
      expect(format.decodeHexString('0x')).toEqual(Buffer.alloc(0));
    });

    it('throws on odd-length hex', async () => {
      expect(() => format.decodeHexString('abc')).toThrow('Invalid hex string');
    });

    it('throws on non-hex characters', async () => {
      expect(() => format.decodeHexString('0x0g')).toThrow('Invalid hex string');
    });

    it('throws when separators are not recognized (e.g., underscore)', async () => {
      expect(() => format.decodeHexString('aabb__ccdd')).toThrow('Invalid hex string');
    });
  });

  describe('decodeBase64String', () => {
    it('decodes valid base64', async () => {
      expect(format.decodeBase64String('aGVsbG8=')).toEqual(Buffer.from('hello', 'utf8'));
    });

    it('decodes base64 containing spaces', async () => {
      expect(format.decodeBase64String('aGVs bG8=')).toEqual(Buffer.from('hello', 'utf8'));
    });

    it('decodes base64 containing newlines and tabs', async () => {
      expect(format.decodeBase64String('aGVs\n\tbG8=')).toEqual(Buffer.from('hello', 'utf8'));
    });

    it('returns empty buffer for empty string', async () => {
      expect(format.decodeBase64String('')).toEqual(Buffer.alloc(0));
    });

    it('returns empty buffer for whitespace-only string', async () => {
      expect(format.decodeBase64String('   \n\t  ')).toEqual(Buffer.alloc(0));
    });

    it('throws on invalid characters', async () => {
      expect(() => format.decodeBase64String('aGVsbG8$')).toThrow('Invalid base64 string');
    });

    it('throws when length is not a multiple of 4', async () => {
      expect(() => format.decodeBase64String('aGVsbG8')).toThrow('Invalid base64 string');
    });

    it('throws on non-canonical base64 (roundtrip mismatch)', async () => {
      expect(() => format.decodeBase64String('Zm9=')).toThrow('Invalid base64 string');
    });

    it('throws on base64url-like alphabet characters', async () => {
      expect(() => format.decodeBase64String('-w==')).toThrow('Invalid base64 string');
      expect(() => format.decodeBase64String('_w==')).toThrow('Invalid base64 string');
    });
  });

  describe('decodeBinaryAuto', () => {
    it('returns empty buffer for empty string', async () => {
      expect(format.decodeBinaryAuto('')).toEqual(Buffer.alloc(0));
    });

    it('returns empty buffer for whitespace-only string', async () => {
      expect(format.decodeBinaryAuto('   \n\t  ')).toEqual(Buffer.alloc(0));
    });

    it('auto-detects hex (0x prefix)', async () => {
      expect(format.decodeBinaryAuto('0x666f6f')).toEqual(Buffer.from('foo', 'utf8'));
    });

    it('auto-detects hex with separators', async () => {
      expect(format.decodeBinaryAuto('66 6f 6f')).toEqual(Buffer.from('foo', 'utf8'));
    });

    it('auto-detects base64', async () => {
      expect(format.decodeBinaryAuto('Zm9v')).toEqual(Buffer.from('foo', 'utf8'));
    });

    it('auto-detects base64 with whitespace', async () => {
      expect(format.decodeBinaryAuto('Zm 9v')).toEqual(Buffer.from('foo', 'utf8'));
    });

    it('falls back to utf8 for plain strings', async () => {
      expect(format.decodeBinaryAuto('hello')).toEqual(Buffer.from('hello', 'utf8'));
    });

    it('trims input before utf8 fallback', async () => {
      expect(format.decodeBinaryAuto('  hello  ')).toEqual(Buffer.from('hello', 'utf8'));
    });

    it('prefers hex over base64 when both could match', async () => {
      expect(format.decodeBinaryAuto('deadbeef')).toEqual(Buffer.from('deadbeef', 'hex'));
    });

    it('treats invalid base64 as utf8 (no throw)', async () => {
      expect(format.decodeBinaryAuto('Zm9=')).toEqual(Buffer.from('Zm9=', 'utf8'));
    });
  });

  describe('looksLikeHex', () => {
    it('returns true for a valid hex string', async () => {
      expect(format.looksLikeHex('deadbeef')).toBe(true);
    });

    it('returns true for uppercase hex', async () => {
      expect(format.looksLikeHex('DEADBEEF')).toBe(true);
    });

    it('returns true for 0x-prefixed hex', async () => {
      expect(format.looksLikeHex('0xdeadbeef')).toBe(true);
    });

    it('returns true for 0X-prefixed hex with separators', async () => {
      expect(format.looksLikeHex('0XDE AD')).toBe(true);
    });

    it('returns true for colon-separated hex', async () => {
      expect(format.looksLikeHex('de:ad:be:ef')).toBe(true);
    });

    it('returns true for mixed separators (spaces, hyphens, commas)', async () => {
      expect(format.looksLikeHex('de-ad be,ef')).toBe(true);
    });

    it('returns false for odd-length strings', async () => {
      expect(format.looksLikeHex('abc')).toBe(false);
    });

    it('returns false for non-hex characters', async () => {
      expect(format.looksLikeHex('0x0g')).toBe(false);
    });

    it('returns false for empty string', async () => {
      expect(format.looksLikeHex('')).toBe(false);
    });

    it('returns false for only prefix', async () => {
      expect(format.looksLikeHex('0x')).toBe(false);
    });

    it('returns false when separators are not recognized (e.g., underscore)', async () => {
      expect(format.looksLikeHex('aabb__ccdd')).toBe(false);
    });
  });

  describe('looksLikeBase64', () => {
    it('returns true for valid unpadded base64', async () => {
      expect(format.looksLikeBase64('Zm9v')).toBe(true);
    });

    it('returns true for valid padded base64', async () => {
      expect(format.looksLikeBase64('Zg==')).toBe(true);
    });

    it('returns true for base64 containing + and /', async () => {
      expect(format.looksLikeBase64('+w==')).toBe(true);
      expect(format.looksLikeBase64('/w==')).toBe(true);
    });

    it('returns true for valid base64 with whitespace', async () => {
      expect(format.looksLikeBase64('Zm 9v\n')).toBe(true);
    });

    it('returns false for empty string', async () => {
      expect(format.looksLikeBase64('')).toBe(false);
    });

    it('returns false when length is not a multiple of 4', async () => {
      expect(format.looksLikeBase64('Zg=')).toBe(false);
      expect(format.looksLikeBase64('Zm9vYg')).toBe(false);
    });

    it('returns false for invalid characters', async () => {
      expect(format.looksLikeBase64('Zm9v*')).toBe(false);
      expect(format.looksLikeBase64('-w==')).toBe(false);
      expect(format.looksLikeBase64('_w==')).toBe(false);
    });

    it('returns false for too much padding', async () => {
      expect(format.looksLikeBase64('Zg===')).toBe(false);
    });

    it('returns false for padding in the middle', async () => {
      expect(format.looksLikeBase64('Zg==Zg==')).toBe(false);
    });

    it('returns false when base64 decodes but fails canonical roundtrip', async () => {
      expect(format.looksLikeBase64('Zm9=')).toBe(false);
    });
  });

  describe('looksLikeUrlEncoded', () => {
    it('returns true when it contains %XX sequences', async () => {
      expect(format.looksLikeUrlEncoded('%7B%7D')).toBe(true);
    });

    it('returns true when it contains +', async () => {
      expect(format.looksLikeUrlEncoded('a+b')).toBe(true);
    });

    it('returns false for plain text', async () => {
      expect(format.looksLikeUrlEncoded('plain text')).toBe(false);
    });

    it('returns false for % not followed by two hex digits', async () => {
      expect(format.looksLikeUrlEncoded('100% sure')).toBe(false);
      expect(format.looksLikeUrlEncoded('%zz')).toBe(false);
    });

    it('treats literal + as a signal even if not truly encoded', async () => {
      expect(format.looksLikeUrlEncoded('x+y+z')).toBe(true);
    });
  });

  describe('decodeUrl', () => {
    it('decodes %XX sequences', async () => {
      expect(format.decodeUrl('hello%20world')).toBe('hello world');
    });

    it('treats + as space', async () => {
      expect(format.decodeUrl('a+b')).toBe('a b');
    });

    it('does not treat %2B as space', async () => {
      expect(format.decodeUrl('a%2Bb')).toBe('a+b');
    });

    it('decodes UTF-8 percent-encoded sequences', async () => {
      expect(format.decodeUrl('%E4%BD%A0%E5%A5%BD')).toBe('你好');
    });

    it('decodes mixed reserved characters', async () => {
      expect(format.decodeUrl('x%2Fy%3Fz%3D1')).toBe('x/y?z=1');
    });

    it('returns empty string for empty input', async () => {
      expect(format.decodeUrl('')).toBe('');
    });

    it('decodes %25 back to %', async () => {
      expect(format.decodeUrl('100%25')).toBe('100%');
    });
  });

  describe('encodeUrlBytes', () => {
    it('passes through unreserved characters', async () => {
      const input = Buffer.from('AZaz09-._~', 'ascii');
      expect(format.encodeUrlBytes(input)).toBe('AZaz09-._~');
    });

    it('encodes spaces as %20', async () => {
      expect(format.encodeUrlBytes(Buffer.from('a b', 'ascii'))).toBe('a%20b');
    });

    it('encodes reserved/special ASCII characters using %XX', async () => {
      expect(format.encodeUrlBytes(Buffer.from('/?:#[]@', 'ascii'))).toBe('%2F%3F%3A%23%5B%5D%40');
    });

    it('encodes % as %25', async () => {
      expect(format.encodeUrlBytes(Buffer.from('%', 'ascii'))).toBe('%25');
    });

    it('encodes + as %2B (not as +)', async () => {
      expect(format.encodeUrlBytes(Buffer.from('+', 'ascii'))).toBe('%2B');
    });

    it('encodes raw bytes outside ASCII using uppercase hex', async () => {
      expect(format.encodeUrlBytes(Buffer.from([0xff, 0xab, 0x00]))).toBe('%FF%AB%00');
    });

    it('encodes newline as %0A', async () => {
      expect(format.encodeUrlBytes(Buffer.from([0x0a]))).toBe('%0A');
    });

    it('percent-encodes UTF-8 bytes of non-ASCII text', async () => {
      expect(format.encodeUrlBytes(Buffer.from('你好', 'utf8'))).toBe('%E4%BD%A0%E5%A5%BD');
    });

    it('returns empty string for empty buffer', async () => {
      expect(format.encodeUrlBytes(Buffer.alloc(0))).toBe('');
    });
  });

  describe('toSafeUtf8', () => {
    it('returns empty string for empty buffer', async () => {
      expect(format.toSafeUtf8(Buffer.alloc(0))).toBe('');
    });

    it('returns utf8 text for valid ASCII', async () => {
      expect(format.toSafeUtf8(Buffer.from('hello', 'utf8'))).toBe('hello');
    });

    it('returns utf8 text for valid unicode', async () => {
      expect(format.toSafeUtf8(Buffer.from('你好', 'utf8'))).toBe('你好');
    });

    it('returns null when decoding introduces U+FFFD from invalid UTF-8', async () => {
      // Invalid 2-byte sequence: 0xC3 must be followed by 0x80..0xBF.
      expect(format.toSafeUtf8(Buffer.from([0xc3, 0x28]))).toBeNull();
    });

    it('returns null when the resulting text contains the replacement character (U+FFFD)', async () => {
      expect(format.toSafeUtf8(Buffer.from('\uFFFD', 'utf8'))).toBeNull();
    });

    it('returns null when valid text contains U+FFFD anywhere', async () => {
      expect(format.toSafeUtf8(Buffer.from(`ok\uFFFD`, 'utf8'))).toBeNull();
    });
  });

  describe('tryParseJson', () => {
    it('parses valid object JSON', async () => {
      expect(format.tryParseJson('{"ok":true}')).toEqual({ ok: true });
    });

    it('parses valid array JSON', async () => {
      expect(format.tryParseJson('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('parses valid number JSON', async () => {
      expect(format.tryParseJson('123')).toBe(123);
    });

    it('parses valid string JSON', async () => {
      expect(format.tryParseJson('"str"')).toBe('str');
    });

    it('parses valid null JSON', async () => {
      expect(format.tryParseJson('null')).toBeNull();
    });

    it('returns null for invalid JSON', async () => {
      expect(format.tryParseJson('{')).toBeNull();
      expect(format.tryParseJson('not json')).toBeNull();
    });

    it('returns null for JSON with trailing comma', async () => {
      expect(format.tryParseJson('{ "a": 1, }')).toBeNull();
      expect(format.tryParseJson('[1,2,]')).toBeNull();
    });

    it('handles leading/trailing whitespace for valid JSON', async () => {
      expect(format.tryParseJson(' \n\t {"a":1} \n')).toEqual({ a: 1 });
    });
  });
});
