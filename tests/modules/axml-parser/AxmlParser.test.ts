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
