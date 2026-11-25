/**
 * MemoryManager — Encapsulates guest memory management extracted from CpuEngine.
 *
 * Manages:
 * - Mapped memory regions (base, size, data)
 * - Fast-path region lookup cache
 * - Symbol table (name → vaddr mapping)
 * - Load/store operations with automatic region lookup
 */

interface MappedRegion {
  base: number;
  size: number;
  data: Uint8Array;
}

export type ReadHook = (address: number, length: number) => Uint8Array | null;

export class MemoryManager {
  private readonly regions: MappedRegion[] = [];
  private readonly regionsByBase: MappedRegion[] = [];
  private lastRegion: MappedRegion | undefined;
  private regionFastPathSafe = true;
  /** Exported dynamic symbols (name → vaddr), populated by loadElf. */
  private readonly symbols = new Map<string, number>();
  /** Optional read hook for shadow memory. If returns non-null, use shadow data. */
  readHook: ReadHook | null = null;

  /**
   * Write-protected address ranges. Any store/STR to these ranges is silently dropped.
   * Each entry: { base: number, size: number }
   */
  private readonly writeProtectRegions: { base: number; size: number }[] = [];

  // ── Memory region management ──

  /**
   * Map a zero-filled region of guest memory.
   * @param address - Base address of the region
   * @param size - Size in bytes
   */
  mapMemory(address: number, size: number): void {
    this.addRegion({ base: address, size, data: new Uint8Array(size) });
  }

  /**
   * Write bytes (machine code or data) into a mapped region.
   * @param address - Starting address
   * @param bytes - Data to write
   */
  writeCode(address: number, bytes: Uint8Array): void {
    if (this.isWriteProtected(address, bytes.length)) return;
    const region = this.findRegion(address, bytes.length, true);
    region.data.set(bytes, address - region.base);
  }

  /**
   * Add a pre-allocated region to the memory map.
   * @param region - Region to add
   */
  addRegion(region: MappedRegion): void {
    if (
      this.regionFastPathSafe &&
      this.regions.some((existing) => regionsOverlap(existing, region.base, region.size))
    ) {
      this.regionFastPathSafe = false;
      this.lastRegion = undefined;
      this.regionsByBase.length = 0;
    }
    this.regions.push(region);
    if (this.regionFastPathSafe) insertRegionByBase(this.regionsByBase, region);
  }

  /**
   * Find a region containing [address, address+length).
   *
   * Read callers consult the shadow-memory `readHook`; write callers must pass
   * `forWrite` so stores land in real mapped memory instead of mutating the
   * synthesized shadow overlay.
   * @throws Error if no region contains the range
   */
  findRegion(address: number, length: number, forWrite = false): MappedRegion {
    // Check read hook (shadow memory) first — reads only.
    if (!forWrite && this.readHook) {
      const shadow = this.readHook(address, length);
      if (shadow) return { base: address, size: shadow.length, data: shadow };
    }
    const cached = this.lastRegion;
    if (
      this.regionFastPathSafe &&
      cached &&
      address >= cached.base &&
      address + length <= cached.base + cached.size
    ) {
      return cached;
    }
    if (this.regionFastPathSafe) {
      const indexed = findRegionByBase(this.regionsByBase, address, length);
      if (indexed) {
        this.lastRegion = indexed;
        return indexed;
      }
    }
    for (const region of this.regions) {
      if (address >= region.base && address + length <= region.base + region.size) {
        if (this.regionFastPathSafe) this.lastRegion = region;
        return region;
      }
    }
    throw new Error(`Unmapped memory access at 0x${address.toString(16)} (len ${length})`);
  }

  // ── Load/Store operations ──

  /**
   * Read a little-endian unsigned integer of `bytes` width from guest memory.
   * @param address - Starting address
   * @param bytes - Number of bytes (1, 2, 4, or 8)
   * @returns The loaded value as BigInt
   */
  loadValue(address: number, bytes: number): bigint {
    const region = this.findRegion(address, bytes);
    const data = region.data;
    let offset = address - region.base;
    let value = 0n;
    for (let i = 0; i < bytes; i++) {
      value |= BigInt(data[offset++]!) << BigInt(i * 8);
    }
    return value;
  }

  /**
   * Write the low `bytes` of `value` to guest memory, little-endian.
   * @param address - Starting address
   * @param bytes - Number of bytes (1, 2, 4, or 8)
   * @param value - Value to write
   */
  storeValue(address: number, bytes: number, value: bigint): void {
    if (this.isWriteProtected(address, bytes)) return;
    const region = this.findRegion(address, bytes, true);
    const data = region.data;
    let offset = address - region.base;
    let v = value;
    for (let i = 0; i < bytes; i++) {
      data[offset++] = Number(v & 0xffn);
      v >>= 8n;
    }
  }

  /**
   * Read bytes from guest memory.
   * @param address - Starting address
   * @param length - Number of bytes to read
   * @returns A copy of the bytes
   */
  readMemory(address: number, length: number): Uint8Array {
    const region = this.findRegion(address, length);
    const offset = address - region.base;
    return region.data.slice(offset, offset + length);
  }

  /**
   * Write bytes to guest memory.
   * @param address - Starting address
   * @param bytes - Data to write
   */
  writeMemory(address: number, bytes: Uint8Array): void {
    const region = this.findRegion(address, bytes.length, true);
    const offset = address - region.base;
    region.data.set(bytes, offset);
  }

  // ── Write-protect API ──

  /**
   * Add a write-protected address range. Any store/STR to this range is silently dropped.
   * Useful for preventing runtime self-modifying code from corrupting patches.
   * @param base - Start address of protected range
   * @param size - Size in bytes
   */
  addWriteProtect(base: number, size: number): void {
    this.writeProtectRegions.push({ base, size });
  }

  /**
   * Clear all write-protected ranges.
   */
  clearWriteProtect(): void {
    this.writeProtectRegions.length = 0;
  }

  /**
   * Check if an address range overlaps any write-protected region.
   */
  private isWriteProtected(address: number, length: number): boolean {
    for (const wp of this.writeProtectRegions) {
      if (address < wp.base + wp.size && wp.base < address + length) {
        return true;
      }
    }
    return false;
  }

  // ── Symbol table ──

  /**
   * Add a symbol to the symbol table.
   * @param name - Symbol name
   * @param vaddr - Virtual address
   */
  addSymbol(name: string, vaddr: number): void {
    this.symbols.set(name, vaddr);
  }

  /**
   * Lookup a symbol by name.
   * @param name - Symbol name
   * @returns Virtual address or undefined if not found
   */
  findSymbol(name: string): number | undefined {
    return this.symbols.get(name);
  }

  /**
   * Check if a symbol exists.
   * @param name - Symbol name
   */
  hasSymbol(name: string): boolean {
    return this.symbols.has(name);
  }

  /**
   * Get all symbol names.
   */
  getSymbolNames(): string[] {
    return [...this.symbols.keys()];
  }

  /**
   * Clear the symbol table.
   */
  clearSymbols(): void {
    this.symbols.clear();
  }

  // ── Diagnostic/Debug ──

  /**
   * Dump a region of memory as a hex string.
   * @param address - Starting address
   * @param length - Number of bytes
   * @returns Hex string (no 0x prefix)
   */
  dumpMemory(address: number, length: number): string {
    const bytes = this.readMemory(address, length);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

// ── Helper functions ──

function regionsOverlap(region: MappedRegion, base: number, size: number): boolean {
  return base < region.base + region.size && region.base < base + size;
}

function insertRegionByBase(sorted: MappedRegion[], region: MappedRegion): void {
  const idx = sorted.findIndex((r) => r.base > region.base);
  if (idx === -1) sorted.push(region);
  else sorted.splice(idx, 0, region);
}

function findRegionByBase(
  sorted: MappedRegion[],
  address: number,
  length: number,
): MappedRegion | undefined {
  let left = 0;
  let right = sorted.length - 1;
  while (left <= right) {
    const mid = (left + right) >>> 1;
    const region = sorted[mid]!;
    if (address >= region.base && address + length <= region.base + region.size) {
      return region;
    }
    if (address < region.base) {
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }
  return undefined;
}
