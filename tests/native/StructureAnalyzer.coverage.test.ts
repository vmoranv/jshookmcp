/**
 * StructureAnalyzer coverage tests — exercise uncovered branches.
 *
 * Gaps in the main test suite (StructureAnalyzer.test.ts):
 *  - exportToCStruct(): struct definition, padding fields, field lines
 *  - fieldTypeToCType(): all type branches
 *  - classifyValue: padding, zero-value int32, bool, uint32, uint16
 *  - parseVtable: read error → functionCount=0, RTTI failure best-effort
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StructureAnalyzer } from '@native/StructureAnalyzer';
import type { InferredStruct, InferredField, FieldType } from '@native/StructureAnalyzer.types';

function makeField(
  overrides: Partial<InferredField> & { offset: number; type: string },
): InferredField {
  return {
    size: 4,
    name: `field_0x${overrides.offset.toString(16).padStart(2, '0').toUpperCase()}`,
    value: '0',
    confidence: 0.5,
    ...overrides,
  } as InferredField;
}

function makeStruct(overrides?: Partial<InferredStruct>): InferredStruct {
  return {
    baseAddress: '0x7FF600001000',
    totalSize: 64,
    fields: [
      makeField({ offset: 0, type: 'int32', value: '100' }),
      makeField({ offset: 4, type: 'int32', value: '200' }),
    ],
    timestamp: Date.now(),
    ...overrides,
  } as InferredStruct;
}

const mockProvider = {
  platform: 'win32' as const,
  openProcess: vi.fn(() => ({ pid: 1234, writeAccess: false })),
  closeProcess: vi.fn(),
  readMemory: vi.fn(() => ({ data: Buffer.alloc(64), bytesRead: 64 })),
  queryRegion: vi.fn(() => null),
};

vi.mock('@native/platform/factory', () => ({
  createPlatformProvider: vi.fn(() => mockProvider),
}));

vi.mock('@native/NativeMemoryManager.impl', () => ({
  nativeMemoryManager: { enumerateModules: vi.fn(async () => ({ success: true, modules: [] })) },
}));

vi.mock('@utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));

describe('StructureAnalyzer coverage: exportToCStruct()', () => {
  let analyzer: StructureAnalyzer;

  beforeEach(() => {
    analyzer = new StructureAnalyzer();
    vi.clearAllMocks();
  });

  it('emits struct definition with name', () => {
    const struct = makeStruct({ baseAddress: '0x1000', totalSize: 8 });
    const result = analyzer.exportToCStruct(struct, 'TestStruct');
    expect(result.definition).toContain('struct TestStruct');
  });

  it('emits struct with size comment', () => {
    const struct = makeStruct({ totalSize: 16 });
    const result = analyzer.exportToCStruct(struct, 'MyStruct');
    expect(result.definition).toContain('// size: 0x10');
  });

  it('uses className when name is not provided', () => {
    const struct = makeStruct({ className: 'PlayerClass' });
    const result = analyzer.exportToCStruct(struct);
    expect(result.definition).toContain('struct PlayerClass');
  });

  it('uses UnknownStruct when no name and no className', () => {
    const struct = makeStruct();
    const result = analyzer.exportToCStruct(struct);
    expect(result.definition).toContain('struct UnknownStruct');
  });

  it('emits padding field as uint8_t array', () => {
    const struct = makeStruct({
      fields: [makeField({ offset: 0, type: 'padding', size: 8, name: 'field_0x00' })],
    });
    const result = analyzer.exportToCStruct(struct, 'PaddedStruct');
    expect(result.definition).toContain('uint8_t _pad_0');
  });

  it('emits non-padding field with C type and name', () => {
    const struct = makeStruct({
      fields: [makeField({ offset: 0, type: 'int32', name: 'health', value: '100' })],
    });
    const result = analyzer.exportToCStruct(struct, 'Entity');
    expect(result.definition).toContain('int32_t health');
    expect(result.definition).toContain('// +0x00 = 100');
  });

  it('emits field with notes comment when present', () => {
    const struct = makeStruct({
      fields: [makeField({ offset: 0, type: 'vtable_ptr', notes: 'vtable pointer' })],
    });
    const result = analyzer.exportToCStruct(struct, 'GameObject');
    expect(result.definition).toContain('void**');
    expect(result.definition).toContain('vtable pointer');
  });

  it('returns fieldCount excluding padding fields', () => {
    const struct = makeStruct({
      fields: [
        makeField({ offset: 0, type: 'padding', size: 4 }),
        makeField({ offset: 4, type: 'int32', name: 'x' }),
      ],
    });
    const result = analyzer.exportToCStruct(struct);
    expect(result.fieldCount).toBe(1);
  });

  it('returns correct struct size', () => {
    const struct = makeStruct({ totalSize: 128 });
    const result = analyzer.exportToCStruct(struct);
    expect(result.size).toBe(128);
  });
});

describe('StructureAnalyzer coverage: fieldTypeToCType() — all type branches', () => {
  let analyzer: StructureAnalyzer;

  beforeEach(() => {
    analyzer = new StructureAnalyzer();
  });

  it('maps int8 to int8_t', () => {
    expect((analyzer as any).fieldTypeToCType('int8', 1)).toBe('int8_t');
  });
  it('maps uint8 to uint8_t', () => {
    expect((analyzer as any).fieldTypeToCType('uint8', 1)).toBe('uint8_t');
  });
  it('maps int16 to int16_t', () => {
    expect((analyzer as any).fieldTypeToCType('int16', 2)).toBe('int16_t');
  });
  it('maps uint16 to uint16_t', () => {
    expect((analyzer as any).fieldTypeToCType('uint16', 2)).toBe('uint16_t');
  });
  it('maps int32 to int32_t', () => {
    expect((analyzer as any).fieldTypeToCType('int32', 4)).toBe('int32_t');
  });
  it('maps uint32 to uint32_t', () => {
    expect((analyzer as any).fieldTypeToCType('uint32', 4)).toBe('uint32_t');
  });
  it('maps int64 to int64_t', () => {
    expect((analyzer as any).fieldTypeToCType('int64', 8)).toBe('int64_t');
  });
  it('maps uint64 to uint64_t', () => {
    expect((analyzer as any).fieldTypeToCType('uint64', 8)).toBe('uint64_t');
  });
  it('maps float to float', () => {
    expect((analyzer as any).fieldTypeToCType('float', 4)).toBe('float');
  });
  it('maps double to double', () => {
    expect((analyzer as any).fieldTypeToCType('double', 8)).toBe('double');
  });
  it('maps pointer to void*', () => {
    expect((analyzer as any).fieldTypeToCType('pointer', 8)).toBe('void*');
  });
  it('maps vtable_ptr to void**', () => {
    expect((analyzer as any).fieldTypeToCType('vtable_ptr', 8)).toBe('void**');
  });
  it('maps string_ptr to char*', () => {
    expect((analyzer as any).fieldTypeToCType('string_ptr', 8)).toBe('char*');
  });
  it('maps bool to bool', () => {
    expect((analyzer as any).fieldTypeToCType('bool', 4)).toBe('bool');
  });
  it('maps padding to uint8_t[size]', () => {
    expect((analyzer as any).fieldTypeToCType('padding', 16)).toBe('uint8_t[16]');
  });
  it('maps unknown to uint8_t[size]', () => {
    expect((analyzer as any).fieldTypeToCType('unknown', 8)).toBe('uint8_t[8]');
  });
  it('maps default/unknown type to uint8_t[size]', () => {
    expect((analyzer as any).fieldTypeToCType('not_a_type' as FieldType, 4)).toBe('uint8_t[4]');
  });
});

describe('StructureAnalyzer coverage: analyzeStructure() — field classification', () => {
  let analyzer: StructureAnalyzer;

  beforeEach(() => {
    analyzer = new StructureAnalyzer();
    vi.clearAllMocks();
  });

  it('classifies all-zeros as padding', () => {
    const buf = Buffer.alloc(16, 0);
    const result = (analyzer as any).classifyValue(buf, { pid: 1234 } as any, 0n, 0, 16);
    expect(result.type).toBe('padding');
  });

  it('classifies val32u===0 but not 8-byte zero as int32', () => {
    const buf = Buffer.alloc(8);
    buf.fill(0);
    buf[4] = 0x01; // break 8-byte zero condition
    const result = (analyzer as any).classifyValue(buf, { pid: 1234 } as any, 0n, 0, 8);
    expect(result.type).toBe('int32');
    expect(result.value).toBe('0');
  });

  it('classifies val32u===1 as bool', () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(1, 0);
    buf.writeUInt32LE(0, 4);
    const result = (analyzer as any).classifyValue(buf, { pid: 1234 } as any, 0n, 0, 8);
    expect(result.type).toBe('bool');
    expect(result.value).toBe('true');
  });

  it('classifies uint32 value >= 0x80000000 as uint32', () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(0x80000001, 0);
    const result = (analyzer as any).classifyValue(buf, { pid: 1234 } as any, 0n, 0, 4);
    expect(result.type).toBe('uint32');
  });

  it('classifies 2-byte value as uint16', () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt16LE(0x1234, 0);
    const result = (analyzer as any).classifyValue(buf, { pid: 1234 } as any, 0n, 0, 2);
    expect(result.type).toBe('uint16');
    expect(result.value).toBe('4660');
  });
});

describe('StructureAnalyzer coverage: parseVtable() — error branches', () => {
  it('breaks loop and returns empty functions when vtable read throws', async () => {
    const analyzer = new StructureAnalyzer();
    mockProvider.readMemory.mockImplementationOnce(() => {
      throw new Error('vtable read fault');
    });

    const result = await analyzer.parseVtable(1234, '0x7ff600010000');
    expect(result.functionCount).toBe(0);
    expect(result.address).toContain('7FF600010000');
  });

  it('handles RTTI parse failure best-effort (rttiName undefined)', async () => {
    const analyzer = new StructureAnalyzer();
    mockProvider.readMemory.mockImplementation(() => {
      throw new Error('RTTI fault');
    });

    const result = await analyzer.parseVtable(1234, '0x7ff600010000');
    expect(result.functionCount).toBe(0);
    expect(result.rttiName).toBeUndefined();
    expect(result.baseClasses).toBeUndefined();
  });
});
