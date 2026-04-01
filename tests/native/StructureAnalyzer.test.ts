/**
 * StructureAnalyzer unit tests.
 *
 * Tests C struct export, MSVC name demangling, field type mapping,
 * and instance comparison (synthetic data, no live process).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StructureAnalyzer } from '@native/StructureAnalyzer';
import type { InferredStruct, InferredField, FieldType } from '@native/StructureAnalyzer.types';
import * as ofactory from '@native/platform/factory';
import { nativeMemoryManager } from '@native/NativeMemoryManager.impl';

vi.mock('@native/platform/factory', () => ({
  createPlatformProvider: vi.fn(),
}));

vi.mock('@native/NativeMemoryManager.impl', () => ({
  nativeMemoryManager: {
    enumerateModules: vi.fn(),
  },
}));

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
      const struct = analyzer.exportToCStruct({
        baseAddress: '0x1000',
        totalSize: 8,
        timestamp: Date.now(),
        fields: [
          { type: 'int32', offset: 0, size: 4, name: 'field_0', value: '42', confidence: 1 },
          {
            type: 'int32',
            offset: 4,
            size: 4,
            name: 'field_4',
            value: '100',
            notes: 'Test note',
            confidence: 1,
          },
        ],
      });
      expect(struct.definition).toContain('// +0x04 Test note');
      expect(struct.definition).toContain('// +0x00 = 42');
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

    it('should map unknown and default fallback branches to uint8 arrays', () => {
      const g = (analyzer as any).fieldTypeToCType('unknown', 16);
      expect(g).toBe('uint8_t[16]');
      const d = (analyzer as any).fieldTypeToCType('fake_branch_type_testing_only' as any, 24);
      expect(d).toBe('uint8_t[24]');
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

  describe('Memory Parsing Mocks', () => {
    let mockProvider: any;

    beforeEach(() => {
      mockProvider = {
        openProcess: vi.fn(() => 1234),
        closeProcess: vi.fn(),
        readMemory: vi.fn(),
        writeMemory: vi.fn(),
        queryRegion: vi.fn(),
      };
      vi.mocked(ofactory.createPlatformProvider).mockReturnValue(mockProvider);
      // Force recreation of provider
      (analyzer as any)._provider = null;
    });

    it('should parse simple structure with various types', async () => {
      mockProvider.readMemory.mockImplementation((_h: any, addr: bigint, size: number) => {
        const buf = Buffer.alloc(Math.max(size, 48));
        if (addr === 0x1000n) {
          buf.writeBigUInt64LE(0x2000n, 0); // vtable ptr -> 0x2000
          buf.writeFloatLE(123.456, 8); // float
          buf.writeInt32LE(42, 12); // int32
          buf.writeUInt32LE(0, 16); // padding 0
          buf.writeUInt32LE(0, 20); // padding 0
          buf.writeBigUInt64LE(0x30000n, 24); // pointer to string
          buf.writeUInt32LE(1, 32); // bool
          buf.writeUInt32LE(0x80000001, 36); // uint32 (>0x7FFFFFFF)
          buf.writeFloatLE(123.0, 40); // zero-decimal float to hit float fallback (line 482)
          buf.writeFloatLE(20000.0, 44); // zero-decimal float > 10000 to cover false fallback branch
          buf.writeUInt16LE(0x1234, 48); // uint16
          buf.writeUInt8(0x56, 50); // uint8
        } else if (addr === 0x2000n) {
          buf.writeBigUInt64LE(0x2008n, 0); // first func of vtable
        } else if (addr === 0x30000n) {
          buf.write('ThisIsAVeryLongStringThatExceedsThirtyTwoCharacters\0', 0); // valid string > 32 chars
        } else if (addr === 0x4000n) {
          buf.writeBigUInt64LE(0x30000n, 0); // pointer to 0x30000n (which holds "This" which is not executable, failing vtable parsing at offset 0)
        }
        return { data: buf };
      });

      mockProvider.queryRegion.mockImplementation((_h: any, addr: bigint) => {
        if (addr === 0x2000n || addr === 0x2008n) return { isReadable: true, isExecutable: true };
        if (addr === 0x30000n) return { isReadable: true, isExecutable: false };
        if (addr === 0x4000n) return { isReadable: true, isExecutable: false };
        if (addr === 0x88000n) throw new Error('Query region exception trap'); // For catch testing limits
        return { isReadable: false, isExecutable: false };
      });

      const struct = await analyzer.analyzeStructure(1234, '0x1000', {
        size: 51,
        parseRtti: false,
      });
      expect(struct.fields[0]!.type).toBe('vtable_ptr');
      expect(struct.fields[1]!.type).toBe('float');
      expect(struct.fields[2]!.type).toBe('int32');
      expect(struct.fields[3]!.type).toBe('padding');
      expect(struct.fields[4]!.type).toBe('string_ptr');
      expect(struct.fields[5]!.type).toBe('bool');
      expect(struct.fields[6]!.type).toBe('uint32');
      expect(struct.fields[7]!.type).toBe('float'); // zero-decimal float fallback
      expect(struct.fields[8]!.type).toBe('int32'); // zero-decimal > 10000 fallback to integer limit bounds
      expect(struct.fields[9]!.type).toBe('uint16');
      expect(struct.fields[10]!.type).toBe('uint8');

      // Test queryRegion catches manually here (Lines 540 & 550)
      const resR = (analyzer as any).isValidReadablePointer(1234, 0x88000n);
      expect(resR).toBe(false);
      const resE = (analyzer as any).isValidExecutablePointer(1234, 0x88000n);
      expect(resE).toBe(false);
    });

    it('should fallback to string_ptr if vtable execution check fails', async () => {
      mockProvider.readMemory.mockImplementation((_h: any, addr: bigint, _size: number) => {
        const buf = Buffer.alloc(16);
        if (addr === 0x4000n) buf.writeBigUInt64LE(0x30000n, 0);
        else if (addr === 0x30000n) buf.write('ThisIsAString\0', 0);
        return { data: buf };
      });
      mockProvider.queryRegion.mockImplementation((_h: any, addr: bigint) => {
        if (addr === 0x4000n) return { isReadable: true, isExecutable: true, type: 'image' };
        if (addr === 0x30000n) return { isReadable: true, isExecutable: false, type: 'image' };
        return { isReadable: false, isExecutable: false };
      });
      const struct = await analyzer.analyzeStructure(1234, '0x4000', { size: 8, parseRtti: false });
      expect(struct.fields[0]!.type).toBe('string_ptr');
    });

    it('should identify vtable_ptr via heuristics when RTTI check fails', async () => {
      mockProvider.readMemory.mockImplementation((_h: any, addr: bigint, _size: number) => {
        const buf = Buffer.alloc(16);
        if (addr === 0x5000n)
          buf.writeBigUInt64LE(0x40000n, 0); // pointer to simulated vtable
        else if (addr === 0x40000n)
          buf.writeBigUInt64LE(0x50000n, 0); // heuristic reads firstFunc inside vtable
        else if (addr === 0x3fff8n) throw new Error('RTTI missing'); // throw to force fallback
        return { data: buf };
      });
      mockProvider.queryRegion.mockImplementation((_h: any, addr: bigint) => {
        if (addr === 0x5000n) return { isReadable: true, isExecutable: true, type: 'image' };
        if (addr === 0x40000n) return { isReadable: true, isExecutable: true, type: 'image' }; // the vtable itself
        if (addr === 0x50000n) return { isReadable: true, isExecutable: true, type: 'image' }; // the first function
        return { isReadable: false, isExecutable: false };
      });
      const struct = await analyzer.analyzeStructure(1234, '0x5000', { size: 8, parseRtti: false });
      expect(struct.fields[0]!.type).toBe('vtable_ptr');
      expect(struct.fields[0]!.notes).toContain('likely vtable pointer');
    });

    it('should break classification loop if size remaining drops below 1', async () => {
      mockProvider.readMemory.mockImplementation(() => ({ data: Buffer.alloc(1) }));
      const struct = await analyzer.analyzeStructure(1234, '0x1000', {
        size: 0.5,
        parseRtti: false,
      });
      expect(struct.fields.length).toBe(0);
    });

    it('should ignore RTTI base class arrays if numBaseClasses is out of bounds', async () => {
      mockProvider.readMemory.mockImplementation((_h: any, addr: bigint, _size: number) => {
        const buf = Buffer.alloc(48);
        if (addr === 0x1000n)
          buf.writeBigUInt64LE(0x2000n, 0); // VTable pointer
        else if (addr === 0x1ff8n)
          buf.writeBigUInt64LE(0x3000n, 0); // COL addr
        else if (addr === 0x3000n) {
          // CompleteObjectLocator
          buf.writeInt32LE(0, 8); // cdOffset
          buf.writeInt32LE(0x4000, 12); // typeDescriptor RVA
          buf.writeInt32LE(0x5000, 16); // classHierarchyDescriptor RVA
          buf.writeInt32LE(0x3000, 20); // self RVA
        } else if (addr === 0x4000n) {
          // TypeDescriptor
          buf.write('.?AVTestClass@@\0', 16);
        } else if (addr === 0x5000n) {
          // ClassHierarchyDescriptor
          buf.writeUInt32LE(25, 8); // numBaseClasses = 25 (out of bounds)
        }
        return { data: buf };
      });
      mockProvider.queryRegion.mockImplementation(() => ({
        isReadable: true,
        isExecutable: true,
        type: 'image',
      }));

      const struct = await analyzer.analyzeStructure(1234, '0x1000', { size: 8 });
      expect(struct.fields[0]!.notes).not.toContain('Inherits from');
    });

    it('should ignore RTTI base class arrays if numBaseClasses is exactly zero', async () => {
      mockProvider.readMemory.mockImplementation((_h: any, addr: bigint, _size: number) => {
        const buf = Buffer.alloc(48);
        if (addr === 0x1000n)
          buf.writeBigUInt64LE(0x2000n, 0); // VTable pointer
        else if (addr === 0x1ff8n)
          buf.writeBigUInt64LE(0x3000n, 0); // COL addr
        else if (addr === 0x3000n) {
          // CompleteObjectLocator
          buf.writeInt32LE(0, 8); // cdOffset
          buf.writeInt32LE(0x4000, 12); // typeDescriptor RVA
          buf.writeInt32LE(0x5000, 16); // classHierarchyDescriptor RVA
          buf.writeInt32LE(0x3000, 20); // self RVA
        } else if (addr === 0x4000n) {
          // TypeDescriptor
          buf.write('.?AVTestClass@@\0', 16);
        } else if (addr === 0x5000n) {
          // ClassHierarchyDescriptor
          buf.writeUInt32LE(0, 8); // numBaseClasses = 0
        }
        return { data: buf };
      });
      mockProvider.queryRegion.mockImplementation(() => ({
        isReadable: true,
        isExecutable: true,
        type: 'image',
      }));

      const struct = await analyzer.analyzeStructure(1234, '0x1000', { size: 8 });
      expect(struct.fields[0]!.notes).not.toContain('Inherits from');
    });

    it('should fallback from vtable_ptr if first func is not executable', async () => {
      mockProvider.readMemory.mockImplementation((_h: any, addr: bigint, _size: number) => {
        const buf = Buffer.alloc(16);
        if (addr === 0x5000n)
          buf.writeBigUInt64LE(0x40000n, 0); // pointer to simulated vtable
        else if (addr === 0x40000n) buf.writeBigUInt64LE(0x50000n, 0); // heuristic reads firstFunc inside vtable
        return { data: buf };
      });
      mockProvider.queryRegion.mockImplementation((_h: any, addr: bigint) => {
        if (addr === 0x5000n) return { isReadable: true, isExecutable: true, type: 'image' };
        if (addr === 0x40000n) return { isReadable: true, isExecutable: true, type: 'image' }; // val64 IS EXECUTABLE!
        if (addr === 0x50000n) return { isReadable: true, isExecutable: false, type: 'image' }; // FIRST FUNC IS NOT EXECUTABLE!
        return { isReadable: false, isExecutable: false };
      });
      const struct = await analyzer.analyzeStructure(1234, '0x5000', { size: 8, parseRtti: false });
      expect(struct.fields[0]!.type).toBe('pointer');
    });

    it('should compare instances correctly', async () => {
      mockProvider.readMemory.mockImplementation((_h: any, addr: bigint, size: number) => {
        const buf = Buffer.alloc(Math.max(size ?? 1024, 24));
        if (addr === 0x1000n) {
          buf.writeInt32LE(42, 0); // static matching
          buf.writeInt32LE(100, 4); // differing
          buf.writeInt32LE(200, 8); // missing in struct2 explicitly
        } else if (addr === 0x2000n) {
          buf.writeInt32LE(42, 0); // static matching
          buf.writeBigUInt64LE(0x30000n, 4); // 8-byte pointer masking offset 8 explicitly
        }
        return { data: buf.subarray(0, size) };
      });

      const { matching, differing } = await analyzer.compareInstances(1234, '0x1000', '0x2000', 12);
      expect(matching.length).toBeGreaterThan(0);
      expect(differing.length).toBeGreaterThan(0);
      expect(differing[0]!.offset).toBe(4);

      // Test size default logic fallback
      await analyzer.compareInstances(1234, '0x1000', '0x2000');
    });

    it('should parse vtable and RTTI structure with loop breaks', async () => {
      vi.mocked(nativeMemoryManager.enumerateModules).mockResolvedValueOnce({
        success: true,
        modules: [{ name: 'game.exe', baseAddress: '0x1000000', size: 0x10000 }],
      } as any);

      mockProvider.readMemory.mockImplementation((_h: any, addr: bigint, size: number) => {
        const buf = Buffer.alloc(Math.max(size, 48));
        if (addr === 0x1000n) {
          // for analyzeStructure test
          buf.writeBigUInt64LE(0x2000n, 0); // VTable pointer
          buf.writeUInt32LE(0, 8); // zeroes for int32 '0' fallback mapping line 451
          buf.writeUInt32LE(1, 12); // non-zero forces fallback
        } else if (addr === 0x2000n) {
          // First func pointer
          buf.writeBigUInt64LE(0x1001000n, 0);
        } else if (addr === 0x2008n) {
          // Second func pointer loop iteration
          buf.writeBigUInt64LE(0x1002000n, 0);
        } else if (addr === 0x2010n) {
          // Third func pointer
          throw new Error('Break parseVtable loop trap line 133');
        } else if (addr === 0x1ff8n) {
          buf.writeBigUInt64LE(0x2100n, 0); // COL addr
        } else if (addr === 0x2100n) {
          // COL
          buf.writeUInt32LE(1, 0);
          buf.writeUInt32LE(0x500, 0x0c); // TypeDescRVA
          buf.writeUInt32LE(0x200, 0x10);
          buf.writeUInt32LE(0x100, 0x14); // ObjectLocRVA -> moduleBase = 0x2100 - 0x100 = 0x2000
        } else if (addr === 0x2500n || addr === 0x2510n) {
          // TypeDescriptor at moduleBase(0x2000) + typeRva(0x500)
          const offset = addr === 0x2500n ? 0x10 : 0x00;
          buf.write('.?AVPlayer@@\0', offset);
        } else if (addr === 0x2200n) {
          // ClassHierarchy
          buf.writeUInt32LE(3, 0x08); // Set ClassHierarchy baseArray count to 3
          buf.writeUInt32LE(0x300, 0x0c);
        } else if (addr === 0x2300n) {
          // BaseArray
          buf.writeUInt32LE(0, 0); // Entry 0 -> addr 0x2000n
          buf.writeUInt32LE(0x400, 4); // Entry 1 -> addr 0x2400n -> Entity base class
          buf.writeUInt32LE(0x404, 8); // Entry 2 -> addr 0x2404n -> Exception
        } else if (addr === 0x2400n) {
          // BaseDescriptor
          buf.writeUInt32LE(0x150, 0); // Base TypeDescRVA = 0x150, => 0x2150n
        } else if (addr === 0x2150n || addr === 0x2160n) {
          // Base TypeDescriptor
          const offset = addr === 0x2150n ? 0x10 : 0x00;
          buf.write('.?AVEntity@@\0', offset);
        } else if (addr === 0x2404n) {
          // Second BaseDescriptor throws to break RTTI base enumeration line 265
          throw new Error('Break parseRtti base classes loop trap line 265');
        }
        return { data: buf };
      });

      mockProvider.queryRegion.mockImplementation((_h: any, addr: bigint) => {
        if (addr >= 0x1001000n && addr <= 0x1002000n)
          return { isReadable: true, isExecutable: true, type: 'image' };
        if (addr >= 0x2000n && addr <= 0x3000n)
          return { isReadable: true, isExecutable: true, type: 'image' };
        if (addr >= 0x1000000n && addr <= 0x1010000n)
          return { isReadable: true, isExecutable: false, type: 'image' };
        return { isReadable: false, isExecutable: false, type: 'private' };
      });

      // Analyze structure parsing RTTI implicitly
      const struct = await analyzer.analyzeStructure(1234, '0x1000', { size: 16 });
      expect(struct.className).toBe('Player');
      expect(struct.baseClasses).toContain('Entity');
      expect(struct.fields[1]!.type).toBe('int32'); // hits line 451

      const rtti = await analyzer.parseRtti(1234, '0x2000');
      expect(rtti?.className).toBe('Player');
      expect(rtti?.baseClasses).toContain('Entity');

      const vtable = await analyzer.parseVtable(1234, '0x2000');
      expect(vtable.rttiName).toBe('Player');
      expect(vtable.functionCount).toBeGreaterThan(0);
      expect(vtable.functions[0]!.moduleOffset).toBe(0x1000);
    });

    it('should cover un-terminated and memory out-of-bounds branches', async () => {
      mockProvider.readMemory.mockImplementation((_h: any, addr: bigint, size: number) => {
        const buf = Buffer.alloc(Math.max(size, 32));
        if (addr === 0x1000n) {
          // for parseVtable trigger
          buf.writeBigUInt64LE(0x2000n, 0);
        } else if (addr === 0x2000n) {
          // VTable first func pointer that falls OUT of enum boundaries
          buf.writeBigUInt64LE(0x4000000n, 0);
        } else if (addr === 0x2008n) {
          throw new Error('Break parseVtable early line 133');
        } else if (addr === 0x1ff8n) {
          buf.writeBigUInt64LE(0x2100n, 0); // COL addr
        } else if (addr === 0x2100n) {
          // COL
          buf.writeUInt32LE(1, 0);
          buf.writeUInt32LE(0x500, 0x0c); // TypeDescRVA
          buf.writeUInt32LE(0x200, 0x10);
          buf.writeUInt32LE(0x100, 0x14); // ObjectLocRVA -> moduleBase = 0x2000
        } else if (addr === 0x2500n || addr === 0x2510n) {
          // TypeDescriptor Type RVA 0x500: write entirely 'A's without null terminator
          // To trigger readCString `if (nullIdx < 0) return null` (Line 559)
          buf.fill(0x41);
        } else {
          // Throw to trigger remaining catch block in readCString or parseRtti
          if (addr === 0x2400n) throw new Error('Throw readCString catch line 567');
          throw new Error('Trigger early exit');
        }
        return { data: buf };
      });
      mockProvider.queryRegion.mockImplementation((_h: any, _addr: bigint) => ({
        isReadable: true,
        isExecutable: true,
        type: 'image',
      }));

      // 1. Cover resolveToModule loop `return null` (line 653) because `0x4000000n` is NOT in `modules`
      vi.mocked(nativeMemoryManager.enumerateModules).mockResolvedValueOnce({
        success: true,
        modules: [{ name: 'dummy.dll', baseAddress: '1000000', size: 0x1000 }], // No 0x prefix covers line 633 false path
      } as any);

      const vtable1 = await analyzer.parseVtable(1234, '0x2000');
      // Should have resolved nothing (0x4000000n is outside dummy.dll)
      expect(vtable1.functions[0]!.moduleOffset).toBeUndefined();

      // 2. Cover getModuleEntries catch block (line 638)
      vi.mocked(nativeMemoryManager.enumerateModules).mockRejectedValueOnce(
        new Error('Trigger error for line 638 catch'),
      );
      const vtable2 = await analyzer.parseVtable(1234, '0x2000');
      // Modules fail entirely, offset undefined
      expect(vtable2.functions[0]!.moduleOffset).toBeUndefined();

      // 3. Cover readCString missing null idx (line 559) & catch (line 567)
      const rtti = await analyzer.parseRtti(1234, '0x2000');
      // Buffer filled with 0x41 returns null because no null term
      expect(rtti).toBeNull();
    });

    it('should handle un-prefixed addresses', async () => {
      mockProvider.readMemory.mockImplementation((_h: any, addr: bigint) => {
        const buf = Buffer.alloc(16);
        if (addr === 0x1000n) buf.writeBigUInt64LE(0x2000n, 0); // valid vtable_ptr
        if (addr === 0x2000n) buf.writeBigUInt64LE(0x3000n, 0); // valid func_ptr in vtable
        return { data: buf };
      });
      mockProvider.queryRegion.mockImplementation((_h: any, addr: bigint) => ({
        isReadable: true,
        isExecutable: addr !== 0n,
      }));

      const s = await analyzer.analyzeStructure(1234, '1000', { size: 8, parseRtti: true }); // triggers RTTI catch gracefully
      expect(s.fields[0]!.type).toBe('vtable_ptr');

      const v = await analyzer.parseVtable(1234, '2000');
      expect(v.functions.length).toBe(1); // valid execute handle breaker on index 1

      const r = await analyzer.parseRtti(1234, '2000');
      expect(r).toBeNull();
    });

    it('should validate printable ASCII pointers and gracefully fallback to default pointer on throw', async () => {
      mockProvider.readMemory.mockImplementation((_h: any, addr: bigint) => {
        if (addr === 0x400040n) {
          throw new Error('Memory exception');
        }
        if (addr === 0x500050n) {
          const buf = Buffer.alloc(64);
          buf.write('\x05\x07Fake\x00', 0);
          return { data: buf };
        }
        const buf = Buffer.alloc(16);
        if (addr === 0x1000n) {
          buf.writeBigUInt64LE(0x400040n, 0);
          buf.writeBigUInt64LE(0x500050n, 8);
        }
        return { data: buf };
      });
      mockProvider.queryRegion.mockReturnValue({ isReadable: true, isExecutable: false });

      const s = await analyzer.analyzeStructure(1234, '1000', { size: 16 });
      expect(s.fields[0]!.type).toBe('pointer');
      expect(s.fields[1]!.type).toBe('pointer');
    });

    it('should gracefully handle invalid pointers and parsing failures', async () => {
      mockProvider.readMemory.mockImplementation(() => {
        throw new Error('Unreadable');
      });
      await expect(analyzer.analyzeStructure(1234, '0x1000')).rejects.toThrow('Unreadable');
      const rtti = await analyzer.parseRtti(1234, '0x2000');
      expect(rtti).toBeNull();
    });

    it('should trigger RTTI pointer guard falses and execution limits', async () => {
      mockProvider.readMemory.mockImplementation((_h: any, addr: bigint) => {
        const buf = Buffer.alloc(Math.max(32, 8));
        if (addr === 0x1ff8n) buf.writeBigUInt64LE(0x30n, 0); // Under 0x10000 guards bounds
        // Triggers invalid readable pointer line 206
        return { data: buf };
      });
      expect(await analyzer.parseRtti(1234, '0x2000')).toBeNull();
    });

    it('should demangle names edgecases directly', () => {
      expect((analyzer as any).demangleMsvcName('.?AW4EnumName@@')).toBe('EnumName');
      expect((analyzer as any).demangleMsvcName('.StructName@@')).toBe('StructName');
    });
  });
});
