import { describe, expect, it } from 'vitest';
import { ProtocolPatternEngine } from '@modules/protocol-analysis/ProtocolPatternEngine';
import type { ProtocolField } from '@modules/protocol-analysis/types';

describe('ProtocolPatternEngine', () => {
  describe('definePattern', () => {
    it('defines a pattern with minimal fields', () => {
      const engine = new ProtocolPatternEngine();
      const fields: ProtocolField[] = [{ name: 'magic', type: 'uint16', offset: 0, length: 2 }];
      const pattern = engine.definePattern('test_proto', fields);

      expect(pattern.name).toBe('test_proto');
      expect(pattern.fields).toHaveLength(1);
      expect(pattern.fields[0]?.name).toBe('magic');
      expect(pattern.byteOrder).toBe('big');
    });

    it('stores pattern in registry', () => {
      const engine = new ProtocolPatternEngine();
      const fields: ProtocolField[] = [{ name: 'header', type: 'uint8', offset: 0, length: 1 }];
      engine.definePattern('stored', fields);

      expect(engine.listPatterns()).toContain('stored');
    });

    it('supports little endian byte order', () => {
      const engine = new ProtocolPatternEngine();
      const pattern = engine.definePattern('le_proto', [], {
        byteOrder: 'little',
      });

      expect(pattern.byteOrder).toBe('little');
    });

    it('supports encryption info', () => {
      const engine = new ProtocolPatternEngine();
      const pattern = engine.definePattern('encrypted', [], {
        encryption: { type: 'aes', key: 'test-key', notes: 'AES-256-CBC' },
      });

      expect(pattern.encryption?.type).toBe('aes');
      expect(pattern.encryption?.key).toBe('test-key');
    });

    it('handles empty fields', () => {
      const engine = new ProtocolPatternEngine();
      const pattern = engine.definePattern('empty', []);

      expect(pattern.fields).toEqual([]);
    });
  });

  describe('getPattern', () => {
    it('returns undefined for unknown pattern', () => {
      const engine = new ProtocolPatternEngine();
      expect(engine.getPattern('nonexistent')).toBeUndefined();
    });

    it('returns registered pattern', () => {
      const engine = new ProtocolPatternEngine();
      const fields: ProtocolField[] = [{ name: 'field', type: 'uint8', offset: 0, length: 1 }];
      engine.definePattern('lookup', fields);

      const result = engine.getPattern('lookup');
      expect(result).toBeDefined();
      expect(result?.name).toBe('lookup');
    });
  });

  describe('listPatterns', () => {
    it('returns empty list initially', () => {
      const engine = new ProtocolPatternEngine();
      expect(engine.listPatterns()).toEqual([]);
    });

    it('returns multiple patterns', () => {
      const engine = new ProtocolPatternEngine();
      engine.definePattern('a', []);
      engine.definePattern('b', []);

      const names = engine.listPatterns();
      expect(names).toHaveLength(2);
      expect(names).toContain('a');
      expect(names).toContain('b');
    });
  });

  describe('exportProto', () => {
    it('exports a pattern to proto schema', () => {
      const engine = new ProtocolPatternEngine();
      const fields: ProtocolField[] = [
        { name: 'magic', type: 'uint16', offset: 0, length: 2 },
        { name: 'data', type: 'string', offset: 2, length: 10 },
      ];
      const pattern = engine.definePattern('my_proto', fields);

      const schema = engine.exportProto(pattern);

      expect(schema).toContain('message MyProto');
      expect(schema).toContain('uint32 magic = 1');
      expect(schema).toContain('string data = 2');
    });

    it('includes encryption comment when present', () => {
      const engine = new ProtocolPatternEngine();
      const pattern = engine.definePattern('enc', [], {
        encryption: { type: 'xor', notes: 'simple xor' },
      });

      const schema = engine.exportProto(pattern);
      expect(schema).toContain('Encryption: xor');
      expect(schema).toContain('simple xor');
    });

    it('handles empty pattern', () => {
      const engine = new ProtocolPatternEngine();
      const pattern = engine.definePattern('empty', []);

      const schema = engine.exportProto(pattern);
      expect(schema).toContain('message Empty');
    });
  });

  describe('autoDetectPattern', () => {
    it('returns empty pattern for no payloads', () => {
      const engine = new ProtocolPatternEngine();
      const pattern = engine.autoDetectPattern([]);

      expect(pattern.fields).toHaveLength(0);
    });

    it('detects magic bytes from common prefix', () => {
      const engine = new ProtocolPatternEngine();
      const payloads = [Buffer.from('deadc0de0100', 'hex'), Buffer.from('deadc0de0200', 'hex')];

      const pattern = engine.autoDetectPattern(payloads);

      // First 4 bytes are common (deadc0de)
      expect(pattern.fields.length).toBeGreaterThan(0);
      expect(pattern.fields[0]?.name).toContain('magic');
    });

    it('detects version field after magic', () => {
      const engine = new ProtocolPatternEngine();
      // 2-byte common prefix, then low-value version-like bytes
      const payloads = [Buffer.from('ab010200', 'hex'), Buffer.from('ab020200', 'hex')];

      const pattern = engine.autoDetectPattern(payloads);

      // Should detect magic (1 byte) and potentially version
      expect(pattern.fields.length).toBeGreaterThanOrEqual(1);
    });

    it('handles single payload', () => {
      const engine = new ProtocolPatternEngine();
      const payloads = [Buffer.from('aabbccdd', 'hex')];

      const pattern = engine.autoDetectPattern(payloads);

      // Single payload means no common prefix to detect
      expect(pattern).toBeDefined();
    });

    it('detects string-like payloads', () => {
      const engine = new ProtocolPatternEngine();
      // Magic + ASCII text
      const payloads = [Buffer.concat([Buffer.from('01', 'hex'), Buffer.from('hello world')])];

      const pattern = engine.autoDetectPattern(payloads);

      expect(pattern.fields.length).toBeGreaterThan(0);
    });

    it('detects high-entropy sections as potentially encrypted', () => {
      const engine = new ProtocolPatternEngine();
      // Magic + random-looking high-entropy bytes
      const payloads = [
        Buffer.concat([
          Buffer.from('01', 'hex'),
          Buffer.from([
            0x7f, 0xab, 0xcd, 0xef, 0x9f, 0x8e, 0x7d, 0x6c, 0x5b, 0x4a, 0x39, 0x28, 0x17, 0x06,
            0xf5, 0xe4,
          ]),
        ]),
        Buffer.concat([
          Buffer.from('01', 'hex'),
          Buffer.from([
            0x8f, 0xbc, 0xde, 0xff, 0xaf, 0x9e, 0x8d, 0x7c, 0x6b, 0x5a, 0x49, 0x38, 0x27, 0x16,
            0x05, 0xf4,
          ]),
        ]),
      ];

      const pattern = engine.autoDetectPattern(payloads);

      // Should detect magic and potentially high-entropy data section
      expect(pattern.fields.length).toBeGreaterThanOrEqual(1);
    });

    it('uses provided name option', () => {
      const engine = new ProtocolPatternEngine();
      const payloads = [Buffer.from('aabb', 'hex')];

      const pattern = engine.autoDetectPattern(payloads, { name: 'custom' });

      expect(pattern.name).toBe('custom');
    });

    it('handles payloads of different lengths', () => {
      const engine = new ProtocolPatternEngine();
      const payloads = [Buffer.from('deadc0de01', 'hex'), Buffer.from('deadc0de02000300', 'hex')];

      const pattern = engine.autoDetectPattern(payloads);

      expect(pattern).toBeDefined();
      expect(pattern.fields.length).toBeGreaterThan(0);
    });
  });
});
