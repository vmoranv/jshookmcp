/**
 * Pointer Chain Engine — multi-level BFS pointer scanning.
 *
 * Finds stable pointer chains: [base_module+offset] → [+off1] → [+off2] → ... → target
 * Supports chain validation, resolution, and persistence.
 *
 * Uses PlatformMemoryAPI for cross-platform memory operations.
 *
 * @module PointerChainEngine
 */

import { randomUUID } from 'node:crypto';
import {
  POINTER_CHAIN_DEFAULT_ALIGNMENT,
  POINTER_CHAIN_MAX_BFS_BREADTH,
  POINTER_CHAIN_MAX_DEPTH,
  POINTER_CHAIN_MAX_MATCHES,
  POINTER_CHAIN_MAX_OFFSET,
  POINTER_CHAIN_MAX_RESULTS,
  POINTER_CHAIN_SCAN_CHUNK_SIZE,
  USERSPACE_MAX_ADDRESS,
} from '@src/constants';
import type {
  PointerChain,
  PointerChainLink,
  PointerScanOptions,
  PointerScanResult,
  ChainValidationResult,
} from './PointerChainEngine.types';
import { createPlatformProvider } from './platform/factory.js';
import type { PlatformMemoryAPI } from './platform/PlatformMemoryAPI.js';
import type { ProcessHandle } from './platform/types.js';
import { nativeMemoryManager } from './NativeMemoryManager.impl';
import { formatAddress, parseAddress } from './formatAddress';
import { SortedRegionIndex } from './SortedRegionIndex.js';
import type { MemoryRegionInfo } from './platform/types.js';

interface ModuleEntry {
  name: string;
  base: bigint;
  size: number;
}

interface LevelMatch {
  /** Address where the pointer was found */
  pointerAddress: bigint;
  /** The value at pointerAddress (what it points to) */
  pointsTo: bigint;
  /** Offset: pointsTo - targetAddress for this level */
  offset: number;
}

export class PointerChainEngine {
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
   * Multi-level BFS pointer scan.
   *
   * Algorithm:
   * Level 0: Find pointers P where *P ∈ [target - maxOffset, target + maxOffset]
   * Level 1: Find pointers Q where *Q ∈ [P - maxOffset, P + maxOffset] for each P
   * ... repeat up to maxDepth
   * Construct chains backward from target to base.
   */
  async scan(
    pid: number,
    targetAddress: string,
    options?: PointerScanOptions,
  ): Promise<PointerScanResult> {
    const start = performance.now();
    const maxDepth = Math.min(options?.maxDepth ?? 4, POINTER_CHAIN_MAX_DEPTH);
    const maxOffset = options?.maxOffset ?? POINTER_CHAIN_MAX_OFFSET;
    const maxResults = options?.maxResults ?? POINTER_CHAIN_MAX_RESULTS;
    const alignment = options?.alignment ?? POINTER_CHAIN_DEFAULT_ALIGNMENT;
    const staticOnly = options?.staticOnly ?? false;

    const targetAddr = parseAddress(targetAddress);

    const handle = this.provider.openProcess(pid, false);
    try {
      const modules = await this.getModuleMap(pid);

      // Pre-enumerate all memory regions once — reused across BFS levels.
      // SortedRegionIndex provides O(log n) binary search + LRU chunk cache.
      const allRegions = this.enumerateAllRegions(handle);
      const regionIndex = new SortedRegionIndex();
      regionIndex.build(allRegions);

      // BFS: level by level
      // levelResults[i] = matches found at level i
      // levelResults[0] = pointers that point to target ±maxOffset
      const levelResults: LevelMatch[][] = [];

      // Targets for current level: addresses we're looking for pointers TO
      let currentTargets = new Set<bigint>([targetAddr]);

      for (let depth = 0; depth < maxDepth; depth++) {
        if (currentTargets.size === 0) break;

        const matches = await this.scanLevel(
          handle,
          currentTargets,
          maxOffset,
          alignment,
          regionIndex,
        );

        if (matches.length === 0) break;

        levelResults.push(matches);

        // Build next-level targets from found pointer addresses
        currentTargets = new Set<bigint>();
        for (const m of matches) {
          currentTargets.add(m.pointerAddress);
          if (currentTargets.size > POINTER_CHAIN_MAX_BFS_BREADTH) break; // limit BFS breadth
        }
      }

      // Construct chains: walk from deepest level back to target
      const chains = this.buildChains(levelResults, targetAddr, modules, maxResults, staticOnly);

      const elapsed = `${(performance.now() - start).toFixed(1)}ms`;

      return {
        pid,
        targetAddress: formatAddress(targetAddr),
        chains,
        totalFound: chains.length,
        maxDepth,
        elapsed,
      };
    } finally {
      this.provider.closeProcess(handle);
    }
  }

  /**
   * Auto-discover pointer chains via recursive pointer scanning.
   *
   * Cheat Engine "pointer scan" equivalent: starts from the target address,
   * recursively finds all pointers that point TO or NEAR (±tolerance bytes)
   * the target, then repeats for each found pointer base.  Builds multi-level
   * chains automatically without requiring manual base+offsets.
   *
   * Algorithm (recursive DFS):
   * ```
   * function autoScan(targets, depth, maxDepth, tolerance):
   *   if depth >= maxDepth: return []
   *
   *   // Scan all writable/readable regions for pointers to any target ±tolerance
   *   matches = scanForPointers(handle, targets, tolerance)
   *   if matches.length === 0: return []
   *
   *   chains = []
   *   for each match in matches:
   *     // Recursively find pointers to this pointer's address
   *     parentChains = autoScan([match.pointerAddress], depth+1, maxDepth, tolerance)
   *     if parentChains.length === 0:
   *       // Leaf chain: [match] → target
   *       chains.push([match])
   *     else:
   *       for each parent in parentChains:
   *         chains.push([match, ...parent])
   *
   *   return chains (filtered to static-only if requested, sorted by depth)
   * ```
   *
   * The scan uses the same `scanLevel` engine as `scan()` — the difference is
   * that `autoScan` drives the level recursion from the target backward
   * (discovering all pointers at each level) whereas `scan()` uses BFS forward
   * from known base addresses.
   */
  async autoScan(
    pid: number,
    targetAddress: string,
    options?: PointerScanOptions,
  ): Promise<PointerScanResult> {
    const start = performance.now();
    const maxDepth = Math.min(options?.maxDepth ?? 4, POINTER_CHAIN_MAX_DEPTH);
    const maxOffset = options?.maxOffset ?? POINTER_CHAIN_MAX_OFFSET;
    const maxResults = options?.maxResults ?? POINTER_CHAIN_MAX_RESULTS;
    const alignment = options?.alignment ?? POINTER_CHAIN_DEFAULT_ALIGNMENT;
    const staticOnly = options?.staticOnly ?? false;

    const targetAddr = parseAddress(targetAddress);

    const handle = this.provider.openProcess(pid, false);
    try {
      const modules = await this.getModuleMap(pid);

      // Pre-enumerate all memory regions once for the recursive scan.
      const allRegions = this.enumerateAllRegions(handle);
      const regionIndex = new SortedRegionIndex();
      regionIndex.build(allRegions);

      // Recursively discover pointer levels
      const levelResults: LevelMatch[][] = [];
      await this.autoScanRecursive(
        handle,
        new Set<bigint>([targetAddr]),
        0,
        maxDepth,
        maxOffset,
        alignment,
        levelResults,
        regionIndex,
      );

      // Build chains from the auto-discovered levels
      const chains = this.buildChains(levelResults, targetAddr, modules, maxResults, staticOnly);

      const elapsed = `${(performance.now() - start).toFixed(1)}ms`;

      return {
        pid,
        targetAddress: formatAddress(targetAddr),
        chains,
        totalFound: chains.length,
        maxDepth,
        elapsed,
      };
    } finally {
      this.provider.closeProcess(handle);
    }
  }

  /**
   * Recursive auto-scan worker: find pointers to `targets`, record at current
   * depth, then recurse with the found pointer addresses as new targets.
   */
  private async autoScanRecursive(
    handle: ProcessHandle,
    targets: Set<bigint>,
    depth: number,
    maxDepth: number,
    maxOffset: number,
    alignment: number,
    levelResults: LevelMatch[][],
    regionIndex: SortedRegionIndex,
  ): Promise<void> {
    if (depth >= maxDepth || targets.size === 0) return;

    const matches = await this.scanLevel(handle, targets, maxOffset, alignment, regionIndex);
    if (matches.length === 0) return;

    levelResults.push(matches);

    // Collect found pointer addresses as next-level targets
    const nextTargets = new Set<bigint>();
    for (const m of matches) {
      nextTargets.add(m.pointerAddress);
    }

    await this.autoScanRecursive(
      handle,
      nextTargets,
      depth + 1,
      maxDepth,
      maxOffset,
      alignment,
      levelResults,
      regionIndex,
    );
  }

  /**
   * Validate a pointer chain by re-dereferencing each link.
   */
  async validateChain(pid: number, chain: PointerChain): Promise<ChainValidationResult> {
    const handle = this.provider.openProcess(pid, false);
    try {
      const resolved = await this.resolveChainInternal(handle, chain);
      if (resolved.brokenAt !== undefined) {
        return {
          chainId: chain.id,
          isValid: false,
          resolvedAddress: null,
          expectedAddress: chain.targetAddress,
          brokenAt: resolved.brokenAt,
        };
      }

      const expectedAddr = parseAddress(chain.targetAddress);
      const isValid = resolved.currentAddr === expectedAddr;

      return {
        chainId: chain.id,
        isValid,
        resolvedAddress: formatAddress(resolved.currentAddr),
        expectedAddress: chain.targetAddress,
        brokenAt: isValid ? undefined : chain.links.length - 1,
      };
    } finally {
      this.provider.closeProcess(handle);
    }
  }

  /**
   * Validate multiple chains in batch.
   */
  async validateChains(pid: number, chains: PointerChain[]): Promise<ChainValidationResult[]> {
    const results: ChainValidationResult[] = [];
    for (const chain of chains) {
      results.push(await this.validateChain(pid, chain));
    }
    return results;
  }

  /**
   * Resolve a pointer chain to its current target address.
   */
  async resolveChain(pid: number, chain: PointerChain): Promise<string | null> {
    const handle = this.provider.openProcess(pid, false);
    try {
      const resolved = await this.resolveChainInternal(handle, chain);
      return resolved.brokenAt === undefined ? formatAddress(resolved.currentAddr) : null;
    } finally {
      this.provider.closeProcess(handle);
    }
  }

  /**
   * Walk a chain link-by-link, dereferencing each pointer. Returns the final
   * address plus the index of the first link whose read failed (undefined when
   * the whole chain resolved). Shared by {@link validateChain} and
   * {@link resolveChain} — previously two verbatim copies of this loop.
   */
  private async resolveChainInternal(
    handle: ProcessHandle,
    chain: PointerChain,
  ): Promise<{ currentAddr: bigint; brokenAt?: number }> {
    let currentAddr = parseAddress(chain.baseAddress);

    for (let i = 0; i < chain.links.length; i++) {
      const link = chain.links[i]!;
      let ptrValue: bigint;
      try {
        const buf = (await this.provider.readMemory(handle, currentAddr, 8)).data;
        ptrValue = buf.readBigUInt64LE(0);
      } catch {
        return { currentAddr, brokenAt: i };
      }
      currentAddr = ptrValue + BigInt(link.offset);
    }

    return { currentAddr };
  }

  /**
   * Export chains to JSON for persistence.
   */
  exportChains(chains: PointerChain[]): string {
    return JSON.stringify(chains, null, 2);
  }

  /**
   * Import chains from JSON.
   */
  importChains(data: string): PointerChain[] {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) throw new Error('Invalid chain data: expected array');
    return parsed as PointerChain[];
  }

  // ── Private Helpers ──

  /**
   * Get module info map for resolving module-relative addresses.
   */
  private async getModuleMap(pid: number): Promise<Map<string, ModuleEntry>> {
    const modules = new Map<string, ModuleEntry>();
    try {
      const result = await nativeMemoryManager.enumerateModules(pid);
      if (result.success && result.modules) {
        for (const mod of result.modules) {
          const base = parseAddress(mod.baseAddress);
          modules.set(mod.name.toLowerCase(), { name: mod.name, base, size: mod.size });
        }
      }
    } catch {
      // Module enumeration failed — proceed without module info
    }
    return modules;
  }

  /**
   * Walk the entire user-mode address space once and collect every region.
   *
   * Called once at scan start — the resulting array is fed to
   * {@link SortedRegionIndex.build} and reused across all BFS levels,
   * avoiding per-level `queryRegion` system calls for each region.
   *
   * Complexity: O(r) where r = number of memory regions in the process.
   */
  private enumerateAllRegions(handle: ProcessHandle): MemoryRegionInfo[] {
    const regions: MemoryRegionInfo[] = [];
    let address = 0n;
    while (address < USERSPACE_MAX_ADDRESS) {
      const region = this.provider.queryRegion(handle, address);
      if (!region) break;
      regions.push(region);
      address = region.baseAddress + BigInt(region.size);
    }
    return regions;
  }

  /**
   * Resolve an address to module+offset notation.
   */
  private resolveToModule(
    address: bigint,
    moduleMap: Map<string, ModuleEntry>,
  ): { module: string; offset: number } | null {
    for (const entry of moduleMap.values()) {
      if (address >= entry.base && address < entry.base + BigInt(entry.size)) {
        return {
          module: entry.name,
          offset: Number(address - entry.base),
        };
      }
    }
    return null;
  }

  /**
   * BFS scan for one level: find all addresses whose pointer-sized value
   * points within ±maxOffset of any target address.
   *
   * Uses the pre-built {@link SortedRegionIndex} to iterate readable regions
   * without per-region system calls, an LRU chunk cache to avoid re-reading
   * the same memory across BFS levels, and a {@link BigInt64Array} for the
   * sorted target list (TypedArray = 8 bytes per entry vs ~32 bytes for JS
   * BigInt objects — 87.5% RAM reduction).
   */
  private async scanLevel(
    handle: ProcessHandle,
    targetAddresses: Set<bigint>,
    maxOffset: number,
    alignment: number,
    regionIndex: SortedRegionIndex,
  ): Promise<LevelMatch[]> {
    const matches: LevelMatch[] = [];
    const chunkSize = POINTER_CHAIN_SCAN_CHUNK_SIZE;

    // Build sorted target list for O(log n) binary search per pointer.
    // BigInt64Array stores native 8-byte values — ~87.5% smaller than JS BigInt[]
    const sortedTargets = Array.from(targetAddresses).toSorted((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    if (sortedTargets.length === 0) return matches;

    // Copy into TypedArray for cache-friendly binary search
    const targets = new BigInt64Array(sortedTargets.length);
    for (let i = 0; i < sortedTargets.length; i++) {
      targets[i] = sortedTargets[i]!;
    }
    const targetCount = targets.length;

    // Compute global target range for fast pre-filter
    const maxOffsetBig = BigInt(maxOffset);
    const globalMin = targets[0]! - maxOffsetBig;
    const globalMax = targets[targetCount - 1]! + maxOffsetBig;

    // Iterate pre-built readable regions (no per-region queryRegion syscalls)
    const readableRegions = regionIndex.getReadableRegions();
    for (const region of readableRegions) {
      const regionBase = region.baseAddress;
      const regionSize = region.size;

      for (
        let offset = 0;
        offset < regionSize && matches.length < POINTER_CHAIN_MAX_MATCHES;
        offset += chunkSize
      ) {
        const readSize = Math.min(chunkSize, regionSize - offset);
        const chunkAddr = regionBase + BigInt(offset);

        let chunk: Buffer;
        try {
          // LRU-cached read — avoids re-reading same region across BFS levels
          chunk = await regionIndex.readChunk(this.provider, handle, chunkAddr, readSize);
        } catch {
          break;
        }

        // Scan for pointer-sized values that fall within target range
        const scanEnd = chunk.length - 8;
        for (let i = 0; i <= scanEnd; i += alignment) {
          const ptrValue = chunk.readBigUInt64LE(i);

          // Fast pre-filter: check global range
          if (ptrValue < globalMin || ptrValue > globalMax) continue;

          // Binary search on BigInt64Array: find first target >= (ptrValue - maxOffset)
          const searchMin = ptrValue - maxOffsetBig;
          const searchMax = ptrValue + maxOffsetBig;
          let lo = 0;
          let hi = targetCount;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (targets[mid]! < searchMin) lo = mid + 1;
            else hi = mid;
          }

          // Check targets in range [searchMin, searchMax]
          for (let t = lo; t < targetCount && targets[t]! <= searchMax; t++) {
            const target = targets[t]!;
            const diff = ptrValue > target ? Number(ptrValue - target) : Number(target - ptrValue);

            if (diff <= maxOffset) {
              const pointerAddr = chunkAddr + BigInt(i);
              const matchOffset = Number(target - ptrValue);

              matches.push({
                pointerAddress: pointerAddr,
                pointsTo: ptrValue,
                offset: matchOffset,
              });
              break; // One match per pointer address
            }
          }
        }
      }
    }

    return matches;
  }

  /**
   * Build pointer chains from level results (backward: deepest level = base).
   *
   * For a chain rooted at level `d`, every intermediate level must appear as a
   * link: [match@d] → [match@d-1] → … → [match@0] → target. Links are resolved
   * by walking backward from the root match, finding the previous level's match
   * whose pointerAddress lies within ±maxOffset of the current match's pointsTo.
   */
  private buildChains(
    levelResults: LevelMatch[][],
    targetAddr: bigint,
    modules: Map<string, ModuleEntry>,
    maxResults: number,
    staticOnly: boolean,
  ): PointerChain[] {
    if (levelResults.length === 0) return [];

    const chains: PointerChain[] = [];
    const ctx: ChainBuildContext = {
      targetAddrStr: formatAddress(targetAddr),
      maxOff: BigInt(POINTER_CHAIN_MAX_OFFSET),
      modules,
      maxResults,
      staticOnly,
      levelResults,
      levelIndex: indexLevelsByPointerAddress(levelResults),
    };

    // For each depth, create chains: depth 0 is the direct-pointer case,
    // deeper levels walk backward from the root match.
    for (let depth = 0; depth < levelResults.length && chains.length < ctx.maxResults; depth++) {
      if (depth === 0) {
        this.appendDirectChains(ctx, levelResults[0]!, chains);
      } else {
        this.appendBacktrackedChains(ctx, levelResults[depth]!, depth, chains);
      }
    }

    // Sort: static chains first, then by depth (shorter preferred)
    chains.sort((a, b) => {
      if (a.isStatic !== b.isStatic) return a.isStatic ? -1 : 1;
      return a.depth - b.depth;
    });

    return chains.slice(0, maxResults);
  }

  /** Depth 0: a single link straight to the target. */
  private appendDirectChains(
    ctx: ChainBuildContext,
    level: LevelMatch[],
    chains: PointerChain[],
  ): void {
    for (const match of level) {
      if (chains.length >= ctx.maxResults) break;

      const modInfo = this.resolveToModule(match.pointerAddress, ctx.modules);
      const isStatic = modInfo !== null;
      if (ctx.staticOnly && !isStatic) continue;

      const baseAddrStr = formatAddress(match.pointerAddress);
      chains.push({
        id: randomUUID(),
        links: [
          {
            address: baseAddrStr,
            module: modInfo?.module,
            moduleOffset: modInfo?.offset,
            offset: match.offset,
          },
        ],
        targetAddress: ctx.targetAddrStr,
        baseAddress: baseAddrStr,
        isStatic,
        depth: 1,
        lastValidated: Date.now(),
        isValid: true,
      });
    }
  }

  /** Depth >= 1: walk backward from the root match to level 0, one link per
   * level — a depth-3 chain has 3 links. */
  private appendBacktrackedChains(
    ctx: ChainBuildContext,
    level: LevelMatch[],
    depth: number,
    chains: PointerChain[],
  ): void {
    for (const match of level) {
      if (chains.length >= ctx.maxResults) break;

      const modInfo = this.resolveToModule(match.pointerAddress, ctx.modules);
      const isStatic = modInfo !== null;
      if (ctx.staticOnly && !isStatic) continue;

      const links = buildBacktrackedLinks(ctx, match, depth, modInfo);
      if (!links) continue; // chain broken at some level — drop the candidate

      chains.push({
        id: randomUUID(),
        links,
        targetAddress: ctx.targetAddrStr,
        baseAddress: formatAddress(match.pointerAddress),
        isStatic,
        depth: links.length,
        lastValidated: Date.now(),
        isValid: true,
      });
    }
  }
}

/** State shared by the chain builders. */
interface ChainBuildContext {
  targetAddrStr: string;
  maxOff: bigint;
  modules: Map<string, ModuleEntry>;
  maxResults: number;
  staticOnly: boolean;
  levelResults: LevelMatch[][];
  levelIndex: Map<bigint, LevelMatch>[];
}

/** Pre-index every level by pointerAddress for O(1) backward lookups. */
function indexLevelsByPointerAddress(levelResults: LevelMatch[][]): Map<bigint, LevelMatch>[] {
  return levelResults.map((level) => {
    const index = new Map<bigint, LevelMatch>();
    for (const m of level) index.set(m.pointerAddress, m);
    return index;
  });
}

/** Find the previous level's match whose pointerAddress is within maxOff. */
function findPrevMatch(
  ctx: ChainBuildContext,
  levelIdx: number,
  pointsTo: bigint,
): LevelMatch | undefined {
  const exact = ctx.levelIndex[levelIdx]!.get(pointsTo);
  if (exact) return exact;
  for (const pm of ctx.levelResults[levelIdx]!) {
    const diff =
      pointsTo > pm.pointerAddress ? pointsTo - pm.pointerAddress : pm.pointerAddress - pointsTo;
    if (diff <= ctx.maxOff) return pm;
  }
  return undefined;
}

/** Build the link list for a depth-N chain, or null when any hop is missing. */
function buildBacktrackedLinks(
  ctx: ChainBuildContext,
  match: LevelMatch,
  depth: number,
  rootModInfo: { module?: string; offset?: number } | null,
): PointerChainLink[] | null {
  const links: PointerChainLink[] = [];
  let cur = match;
  let prev: LevelMatch | undefined;

  for (let lvl = depth; lvl >= 1; lvl--) {
    prev = findPrevMatch(ctx, lvl - 1, cur.pointsTo);
    if (!prev) return null; // chain broken at this level

    const isRoot = lvl === depth;
    links.push({
      address: formatAddress(cur.pointerAddress),
      module: isRoot ? rootModInfo?.module : undefined,
      moduleOffset: isRoot ? rootModInfo?.offset : undefined,
      // Dereferencing cur yields cur.pointsTo; adding this offset lands
      // exactly on prev's pointerAddress.
      offset: Number(prev.pointerAddress - cur.pointsTo),
    });
    cur = prev;
  }

  if (!prev) return null;

  // Final link: level 0's offset is relative to the target address.
  links.push({
    address: formatAddress(prev.pointerAddress),
    offset: prev.offset,
  });
  return links;
}

export const pointerChainEngine = new PointerChainEngine();
