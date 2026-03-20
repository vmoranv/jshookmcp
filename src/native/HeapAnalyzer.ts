/**
 * Heap Analysis Engine.
 *
 * Enumerates process heaps and blocks via Toolhelp32 Snapshot APIs,
 * provides statistical analysis and anomaly detection (spray, UAF heuristic).
 *
 * @module HeapAnalyzer
 */

import { logger } from '@utils/logger';
import koffi from 'koffi';
import {
  openProcessForMemory,
  CloseHandle,
  ReadProcessMemory,
} from '@native/Win32API';
import {
  HEAP_ENUMERATE_MAX_BLOCKS,
  HEAP_SPRAY_THRESHOLD,
  HEAP_SPRAY_SIZE_TOLERANCE,
  HEAP_SUSPICIOUS_BLOCK_SIZE,
} from '@src/constants';
import type {
  HeapInfo,
  HeapBlock,
  HeapStats,
  HeapSizeBucket,
  HeapAnomaly,
} from './HeapAnalyzer.types';
import { LF32, HF32 } from './HeapAnalyzer.types';
import { TH32CS } from '@native/Win32Debug';

// ── Toolhelp32 Heap APIs (loaded lazily) ──

let _heapApis: ReturnType<typeof loadHeapApis> | null = null;

function loadHeapApis() {
  const k32 = koffi.load('kernel32.dll');

  return {
    CreateToolhelp32Snapshot: k32.func('CreateToolhelp32Snapshot', 'intptr', ['uint32', 'uint32']),
    Heap32ListFirst: k32.func('Heap32ListFirst', 'bool', ['intptr', '_Inout_ uint8_t *']),
    Heap32ListNext: k32.func('Heap32ListNext', 'bool', ['intptr', '_Inout_ uint8_t *']),
    Heap32First: k32.func('Heap32First', 'bool', ['_Inout_ uint8_t *', 'uint32', 'uintptr_t']),
    Heap32Next: k32.func('Heap32Next', 'bool', ['_Inout_ uint8_t *']),
    CloseHandle: k32.func('int CloseHandle(intptr)'),
    // Structure sizes
    HEAPLIST32_SIZE: 36, // dwSize(8) + th32ProcessID(4) + th32HeapID(8) + dwFlags(4) + padding
    HEAPENTRY32_SIZE: 56, // dwSize(8) + hHandle(8) + dwAddress(8) + dwBlockSize(8) + dwFlags(4) + dwLockCount(4) + dwResvd(4) + th32ProcessID(4) + th32HeapID(8)
  };
}

function getHeapApis() {
  if (!_heapApis) _heapApis = loadHeapApis();
  return _heapApis;
}

// ── Size Distribution Buckets ──

const SIZE_RANGES: [string, number, number][] = [
  ['0-64B', 0, 64],
  ['64-256B', 64, 256],
  ['256B-1KB', 256, 1024],
  ['1-4KB', 1024, 4096],
  ['4-16KB', 4096, 16384],
  ['16-64KB', 16384, 65536],
  ['64KB-1MB', 65536, 1048576],
  ['>1MB', 1048576, Number.MAX_SAFE_INTEGER],
];

function classifyBlock(size: number): number {
  for (let i = 0; i < SIZE_RANGES.length; i++) {
    const range = SIZE_RANGES[i]!;
    if (size >= range[1] && size < range[2]) return i;
  }
  return SIZE_RANGES.length - 1;
}

// ── HeapAnalyzer Class ──

export class HeapAnalyzer {
  /**
   * Enumerate all heaps in a process and return info + stats.
   */
  async enumerateHeaps(pid: number): Promise<{ heaps: HeapInfo[]; stats: HeapStats }> {
    const apis = getHeapApis();
    const hSnap = apis.CreateToolhelp32Snapshot(TH32CS.SNAPHEAPLIST, pid);
    if (hSnap === -1n && typeof hSnap === 'bigint') {
      throw new Error(`Failed to create heap snapshot for PID ${pid}`);
    }

    const heaps: HeapInfo[] = [];

    try {
      // HEAPLIST32 buffer: dwSize(8) + th32ProcessID(4) + th32HeapID(8) + dwFlags(4)
      const hlBuf = Buffer.alloc(apis.HEAPLIST32_SIZE);
      hlBuf.writeBigUInt64LE(BigInt(apis.HEAPLIST32_SIZE), 0); // dwSize

      let hasHeap = apis.Heap32ListFirst(hSnap, hlBuf);

      while (hasHeap) {
        const processId = hlBuf.readUInt32LE(8);
        const heapId = hlBuf.readBigUInt64LE(12);
        const flags = hlBuf.readUInt32LE(20);

        // Enumerate blocks in this heap
        const blocks = await this._enumerateBlocksInternal(pid, heapId, HEAP_ENUMERATE_MAX_BLOCKS);

        heaps.push({
          heapId: `0x${heapId.toString(16)}`,
          processId,
          flags,
          isDefault: (flags & HF32.DEFAULT) !== 0,
          blockCount: blocks.length,
          totalSize: blocks.reduce((sum, b) => sum + b.size, 0),
        });

        hlBuf.writeBigUInt64LE(BigInt(apis.HEAPLIST32_SIZE), 0);
        hasHeap = apis.Heap32ListNext(hSnap, hlBuf);
      }
    } finally {
      apis.CloseHandle(hSnap);
    }

    const stats = this._computeStats(heaps, []);
    return { heaps, stats };
  }

  /**
   * Enumerate blocks within a specific heap.
   */
  async enumerateBlocks(
    pid: number,
    heapId: string,
    options?: { maxBlocks?: number }
  ): Promise<HeapBlock[]> {
    const id = BigInt(heapId);
    const max = options?.maxBlocks ?? HEAP_ENUMERATE_MAX_BLOCKS;
    return this._enumerateBlocksInternal(pid, id, max);
  }

  /**
   * Get full statistical breakdown for all heaps.
   */
  async getStats(pid: number): Promise<HeapStats> {
    const { heaps } = await this.enumerateHeaps(pid);

    // Collect all blocks for detailed stats
    const allBlocks: HeapBlock[] = [];
    for (const heap of heaps) {
      const blocks = await this._enumerateBlocksInternal(
        pid,
        BigInt(heap.heapId),
        HEAP_ENUMERATE_MAX_BLOCKS
      );
      allBlocks.push(...blocks);
    }

    return this._computeStats(heaps, allBlocks);
  }

  /**
   * Detect heap anomalies: spray, UAF heuristic, suspicious sizes.
   */
  async detectAnomalies(pid: number): Promise<HeapAnomaly[]> {
    const anomalies: HeapAnomaly[] = [];
    const { heaps } = await this.enumerateHeaps(pid);

    for (const heap of heaps) {
      const blocks = await this._enumerateBlocksInternal(
        pid,
        BigInt(heap.heapId),
        HEAP_ENUMERATE_MAX_BLOCKS
      );

      // Check for heap spray pattern
      this._detectSpray(blocks, heap.heapId, anomalies);

      // Check for suspicious sizes
      this._detectSuspiciousSizes(blocks, heap.heapId, anomalies);

      // Check for possible UAF (free blocks with non-zero data)
      await this._detectPossibleUAF(pid, blocks, heap.heapId, anomalies);
    }

    return anomalies;
  }

  // ── Private Helpers ──

  private async _enumerateBlocksInternal(
    pid: number,
    heapId: bigint,
    maxBlocks: number
  ): Promise<HeapBlock[]> {
    const apis = getHeapApis();
    const blocks: HeapBlock[] = [];

    // HEAPENTRY32: dwSize(8) + hHandle(8) + dwAddress(8) + dwBlockSize(8) + dwFlags(4) + ...
    const heBuf = Buffer.alloc(apis.HEAPENTRY32_SIZE);
    heBuf.writeBigUInt64LE(BigInt(apis.HEAPENTRY32_SIZE), 0);

    let hasBlock = apis.Heap32First(heBuf, pid, heapId);

    while (hasBlock && blocks.length < maxBlocks) {
      const address = heBuf.readBigUInt64LE(16);
      const blockSize = Number(heBuf.readBigUInt64LE(24));
      const flags = heBuf.readUInt32LE(32);

      blocks.push({
        address: `0x${address.toString(16)}`,
        size: blockSize,
        flags,
        heapId: `0x${heapId.toString(16)}`,
        isFree: (flags & LF32.FREE) !== 0,
      });

      heBuf.writeBigUInt64LE(BigInt(apis.HEAPENTRY32_SIZE), 0);
      hasBlock = apis.Heap32Next(heBuf);
    }

    return blocks;
  }

  private _computeStats(heaps: HeapInfo[], blocks: HeapBlock[]): HeapStats {
    const buckets: HeapSizeBucket[] = SIZE_RANGES.map(([range]) => ({
      range,
      count: 0,
      totalBytes: 0,
    }));

    let totalSize = 0;
    let freeSize = 0;
    let largestBlock = 0;
    let smallestBlock = Number.MAX_SAFE_INTEGER;

    for (const block of blocks) {
      totalSize += block.size;
      if (block.isFree) freeSize += block.size;
      if (block.size > largestBlock) largestBlock = block.size;
      if (!block.isFree && block.size < smallestBlock) smallestBlock = block.size;

      const idx = classifyBlock(block.size);
      buckets[idx]!.count++;
      buckets[idx]!.totalBytes += block.size;
    }

    if (smallestBlock === Number.MAX_SAFE_INTEGER) smallestBlock = 0;
    if (totalSize === 0 && heaps.length > 0) {
      // Use heap-level stats if no blocks were enumerated
      totalSize = heaps.reduce((s, h) => s + h.totalSize, 0);
    }

    return {
      totalHeaps: heaps.length,
      totalBlocks: blocks.length || heaps.reduce((s, h) => s + h.blockCount, 0),
      totalSize,
      freeSize,
      usedSize: totalSize - freeSize,
      largestBlock,
      smallestBlock,
      averageBlockSize: blocks.length > 0 ? Math.round(totalSize / blocks.length) : 0,
      sizeDistribution: buckets,
      fragmentationRatio: totalSize > 0 ? freeSize / totalSize : 0,
    };
  }

  private _detectSpray(blocks: HeapBlock[], heapId: string, anomalies: HeapAnomaly[]): void {
    // Group blocks by approximate size (within tolerance)
    const sizeGroups = new Map<number, HeapBlock[]>();

    for (const block of blocks) {
      if (block.isFree) continue;
      const rounded = Math.round(block.size / HEAP_SPRAY_SIZE_TOLERANCE) * HEAP_SPRAY_SIZE_TOLERANCE;
      const group = sizeGroups.get(rounded) ?? [];
      group.push(block);
      sizeGroups.set(rounded, group);
    }

    for (const [size, group] of sizeGroups) {
      if (group.length >= HEAP_SPRAY_THRESHOLD) {
        anomalies.push({
          type: 'heap_spray_pattern',
          severity: 'high',
          address: group[0]!.address,
          details: `${group.length} blocks of ~${size} bytes detected — possible heap spray`,
          heapId,
        });
      }
    }
  }

  private _detectSuspiciousSizes(blocks: HeapBlock[], heapId: string, anomalies: HeapAnomaly[]): void {
    for (const block of blocks) {
      if (block.size === 0) {
        anomalies.push({
          type: 'suspicious_size',
          severity: 'medium',
          address: block.address,
          details: 'Block with zero size',
          heapId,
        });
      } else if (block.size > HEAP_SUSPICIOUS_BLOCK_SIZE) {
        anomalies.push({
          type: 'suspicious_size',
          severity: 'medium',
          address: block.address,
          details: `Unusually large block: ${(block.size / (1024 * 1024)).toFixed(1)} MB`,
          heapId,
        });
      }
    }
  }

  private async _detectPossibleUAF(
    pid: number,
    blocks: HeapBlock[],
    heapId: string,
    anomalies: HeapAnomaly[]
  ): Promise<void> {
    const freeBlocks = blocks.filter(b => b.isFree && b.size >= 8);
    const sampled = freeBlocks.slice(0, 100); // Sample max 100 free blocks

    let hProcess: bigint | null = null;
    try {
      hProcess = openProcessForMemory(pid);
      for (const block of sampled) {
        const addr = BigInt(block.address);
        const data = ReadProcessMemory(hProcess, addr, 8);
        // If first 8 bytes are all non-zero, data might still be live → possible UAF
        if (data && data.readBigUInt64LE(0) !== 0n) {
          anomalies.push({
            type: 'possible_uaf',
            severity: 'low',
            address: block.address,
            details: `Free block has non-zero data: 0x${data.readBigUInt64LE(0).toString(16)}`,
            heapId,
          });
        }
      }
    } catch (e) {
      logger.debug(`UAF check failed for PID ${pid}: ${e}`);
    } finally {
      if (hProcess) CloseHandle(hProcess);
    }
  }
}

export const heapAnalyzer = new HeapAnalyzer();
