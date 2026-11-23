/**
 * Memory Controller — freeze, undo/redo writes, memory dump.
 *
 * @module MemoryController
 */

import { randomUUID } from 'node:crypto';
import { FREEZE_DEFAULT_INTERVAL_MS, WRITE_HISTORY_MAX } from '@src/constants';
import type { FreezeEntry, WriteHistoryEntry } from './MemoryController.types';
import { createPlatformProvider } from '@native/platform/factory';
import type { PlatformMemoryAPI } from '@native/platform/PlatformMemoryAPI';
import { MemoryProtection } from '@native/platform/types';
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
  private platformProvider: PlatformMemoryAPI | null = null;

  /**
   * Optional provider injection for portable operations. Windows continues to
   * use the existing Win32 API path, regardless of this dependency.
   */
  constructor(provider?: PlatformMemoryAPI) {
    this.platformProvider = provider ?? null;
  }

  private getPortableProvider(): PlatformMemoryAPI {
    this.platformProvider ??= createPlatformProvider();
    return this.platformProvider;
  }

  private async readBuffer(pid: number, address: bigint, size: number): Promise<Buffer> {
    if (process.platform === 'win32') {
      // Low-frequency single-read path (write_value/undo/redo). Left synchronous;
      // the scanner hot path uses the async provider (see a4-01 registry).
      const handle = openProcessForMemory(pid, false);
      try {
        return ReadProcessMemory(handle, address, size);
      } finally {
        CloseHandle(handle);
      }
    }

    const provider = this.getPortableProvider();
    const handle = provider.openProcess(pid, false);
    try {
      const result = await provider.readMemory(handle, address, size);
      return result.data.subarray(0, result.bytesRead);
    } finally {
      provider.closeProcess(handle);
    }
  }

  private async writeBuffer(pid: number, address: bigint, data: Buffer): Promise<void> {
    if (process.platform === 'win32') {
      const handle = openProcessForMemory(pid, true);
      try {
        const { oldProtect } = VirtualProtectEx(handle, address, data.length, PAGE.READWRITE);
        try {
          WriteProcessMemory(handle, address, data);
        } finally {
          // Restore the original protection even when the write throws — a
          // failed write must not leave the target region PAGE_READWRITE.
          VirtualProtectEx(handle, address, data.length, oldProtect);
        }
      } finally {
        CloseHandle(handle);
      }
      return;
    }

    const provider = this.getPortableProvider();
    const handle = provider.openProcess(pid, true);
    let oldProtection: MemoryProtection | undefined;
    try {
      const region = provider.queryRegion(handle, address);
      if (!region?.isWritable) {
        oldProtection = provider.changeProtection(
          handle,
          address,
          data.length,
          MemoryProtection.ReadWrite,
        ).oldProtection;
      }
      await provider.writeMemory(handle, address, data);
    } finally {
      try {
        if (oldProtection !== undefined) {
          provider.changeProtection(handle, address, data.length, oldProtection);
        }
      } finally {
        provider.closeProcess(handle);
      }
    }
  }

  /** Write a typed value to memory (with undo support) */
  async writeValue(
    pid: number,
    address: string,
    value: string,
    valueType: string,
  ): Promise<WriteHistoryEntry> {
    const addr = BigInt(address.startsWith('0x') ? address : `0x${address}`);
    const { patternBytes } = parsePattern(value, valueType as Parameters<typeof parsePattern>[1]);
    const newBuf = Buffer.from(patternBytes);

    const oldBuf = await this.readBuffer(pid, addr, newBuf.length);
    if (oldBuf.length !== newBuf.length) {
      throw new Error(
        `Memory read returned ${oldBuf.length} of ${newBuf.length} bytes at ${address}; ` +
          `refusing to write without a complete undo snapshot`,
      );
    }
    await this.writeBuffer(pid, addr, newBuf);

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
  }

  /**
   * Undo the last write.
   *
   * When `pid` is provided, only undoes the most recent non-undone write
   * belonging to that process — this prevents cross-process interleaving
   * errors when multiple processes are being written concurrently (the
   * previous global stack could revert an unrelated process's write).
   * Omit `pid` for the legacy global-undo behaviour.
   */
  async undo(pid?: number): Promise<WriteHistoryEntry | null> {
    // Find last non-undone entry matching the optional pid filter.
    for (let i = this.writeHistory.length - 1; i >= 0; i--) {
      const entry = this.writeHistory[i]!;
      if (entry.undone) continue;
      if (pid !== undefined && entry.pid !== pid) continue;

      const addr = BigInt(entry.address);
      const oldBuf = Buffer.from(entry.oldValue);

      await this.writeBuffer(entry.pid, addr, oldBuf);

      entry.undone = true;
      this.undoneStack.push(entry);
      return entry;
    }
    return null;
  }

  /**
   * Redo the last undone write.
   *
   * When `pid` is provided, redoes the most recently undone write for that
   * process (searches the redo stack from the top rather than blindly popping,
   * so per-PID redo stays correct under interleaving).
   */
  async redo(pid?: number): Promise<WriteHistoryEntry | null> {
    for (let i = this.undoneStack.length - 1; i >= 0; i--) {
      const entry = this.undoneStack[i]!;
      if (pid !== undefined && entry.pid !== pid) continue;

      const addr = BigInt(entry.address);
      const newBuf = Buffer.from(entry.newValue);

      // Write before mutating the redo stack: if the write rejects, the entry
      // must stay available for a later redo attempt.
      await this.writeBuffer(entry.pid, addr, newBuf);

      const idx = this.undoneStack.indexOf(entry);
      if (idx >= 0) this.undoneStack.splice(idx, 1);

      entry.undone = false;
      return entry;
    }
    return null;
  }

  /** Freeze: continuously write value at interval */
  async freeze(
    pid: number,
    address: string,
    value: string,
    valueType: string,
    intervalMs?: number,
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
      void this.writeBuffer(pid, addr, valueBuf).catch(() => {
        // If write fails, deactivate and fully evict from the index
        // so stale entries don't accumulate.
        entry.isActive = false;
        if (entry.timer) clearInterval(entry.timer);
        this.freezes.delete(entry.id);
      });
    }, interval);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();

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
    return this.readBuffer(pid, addr, size);
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
