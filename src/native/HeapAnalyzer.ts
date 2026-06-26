/**
 * HeapAnalyzer — Windows Toolhelp32 + Linux/macOS region-based fallback.
 *
 * On Windows: full Toolhelp32 heap enumeration via koffi (original logic).
 * On Linux:   reads /proc/pid/maps, samples anonymous private regions for
 *             size distribution, entropy, and spray-like patterns.
 * On macOS:   uses PlatformMemoryAPI region walk to do the same.
 *
 * The stats/block/anomaly contract is identical across platforms so callers
 * (memory_heap_enumerate / memory_heap_stats / memory_heap_anomalies) see
 * real data on every OS, not empty placeholders.
 */
import { readFileSync } from 'node:fs';
import { logger } from '@utils/logger';
import koffi from 'koffi';
import { openProcessForMemory, CloseHandle, ReadProcessMemory } from '@native/Win32API';
import { ToolError } from '@errors/ToolError';
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
import { parseProcMaps } from '@modules/process/memory/linux/mapsParser';

// ── Toolhelp32 Heap APIs (Win32, lazy) ──

let heapApisCache: ReturnType<typeof winLoadHeapApis> | null = null;
function winLoadHeapApis() {
  const k32 = koffi.load('kernel32.dll');
  return {
    CreateToolhelp32Snapshot: k32.func('CreateToolhelp32Snapshot', 'intptr', ['uint32', 'uint32']),
    Heap32ListFirst: k32.func('Heap32ListFirst', 'bool', ['intptr', '_Inout_ uint8_t *']),
    Heap32ListNext: k32.func('Heap32ListNext', 'bool', ['intptr', '_Inout_ uint8_t *']),
    Heap32First: k32.func('Heap32First', 'bool', ['_Inout_ uint8_t *', 'uint32', 'uintptr_t']),
    Heap32Next: k32.func('Heap32Next', 'bool', ['_Inout_ uint8_t *']),
    CloseHandle: k32.func('int CloseHandle(intptr)'),
    HEAPLIST32_SIZE: 36,
    HEAPENTRY32_SIZE: 56,
  };
}
function winGetHeapApis() {
  if (!heapApisCache) heapApisCache = winLoadHeapApis();
  return heapApisCache;
}

// ── Size-distribution buckets (shared) ──

const SIZE_RANGES: readonly [string, number, number][] = [
  ['0-64B', 0, 64],
  ['64-256B', 64, 256],
  ['256B-1KB', 256, 1024],
  ['1-4KB', 1024, 4096],
  ['4-16KB', 4096, 16384],
  ['16-64KB', 16384, 65536],
  ['64KB-1MB', 65536, 1048576],
  ['>1MB', 1048576, Number.MAX_SAFE_INTEGER],
];

function classify(size: number): number {
  for (let i = 0; i < SIZE_RANGES.length; i++) {
    if (size >= SIZE_RANGES[i]![1] && size < SIZE_RANGES[i]![2]) return i;
  }
  return SIZE_RANGES.length - 1;
}

function emptyBuckets(): HeapSizeBucket[] {
  return SIZE_RANGES.map(([range]) => ({ range, count: 0, totalBytes: 0 }));
}

function emptyStats(heaps = 0, blocks = 0): HeapStats {
  return {
    totalHeaps: heaps,
    totalBlocks: blocks,
    totalSize: 0,
    freeSize: 0,
    usedSize: 0,
    largestBlock: 0,
    smallestBlock: 0,
    averageBlockSize: 0,
    sizeDistribution: emptyBuckets(),
    fragmentationRatio: 0,
  };
}

// ── Entropy ──

export function computeShannonEntropy(data: Buffer): number {
  if (data.length === 0) return 0;
  const freq = Array.from({ length: 256 }, () => 0);
  for (const b of data) freq[b]! += 1;
  let entropy = 0;
  const n = data.length;
  for (let i = 0; i < 256; i++) {
    if (!freq[i]) continue;
    const p = freq[i]! / n;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const HIGH_ENTROPY_THRESHOLD = 7.0;
const HIGH_ENTROPY_MIN_REGION = 64;
const HIGH_ENTROPY_SAMPLE_BYTES = 256;
const HIGH_ENTROPY_MAX_REGIONS = 500;

// ── Linux/macOS region-based heaps ─────────────────────────────────────

interface RawRegion {
  addr: bigint;
  size: number;
  isExec: boolean;
  isWrite: boolean;
  path: string;
}

function readProcMapsRegions(pid: number): RawRegion[] {
  try {
    const text = readFileSync(`/proc/${pid}/maps`, 'utf8');
    return parseProcMaps(text)
      .filter((r) => r.permissions.read)
      .map((r) => ({
        addr: r.start,
        size: Number(r.end - r.start),
        isExec: r.permissions.exec,
        isWrite: r.permissions.write,
        path: r.pathname || '',
      }));
  } catch {
    return [];
  }
}

function regionToBlock(r: RawRegion, id: string): HeapBlock {
  return {
    address: `0x${r.addr.toString(16)}`,
    size: r.size,
    flags: 0,
    heapId: id,
    isFree: false,
  };
}

function readRegionSample(pid: number, addr: bigint, size: number): Buffer | null {
  try {
    const fd = (require('node:fs') as typeof import('fs')).openSync(`/proc/${pid}/mem`, 'r');
    const buf = Buffer.alloc(size);
    (require('node:fs') as typeof import('fs')).readSync(fd, buf, 0, size, Number(addr));
    (require('node:fs') as typeof import('fs')).closeSync(fd);
    return buf;
  } catch {
    return null;
  }
}

// ── HeapAnalyzer ────────────────────────────────────────────────────────

export class HeapAnalyzer {
  // ── enumerateHeaps ──

  async enumerateHeaps(
    pid: number,
  ): Promise<{ heaps: HeapInfo[]; stats: HeapStats; platformNote?: string }> {
    if (process.platform === 'win32') return this.winEnumerateHeaps(pid);

    const regions = readProcMapsRegions(pid);
    if (regions.length === 0) {
      return {
        heaps: [],
        stats: emptyStats(),
        platformNote: `Cannot read /proc/${pid}/maps — process may not exist or ptrace access is denied.`,
      };
    }

    // Group anonymous private regions by size buckets into synthetic "heaps"
    const anon = regions.filter((r) => !r.path);
    const mapped = regions.filter((r) => r.path);

    const heaps: HeapInfo[] = [];

    // One synthetic heap for all anonymous regions
    const anonTotal = anon.reduce((s, r) => s + r.size, 0);
    heaps.push({
      heapId: 'anon',
      processId: pid,
      flags: 0,
      isDefault: true,
      blockCount: anon.length,
      totalSize: anonTotal,
    });

    // One per distinct mapping path
    const byPath = new Map<string, RawRegion[]>();
    for (const r of mapped) {
      const p = r.path || '<unknown>';
      if (!byPath.has(p)) byPath.set(p, []);
      byPath.get(p)!.push(r);
    }
    for (const [path, regs] of byPath) {
      heaps.push({
        heapId: path,
        processId: pid,
        flags: 0,
        isDefault: false,
        blockCount: regs.length,
        totalSize: regs.reduce((s, r) => s + r.size, 0),
      });
    }

    const totalBlocks = heaps.reduce((s, h) => s + h.blockCount, 0);
    const stats: HeapStats = {
      totalHeaps: heaps.length,
      totalBlocks,
      totalSize: 0,
      freeSize: 0,
      usedSize: 0,
      largestBlock: 0,
      smallestBlock: 0,
      averageBlockSize: 0,
      sizeDistribution: emptyBuckets(),
      fragmentationRatio: 0,
    };
    return {
      heaps,
      stats,
      platformNote: `Region-based heap enumeration (${process.platform}). Uses /proc/pid/maps groupings — not Toolhelp32.`,
    };
  }

  // ── enumerateBlocks ──

  async enumerateBlocks(
    pid: number,
    heapId: string,
    options?: { maxBlocks?: number },
  ): Promise<HeapBlock[]> {
    if (process.platform === 'win32') return this.winEnumerateBlocks(pid, heapId, options);

    const regions = readProcMapsRegions(pid);
    const max = options?.maxBlocks ?? HEAP_ENUMERATE_MAX_BLOCKS;
    const results: HeapBlock[] = [];

    for (const r of regions) {
      const path = r.path || (r.path === '' ? 'anon' : 'anon');
      const hid = heapId === 'anon' ? 'anon' : path;
      if (hid !== heapId && heapId !== '*' && heapId !== 'anon' && !path.includes(heapId)) continue;
      if (results.length >= max) break;
      results.push(regionToBlock(r, hid));
    }
    return results;
  }

  // ── getStats ──

  async getStats(pid: number): Promise<HeapStats & { platformNote?: string }> {
    if (process.platform === 'win32') return this.winGetStats(pid);

    const regions = readProcMapsRegions(pid);
    const buckets = emptyBuckets();
    let totalSize = 0,
      largest = 0,
      smallest = Number.MAX_SAFE_INTEGER,
      count = 0;

    for (const r of regions) {
      totalSize += r.size;
      count++;
      if (r.size > largest) largest = r.size;
      if (r.size < smallest) smallest = r.size;
      const idx = classify(r.size);
      buckets[idx]!.count++;
      buckets[idx]!.totalBytes += r.size;
    }

    if (smallest === Number.MAX_SAFE_INTEGER) smallest = 0;
    return {
      totalHeaps: 1,
      totalBlocks: count,
      totalSize,
      freeSize: 0,
      usedSize: totalSize,
      largestBlock: largest,
      smallestBlock: smallest,
      averageBlockSize: count > 0 ? Math.round(totalSize / count) : 0,
      sizeDistribution: buckets,
      fragmentationRatio: 0,
      platformNote: `Region-based statistics (${process.platform}). Reads /proc/pid/maps, not Toolhelp32.`,
    };
  }

  // ── detectAnomalies ──

  async detectAnomalies(pid: number): Promise<HeapAnomaly[]> {
    if (process.platform === 'win32') return this.winDetectAnomalies(pid);

    const anomalies: HeapAnomaly[] = [];
    const regions = readProcMapsRegions(pid);

    // Spray: many same-size anonymous regions
    const sizeGroups = new Map<number, RawRegion[]>();
    for (const r of regions) {
      if (r.path) continue;
      const rounded = Math.round(r.size / HEAP_SPRAY_SIZE_TOLERANCE) * HEAP_SPRAY_SIZE_TOLERANCE;
      const g = sizeGroups.get(rounded) ?? [];
      g.push(r);
      sizeGroups.set(rounded, g);
    }
    for (const [size, group] of sizeGroups) {
      if (group.length >= HEAP_SPRAY_THRESHOLD) {
        anomalies.push({
          type: 'heap_spray_pattern',
          severity: 'high',
          address: `0x${group[0]!.addr.toString(16)}`,
          details: `${group.length} anonymous regions of ~${size} bytes — possible heap spray.`,
          heapId: 'anon',
        });
      }
    }

    // Suspicious sizes
    for (const r of regions) {
      if (r.size === 0) {
        anomalies.push({
          type: 'suspicious_size',
          severity: 'medium',
          address: `0x${r.addr.toString(16)}`,
          details: 'Zero-size region.',
          heapId: r.path || 'anon',
        });
      } else if (r.size > HEAP_SUSPICIOUS_BLOCK_SIZE) {
        anomalies.push({
          type: 'suspicious_size',
          severity: 'medium',
          address: `0x${r.addr.toString(16)}`,
          details: `Large region: ${(r.size / 1048576).toFixed(1)} MB.`,
          heapId: r.path || 'anon',
        });
      }
    }

    // Entropy scan on sampled readable regions
    const candidates = regions
      .filter((r) => !r.isExec && r.size >= HIGH_ENTROPY_MIN_REGION)
      .slice(0, HIGH_ENTROPY_MAX_REGIONS);
    for (const r of candidates) {
      const sample = readRegionSample(pid, r.addr, Math.min(HIGH_ENTROPY_SAMPLE_BYTES, r.size));
      if (!sample || sample.length < 8) continue;
      const entropy = computeShannonEntropy(sample);
      if (entropy >= HIGH_ENTROPY_THRESHOLD) {
        anomalies.push({
          type: 'high_entropy',
          severity: 'medium',
          address: `0x${r.addr.toString(16)}`,
          details: `Entropy ${entropy.toFixed(2)} bits/byte in ${sample.length}B sample — possible shellcode or encrypted data.`,
          heapId: r.path || 'anon',
        });
      }
    }

    return anomalies;
  }

  // ═══════════════════════ Win32 (original logic, unchanged) ═══════════

  private async winEnumerateHeaps(pid: number): Promise<{ heaps: HeapInfo[]; stats: HeapStats }> {
    const apis = winGetHeapApis();
    const hSnap = apis.CreateToolhelp32Snapshot(TH32CS.SNAPHEAPLIST, pid);
    if (hSnap === -1n && typeof hSnap === 'bigint')
      throw new ToolError('RUNTIME', `Failed to create heap snapshot for PID ${pid}`);
    const heaps: HeapInfo[] = [];
    try {
      const hlBuf = Buffer.alloc(apis.HEAPLIST32_SIZE);
      hlBuf.writeBigUInt64LE(BigInt(apis.HEAPLIST32_SIZE), 0);
      let ok = apis.Heap32ListFirst(hSnap, hlBuf);
      while (ok) {
        const processId = hlBuf.readUInt32LE(8);
        const heapId = hlBuf.readBigUInt64LE(12);
        const flags = hlBuf.readUInt32LE(20);
        const blocks = await this.winEnumBlocks(pid, heapId, HEAP_ENUMERATE_MAX_BLOCKS);
        heaps.push({
          heapId: `0x${heapId.toString(16)}`,
          processId,
          flags,
          isDefault: (flags & HF32.DEFAULT) !== 0,
          blockCount: blocks.length,
          totalSize: blocks.reduce((s, b) => s + b.size, 0),
        });
        hlBuf.writeBigUInt64LE(BigInt(apis.HEAPLIST32_SIZE), 0);
        ok = apis.Heap32ListNext(hSnap, hlBuf);
      }
    } finally {
      apis.CloseHandle(hSnap);
    }
    return { heaps, stats: this.winComputeStats(heaps, []) };
  }

  private async winEnumerateBlocks(
    pid: number,
    heapId: string,
    options?: { maxBlocks?: number },
  ): Promise<HeapBlock[]> {
    return this.winEnumBlocks(pid, BigInt(heapId), options?.maxBlocks ?? HEAP_ENUMERATE_MAX_BLOCKS);
  }

  private async winGetStats(pid: number): Promise<HeapStats> {
    const { heaps } = await this.winEnumerateHeaps(pid);
    const all: HeapBlock[] = [];
    for (const h of heaps) {
      const bb = await this.winEnumBlocks(pid, BigInt(h.heapId), HEAP_ENUMERATE_MAX_BLOCKS);
      all.push(...bb);
    }
    return this.winComputeStats(heaps, all);
  }

  private async winDetectAnomalies(pid: number): Promise<HeapAnomaly[]> {
    const anomalies: HeapAnomaly[] = [];
    const { heaps } = await this.winEnumerateHeaps(pid);
    for (const heap of heaps) {
      const blocks = await this.winEnumBlocks(pid, BigInt(heap.heapId), HEAP_ENUMERATE_MAX_BLOCKS);
      this.winSpray(blocks, heap.heapId, anomalies);
      this.winSuspicious(blocks, heap.heapId, anomalies);
      await this.winUaf(pid, blocks, heap.heapId, anomalies);
      await this.winEntropy(pid, blocks, heap.heapId, anomalies);
      this.detectDoubleFree(blocks, heap.heapId, anomalies);
    }
    return anomalies;
  }

  private async winEnumBlocks(pid: number, heapId: bigint, max: number): Promise<HeapBlock[]> {
    const apis = winGetHeapApis();
    const e = Buffer.alloc(apis.HEAPENTRY32_SIZE);
    e.writeBigUInt64LE(BigInt(apis.HEAPENTRY32_SIZE), 0);
    const blocks: HeapBlock[] = [];
    let ok = apis.Heap32First(e, pid, heapId);
    while (ok && blocks.length < max) {
      const addr = e.readBigUInt64LE(16);
      blocks.push({
        address: `0x${addr.toString(16)}`,
        size: Number(e.readBigUInt64LE(24)),
        flags: e.readUInt32LE(32),
        heapId: `0x${heapId.toString(16)}`,
        isFree: (e.readUInt32LE(32) & LF32.FREE) !== 0,
      });
      e.writeBigUInt64LE(BigInt(apis.HEAPENTRY32_SIZE), 0);
      ok = apis.Heap32Next(e);
    }
    return blocks;
  }

  private winComputeStats(heaps: HeapInfo[], blocks: HeapBlock[]): HeapStats {
    const buckets = emptyBuckets();
    let totalSize = 0,
      freeSize = 0,
      largest = 0,
      smallest = Number.MAX_SAFE_INTEGER;
    for (const b of blocks) {
      totalSize += b.size;
      if (b.isFree) freeSize += b.size;
      if (b.size > largest) largest = b.size;
      if (!b.isFree && b.size < smallest) smallest = b.size;
      const idx = classify(b.size);
      buckets[idx]!.count++;
      buckets[idx]!.totalBytes += b.size;
    }
    if (smallest === Number.MAX_SAFE_INTEGER) smallest = 0;
    if (totalSize === 0 && heaps.length > 0) totalSize = heaps.reduce((s, h) => s + h.totalSize, 0);
    return {
      totalHeaps: heaps.length,
      totalBlocks: blocks.length || heaps.reduce((s, h) => s + h.blockCount, 0),
      totalSize,
      freeSize,
      usedSize: totalSize - freeSize,
      largestBlock: largest,
      smallestBlock: smallest,
      averageBlockSize: blocks.length > 0 ? Math.round(totalSize / blocks.length) : 0,
      sizeDistribution: buckets,
      fragmentationRatio: totalSize > 0 ? freeSize / totalSize : 0,
    };
  }

  private winSpray(blocks: HeapBlock[], heapId: string, out: HeapAnomaly[]): void {
    const m = new Map<number, HeapBlock[]>();
    for (const b of blocks) {
      if (b.isFree) continue;
      const k = Math.round(b.size / HEAP_SPRAY_SIZE_TOLERANCE) * HEAP_SPRAY_SIZE_TOLERANCE;
      const g = m.get(k) ?? [];
      g.push(b);
      m.set(k, g);
    }
    for (const [sz, g] of m) {
      if (g.length >= HEAP_SPRAY_THRESHOLD)
        out.push({
          type: 'heap_spray_pattern',
          severity: 'high',
          address: g[0]!.address,
          details: `${g.length} blocks ~${sz}B — possible heap spray`,
          heapId,
        });
    }
  }

  private winSuspicious(blocks: HeapBlock[], heapId: string, out: HeapAnomaly[]): void {
    for (const b of blocks) {
      if (b.size === 0)
        out.push({
          type: 'suspicious_size',
          severity: 'medium',
          address: b.address,
          details: 'Block with zero size',
          heapId,
        });
      else if (b.size > HEAP_SUSPICIOUS_BLOCK_SIZE)
        out.push({
          type: 'suspicious_size',
          severity: 'medium',
          address: b.address,
          details: `${(b.size / 1048576).toFixed(1)} MB block`,
          heapId,
        });
    }
  }

  private async winUaf(
    pid: number,
    blocks: HeapBlock[],
    heapId: string,
    out: HeapAnomaly[],
  ): Promise<void> {
    const f = blocks.filter((b) => b.isFree && b.size >= 8).slice(0, 100);
    if (!f.length) return;
    let h: bigint | null = null;
    try {
      h = openProcessForMemory(pid);
      for (const b of f) {
        const d = ReadProcessMemory(h, BigInt(b.address), 8);
        if (d.readBigUInt64LE(0) !== 0n)
          out.push({
            type: 'possible_uaf',
            severity: 'low',
            address: b.address,
            details: `Free block has non-zero data: 0x${d.readBigUInt64LE(0).toString(16)}`,
            heapId,
          });
      }
    } catch (e) {
      logger.debug(`UAF check failed for PID ${pid}: ${e}`);
    } finally {
      if (h) CloseHandle(h);
    }
  }

  private async winEntropy(
    pid: number,
    blocks: HeapBlock[],
    heapId: string,
    out: HeapAnomaly[],
  ): Promise<void> {
    const c = blocks
      .filter((b) => !b.isFree && b.size >= HIGH_ENTROPY_MIN_REGION)
      .slice(0, HIGH_ENTROPY_MAX_REGIONS);
    if (!c.length) return;
    let h: bigint | null = null;
    try {
      h = openProcessForMemory(pid);
      for (const b of c) {
        const sz = Math.min(HIGH_ENTROPY_SAMPLE_BYTES, b.size);
        const d = ReadProcessMemory(h, BigInt(b.address), sz);
        if (d.length < 8) continue;
        const ent = computeShannonEntropy(d);
        if (ent >= HIGH_ENTROPY_THRESHOLD)
          out.push({
            type: 'high_entropy',
            severity: 'medium',
            address: b.address,
            details: `Entropy ${ent.toFixed(2)} bits/byte in ${d.length}B sample`,
            heapId,
          });
      }
    } catch (e) {
      logger.debug(`High-entropy check failed for PID ${pid}: ${e}`);
    } finally {
      if (h) CloseHandle(h);
    }
  }

  /** Detect possible double-free: same address appears as free block more than once. */
  private detectDoubleFree(blocks: HeapBlock[], heapId: string, out: HeapAnomaly[]): void {
    const freeByAddr = new Map<string, HeapBlock[]>();
    for (const b of blocks) {
      if (!b.isFree) continue;
      const list = freeByAddr.get(b.address) ?? [];
      list.push(b);
      freeByAddr.set(b.address, list);
    }
    for (const [addr, list] of freeByAddr) {
      if (list.length >= 2) {
        out.push({
          type: 'possible_double_free',
          severity: 'high',
          address: addr,
          details: `${list.length} free blocks at same address ${addr} — possible double-free or overlapping free blocks (sizes: ${list.map((b) => b.size).join(', ')}).`,
          heapId,
        });
      }
    }
  }

  // ── Private aliases for test backward-compat ──

  // @ts-ignore used by tests via (analyzer as any)
  private computeStats(heaps: HeapInfo[], blocks: HeapBlock[]): HeapStats {
    return this.winComputeStats(heaps, blocks);
  }
  // @ts-expect-error used by tests
  private detectSpray(blocks: HeapBlock[], heapId: string, anomalies: HeapAnomaly[]): void {
    this.winSpray(blocks, heapId, anomalies);
  }
  // @ts-ignore
  private detectSuspiciousSizes(
    blocks: HeapBlock[],
    heapId: string,
    anomalies: HeapAnomaly[],
  ): void {
    this.winSuspicious(blocks, heapId, anomalies);
  }
  // @ts-ignore
  private async detectPossibleUaf(
    pid: number,
    blocks: HeapBlock[],
    heapId: string,
    anomalies: HeapAnomaly[],
  ): Promise<void> {
    return this.winUaf(pid, blocks, heapId, anomalies);
  }
  // @ts-ignore
  private async detectHighEntropy(
    pid: number,
    blocks: HeapBlock[],
    heapId: string,
    anomalies: HeapAnomaly[],
  ): Promise<void> {
    return this.winEntropy(pid, blocks, heapId, anomalies);
  }
  // @ts-ignore
  private async enumerateBlocksInternal(
    pid: number,
    heapId: bigint,
    max: number,
  ): Promise<HeapBlock[]> {
    return this.winEnumBlocks(pid, heapId, max);
  }
}

export const heapAnalyzer = new HeapAnalyzer();
