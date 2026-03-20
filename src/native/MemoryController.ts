/**
 * Memory Controller — freeze, undo/redo writes, memory dump.
 *
 * @module MemoryController
 */

import { randomUUID } from 'node:crypto';
import {
  FREEZE_DEFAULT_INTERVAL_MS,
  WRITE_HISTORY_MAX,
} from '@src/constants';
import type { FreezeEntry, WriteHistoryEntry } from './MemoryController.types';
import {
  openProcessForMemory,
  CloseHandle,
  ReadProcessMemory,
  WriteProcessMemory,
  VirtualProtectEx,
  PAGE,
} from './Win32API';
import { parsePattern } from './NativeMemoryManager.utils';

export class MemoryController {
  private freezes = new Map<string, FreezeEntry & { timer?: ReturnType<typeof setInterval> }>();
  private writeHistory: WriteHistoryEntry[] = [];
  private undoneStack: WriteHistoryEntry[] = [];

  /** Write a typed value to memory (with undo support) */
  async writeValue(
    pid: number,
    address: string,
    value: string,
    valueType: string
  ): Promise<WriteHistoryEntry> {
    const addr = BigInt(address.startsWith('0x') ? address : `0x${address}`);
    const { patternBytes } = parsePattern(value, valueType as Parameters<typeof parsePattern>[1]);
    const newBuf = Buffer.from(patternBytes);

    const handle = openProcessForMemory(pid, true);
    try {
      // Read old value
      const oldBuf = ReadProcessMemory(handle, addr, newBuf.length);

      // Make writable and write
      const { oldProtect } = VirtualProtectEx(handle, addr, newBuf.length, PAGE.READWRITE);
      WriteProcessMemory(handle, addr, newBuf);
      VirtualProtectEx(handle, addr, newBuf.length, oldProtect);

      const entry: WriteHistoryEntry = {
        id: randomUUID(),
        pid,
        address: `0x${addr.toString(16).toUpperCase()}`,
        oldValue: Array.from(oldBuf),
        newValue: Array.from(newBuf),
        timestamp: Date.now(),
        undone: false,
      };

      this.writeHistory.push(entry);
      this.undoneStack = []; // Clear redo stack on new write

      // Trim history
      if (this.writeHistory.length > WRITE_HISTORY_MAX) {
        this.writeHistory = this.writeHistory.slice(-WRITE_HISTORY_MAX);
      }

      return entry;
    } finally {
      CloseHandle(handle);
    }
  }

  /** Undo last write */
  async undo(): Promise<WriteHistoryEntry | null> {
    // Find last non-undone entry
    for (let i = this.writeHistory.length - 1; i >= 0; i--) {
      const entry = this.writeHistory[i]!;
      if (!entry.undone) {
        const addr = BigInt(entry.address);
        const oldBuf = Buffer.from(entry.oldValue);

        const handle = openProcessForMemory(entry.pid, true);
        try {
          const { oldProtect } = VirtualProtectEx(handle, addr, oldBuf.length, PAGE.READWRITE);
          WriteProcessMemory(handle, addr, oldBuf);
          VirtualProtectEx(handle, addr, oldBuf.length, oldProtect);
        } finally {
          CloseHandle(handle);
        }

        entry.undone = true;
        this.undoneStack.push(entry);
        return entry;
      }
    }
    return null;
  }

  /** Redo last undone write */
  async redo(): Promise<WriteHistoryEntry | null> {
    const entry = this.undoneStack.pop();
    if (!entry) return null;

    const addr = BigInt(entry.address);
    const newBuf = Buffer.from(entry.newValue);

    const handle = openProcessForMemory(entry.pid, true);
    try {
      const { oldProtect } = VirtualProtectEx(handle, addr, newBuf.length, PAGE.READWRITE);
      WriteProcessMemory(handle, addr, newBuf);
      VirtualProtectEx(handle, addr, newBuf.length, oldProtect);
    } finally {
      CloseHandle(handle);
    }

    entry.undone = false;
    return entry;
  }

  /** Freeze: continuously write value at interval */
  async freeze(
    pid: number,
    address: string,
    value: string,
    valueType: string,
    intervalMs?: number
  ): Promise<FreezeEntry> {
    const addr = BigInt(address.startsWith('0x') ? address : `0x${address}`);
    const { patternBytes } = parsePattern(value, valueType as Parameters<typeof parsePattern>[1]);
    const valueBuf = Buffer.from(patternBytes);
    const interval = intervalMs ?? FREEZE_DEFAULT_INTERVAL_MS;

    const entry: FreezeEntry & { timer?: ReturnType<typeof setInterval> } = {
      id: randomUUID(),
      pid,
      address: `0x${addr.toString(16).toUpperCase()}`,
      value: Array.from(valueBuf),
      valueType,
      intervalMs: interval,
      isActive: true,
    };

    // Start periodic write
    entry.timer = setInterval(() => {
      try {
        const handle = openProcessForMemory(pid, true);
        try {
          const { oldProtect } = VirtualProtectEx(handle, addr, valueBuf.length, PAGE.READWRITE);
          WriteProcessMemory(handle, addr, valueBuf);
          VirtualProtectEx(handle, addr, valueBuf.length, oldProtect);
        } finally {
          CloseHandle(handle);
        }
      } catch {
        // If write fails, deactivate
        entry.isActive = false;
        if (entry.timer) clearInterval(entry.timer);
      }
    }, interval);

    this.freezes.set(entry.id, entry);
    return entry;
  }

  /** Unfreeze */
  async unfreeze(freezeId: string): Promise<boolean> {
    const entry = this.freezes.get(freezeId);
    if (!entry) return false;

    if (entry.timer) clearInterval(entry.timer);
    entry.isActive = false;
    this.freezes.delete(freezeId);
    return true;
  }

  /** Unfreeze all */
  async unfreezeAll(): Promise<number> {
    let count = 0;
    for (const [id] of this.freezes) {
      await this.unfreeze(id);
      count++;
    }
    return count;
  }

  /** List all active freezes */
  listFreezes(): FreezeEntry[] {
    return Array.from(this.freezes.values()).map(({ timer: _timer, ...rest }) => rest);
  }

  /** Dump memory region to Buffer */
  async dumpMemory(pid: number, address: string, size: number): Promise<Buffer> {
    const addr = BigInt(address.startsWith('0x') ? address : `0x${address}`);
    const handle = openProcessForMemory(pid, false);
    try {
      return ReadProcessMemory(handle, addr, size);
    } finally {
      CloseHandle(handle);
    }
  }

  /** Dump memory region as hex string */
  async dumpMemoryHex(pid: number, address: string, size: number): Promise<string> {
    const buf = await this.dumpMemory(pid, address, size);
    const lines: string[] = [];
    const addr = BigInt(address.startsWith('0x') ? address : `0x${address}`);

    for (let i = 0; i < buf.length; i += 16) {
      const lineAddr = addr + BigInt(i);
      const hex = Array.from(buf.subarray(i, Math.min(i + 16, buf.length)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      const ascii = Array.from(buf.subarray(i, Math.min(i + 16, buf.length)))
        .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
        .join('');
      lines.push(`${lineAddr.toString(16).padStart(12, '0')}  ${hex.padEnd(47)}  |${ascii}|`);
    }

    return lines.join('\n');
  }

  /** Get write history */
  getWriteHistory(): WriteHistoryEntry[] {
    return [...this.writeHistory];
  }
}

export const memoryController = new MemoryController();
