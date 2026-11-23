import { describe, it, expect } from 'vitest';
import { AxmlParser, parseAxml } from '@modules/axml-parser';

describe('AxmlParser', () => {
  describe('parseAxml', () => {
    it('should return null for invalid header', () => {
      const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00]);
      const result = parseAxml(buffer);
      expect(result).toBeNull();
    });

    it('should return null for empty buffer', () => {
      const buffer = Buffer.alloc(0);
      const result = parseAxml(buffer);
      expect(result).toBeNull();
    });

    it('should return null for buffer too small', () => {
      const buffer = Buffer.from([0x03, 0x00, 0x08]);
      const result = parseAxml(buffer);
      expect(result).toBeNull();
    });

    it('should return null for malformed string pool', () => {
      const buffer = Buffer.alloc(100);
      // Valid XML header
      buffer.writeUInt32LE(0x00080003, 0); // CHUNK_TYPE.XML
      buffer.writeUInt32LE(100, 4); // chunk size
      // Invalid string pool header
      buffer.writeUInt32LE(0x001c0001, 8); // CHUNK_TYPE.STRING_POOL
      buffer.writeUInt32LE(50, 12); // chunk size
      buffer.writeUInt32LE(999999, 16); // unrealistic string count

      const result = parseAxml(buffer);
      expect(result).toBeNull();
    });

    it('should handle binary AXML buffers gracefully', () => {
      // Create a buffer that looks like AXML but has internal inconsistencies
      const buffer = Buffer.alloc(200);
      buffer.writeUInt32LE(0x00080003, 0); // Valid XML chunk type
      buffer.writeUInt32LE(200, 4);
      buffer.writeUInt32LE(0x001c0001, 8); // String pool chunk
      buffer.writeUInt32LE(100, 12);
      buffer.writeUInt32LE(5, 16); // 5 strings
      buffer.writeUInt32LE(0, 20); // 0 styles

      const result = parseAxml(buffer);
      // Should either parse successfully or return null, but not crash
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });

  describe('AxmlParser class', () => {
    it('should throw error for non-XML chunk type', () => {
      const buffer = Buffer.alloc(8);
      buffer.writeUInt32LE(0x12345678, 0); // invalid chunk type
      buffer.writeUInt32LE(8, 4);

      const parser = new AxmlParser(buffer);
      expect(() => parser.parse()).toThrow('Invalid AXML header');
    });

    it('should throw error for missing string pool', () => {
      const buffer = Buffer.alloc(16);
      buffer.writeUInt32LE(0x00080003, 0); // valid XML header
      buffer.writeUInt32LE(16, 4);
      buffer.writeUInt32LE(0x99999999, 8); // invalid chunk type (not STRING_POOL)

      const parser = new AxmlParser(buffer);
      expect(() => parser.parse()).toThrow('Expected STRING_POOL chunk');
    });

    it('should handle edge cases gracefully', () => {
      // Test with various malformed but structurally valid AXML
      const buffer = Buffer.alloc(100);
      buffer.writeUInt32LE(0x00080003, 0); // XML header
      buffer.writeUInt32LE(100, 4);
      buffer.writeUInt32LE(0x001c0001, 8); // STRING_POOL
      buffer.writeUInt32LE(50, 12);
      buffer.writeUInt32LE(2, 16); // 2 strings
      buffer.writeUInt32LE(0, 20); // 0 styles
      buffer.writeUInt32LE(0x00000100, 24); // UTF-8 flag
      buffer.writeUInt32LE(36, 28); // strings offset
      buffer.writeUInt32LE(0, 32); // styles offset

      const result = parseAxml(buffer);
      // Should either parse or return null, not crash
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });
});

describe('AxmlParser string pool decoding', () => {
  it('reads the chunk size (not the chunk type) and resolves strings', () => {
    // Minimal AXML: file header + UTF-8 string pool ("manifest") + start/end tag.
    const buffer = Buffer.alloc(112);
    buffer.writeUInt32LE(0x00080003, 0);
    buffer.writeUInt32LE(112, 4);

    // STRING_POOL chunk at 8 (28-byte header + 4-byte offset table + 11-byte
    // UTF-8 string + 1 pad = 44).
    buffer.writeUInt32LE(0x001c0001, 8);
    buffer.writeUInt32LE(44, 12);
    buffer.writeUInt32LE(1, 16); // string count
    buffer.writeUInt32LE(0, 20); // style count
    buffer.writeUInt32LE(0x00000100, 24); // UTF-8 flag
    buffer.writeUInt32LE(32, 28); // strings start (relative to chunk)
    buffer.writeUInt32LE(0, 32); // styles start
    buffer.writeUInt32LE(0, 36); // string offset 0
    buffer.writeUInt8(8, 40); // char count
    buffer.writeUInt8(8, 41); // byte count
    buffer.write('manifest', 42, 'utf8');
    buffer.writeUInt8(0, 50);

    // START_TAG at 52, name index 0.
    buffer.writeUInt32LE(0x00100102, 52);
    buffer.writeUInt32LE(36, 56);
    buffer.writeUInt32LE(1, 60);
    buffer.writeUInt32LE(0xffffffff, 64);
    buffer.writeUInt32LE(0xffffffff, 68);
    buffer.writeUInt32LE(0, 72);
    buffer.writeUInt16LE(20, 76);
    buffer.writeUInt16LE(20, 78);
    buffer.writeUInt16LE(0, 80);
    buffer.writeUInt16LE(0, 82);
    buffer.writeUInt16LE(0, 84);
    buffer.writeUInt16LE(0, 86);

    // END_TAG at 88.
    buffer.writeUInt32LE(0x00100103, 88);
    buffer.writeUInt32LE(24, 92);
    buffer.writeUInt32LE(2, 96);
    buffer.writeUInt32LE(0xffffffff, 100);
    buffer.writeUInt32LE(0xffffffff, 104);
    buffer.writeUInt32LE(0, 108);

    const xml = parseAxml(buffer);
    expect(xml).not.toBeNull();
    expect(xml).toContain('<manifest>');
    expect(xml).toContain('</manifest>');
  });
});
