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
  USERSPACE_MAX_ADDRESS,
} from '@src/constants';
import type { NativeMemoryManager } from './NativeMemoryManager.impl';
import { nativeMemoryManager } from './NativeMemoryManager.impl';
import { scanSessionManager } from './MemoryScanSession';
import {
  compareScanValues,
  getValueSize,
  getDefaultAlignment,
  readTypedValue,
} from './ScanComparators';
import { parsePattern } from './NativeMemoryManager.utils';
import type { ScanOptions, ScanCompareMode, ScanValueType } from './NativeMemoryManager.types';
import { createPlatformProvider } from './platform/factory.js';
import type { PlatformMemoryAPI } from './platform/PlatformMemoryAPI.js';
import type { ProcessHandle } from './platform/types.js';
import { formatAddress, parseAddress } from './formatAddress';
import { ToolError } from '@errors/ToolError';

/**
 * Number of chunks processed between event-loop yields inside scan loops.
 * The FFI read is already async (awaited), but the per-chunk `Buffer.indexOf`
 * scan is CPU-bound; yielding every N chunks keeps long first-scans from
 * starving concurrent requests (b3-09).
 */
const SCAN_YIELD_CHUNK_INTERVAL = 8;

/** Yield to the event loop (macrotask) without a fixed delay. */
async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export interface ScanResult {
  sessionId: string;
  matchCount: number;
  scanNumber: number;
  addresses: string[];
  totalMatches: number;
  truncated: boolean;
  elapsed: string;
  /** Per-address deltas for changed_by_variable mode (address hex -> delta). */
  deltas?: Record<string, number>;
}

// System module name prefixes to skip (case-insensitive)
const SYSTEM_MODULE_PREFIXES = new Set([
  'ntdll.dll',
  'ntdll',
  'kernel32.dll',
  'kernel32',
  'kernelbase.dll',
  'kernelbase',
  'user32.dll',
  'user32',
  'gdi32.dll',
  'gdi32',
  'advapi32.dll',
  'advapi32',
  'msvcrt.dll',
  'msvcrt',
  'combase.dll',
  'combase',
  'ole32.dll',
  'ole32',
  'shell32.dll',
  'shell32',
  'ws2_32.dll',
  'ws2_32',
  'bcrypt.dll',
  'bcrypt',
  'ucrtbase.dll',
  'ucrtbase',
  'vcruntime',
  'msvcp',
  'libc.so',
  'libc-',
  'libpthread',
  'ld-linux',
  'libm.so',
  'libdl.so',
  'librt.so',
  'libc++.so',
  'libc++abi.so',
  'libSystem.B.dylib',
  'libobjc.A.dylib',
  'libc++.1.dylib',
]);

export class MemoryScanner {
  private readonly nmm: NativeMemoryManager;
  private providerCache: PlatformMemoryAPI | null = null;

  private get provider(): PlatformMemoryAPI {
    if (!this.providerCache) {
      this.providerCache = createPlatformProvider();
    }
    return this.providerCache;
  }

  private set provider(value: PlatformMemoryAPI | null) {
    this.providerCache = value;
  }

  /**
   * The provider is injectable so a domain can compose scanner and manager
   * against the same lifecycle. The legacy one-argument constructor remains
   * supported and lazily creates the platform provider as before.
   */
  constructor(nmm: NativeMemoryManager, provider?: PlatformMemoryAPI) {
    this.nmm = nmm;
    this.providerCache = provider ?? null;
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
      throw new ToolError('VALIDATION', `Invalid pattern for type ${valueType}: "${value}"`);
    }

    const targetBuf = Buffer.from(patternBytes);
    const sessionId = scanSessionManager.createSession(pid, options);
    const addresses: bigint[] = [];
    const values = new Map<bigint, Buffer>();

    const handle = this.provider.openProcess(pid, false);
    try {
      const alignHelpers: AlignHelpers = {
        getAlignStep: (a) => this.getAlignStep(a),
        getAlignedChunkStart: (addr, step) => this.getAlignedChunkStart(addr, step),
        isAlignedAddress: (addr, step) => this.isAlignedAddress(addr, step),
      };
      const regions = this.getFilteredRegions(handle, options);
      const totalRegions = regions.length;
      let regionsProcessed = 0;
      let chunksProcessed = 0;

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
            chunk = (await this.provider.readMemory(handle, chunkAddr, readSize)).data;
          } catch {
            break; // Skip unreadable chunks
          }

          scanChunkForValue(
            chunk,
            chunkAddr,
            targetBuf,
            valueSize,
            alignment,
            maxResults,
            addresses,
            values,
            alignHelpers,
          );

          chunksProcessed++;
          if (chunksProcessed % SCAN_YIELD_CHUNK_INTERVAL === 0) {
            await yieldToEventLoop();
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
    delta?: number,
    tolerance?: number,
  ): Promise<ScanResult> {
    const start = performance.now();
    const session = scanSessionManager.getSession(sessionId);
    const { pid, valueType, addresses: prevAddresses, previousValues } = session;
    const valueSize = getValueSize(valueType);

    if (valueSize === 0) {
      throw new ToolError(
        'VALIDATION',
        'Next-scan is not supported for variable-length types (hex/string)',
      );
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
    const deltasByAddress = new Map<bigint, number>();

    const handle = this.provider.openProcess(pid, false);
    try {
      for (const addr of prevAddresses) {
        let currentBuf: Buffer;
        try {
          currentBuf = (await this.provider.readMemory(handle, addr, valueSize)).data;
        } catch {
          continue; // Address no longer readable
        }

        const prevBuf = previousValues.get(addr) ?? null;

        if (
          compareScanValues(
            currentBuf,
            prevBuf,
            targetBuf,
            target2Buf,
            mode,
            valueType,
            delta,
            tolerance,
          )
        ) {
          newAddresses.push(addr);
          newValues.set(addr, Buffer.from(currentBuf));

          // For changed_by_variable, compute per-address delta
          if (mode === 'changed_by_variable' && prevBuf) {
            const curVal = readTypedValue(currentBuf, valueType);
            const prevVal = readTypedValue(prevBuf, valueType);
            const diff =
              typeof curVal === 'bigint' && typeof prevVal === 'bigint'
                ? Number(curVal - prevVal)
                : Number(curVal) - Number(prevVal);
            deltasByAddress.set(addr, diff);
          }
        }
      }
    } finally {
      this.provider.closeProcess(handle);
    }

    scanSessionManager.updateSession(sessionId, newAddresses, newValues);
    const elapsed = `${(performance.now() - start).toFixed(1)}ms`;
    const displayAddresses = newAddresses.slice(0, SCAN_DISPLAY_RESULTS_LIMIT).map(formatAddress);

    const result: ScanResult = {
      sessionId,
      matchCount: newAddresses.length,
      scanNumber: session.scanCount,
      addresses: displayAddresses,
      totalMatches: newAddresses.length,
      truncated: newAddresses.length > SCAN_DISPLAY_RESULTS_LIMIT,
      elapsed,
    };

    if (mode === 'changed_by_variable' && deltasByAddress.size > 0) {
      const deltas: Record<string, number> = {};
      for (const [addr, d] of deltasByAddress) {
        deltas[formatAddress(addr)] = d;
      }
      result.deltas = deltas;
    }

    return result;
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
      throw new ToolError(
        'VALIDATION',
        'Unknown initial scan is not supported for variable-length types',
      );
    }

    const sessionId = scanSessionManager.createSession(pid, options);
    const addresses: bigint[] = [];
    const values = new Map<bigint, Buffer>();

    const handle = this.provider.openProcess(pid, false);
    try {
      const regions = this.getFilteredRegions(handle, options);
      const totalRegions = regions.length;
      let regionsProcessed = 0;
      let chunksProcessed = 0;

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
            chunk = (await this.provider.readMemory(handle, chunkAddr, readSize)).data;
          } catch {
            break;
          }

          const alignStep = this.getAlignStep(alignment);
          const chunkStart = this.getAlignedChunkStart(chunkAddr, alignStep);
          for (let i = chunkStart; i <= chunk.length - valueSize; i += alignStep) {
            const addr = chunkAddr + BigInt(i);
            addresses.push(addr);
            values.set(addr, Buffer.from(chunk.subarray(i, i + valueSize)));

            if (addresses.length >= maxAddresses) break;
          }

          chunksProcessed++;
          if (chunksProcessed % SCAN_YIELD_CHUNK_INTERVAL === 0) {
            await yieldToEventLoop();
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
      regionFilter?: import('./NativeMemoryManager.types').RegionFilter;
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
      regionFilter: options.regionFilter ?? { moduleOnly: options.moduleOnly },
    };
    const sessionId = scanSessionManager.createSession(pid, scanOptions);
    const pointers: Array<{ address: string; value: string; offsetFromTarget: number }> = [];

    const handle = this.provider.openProcess(pid, false);
    try {
      const regions = this.getFilteredRegions(handle, scanOptions);
      let chunksProcessed = 0;

      for (const region of regions) {
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
            chunk = (await this.provider.readMemory(handle, chunkAddr, readSize)).data;
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

          chunksProcessed++;
          if (chunksProcessed % SCAN_YIELD_CHUNK_INTERVAL === 0) {
            await yieldToEventLoop();
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
      throw new ToolError('VALIDATION', 'Group scan requires at least one value pattern');
    }

    // Calculate total pattern size
    const maxOffset = Math.max(...pattern.map((p) => p.offset + getValueSize(p.type)));
    if (maxOffset > SCAN_GROUP_MAX_PATTERN_SIZE) {
      throw new ToolError(
        'VALIDATION',
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
      let chunksProcessed = 0;

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
            chunk = (await this.provider.readMemory(handle, chunkAddr, readSize)).data;
          } catch {
            break;
          }

          const alignStep = this.getAlignStep(alignment);
          const chunkStart = this.getAlignedChunkStart(chunkAddr, alignStep);
          for (let i = chunkStart; i <= chunk.length - maxOffset; i += alignStep) {
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

          chunksProcessed++;
          if (chunksProcessed % SCAN_YIELD_CHUNK_INTERVAL === 0) {
            await yieldToEventLoop();
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

  /**
   * AOB (Array of Bytes) scan with wildcard support.
   *
   * Searches for byte patterns like "48 8B ?? ?? 00 00" across readable memory
   * regions. Wildcards (??) match any byte. Optionally restricts to a module
   * via regionFilter.modulePattern or the legacy moduleName shorthand.
   */
  async aobScan(
    pid: number,
    pattern: string,
    options: {
      maxResults?: number;
      moduleName?: string;
      executableOnly?: boolean;
      regionFilter?: import('./NativeMemoryManager.types').RegionFilter;
    } = {},
  ): Promise<{
    matches: string[];
    totalMatches: number;
    elapsed: string;
  }> {
    const start = performance.now();
    const maxResults = options.maxResults ?? 10000;

    // Parse pattern into (byte | null)[] where null = wildcard
    const parsed: (number | null)[] = [];
    const tokens = pattern.trim().split(/\s+/);
    for (const token of tokens) {
      if (token === '??' || token === '?' || token === '???') {
        parsed.push(null);
      } else {
        // Strip optional 0x prefix
        const hex = token.startsWith('0x') || token.startsWith('0X') ? token.slice(2) : token;
        if (hex.length !== 2 || !/^[0-9a-fA-F]{2}$/.test(hex)) {
          throw new Error(`Invalid AOB pattern byte: "${token}" (expected 2 hex chars or "??")`);
        }
        parsed.push(parseInt(hex, 16));
      }
    }

    if (parsed.length === 0) {
      throw new Error('AOB pattern must contain at least one byte or wildcard');
    }

    // Build search needle: byte array + mask boolean array
    const needle = Buffer.from(parsed.map((b) => b ?? 0));
    const mask: boolean[] = parsed.map((b) => b !== null);

    const matches: bigint[] = [];
    const handle = this.provider.openProcess(pid, false);
    try {
      // Build regionFilter for getFilteredRegions
      const scanFilter: import('./NativeMemoryManager.types').RegionFilter = {
        ...options.regionFilter,
      };

      // Legacy moduleName: translate to modulePattern for backward compat
      if (options.moduleName && !scanFilter.modulePattern) {
        scanFilter.modulePattern = options.moduleName;
      }

      // Legacy executableOnly: translate to regionFilter
      if (options.executableOnly && scanFilter.executable === undefined) {
        scanFilter.executable = true;
      }

      const regions = this.getFilteredRegions(handle, {
        valueType: 'byte',
        regionFilter: Object.keys(scanFilter).length > 0 ? scanFilter : undefined,
      });

      const patternLen = parsed.length;
      let chunksProcessed = 0;
      for (const region of regions) {
        if (matches.length >= maxResults) break;

        const chunkSize = 16 * 1024 * 1024;
        for (
          let offset = 0;
          offset < region.size && matches.length < maxResults;
          offset += chunkSize
        ) {
          const readSize = Math.min(chunkSize, region.size - offset);
          const chunkAddr = region.baseAddress + BigInt(offset);

          let chunk: Buffer;
          try {
            chunk = (await this.provider.readMemory(handle, chunkAddr, readSize)).data;
          } catch {
            break;
          }

          // Scan the chunk byte by byte using mask
          for (let i = 0; i <= chunk.length - patternLen && matches.length < maxResults; i++) {
            let matched = true;
            for (let j = 0; j < patternLen; j++) {
              if (mask[j] && chunk[i + j] !== needle[j]) {
                matched = false;
                break;
              }
            }
            if (matched) {
              matches.push(chunkAddr + BigInt(i));
            }
          }

          chunksProcessed++;
          if (chunksProcessed % SCAN_YIELD_CHUNK_INTERVAL === 0) {
            await yieldToEventLoop();
          }
        }
      }
    } finally {
      this.provider.closeProcess(handle);
    }

    const elapsed = `${(performance.now() - start).toFixed(1)}ms`;
    const displayMatches = matches.map(formatAddress);

    return {
      matches: displayMatches,
      totalMatches: matches.length,
      elapsed,
    };
  }

  // ── Private Helpers ──

  private getAlignStep(alignment: number): number {
    return alignment > 0 ? alignment : 1;
  }

  private getAlignedChunkStart(chunkAddr: bigint, alignStep: number): number {
    const align = BigInt(alignStep);
    const remainder = chunkAddr % align;
    return remainder === 0n ? 0 : Number(align - remainder);
  }

  private isAlignedAddress(address: bigint, alignStep: number): boolean {
    return address % BigInt(alignStep) === 0n;
  }

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
    // Only variable-length types (size 0) reach this path: 'hex' and 'string'.
    // 'string' is scanned as a byte/hex pattern by the underlying engine.
    const patternType: 'hex' | 'string' = valueType === 'hex' ? 'hex' : 'string';
    const result = await this.nmm.scanMemory(pid, value, patternType);

    if (!result.success) {
      throw new ToolError('RUNTIME', result.error ?? 'Scan failed');
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
    const maxAddress = USERSPACE_MAX_ADDRESS;
    const filter = options.regionFilter;

    // Cache module list if we need module-aware filters
    let moduleList: Array<{ baseAddress: bigint; size: number; name: string }> | null = null;
    const needsModules = filter?.skipSystemModules || filter?.moduleOnly || filter?.modulePattern;
    if (needsModules) {
      const mods = this.provider.enumerateModules(handle);
      moduleList = mods.map((m) => ({
        baseAddress: m.baseAddress,
        size: m.size,
        name: m.name,
      }));
    }

    while (address < maxAddress) {
      const regionInfo = this.provider.queryRegion(handle, address);
      if (!regionInfo) break;

      const regionSize = regionInfo.size;

      if (regionInfo.isReadable && regionSize > 0 && regionSize <= Number.MAX_SAFE_INTEGER) {
        if (regionPassesFilters(regionInfo, regionSize, filter, moduleList)) {
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

/** Region shape the filters operate on. */
interface ScanRegionInfo {
  baseAddress: bigint;
  size: number;
  isReadable: boolean;
  isWritable: boolean;
  isExecutable: boolean;
  type: string;
}

type ScanModuleEntry = { baseAddress: bigint; size: number; name: string };

/** Apply every regionFilter predicate to one region. */
function regionPassesFilters(
  regionInfo: ScanRegionInfo,
  regionSize: number,
  filter: ScanOptions['regionFilter'],
  moduleList: ScanModuleEntry[] | null,
): boolean {
  if (filter?.writable && !regionInfo.isWritable) return false;
  if (filter?.executable && !regionInfo.isExecutable) return false;
  if (filter?.moduleOnly && regionInfo.type !== 'image') return false;
  if (filter?.minSize && regionSize < filter.minSize) return false;
  if (filter?.skipSystemModules && moduleList && ownsSystemModule(regionInfo, moduleList)) {
    return false;
  }
  if (filter?.modulePattern && moduleList) {
    const owner = findOwnerModule(regionInfo, moduleList);
    const patternLower = filter.modulePattern.toLowerCase();
    if (!owner || !owner.name.toLowerCase().includes(patternLower)) return false;
  }
  return true;
}

/** The module whose loaded range contains this region, or undefined. */
function findOwnerModule(
  regionInfo: ScanRegionInfo,
  moduleList: ScanModuleEntry[],
): ScanModuleEntry | undefined {
  return moduleList.find(
    (m) =>
      regionInfo.baseAddress >= m.baseAddress &&
      regionInfo.baseAddress < m.baseAddress + BigInt(m.size),
  );
}

/** True when the region belongs to a known system DLL. */
function ownsSystemModule(regionInfo: ScanRegionInfo, moduleList: ScanModuleEntry[]): boolean {
  const owner = findOwnerModule(regionInfo, moduleList);
  if (!owner) return false;
  const nameLower = owner.name.toLowerCase();
  for (const sysMod of SYSTEM_MODULE_PREFIXES) {
    if (nameLower.includes(sysMod)) return true;
  }
  return false;
}

/** Alignment predicates owned by MemoryScanner, passed to the chunk scanner. */
interface AlignHelpers {
  getAlignStep: (alignment: number) => number;
  getAlignedChunkStart: (chunkAddr: bigint, alignStep: number) => number;
  isAlignedAddress: (addr: bigint, alignStep: number) => boolean;
}

/** Find `targetBuf` inside one memory chunk, honouring alignment, and record
 * hits into `addresses` / `values` until `maxResults` is reached.
 *
 * Two strategies: when the value size equals the alignment the search uses
 * Buffer.indexOf (V8's SIMD-optimized native scan) and re-checks alignment
 * per hit; otherwise it steps the buffer at `alignStep` and compares. */
function scanChunkForValue(
  chunk: Buffer,
  chunkAddr: bigint,
  targetBuf: Buffer,
  valueSize: number,
  alignment: number,
  maxResults: number,
  addresses: bigint[],
  values: Map<bigint, Buffer>,
  align: AlignHelpers,
): void {
  const alignStep = align.getAlignStep(alignment);

  if (alignment === valueSize && valueSize > 0) {
    let searchFrom = align.getAlignedChunkStart(chunkAddr, alignStep);
    while (searchFrom <= chunk.length - valueSize && addresses.length < maxResults) {
      const hit = chunk.indexOf(targetBuf, searchFrom);
      if (hit === -1) break;
      if (!align.isAlignedAddress(chunkAddr + BigInt(hit), alignStep)) {
        searchFrom = hit + 1;
        continue;
      }
      const addr = chunkAddr + BigInt(hit);
      addresses.push(addr);
      values.set(addr, Buffer.from(chunk.subarray(hit, hit + valueSize)));
      searchFrom = hit + alignStep;
    }
    return;
  }

  const chunkStart = align.getAlignedChunkStart(chunkAddr, alignStep);
  for (let i = chunkStart; i <= chunk.length - valueSize; i += alignStep) {
    if (Buffer.compare(chunk.subarray(i, i + valueSize), targetBuf) === 0) {
      const addr = chunkAddr + BigInt(i);
      addresses.push(addr);
      values.set(addr, Buffer.from(chunk.subarray(i, i + valueSize)));
      if (addresses.length >= maxResults) break;
    }
  }
}
