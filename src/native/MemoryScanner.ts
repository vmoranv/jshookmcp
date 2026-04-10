/**
 * Memory Scanner — orchestrates iterative scan workflows.
 *
 * Provides CE-style scanning: first-scan → next-scan → narrow down → find target.
 * Plus AI-native features: pointer scan, group scan, unknown initial value scan.
 *
 * Uses PlatformMemoryAPI for cross-platform memory operations.
 *
 * Performance: addresses stored as bigint internally; only converted to hex
 * strings at API boundaries. This eliminates ~40K+ short-lived string objects
 * and repeated BigInt↔string round-trips during next-scan operations.
 *
 * @module MemoryScanner
 */

import {
  SCAN_MAX_RESULTS_PER_SCAN,
  SCAN_DISPLAY_RESULTS_LIMIT,
  SCAN_UNKNOWN_INITIAL_MAX_ADDRESSES,
  SCAN_POINTER_MAX_RESULTS,
  SCAN_GROUP_MAX_PATTERN_SIZE,
} from '@src/constants';
import type { NativeMemoryManager } from './NativeMemoryManager.impl';
import { nativeMemoryManager } from './NativeMemoryManager.impl';
import { scanSessionManager } from './MemoryScanSession';
import { compareScanValues, getValueSize, getDefaultAlignment } from './ScanComparators';
import { parsePattern } from './NativeMemoryManager.utils';
import type { ScanOptions, ScanCompareMode, ScanValueType } from './NativeMemoryManager.types';
import { createPlatformProvider } from './platform/factory.js';
import type { PlatformMemoryAPI } from './platform/PlatformMemoryAPI.js';
import type { ProcessHandle } from './platform/types.js';
import { formatAddress, parseAddress } from './formatAddress';

export interface ScanResult {
  sessionId: string;
  matchCount: number;
  scanNumber: number;
  addresses: string[];
  totalMatches: number;
  truncated: boolean;
  elapsed: string;
}

export class MemoryScanner {
  private readonly nmm: NativeMemoryManager;
  private _provider: PlatformMemoryAPI | null = null;

  private get provider(): PlatformMemoryAPI {
    if (!this._provider) {
      this._provider = createPlatformProvider();
    }
    return this._provider;
  }

  constructor(nmm: NativeMemoryManager) {
    this.nmm = nmm;
  }

  /**
   * First scan: scan entire process memory for a value.
   * Creates a new session, stores matching addresses + values.
   */
  async firstScan(pid: number, value: string, options: ScanOptions): Promise<ScanResult> {
    const start = performance.now();
    const valueType = options.valueType;
    const valueSize = getValueSize(valueType);
    const alignment = options.alignment ?? getDefaultAlignment(valueType);
    const maxResults = options.maxResults ?? SCAN_MAX_RESULTS_PER_SCAN;

    // For variable-length types, fall back to existing pattern-based scan
    if (valueSize === 0) {
      return this.patternFirstScan(pid, value, valueType, options);
    }

    const { patternBytes } = parsePattern(value, valueType === 'pointer' ? 'uint64' : valueType);
    if (patternBytes.length === 0) {
      throw new Error(`Invalid pattern for type ${valueType}: "${value}"`);
    }

    const targetBuf = Buffer.from(patternBytes);
    const sessionId = scanSessionManager.createSession(pid, options);
    const addresses: bigint[] = [];
    const values = new Map<bigint, Buffer>();

    const handle = this.provider.openProcess(pid, false);
    try {
      const regions = this.getFilteredRegions(handle, options);
      const totalRegions = regions.length;
      let regionsProcessed = 0;

      for (const region of regions) {
        if (options.onProgress) options.onProgress(regionsProcessed, totalRegions);
        regionsProcessed++;
        if (addresses.length >= maxResults) break;

        const regionBase = region.baseAddress;
        const regionSize = region.size;

        // Scan this region in chunks
        const chunkSize = 16 * 1024 * 1024;
        for (
          let offset = 0;
          offset < regionSize && addresses.length < maxResults;
          offset += chunkSize
        ) {
          const readSize = Math.min(chunkSize, regionSize - offset);
          const chunkAddr = regionBase + BigInt(offset);

          let chunk: Buffer;
          try {
            chunk = this.provider.readMemory(handle, chunkAddr, readSize).data;
          } catch {
            break; // Skip unreadable chunks
          }

          // Scan for aligned matches
          const alignStep = alignment > 0 ? alignment : 1;
          const startOffset = alignment > 0 ? (alignStep - (offset % alignStep)) % alignStep : 0;

          for (let i = startOffset; i <= chunk.length - valueSize; i += alignStep) {
            const currentBuf = chunk.subarray(i, i + valueSize);
            if (compareScanValues(currentBuf, null, targetBuf, null, 'exact', valueType)) {
              const addr = chunkAddr + BigInt(i);
              addresses.push(addr);
              values.set(addr, Buffer.from(currentBuf));

              if (addresses.length >= maxResults) break;
            }
          }
        }
      }
    } finally {
      this.provider.closeProcess(handle);
    }

    scanSessionManager.updateSession(sessionId, addresses, values);
    const elapsed = `${(performance.now() - start).toFixed(1)}ms`;
    const displayAddresses = addresses.slice(0, SCAN_DISPLAY_RESULTS_LIMIT).map(formatAddress);

    return {
      sessionId,
      matchCount: addresses.length,
      scanNumber: 1,
      addresses: displayAddresses,
      totalMatches: addresses.length,
      truncated: addresses.length > SCAN_DISPLAY_RESULTS_LIMIT,
      elapsed,
    };
  }

  /**
   * Next scan: re-read stored addresses, filter using comparator.
   */
  async nextScan(
    sessionId: string,
    mode: ScanCompareMode,
    value?: string,
    value2?: string,
  ): Promise<ScanResult> {
    const start = performance.now();
    const session = scanSessionManager.getSession(sessionId);
    const { pid, valueType, addresses: prevAddresses, previousValues } = session;
    const valueSize = getValueSize(valueType);

    if (valueSize === 0) {
      throw new Error('Next-scan is not supported for variable-length types (hex/string)');
    }

    // Parse target values if provided
    let targetBuf: Buffer | null = null;
    let target2Buf: Buffer | null = null;
    if (value !== undefined) {
      const effectiveType = valueType === 'pointer' ? 'uint64' : valueType;
      const { patternBytes } = parsePattern(value, effectiveType);
      targetBuf = Buffer.from(patternBytes);
    }
    if (value2 !== undefined) {
      const effectiveType = valueType === 'pointer' ? 'uint64' : valueType;
      const { patternBytes } = parsePattern(value2, effectiveType);
      target2Buf = Buffer.from(patternBytes);
    }

    const newAddresses: bigint[] = [];
    const newValues = new Map<bigint, Buffer>();

    const handle = this.provider.openProcess(pid, false);
    try {
      for (const addr of prevAddresses) {
        let currentBuf: Buffer;
        try {
          currentBuf = this.provider.readMemory(handle, addr, valueSize).data;
        } catch {
          continue; // Address no longer readable
        }

        const prevBuf = previousValues.get(addr) ?? null;

        if (compareScanValues(currentBuf, prevBuf, targetBuf, target2Buf, mode, valueType)) {
          newAddresses.push(addr);
          newValues.set(addr, Buffer.from(currentBuf));
        }
      }
    } finally {
      this.provider.closeProcess(handle);
    }

    scanSessionManager.updateSession(sessionId, newAddresses, newValues);
    const elapsed = `${(performance.now() - start).toFixed(1)}ms`;
    const displayAddresses = newAddresses.slice(0, SCAN_DISPLAY_RESULTS_LIMIT).map(formatAddress);

    return {
      sessionId,
      matchCount: newAddresses.length,
      scanNumber: session.scanCount,
      addresses: displayAddresses,
      totalMatches: newAddresses.length,
      truncated: newAddresses.length > SCAN_DISPLAY_RESULTS_LIMIT,
      elapsed,
    };
  }

  /**
   * Unknown initial value scan: captures all readable memory addresses
   * of the given type, then next-scan narrows.
   */
  async unknownInitialScan(pid: number, options: ScanOptions): Promise<ScanResult> {
    const start = performance.now();
    const valueType = options.valueType;
    const valueSize = getValueSize(valueType);
    const alignment = options.alignment ?? getDefaultAlignment(valueType);
    const maxAddresses = options.maxResults ?? SCAN_UNKNOWN_INITIAL_MAX_ADDRESSES;

    if (valueSize === 0) {
      throw new Error('Unknown initial scan is not supported for variable-length types');
    }

    const sessionId = scanSessionManager.createSession(pid, options);
    const addresses: bigint[] = [];
    const values = new Map<bigint, Buffer>();

    const handle = this.provider.openProcess(pid, false);
    try {
      const regions = this.getFilteredRegions(handle, options);
      const totalRegions = regions.length;
      let regionsProcessed = 0;

      for (const region of regions) {
        if (options.onProgress) options.onProgress(regionsProcessed, totalRegions);
        regionsProcessed++;
        if (addresses.length >= maxAddresses) break;

        const regionBase = region.baseAddress;
        const regionSize = region.size;
        const chunkSize = 16 * 1024 * 1024;

        for (
          let offset = 0;
          offset < regionSize && addresses.length < maxAddresses;
          offset += chunkSize
        ) {
          const readSize = Math.min(chunkSize, regionSize - offset);
          const chunkAddr = regionBase + BigInt(offset);

          let chunk: Buffer;
          try {
            chunk = this.provider.readMemory(handle, chunkAddr, readSize).data;
          } catch {
            break;
          }

          const alignStep = alignment > 0 ? alignment : 1;
          for (let i = 0; i <= chunk.length - valueSize; i += alignStep) {
            const addr = chunkAddr + BigInt(i);
            const currentBuf = chunk.subarray(i, i + valueSize);
            addresses.push(addr);
            values.set(addr, Buffer.from(currentBuf));

            if (addresses.length >= maxAddresses) break;
          }
        }
      }
    } finally {
      this.provider.closeProcess(handle);
    }

    scanSessionManager.updateSession(sessionId, addresses, values);
    const elapsed = `${(performance.now() - start).toFixed(1)}ms`;

    return {
      sessionId,
      matchCount: addresses.length,
      scanNumber: 1,
      addresses: addresses.slice(0, SCAN_DISPLAY_RESULTS_LIMIT).map(formatAddress),
      totalMatches: addresses.length,
      truncated: addresses.length > SCAN_DISPLAY_RESULTS_LIMIT,
      elapsed,
    };
  }

  /**
   * Pointer scan: find addresses whose value points to a valid target address.
   */
  async pointerScan(
    pid: number,
    targetAddress: string,
    options: {
      maxDepth?: number;
      maxResults?: number;
      moduleOnly?: boolean;
    } = {},
  ): Promise<{
    sessionId: string;
    pointers: Array<{ address: string; value: string; offsetFromTarget: number }>;
    totalFound: number;
    elapsed: string;
  }> {
    const start = performance.now();
    const maxResults = options.maxResults ?? SCAN_POINTER_MAX_RESULTS;
    const targetAddr = parseAddress(targetAddress);

    const scanOptions: ScanOptions = {
      valueType: 'pointer',
      alignment: 8,
      regionFilter: { moduleOnly: options.moduleOnly },
    };
    const sessionId = scanSessionManager.createSession(pid, scanOptions);
    const pointers: Array<{ address: string; value: string; offsetFromTarget: number }> = [];

    const handle = this.provider.openProcess(pid, false);
    try {
      const regions = this.getFilteredRegions(handle, scanOptions);

      for (const region of regions) {
        if (options.moduleOnly /* unused cast */) {
        }
        // Use scanOptions for onProgress if we added it, but wait, pointerScan doesn't accept onProgress yet in its options!
        // We'll update pointerScan options separately if needed. For now just loop:
        if (pointers.length >= maxResults) break;

        const regionBase = region.baseAddress;
        const regionSize = region.size;
        const chunkSize = 16 * 1024 * 1024;

        for (
          let offset = 0;
          offset < regionSize && pointers.length < maxResults;
          offset += chunkSize
        ) {
          const readSize = Math.min(chunkSize, regionSize - offset);
          const chunkAddr = regionBase + BigInt(offset);

          let chunk: Buffer;
          try {
            chunk = this.provider.readMemory(handle, chunkAddr, readSize).data;
          } catch {
            break;
          }

          // Scan for pointer-sized values that match or are near the target
          for (let i = 0; i <= chunk.length - 8; i += 8) {
            const ptrValue = chunk.readBigUInt64LE(i);
            const diff =
              ptrValue > targetAddr ? Number(ptrValue - targetAddr) : Number(targetAddr - ptrValue);

            // Direct pointer or within ±4096 offset (struct member access)
            if (diff <= 4096) {
              const addr = chunkAddr + BigInt(i);
              const offsetFromTarget =
                ptrValue >= targetAddr
                  ? Number(ptrValue - targetAddr)
                  : -Number(targetAddr - ptrValue);

              pointers.push({
                address: formatAddress(addr),
                value: formatAddress(ptrValue),
                offsetFromTarget,
              });

              if (pointers.length >= maxResults) break;
            }
          }
        }
      }
    } finally {
      this.provider.closeProcess(handle);
    }

    const addresses = pointers.map((p) => parseAddress(p.address));
    scanSessionManager.updateSession(sessionId, addresses, new Map());
    const elapsed = `${(performance.now() - start).toFixed(1)}ms`;

    return {
      sessionId,
      pointers: pointers.slice(0, SCAN_DISPLAY_RESULTS_LIMIT),
      totalFound: pointers.length,
      elapsed,
    };
  }

  /**
   * Group scan: search for N values at known offsets simultaneously.
   */
  async groupScan(
    pid: number,
    pattern: Array<{ offset: number; value: string; type: ScanValueType }>,
    options?: { alignment?: number; maxResults?: number },
  ): Promise<ScanResult> {
    const start = performance.now();

    if (pattern.length === 0) {
      throw new Error('Group scan requires at least one value pattern');
    }

    // Calculate total pattern size
    const maxOffset = Math.max(...pattern.map((p) => p.offset + getValueSize(p.type)));
    if (maxOffset > SCAN_GROUP_MAX_PATTERN_SIZE) {
      throw new Error(
        `Group pattern too large: ${maxOffset} bytes (max ${SCAN_GROUP_MAX_PATTERN_SIZE})`,
      );
    }

    // Build composite pattern
    const compositePattern: number[] = Array.from({ length: maxOffset }, () => 0);
    const compositeMask: number[] = Array.from({ length: maxOffset }, () => 0);

    for (const entry of pattern) {
      const effectiveType = entry.type === 'pointer' ? 'uint64' : entry.type;
      const { patternBytes, mask } = parsePattern(entry.value, effectiveType);
      for (let i = 0; i < patternBytes.length; i++) {
        compositePattern[entry.offset + i] = patternBytes[i]!;
        compositeMask[entry.offset + i] = mask[i]!;
      }
    }

    const alignment = options?.alignment ?? 4;
    const maxResults = options?.maxResults ?? SCAN_MAX_RESULTS_PER_SCAN;
    const scanOptions: ScanOptions = { valueType: 'int32', alignment };
    const sessionId = scanSessionManager.createSession(pid, scanOptions);
    const addresses: bigint[] = [];

    const handle = this.provider.openProcess(pid, false);
    try {
      const regions = this.getFilteredRegions(handle, scanOptions);

      for (const region of regions) {
        // we'd emit here if we exposed onProgress

        if (addresses.length >= maxResults) break;

        const regionBase = region.baseAddress;
        const regionSize = region.size;
        const chunkSize = 16 * 1024 * 1024;
        const overlap = maxOffset - 1;

        for (
          let chunkOffset = 0;
          chunkOffset < regionSize && addresses.length < maxResults;
          chunkOffset += chunkSize
        ) {
          const readSize = Math.min(chunkSize + overlap, regionSize - chunkOffset);
          const chunkAddr = regionBase + BigInt(chunkOffset);

          let chunk: Buffer;
          try {
            chunk = this.provider.readMemory(handle, chunkAddr, readSize).data;
          } catch {
            break;
          }

          const alignStep = alignment > 0 ? alignment : 1;
          for (let i = 0; i <= chunk.length - maxOffset; i += alignStep) {
            let match = true;
            for (let j = 0; j < maxOffset; j++) {
              if (compositeMask[j] === 1 && chunk[i + j] !== compositePattern[j]) {
                match = false;
                break;
              }
            }
            if (match) {
              const addr = chunkAddr + BigInt(i);
              addresses.push(addr);
              if (addresses.length >= maxResults) break;
            }
          }
        }
      }
    } finally {
      this.provider.closeProcess(handle);
    }

    scanSessionManager.updateSession(sessionId, addresses, new Map());
    const elapsed = `${(performance.now() - start).toFixed(1)}ms`;

    return {
      sessionId,
      matchCount: addresses.length,
      scanNumber: 1,
      addresses: addresses.slice(0, SCAN_DISPLAY_RESULTS_LIMIT).map(formatAddress),
      totalMatches: addresses.length,
      truncated: addresses.length > SCAN_DISPLAY_RESULTS_LIMIT,
      elapsed,
    };
  }

  // ── Private Helpers ──

  /**
   * Pattern-based first scan for variable-length types (hex/string).
   * Delegates to existing NativeMemoryManager.scanMemory.
   */
  private async patternFirstScan(
    pid: number,
    value: string,
    valueType: ScanValueType,
    options: ScanOptions,
  ): Promise<ScanResult> {
    const start = performance.now();
    const patternType = (valueType === 'pointer' ? 'uint64' : valueType) as Parameters<
      typeof this.nmm.scanMemory
    >[2];
    const result = await this.nmm.scanMemory(pid, value, patternType);

    if (!result.success) {
      throw new Error(result.error ?? 'Scan failed');
    }

    const sessionId = scanSessionManager.createSession(pid, options);
    const maxResultCount = options.maxResults ?? SCAN_MAX_RESULTS_PER_SCAN;
    const addresses = result.addresses.slice(0, maxResultCount).map(parseAddress);
    scanSessionManager.updateSession(sessionId, addresses, new Map());
    const elapsed = `${(performance.now() - start).toFixed(1)}ms`;

    return {
      sessionId,
      matchCount: addresses.length,
      scanNumber: 1,
      addresses: addresses.slice(0, SCAN_DISPLAY_RESULTS_LIMIT).map(formatAddress),
      totalMatches: result.addresses.length,
      truncated: addresses.length > SCAN_DISPLAY_RESULTS_LIMIT,
      elapsed,
    };
  }

  /**
   * Get readable memory regions, applying region filters.
   * Uses PlatformMemoryAPI.queryRegion() for cross-platform support.
   */
  private getFilteredRegions(
    handle: ProcessHandle,
    options: ScanOptions,
  ): Array<{ baseAddress: bigint; size: number }> {
    const regions: Array<{ baseAddress: bigint; size: number }> = [];
    let address = 0n;
    const maxAddress = BigInt('0x7FFFFFFF0000');
    const filter = options.regionFilter;

    while (address < maxAddress) {
      const regionInfo = this.provider.queryRegion(handle, address);
      if (!regionInfo) break;

      const regionSize = regionInfo.size;

      if (regionInfo.isReadable && regionSize > 0 && regionSize <= Number.MAX_SAFE_INTEGER) {
        // Apply filters
        let include = true;
        if (filter?.writable && !regionInfo.isWritable) include = false;
        if (filter?.executable && !regionInfo.isExecutable) include = false;
        if (filter?.moduleOnly && regionInfo.type !== 'image') include = false;

        if (include) {
          regions.push({
            baseAddress: regionInfo.baseAddress,
            size: regionSize,
          });
        }
      }

      address = regionInfo.baseAddress + BigInt(regionInfo.size);
    }

    return regions;
  }
}

export const memoryScanner = new MemoryScanner(nativeMemoryManager);
