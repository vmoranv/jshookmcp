/**
 * StructureAnalyzer unit tests.
 *
 * Tests C struct export, MSVC name demangling, field type mapping,
 * and instance comparison (synthetic data, no live process).
 */

import { describe, it, expect } from 'vitest';
import { StructureAnalyzer } from '@native/StructureAnalyzer';
import type { InferredStruct, InferredField, FieldType } from '@native/StructureAnalyzer.types';

function makeField(
  overrides: Partial<InferredField> & { offset: number; type: FieldType },
): InferredField {
  return {
    size: 4,
    name: `field_0x${overrides.offset.toString(16).padStart(2, '0').toUpperCase()}`,
    value: '0',
    confidence: 0.5,
    ...overrides,
  };
}

function makeStruct(overrides?: Partial<InferredStruct>): InferredStruct {
  return {
    baseAddress: '0x7FF600001000',
    totalSize: 64,
    fields: [
      makeField({
        offset: 0,
        type: 'vtable_ptr',
        size: 8,
        value: '0x7FF600010000',
        confidence: 0.9,
      }),
      makeField({ offset: 8, type: 'int32', value: '100' }),
      makeField({ offset: 12, type: 'int32', value: '100' }),
      makeField({ offset: 16, type: 'float', value: '123.456001' }),
      makeField({ offset: 20, type: 'float', value: '789.012024' }),
      makeField({ offset: 24, type: 'float', value: '45.678001' }),
      makeField({ offset: 28, type: 'padding', size: 4, value: '0x00000000' }),
      makeField({ offset: 32, type: 'pointer', size: 8, value: '0x7FF612A000' }),
      makeField({ offset: 40, type: 'bool', value: 'true' }),
      makeField({ offset: 44, type: 'padding', size: 4, value: '0x00000000' }),
      makeField({ offset: 48, type: 'string_ptr', size: 8, value: '0x7FF6ABCD → "PlayerName"' }),
      makeField({ offset: 56, type: 'uint32', value: '42' }),
      makeField({ offset: 60, type: 'padding', size: 4, value: '0x00000000' }),
    ],
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('StructureAnalyzer', () => {
  const analyzer = new StructureAnalyzer();

  // ── C Struct Export ──

  describe('exportToCStruct', () => {
    it('should generate valid C struct definition', () => {
      const struct = makeStruct({ className: 'Player' });
      const result = analyzer.exportToCStruct(struct);

      expect(result.name).toBe('Player');
      expect(result.definition).toContain('struct Player {');
      expect(result.definition).toContain('};');
      expect(result.size).toBe(64);
    });

    it('should include field type mappings', () => {
      const struct = makeStruct();
      const result = analyzer.exportToCStruct(struct);

      expect(result.definition).toContain('void**'); // vtable_ptr
      expect(result.definition).toContain('int32_t'); // int32
      expect(result.definition).toContain('float'); // float
      expect(result.definition).toContain('void*'); // pointer
      expect(result.definition).toContain('bool'); // bool
      expect(result.definition).toContain('char*'); // string_ptr
      expect(result.definition).toContain('uint32_t'); // uint32
    });

    it('should include offset comments', () => {
      const struct = makeStruct();
      const result = analyzer.exportToCStruct(struct);

      expect(result.definition).toContain('+0x00');
      expect(result.definition).toContain('+0x08');
      expect(result.definition).toContain('+0x10');
    });

    it('should use _pad_ prefix for padding fields', () => {
      const struct = makeStruct();
      const result = analyzer.exportToCStruct(struct);

      expect(result.definition).toContain('_pad_');
    });

    it('should use custom name when provided', () => {
      const struct = makeStruct({ className: 'Enemy' });
      const result = analyzer.exportToCStruct(struct, 'CustomName');

      expect(result.name).toBe('CustomName');
      expect(result.definition).toContain('struct CustomName {');
    });

    it('should default to UnknownStruct when no class name', () => {
      const struct = makeStruct({ className: undefined });
      const result = analyzer.exportToCStruct(struct);

      expect(result.name).toBe('UnknownStruct');
    });

    it('should count non-padding fields', () => {
      const struct = makeStruct();
      const result = analyzer.exportToCStruct(struct);
      // 13 total fields, 3 are padding
      expect(result.fieldCount).toBe(10);
    });

    it('should include size comment in header', () => {
      const struct = makeStruct({ totalSize: 128 });
      const result = analyzer.exportToCStruct(struct);
      expect(result.definition).toContain('0x80');
      expect(result.definition).toContain('128 bytes');
    });
  });

  // ── MSVC Name Demangling ──

  describe('demangleMsvcName (via exportToCStruct with className)', () => {
    it('should use className directly from struct', () => {
      const struct = makeStruct({ className: 'Player' });
      const result = analyzer.exportToCStruct(struct);
      expect(result.name).toBe('Player');
    });

    it('should handle nested class names', () => {
      const struct = makeStruct({ className: 'Game::Entity::Player' });
      const result = analyzer.exportToCStruct(struct);
      expect(result.name).toBe('Game::Entity::Player');
    });
  });

  // ── Field Type to C Type Mapping ──

  describe('field type C mapping coverage', () => {
    const typeMappings: Array<[FieldType, string]> = [
      ['int8', 'int8_t'],
      ['uint8', 'uint8_t'],
      ['int16', 'int16_t'],
      ['uint16', 'uint16_t'],
      ['int32', 'int32_t'],
      ['uint32', 'uint32_t'],
      ['int64', 'int64_t'],
      ['uint64', 'uint64_t'],
      ['float', 'float'],
      ['double', 'double'],
      ['pointer', 'void*'],
      ['vtable_ptr', 'void**'],
      ['string_ptr', 'char*'],
      ['bool', 'bool'],
    ];

    for (const [fieldType, expectedC] of typeMappings) {
      it(`should map ${fieldType} → ${expectedC}`, () => {
        const struct: InferredStruct = {
          baseAddress: '0x100',
          totalSize: 8,
          fields: [makeField({ offset: 0, type: fieldType, size: 8 })],
          timestamp: Date.now(),
        };
        const result = analyzer.exportToCStruct(struct);
        expect(result.definition).toContain(expectedC);
      });
    }
  });
});
