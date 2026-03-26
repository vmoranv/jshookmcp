/**
 * MemoryController — unit tests.
 *
 * Tests undo/redo stack, freeze/unfreeze, and hex dump formatting.
 * Win32 APIs are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryController } from '@native/MemoryController';
import { VirtualProtectEx, WriteProcessMemory } from '@native/Win32API';

// Mock Win32API
vi.mock('@native/Win32API', () => ({
  openProcessForMemory: vi.fn(() => 1n),
  CloseHandle: vi.fn(() => true),
  ReadProcessMemory: vi.fn((_h: bigint, _a: bigint, size: number) => {
    const buf = Buffer.alloc(size);
    // Fill with known pattern for test verification
    for (let i = 0; i < size; i++) buf[i] = i & 0xff;
    return buf;
  }),
  WriteProcessMemory: vi.fn((_h: bigint, _a: bigint, _d: Buffer) => 4),
  VirtualProtectEx: vi.fn(() => ({ success: true, oldProtect: 0x04 })),
  PAGE: { READWRITE: 0x04 },
}));

// Mock NativeMemoryManager.utils
vi.mock('@native/NativeMemoryManager.utils', () => ({
  parsePattern: vi.fn((value: string, _type: string) => ({
    patternBytes: Buffer.from([parseInt(value) & 0xff, 0, 0, 0]),
  })),
}));

vi.mock('@src/constants', () => ({
  FREEZE_DEFAULT_INTERVAL_MS: 100,
  WRITE_HISTORY_MAX: 50,
}));

describe('MemoryController', () => {
  let ctrl: MemoryController;

  beforeEach(() => {
    ctrl = new MemoryController();
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('writeValue', () => {
    it('should write and record in history', async () => {
      const entry = await ctrl.writeValue(1234, '0x1000', '42', 'int32');
      expect(entry.id).toBeDefined();
      expect(entry.pid).toBe(1234);
      expect(entry.address).toBe('0x1000');
      expect(entry.undone).toBe(false);
    });

    it('should save old value for undo', async () => {
      const entry = await ctrl.writeValue(1234, '0x1000', '42', 'int32');
      expect(entry.oldValue.length).toBeGreaterThan(0);
      expect(entry.newValue.length).toBeGreaterThan(0);
    });
  });

  describe('undo/redo', () => {
    it('should undo last write', async () => {
      await ctrl.writeValue(1234, '0x1000', '42', 'int32');
      const undone = await ctrl.undo();
      expect(undone).not.toBeNull();
      expect(undone!.undone).toBe(true);
    });

    it('should return null when nothing to undo', async () => {
      expect(await ctrl.undo()).toBeNull();
    });

    it('should redo after undo', async () => {
      await ctrl.writeValue(1234, '0x1000', '42', 'int32');
      await ctrl.undo();
      const redone = await ctrl.redo();
      expect(redone).not.toBeNull();
      expect(redone!.undone).toBe(false);
    });

    it('should return null when nothing to redo', async () => {
      expect(await ctrl.redo()).toBeNull();
    });

    it('should clear redo stack on new write', async () => {
      await ctrl.writeValue(1234, '0x1000', '42', 'int32');
      await ctrl.undo();
      await ctrl.writeValue(1234, '0x1000', '99', 'int32');
      expect(await ctrl.redo()).toBeNull();
    });
  });

  describe('freeze/unfreeze', () => {
    it('should create active freeze entry', async () => {
      const entry = await ctrl.freeze(1234, '0x1000', '42', 'int32');
      expect(entry.id).toBeDefined();
      expect(entry.isActive).toBe(true);
      expect(entry.intervalMs).toBe(100);
      // Cleanup
      await ctrl.unfreeze(entry.id);
    });

    it('should unfreeze by id', async () => {
      const entry = await ctrl.freeze(1234, '0x1000', '42', 'int32');
      const result = await ctrl.unfreeze(entry.id);
      expect(result).toBe(true);
    });

    it('should return false for invalid freeze id', async () => {
      expect(await ctrl.unfreeze('invalid')).toBe(false);
    });

    it('should list active freezes', async () => {
      const e1 = await ctrl.freeze(1234, '0x1000', '42', 'int32');
      const e2 = await ctrl.freeze(1234, '0x2000', '99', 'int32');
      const list = ctrl.listFreezes();
      expect(list.length).toBe(2);
      await ctrl.unfreeze(e1.id);
      await ctrl.unfreeze(e2.id);
    });

    it('should unfreeze all', async () => {
      await ctrl.freeze(1234, '0x1000', '42', 'int32');
      await ctrl.freeze(1234, '0x2000', '99', 'int32');
      const count = await ctrl.unfreezeAll();
      expect(count).toBe(2);
      expect(ctrl.listFreezes().length).toBe(0);
    });

    it('should temporarily make target pages writable during freeze writes', async () => {
      const entry = await ctrl.freeze(1234, '0x1000', '42', 'int32');
      vi.advanceTimersByTime(100);

      expect(WriteProcessMemory).toHaveBeenCalled();
      expect(VirtualProtectEx).toHaveBeenCalledTimes(2);

      await ctrl.unfreeze(entry.id);
    });
  });

  describe('dumpMemoryHex', () => {
    it('should produce formatted hex dump with addresses', async () => {
      const hex = await ctrl.dumpMemoryHex(1234, '0x1000', 32);
      expect(hex).toContain('000000001000');
      expect(hex).toContain('000000001010');
      // Should have hex bytes and ASCII column
      expect(hex).toContain('|');
    });

    it('should handle small dump sizes', async () => {
      const hex = await ctrl.dumpMemoryHex(1234, '0x1000', 4);
      const lines = hex.split('\n');
      expect(lines.length).toBe(1);
    });
  });

  describe('getWriteHistory', () => {
    it('should return copy of history', async () => {
      await ctrl.writeValue(1234, '0x1000', '42', 'int32');
      await ctrl.writeValue(1234, '0x1000', '99', 'int32');
      const history = ctrl.getWriteHistory();
      expect(history.length).toBe(2);
    });
  });
});
