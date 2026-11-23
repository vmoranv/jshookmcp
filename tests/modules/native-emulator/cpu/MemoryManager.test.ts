/**
 * Unit tests for MemoryManager — Guest memory management for the ARM64 emulator.
 *
 * Tests memory region mapping, load/store operations, fast-path caching,
 * symbol table, and error handling for unmapped accesses.
 */

import { describe, test, expect } from 'vitest';
import { MemoryManager } from '@modules/native-emulator/cpu/MemoryManager.js';

describe('MemoryManager', () => {
  describe('mapMemory and writeCode', () => {
    test('mapMemory creates a zero-filled region', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      const data = mm.readMemory(0x1000, 256);
      expect(data.every((b) => b === 0)).toBe(true);
    });

    test('writeCode writes bytes to mapped region', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      const code = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      mm.writeCode(0x1000, code);
      const result = mm.readMemory(0x1000, 4);
      expect(Array.from(result)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    });

    test('writeCode at offset within region', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      const code = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);
      mm.writeCode(0x1080, code);
      const result = mm.readMemory(0x1080, 4);
      expect(Array.from(result)).toEqual([0xca, 0xfe, 0xba, 0xbe]);
    });

    test('writeCode throws on unmapped address', () => {
      const mm = new MemoryManager();
      const code = new Uint8Array([0x01, 0x02]);
      expect(() => mm.writeCode(0x9999, code)).toThrow('Unmapped memory access');
    });
  });

  describe('loadValue and storeValue', () => {
    test('loadValue reads 1-byte little-endian', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      mm.writeCode(0x1000, new Uint8Array([0xab]));
      expect(mm.loadValue(0x1000, 1)).toBe(0xabn);
    });

    test('loadValue reads 2-byte little-endian', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      mm.writeCode(0x1000, new Uint8Array([0x34, 0x12]));
      expect(mm.loadValue(0x1000, 2)).toBe(0x1234n);
    });

    test('loadValue reads 4-byte little-endian', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      mm.writeCode(0x1000, new Uint8Array([0xef, 0xbe, 0xad, 0xde]));
      expect(mm.loadValue(0x1000, 4)).toBe(0xdeadbeefn);
    });

    test('loadValue reads 8-byte little-endian', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      mm.writeCode(0x1000, new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]));
      expect(mm.loadValue(0x1000, 8)).toBe(0x0807060504030201n);
    });

    test('storeValue writes 1-byte', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      mm.storeValue(0x1000, 1, 0xffn);
      expect(mm.loadValue(0x1000, 1)).toBe(0xffn);
    });

    test('storeValue writes 2-byte little-endian', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      mm.storeValue(0x1000, 2, 0xabcdn);
      const bytes = mm.readMemory(0x1000, 2);
      expect(Array.from(bytes)).toEqual([0xcd, 0xab]);
    });

    test('storeValue writes 4-byte little-endian', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      mm.storeValue(0x1000, 4, 0x12345678n);
      const bytes = mm.readMemory(0x1000, 4);
      expect(Array.from(bytes)).toEqual([0x78, 0x56, 0x34, 0x12]);
    });

    test('storeValue writes 8-byte little-endian', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      mm.storeValue(0x1000, 8, 0x1122334455667788n);
      const bytes = mm.readMemory(0x1000, 8);
      expect(Array.from(bytes)).toEqual([0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11]);
    });

    test('loadValue throws on unmapped address', () => {
      const mm = new MemoryManager();
      expect(() => mm.loadValue(0x9999, 4)).toThrow('Unmapped memory access');
    });

    test('storeValue throws on unmapped address', () => {
      const mm = new MemoryManager();
      expect(() => mm.storeValue(0x9999, 4, 0xdeadn)).toThrow('Unmapped memory access');
    });

    test('loadValue throws when access crosses region boundary', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      expect(() => mm.loadValue(0x10ff, 4)).toThrow('Unmapped memory access');
    });

    test('storeValue throws when access crosses region boundary', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      expect(() => mm.storeValue(0x10ff, 4, 0xdeadn)).toThrow('Unmapped memory access');
    });
  });

  describe('readMemory and writeMemory', () => {
    test('readMemory returns a copy of bytes', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      mm.writeCode(0x1000, new Uint8Array([0x11, 0x22, 0x33, 0x44]));
      const result = mm.readMemory(0x1000, 4);
      expect(Array.from(result)).toEqual([0x11, 0x22, 0x33, 0x44]);
      // Verify it's a copy, not a reference
      result[0] = 0xff;
      const check = mm.readMemory(0x1000, 1);
      expect(check[0]).toBe(0x11);
    });

    test('writeMemory writes bytes to region', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      mm.writeMemory(0x1000, new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]));
      expect(mm.loadValue(0x1000, 4)).toBe(0xddccbbaan);
    });

    test('readMemory throws on unmapped address', () => {
      const mm = new MemoryManager();
      expect(() => mm.readMemory(0x9999, 16)).toThrow('Unmapped memory access');
    });

    test('writeMemory throws on unmapped address', () => {
      const mm = new MemoryManager();
      expect(() => mm.writeMemory(0x9999, new Uint8Array(16))).toThrow('Unmapped memory access');
    });
  });

  describe('findRegion fast-path cache', () => {
    test('sequential accesses use cached region', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 0x1000);
      // First access populates cache
      mm.loadValue(0x1000, 4);
      // Second access should hit cache (no way to directly observe, but verify correctness)
      mm.storeValue(0x1100, 4, 0xabcdn);
      expect(mm.loadValue(0x1100, 4)).toBe(0xabcdn);
    });

    test('access outside cached region triggers full lookup', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 0x100);
      mm.mapMemory(0x2000, 0x100);
      mm.storeValue(0x1000, 4, 0x1111n);
      mm.storeValue(0x2000, 4, 0x2222n);
      expect(mm.loadValue(0x1000, 4)).toBe(0x1111n);
      expect(mm.loadValue(0x2000, 4)).toBe(0x2222n);
    });

    test('overlapping regions disable fast-path', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 0x100);
      // Overlapping region at 0x1080 (overlaps with first region)
      mm.mapMemory(0x1080, 0x100);
      mm.storeValue(0x1000, 4, 0xaaaaan);
      mm.storeValue(0x1080, 4, 0xbbbbn);
      // Should still work correctly, even though fast-path is disabled
      expect(mm.loadValue(0x1000, 4)).toBe(0xaaaaan);
      expect(mm.loadValue(0x1080, 4)).toBe(0xbbbbn);
    });

    test('non-overlapping regions keep fast-path enabled', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 0x100);
      mm.mapMemory(0x2000, 0x100);
      mm.mapMemory(0x3000, 0x100);
      // All regions are distinct, fast-path should remain active
      mm.storeValue(0x1000, 4, 0x1111n);
      mm.storeValue(0x2000, 4, 0x2222n);
      mm.storeValue(0x3000, 4, 0x3333n);
      expect(mm.loadValue(0x1000, 4)).toBe(0x1111n);
      expect(mm.loadValue(0x2000, 4)).toBe(0x2222n);
      expect(mm.loadValue(0x3000, 4)).toBe(0x3333n);
    });
  });

  describe('Symbol table', () => {
    test('addSymbol and findSymbol work correctly', () => {
      const mm = new MemoryManager();
      mm.addSymbol('main', 0x1234);
      mm.addSymbol('init', 0x5678);
      expect(mm.findSymbol('main')).toBe(0x1234);
      expect(mm.findSymbol('init')).toBe(0x5678);
    });

    test('findSymbol returns undefined for missing symbol', () => {
      const mm = new MemoryManager();
      expect(mm.findSymbol('nonexistent')).toBeUndefined();
    });

    test('hasSymbol returns true for existing symbol', () => {
      const mm = new MemoryManager();
      mm.addSymbol('foo', 0x1000);
      expect(mm.hasSymbol('foo')).toBe(true);
    });

    test('hasSymbol returns false for missing symbol', () => {
      const mm = new MemoryManager();
      expect(mm.hasSymbol('bar')).toBe(false);
    });

    test('getSymbolNames returns all symbol names', () => {
      const mm = new MemoryManager();
      mm.addSymbol('sym1', 0x1000);
      mm.addSymbol('sym2', 0x2000);
      mm.addSymbol('sym3', 0x3000);
      const names = mm.getSymbolNames();
      expect(names).toHaveLength(3);
      expect(names).toContain('sym1');
      expect(names).toContain('sym2');
      expect(names).toContain('sym3');
    });

    test('getSymbolNames returns empty array when no symbols', () => {
      const mm = new MemoryManager();
      expect(mm.getSymbolNames()).toEqual([]);
    });

    test('clearSymbols removes all symbols', () => {
      const mm = new MemoryManager();
      mm.addSymbol('sym1', 0x1000);
      mm.addSymbol('sym2', 0x2000);
      mm.clearSymbols();
      expect(mm.getSymbolNames()).toEqual([]);
      expect(mm.hasSymbol('sym1')).toBe(false);
    });

    test('addSymbol overwrites existing symbol', () => {
      const mm = new MemoryManager();
      mm.addSymbol('foo', 0x1000);
      mm.addSymbol('foo', 0x2000);
      expect(mm.findSymbol('foo')).toBe(0x2000);
    });
  });

  describe('dumpMemory', () => {
    test('dumpMemory returns hex string without 0x prefix', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      mm.writeCode(0x1000, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
      const hex = mm.dumpMemory(0x1000, 4);
      expect(hex).toBe('deadbeef');
    });

    test('dumpMemory pads single-digit hex values', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      mm.writeCode(0x1000, new Uint8Array([0x01, 0x02, 0x0a, 0x0b]));
      const hex = mm.dumpMemory(0x1000, 4);
      expect(hex).toBe('01020a0b');
    });

    test('dumpMemory returns empty string for zero length', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      const hex = mm.dumpMemory(0x1000, 0);
      expect(hex).toBe('');
    });

    test('dumpMemory throws on unmapped address', () => {
      const mm = new MemoryManager();
      expect(() => mm.dumpMemory(0x9999, 16)).toThrow('Unmapped memory access');
    });
  });

  describe('Edge cases and boundary tests', () => {
    test('zero-size region is valid', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 0);
      // No access possible, but mapping succeeds
      expect(() => mm.loadValue(0x1000, 1)).toThrow('Unmapped memory access');
    });

    test('large region (16MB) works correctly', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 16 * 1024 * 1024);
      mm.storeValue(0x1000, 8, 0xdeadbeefcafebabn);
      expect(mm.loadValue(0x1000, 8)).toBe(0xdeadbeefcafebabn);
    });

    test('multiple non-overlapping regions work correctly', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 0x1000);
      mm.mapMemory(0x10000, 0x1000);
      mm.mapMemory(0x100000, 0x1000);
      mm.storeValue(0x1000, 4, 0x1111n);
      mm.storeValue(0x10000, 4, 0x2222n);
      mm.storeValue(0x100000, 4, 0x3333n);
      expect(mm.loadValue(0x1000, 4)).toBe(0x1111n);
      expect(mm.loadValue(0x10000, 4)).toBe(0x2222n);
      expect(mm.loadValue(0x100000, 4)).toBe(0x3333n);
    });

    test('access at exact region end boundary fails', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 0x100);
      expect(() => mm.loadValue(0x1100, 1)).toThrow('Unmapped memory access');
    });

    test('access one byte before region end succeeds', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 0x100);
      mm.storeValue(0x10ff, 1, 0xffn);
      expect(mm.loadValue(0x10ff, 1)).toBe(0xffn);
    });

    test('storeValue truncates value to requested byte width', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 256);
      mm.storeValue(0x1000, 1, 0x12ffn); // Only 0xff should be written
      expect(mm.loadValue(0x1000, 1)).toBe(0xffn);
      mm.storeValue(0x1001, 2, 0x123456n); // Only 0x3456 should be written
      expect(mm.loadValue(0x1001, 2)).toBe(0x3456n);
    });
  });

  describe('shadow memory write behavior', () => {
    test('write paths bypass the read hook and mutate real memory', () => {
      const mm = new MemoryManager();
      mm.mapMemory(0x1000, 16);
      const shadow = new Uint8Array(16).fill(0xaa);
      mm.readHook = (address, length) => (address === 0x1000 ? shadow.subarray(0, length) : null);

      mm.writeMemory(0x1000, new Uint8Array([1, 2, 3]));
      mm.storeValue(0x1004, 1, 0x55n);

      // Drop the hook to observe the real region.
      mm.readHook = null;
      expect(Array.from(mm.readMemory(0x1000, 3))).toEqual([1, 2, 3]);
      expect(mm.loadValue(0x1004, 1)).toBe(0x55n);
      // The shadow overlay must not have received guest stores.
      expect(shadow.every((b) => b === 0xaa)).toBe(true);
    });
  });
});
