import { describe, it, expect } from 'vitest';
import {
  DECODE_ENCODING_SET,
  DETECT_SOURCE_SET,
  ENTROPY_SOURCE_SET,
  INPUT_FORMAT_SET,
  MAGIC_SIGNATURES,
  OUTPUT_ENCODING_SET,
  OUTPUT_FORMAT_SET,
} from '@server/domains/encoding/handlers.impl.core.runtime.shared';
import type {
  ByteFrequencyEntry,
  DecodeEncoding,
  DetectSource,
  EntropyAssessment,
  EntropySource,
  InputFormat,
  MagicSignature,
  MsgPackDecodeResult,
  OutputEncoding,
  OutputFormat,
  ProtobufFieldNode,
  ProtobufParseResult,
} from '@server/domains/encoding/handlers.impl.core.runtime.shared';

describe('encoding/handlers.impl.core.runtime.shared', () => {
  /* ---------- DETECT_SOURCE_SET ---------- */

  describe('DETECT_SOURCE_SET', () => {
    it('contains all expected DetectSource values', async () => {
      const expected: DetectSource[] = ['base64', 'hex', 'file', 'raw'];
      for (const val of expected) {
        expect(DETECT_SOURCE_SET.has(val)).toBe(true);
      }
    });

    it('has exactly 4 members', async () => {
      expect(DETECT_SOURCE_SET.size).toBe(4);
    });

    it('rejects unknown source values', async () => {
      expect(DETECT_SOURCE_SET.has('invalid' as DetectSource)).toBe(false);
      expect(DETECT_SOURCE_SET.has('' as DetectSource)).toBe(false);
      expect(DETECT_SOURCE_SET.has('BASE64' as DetectSource)).toBe(false);
    });

    it('is typed as ReadonlySet (no add method on type)', async () => {
      // ReadonlySet enforces immutability at the type level
      // Verify it is a Set instance but the exported type hides mutating methods
      expect(DETECT_SOURCE_SET).toBeInstanceOf(Set);
    });
  });

  /* ---------- ENTROPY_SOURCE_SET ---------- */

  describe('ENTROPY_SOURCE_SET', () => {
    it('contains all expected EntropySource values', async () => {
      const expected: EntropySource[] = ['base64', 'hex', 'raw', 'file'];
      for (const val of expected) {
        expect(ENTROPY_SOURCE_SET.has(val)).toBe(true);
      }
    });

    it('has exactly 4 members', async () => {
      expect(ENTROPY_SOURCE_SET.size).toBe(4);
    });

    it('rejects unknown values', async () => {
      expect(ENTROPY_SOURCE_SET.has('binary' as EntropySource)).toBe(false);
    });
  });

  /* ---------- DECODE_ENCODING_SET ---------- */

  describe('DECODE_ENCODING_SET', () => {
    it('contains all expected DecodeEncoding values', async () => {
      const expected: DecodeEncoding[] = ['base64', 'hex', 'url', 'protobuf', 'msgpack'];
      for (const val of expected) {
        expect(DECODE_ENCODING_SET.has(val)).toBe(true);
      }
    });

    it('has exactly 5 members', async () => {
      expect(DECODE_ENCODING_SET.size).toBe(5);
    });

    it('rejects unknown encoding values', async () => {
      expect(DECODE_ENCODING_SET.has('utf8' as DecodeEncoding)).toBe(false);
      expect(DECODE_ENCODING_SET.has('ascii' as DecodeEncoding)).toBe(false);
    });
  });

  /* ---------- OUTPUT_FORMAT_SET ---------- */

  describe('OUTPUT_FORMAT_SET', () => {
    it('contains all expected OutputFormat values', async () => {
      const expected: OutputFormat[] = ['hex', 'utf8', 'json'];
      for (const val of expected) {
        expect(OUTPUT_FORMAT_SET.has(val)).toBe(true);
      }
    });

    it('has exactly 3 members', async () => {
      expect(OUTPUT_FORMAT_SET.size).toBe(3);
    });

    it('rejects unknown format values', async () => {
      expect(OUTPUT_FORMAT_SET.has('binary' as OutputFormat)).toBe(false);
      expect(OUTPUT_FORMAT_SET.has('base64' as OutputFormat)).toBe(false);
    });
  });

  /* ---------- INPUT_FORMAT_SET ---------- */

  describe('INPUT_FORMAT_SET', () => {
    it('contains all expected InputFormat values', async () => {
      const expected: InputFormat[] = ['utf8', 'hex', 'json'];
      for (const val of expected) {
        expect(INPUT_FORMAT_SET.has(val)).toBe(true);
      }
    });

    it('has exactly 3 members', async () => {
      expect(INPUT_FORMAT_SET.size).toBe(3);
    });

    it('rejects unknown format values', async () => {
      expect(INPUT_FORMAT_SET.has('base64' as InputFormat)).toBe(false);
      expect(INPUT_FORMAT_SET.has('raw' as InputFormat)).toBe(false);
    });
  });

  /* ---------- OUTPUT_ENCODING_SET ---------- */

  describe('OUTPUT_ENCODING_SET', () => {
    it('contains all expected OutputEncoding values', async () => {
      const expected: OutputEncoding[] = ['base64', 'hex', 'url'];
      for (const val of expected) {
        expect(OUTPUT_ENCODING_SET.has(val)).toBe(true);
      }
    });

    it('has exactly 3 members', async () => {
      expect(OUTPUT_ENCODING_SET.size).toBe(3);
    });

    it('rejects unknown encoding values', async () => {
      expect(OUTPUT_ENCODING_SET.has('utf8' as OutputEncoding)).toBe(false);
      expect(OUTPUT_ENCODING_SET.has('protobuf' as OutputEncoding)).toBe(false);
    });
  });

  /* ---------- MAGIC_SIGNATURES ---------- */

  describe('MAGIC_SIGNATURES', () => {
    it('is a non-empty array', async () => {
      expect(MAGIC_SIGNATURES.length).toBeGreaterThan(0);
    });

    it('contains expected formats', async () => {
      const formats = MAGIC_SIGNATURES.map((sig) => sig.format);
      expect(formats).toContain('png');
      expect(formats).toContain('jpeg');
      expect(formats).toContain('gif');
      expect(formats).toContain('wasm');
      expect(formats).toContain('zip/apk');
      expect(formats).toContain('pdf');
    });

    it('has exactly 6 signatures', async () => {
      expect(MAGIC_SIGNATURES.length).toBe(6);
    });

    it('each signature has format string and bytes array', async () => {
      for (const sig of MAGIC_SIGNATURES) {
        expect(typeof sig.format).toBe('string');
        expect(sig.format.length).toBeGreaterThan(0);
        expect(Array.isArray(sig.bytes)).toBe(true);
        expect(sig.bytes.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('all bytes are valid uint8 values (0-255)', async () => {
      for (const sig of MAGIC_SIGNATURES) {
        for (const byte of sig.bytes) {
          expect(byte).toBeGreaterThanOrEqual(0);
          expect(byte).toBeLessThanOrEqual(255);
          expect(Number.isInteger(byte)).toBe(true);
        }
      }
    });

    it('has unique format names', async () => {
      const formats = MAGIC_SIGNATURES.map((sig) => sig.format);
      expect(new Set(formats).size).toBe(formats.length);
    });

    it.each([
      { format: 'png', expectedBytes: [0x89, 0x50, 0x4e, 0x47] },
      { format: 'jpeg', expectedBytes: [0xff, 0xd8, 0xff] },
      { format: 'gif', expectedBytes: [0x47, 0x49, 0x46] },
      { format: 'wasm', expectedBytes: [0x00, 0x61, 0x73, 0x6d] },
      { format: 'zip/apk', expectedBytes: [0x50, 0x4b, 0x03, 0x04] },
      { format: 'pdf', expectedBytes: [0x25, 0x50, 0x44, 0x46] },
    ])('$format has correct magic bytes', ({ format, expectedBytes }) => {
      const sig = MAGIC_SIGNATURES.find((s) => s.format === format);
      expect(sig).toBeDefined();
      expect(Array.from(sig!.bytes)).toEqual(expectedBytes);
    });

    it('is typed as ReadonlyArray', async () => {
      // ReadonlyArray enforces immutability at the type level
      // Verify it is an Array instance
      expect(Array.isArray(MAGIC_SIGNATURES)).toBe(true);
    });
  });

  /* ---------- Type structure validation ---------- */

  describe('type contracts (compile-time + structural)', () => {
    it('MagicSignature has expected shape', async () => {
      const sig: MagicSignature = { format: 'test', bytes: [0x00] };
      expect(sig.format).toBe('test');
      expect(sig.bytes).toEqual([0x00]);
    });

    it('ByteFrequencyEntry has expected shape', async () => {
      const entry: ByteFrequencyEntry = { byte: '0x41', count: 10, ratio: 0.5 };
      expect(entry.byte).toBe('0x41');
      expect(entry.count).toBe(10);
      expect(entry.ratio).toBe(0.5);
    });

    it('ProtobufFieldNode has expected shape', async () => {
      const node: ProtobufFieldNode = {
        index: 0,
        fieldNumber: 1,
        wireType: 0,
        wireTypeName: 'varint',
        value: 42,
      };
      expect(node.index).toBe(0);
      expect(node.fieldNumber).toBe(1);
      expect(node.wireType).toBe(0);
      expect(node.wireTypeName).toBe('varint');
      expect(node.value).toBe(42);
    });

    it('ProtobufParseResult has expected shape', async () => {
      const result: ProtobufParseResult = {
        fields: [],
        bytesConsumed: 0,
      };
      expect(result.fields).toEqual([]);
      expect(result.bytesConsumed).toBe(0);
      expect(result.error).toBeUndefined();
    });

    it('ProtobufParseResult can include error', async () => {
      const result: ProtobufParseResult = {
        fields: [],
        bytesConsumed: 0,
        error: 'parse failed',
      };
      expect(result.error).toBe('parse failed');
    });

    it('MsgPackDecodeResult has expected shape', async () => {
      const result: MsgPackDecodeResult = { value: 'hello', offset: 6 };
      expect(result.value).toBe('hello');
      expect(result.offset).toBe(6);
    });

    it('EntropyAssessment type accepts all valid values', async () => {
      const values: EntropyAssessment[] = [
        'plaintext',
        'encoded',
        'compressed',
        'encrypted',
        'random',
      ];
      expect(values).toHaveLength(5);
      values.forEach((v) => expect(typeof v).toBe('string'));
    });
  });

  /* ---------- Set cross-validation ---------- */

  describe('set cross-relationships', () => {
    it('DETECT_SOURCE_SET and ENTROPY_SOURCE_SET share base64, hex, raw, file', async () => {
      for (const val of ['base64', 'hex', 'raw', 'file'] as const) {
        expect(DETECT_SOURCE_SET.has(val)).toBe(true);
        expect(ENTROPY_SOURCE_SET.has(val)).toBe(true);
      }
    });

    it('DECODE_ENCODING_SET includes base64 and hex (shared with source sets)', async () => {
      expect(DECODE_ENCODING_SET.has('base64')).toBe(true);
      expect(DECODE_ENCODING_SET.has('hex')).toBe(true);
    });

    it('OUTPUT_ENCODING_SET includes base64 and hex (shared with decode set)', async () => {
      expect(OUTPUT_ENCODING_SET.has('base64')).toBe(true);
      expect(OUTPUT_ENCODING_SET.has('hex')).toBe(true);
    });

    it('INPUT_FORMAT_SET and OUTPUT_FORMAT_SET both contain hex', async () => {
      expect(INPUT_FORMAT_SET.has('hex')).toBe(true);
      expect(OUTPUT_FORMAT_SET.has('hex')).toBe(true);
    });

    it('INPUT_FORMAT_SET contains json, OUTPUT_FORMAT_SET also contains json', async () => {
      expect(INPUT_FORMAT_SET.has('json')).toBe(true);
      expect(OUTPUT_FORMAT_SET.has('json')).toBe(true);
    });
  });
});
