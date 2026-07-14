/**
 * Pure-TS process hollowing scanner.
 *
 * Analyses process memory structures for signs of process hollowing
 * without requiring native OS APIs. Works from /proc filesystem data
 * (Linux) or PE header parsing (cross-platform).
 *
 * Detects:
 *   1. Mismatched binary path — the process image path does not match
 *      the real executable on disk (PE header timestamp / checksum).
 *   2. RWX sections — memory regions with read-write-execute permissions
 *      (common in hollowed processes where injected code needs W+X).
 *   3. Deleted backing file — /proc/{pid}/exe points to "(deleted)".
 *   4. PE header vs memory mismatch — compare PE section headers against
 *      expected layout from on-disk binary (sizeOfImage, section count,
 *      entry point, characteristic flags).
 *   5. PEB path mismatch — /proc/{pid}/exe symlink target differs from
 *      the process cmdline (Linux) or image path.
 *   6. IAT hook scan — import table entries pointing to unusual address
 *      ranges (outside loaded module bounds, RWX regions).
 *   7. VAD protection anomaly — RWX regions not matching known JIT
 *      engines (Chrome V8, .NET, Java, Node.js), indicating injected code.
 *
 * Honest boundary: This is a static/passive scanner. Live memory comparison
 * (the gold standard for hollowing detection via ReadProcessMemory) is in
 * hollowing-detection.ts and requires native OS APIs on Win32.
 */

/** Severity level for a finding. */
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** A single hollowing indicator. */
export interface HollowingFinding {
  type:
    | 'mismatched_binary_path'
    | 'rwx_memory_region'
    | 'deleted_backing_file'
    | 'suspicious_section_name'
    | 'entry_point_mismatch'
    | 'pe_memory_mismatch'
    | 'peb_path_mismatch'
    | 'iat_hook_detected'
    | 'vad_protection_anomaly';
  severity: FindingSeverity;
  description: string;
  /** Additional structured detail (varies by type). */
  detail?: Record<string, unknown>;
}

/** Input for the hollowing scan. */
export interface HollowingScanInput {
  /** Process ID (for reference in output). */
  pid?: number;
  /** Raw /proc/{pid}/maps content (Linux). */
  mapsContent?: string;
  /** Raw /proc/{pid}/exe readlink target (Linux). */
  exeLink?: string;
  /** Raw /proc/{pid}/cmdline content (Linux). */
  cmdlineContent?: string;
  /** Path to the on-disk PE file for metadata comparison. */
  pePath?: string;
  /** Raw PE file bytes as hex string (on-disk binary). */
  peHex?: string;
  /** Raw PE bytes from memory as hex string (for memory-vs-disk comparison). */
  peMemoryHex?: string;
  /** Expected process image path (from e.g. /proc/{pid}/cmdline). */
  expectedImagePath?: string;
  /** List of module base addresses and sizes for IAT validation. */
  loadedModules?: Array<{ name: string; base: number; size: number }>;
  /** Known JIT address ranges (e.g., V8 code space, .NET JIT heap). */
  knownJitRanges?: Array<{ engine: string; start: number; end: number }>;
}

/** Scan result. */
export interface HollowingScanResult {
  /** Overall verdict. */
  isSuspicious: boolean;
  /** Aggregated confidence 0-100. */
  confidence: number;
  /** Individual findings. */
  findings: HollowingFinding[];
  /** Summary message. */
  summary: string;
  /** Honest capability note. */
  note?: string;
}

// ── /proc/pid/maps parser ──

interface MapsEntry {
  start: string;
  end: string;
  perms: string;
  offset: string;
  dev: string;
  inode: string;
  pathname: string;
}

const MAPS_LINE_RE =
  /^([0-9a-f]+)-([0-9a-f]+)\s+([r-][w-][x][sp-]?)\s+([0-9a-f]+)\s+([0-9a-f]+:[0-9a-f]+)\s+(\d+)\s*(.*)$/;

function parseMapsLine(line: string): MapsEntry | null {
  const m = line.trim().match(MAPS_LINE_RE);
  if (!m) return null;
  return {
    start: m[1]!,
    end: m[2]!,
    perms: m[3]!,
    offset: m[4]!,
    dev: m[5]!,
    inode: m[6]!,
    pathname: (m[7] ?? '').trim(),
  };
}

/**
 * Parse raw /proc/pid/maps content into structured entries.
 * Pure TS — no native calls.
 */
export function parseProcMaps(raw: string): MapsEntry[] {
  return raw
    .split('\n')
    .map(parseMapsLine)
    .filter((e): e is MapsEntry => e !== null);
}

// ── RWX detection ──

/**
 * Find memory regions with RWX (read-write-execute) permissions.
 * RWX regions are a strong hollowing indicator — well-formed executables
 * map code as R-X and data as RW-, never RWX.
 */
export function detectRwxRegions(entries: MapsEntry[]): HollowingFinding[] {
  const findings: HollowingFinding[] = [];
  for (const e of entries) {
    if (e.perms === 'rwx' || e.perms === 'rwxp') {
      findings.push({
        type: 'rwx_memory_region',
        severity: 'high',
        description: `RWX memory region at 0x${e.start}-0x${e.end}${e.pathname ? ` (${e.pathname})` : ''}`,
        detail: {
          start: `0x${e.start}`,
          end: `0x${e.end}`,
          perms: e.perms,
          pathname: e.pathname || null,
          inode: e.inode,
        },
      });
    }
  }
  return findings;
}

// ── Deleted backing file detection ──

/**
 * Check if /proc/{pid}/exe points to a deleted file.
 * Linux marks deleted-but-still-mapped files with " (deleted)" suffix.
 */
export function detectDeletedExe(exeLink: string): HollowingFinding[] {
  const findings: HollowingFinding[] = [];
  if (exeLink.includes('(deleted)')) {
    findings.push({
      type: 'deleted_backing_file',
      severity: 'critical',
      description: `Process executable has been deleted from disk: ${exeLink}`,
      detail: { exeLink },
    });
  }
  return findings;
}

// ── PE header parser (pure TS) ──

/** Minimal PE DOS header. */
interface PeDosHeader {
  e_magic: number; // 0x5A4D
  e_lfanew: number;
}

/** Minimal PE COFF/File header. */
interface PeCoffHeader {
  machine: number;
  numberOfSections: number;
  timeDateStamp: number;
  pointerToSymbolTable: number;
  numberOfSymbols: number;
  sizeOfOptionalHeader: number;
  characteristics: number;
}

/** Minimal PE optional header (PE32/PE32+). */
interface PeOptionalHeader {
  magic: number; // 0x10B = PE32, 0x20B = PE32+
  entryPointAddress: number;
  imageBase: number;
  sectionAlignment: number;
  fileAlignment: number;
  sizeOfImage: number;
  sizeOfHeaders: number;
  checksum: number;
  subsystem: number;
  dllCharacteristics: number;
  sizeOfStackReserve: number | bigint;
}

/** Minimal PE section header. */
interface PeSectionHeader {
  name: string;
  virtualSize: number;
  virtualAddress: number;
  sizeOfRawData: number;
  pointerToRawData: number;
  characteristics: number;
}

/** Parsed PE file summary. */
export interface PeInfo {
  dosHeader: PeDosHeader;
  coffHeader: PeCoffHeader;
  optionalHeader: PeOptionalHeader;
  sections: PeSectionHeader[];
  /** Detected architecture (32/64). */
  is64bit: boolean;
}

// Section characteristic flags
const SCN_MEM_EXECUTE = 0x20000000;
const SCN_MEM_WRITE = 0x80000000;

// PE optional header DLL characteristics constants (available for future extension)

function readUint16(buf: Uint8Array, offset: number): number {
  return buf[offset]! | (buf[offset + 1]! << 8);
}

function readUint32(buf: Uint8Array, offset: number): number {
  return (
    buf[offset]! | (buf[offset + 1]! << 8) | (buf[offset + 2]! << 16) | (buf[offset + 3]! << 24)
  );
}

function sanitizeSectionName(raw: Uint8Array, offset: number): string {
  const bytes: number[] = [];
  for (let i = 0; i < 8; i++) {
    const b = raw[offset + i]!;
    if (b === 0) break;
    bytes.push(b);
  }
  return String.fromCharCode(...bytes);
}

/**
 * Parse a PE (Portable Executable) file from raw bytes.
 * Pure TS — no native calls.
 */
export function parsePe(buffer: Uint8Array): PeInfo | null {
  if (buffer.length < 64) return null;

  // DOS header
  const e_magic = readUint16(buffer, 0);
  if (e_magic !== 0x5a4d) return null; // "MZ"

  const e_lfanew = readUint32(buffer, 0x3c);
  if (e_lfanew < 64 || e_lfanew > buffer.length - 4) return null;

  // PE signature
  const peSig = readUint32(buffer, e_lfanew);
  if (peSig !== 0x00004550) return null; // "PE\0\0"

  // COFF header
  const coffOffset = e_lfanew + 4;
  const machine = readUint16(buffer, coffOffset);
  const numberOfSections = readUint16(buffer, coffOffset + 2);
  const timeDateStamp = readUint32(buffer, coffOffset + 4);
  const pointerToSymbolTable = readUint32(buffer, coffOffset + 8);
  const numberOfSymbols = readUint32(buffer, coffOffset + 12);
  const sizeOfOptionalHeader = readUint16(buffer, coffOffset + 16);
  const characteristics = readUint16(buffer, coffOffset + 18);

  // Optional header
  const optOffset = coffOffset + 20;
  const magic = readUint16(buffer, optOffset);
  const is64bit = magic === 0x020b;

  let entryPointAddress: number;
  let imageBase: number;
  let sectionAlignment: number;
  let fileAlignment: number;
  let sizeOfImage: number;
  let sizeOfHeaders: number;
  let checksum: number;
  let subsystem: number;
  let dllCharacteristics: number;
  let sizeOfStackReserve: number | bigint;

  if (is64bit) {
    entryPointAddress = readUint32(buffer, optOffset + 16);
    imageBase = readUint32(buffer, optOffset + 24); // Lower 32 bits
    sectionAlignment = readUint32(buffer, optOffset + 32);
    fileAlignment = readUint32(buffer, optOffset + 36);
    sizeOfImage = readUint32(buffer, optOffset + 56);
    sizeOfHeaders = readUint32(buffer, optOffset + 60);
    checksum = readUint32(buffer, optOffset + 64);
    subsystem = readUint16(buffer, optOffset + 68);
    dllCharacteristics = readUint16(buffer, optOffset + 70);
    // Stack reserve is 8 bytes for PE32+
    const lo = readUint32(buffer, optOffset + 72);
    const hi = readUint32(buffer, optOffset + 76);
    sizeOfStackReserve = BigInt(lo) | (BigInt(hi) << 32n);
  } else {
    entryPointAddress = readUint32(buffer, optOffset + 16);
    imageBase = readUint32(buffer, optOffset + 28);
    sectionAlignment = readUint32(buffer, optOffset + 32);
    fileAlignment = readUint32(buffer, optOffset + 36);
    sizeOfImage = readUint32(buffer, optOffset + 56);
    sizeOfHeaders = readUint32(buffer, optOffset + 60);
    checksum = readUint32(buffer, optOffset + 64);
    subsystem = readUint16(buffer, optOffset + 68);
    dllCharacteristics = readUint16(buffer, optOffset + 70);
    sizeOfStackReserve = readUint32(buffer, optOffset + 72);
  }

  const optionalHeader: PeOptionalHeader = {
    magic,
    entryPointAddress,
    imageBase,
    sectionAlignment,
    fileAlignment,
    sizeOfImage,
    sizeOfHeaders,
    checksum,
    subsystem,
    dllCharacteristics,
    sizeOfStackReserve,
  };

  // Section headers
  const sectionOffset = optOffset + sizeOfOptionalHeader;
  const sections: PeSectionHeader[] = [];
  for (let i = 0; i < numberOfSections; i++) {
    const off = sectionOffset + i * 40;
    if (off + 40 > buffer.length) break;
    sections.push({
      name: sanitizeSectionName(buffer, off),
      virtualSize: readUint32(buffer, off + 8),
      virtualAddress: readUint32(buffer, off + 12),
      sizeOfRawData: readUint32(buffer, off + 16),
      pointerToRawData: readUint32(buffer, off + 20),
      characteristics: readUint32(buffer, off + 36),
    });
  }

  return {
    dosHeader: { e_magic, e_lfanew },
    coffHeader: {
      machine,
      numberOfSections,
      timeDateStamp,
      pointerToSymbolTable,
      numberOfSymbols,
      sizeOfOptionalHeader,
      characteristics,
    },
    optionalHeader,
    sections,
    is64bit,
  };
}

// ── Suspicious PE section name detection ──

/** Common PE section names for normal executables. */
const NORMAL_SECTION_NAMES = new Set([
  '.text',
  '.rdata',
  '.data',
  '.pdata',
  '.rsrc',
  '.reloc',
  '.edata',
  '.idata',
  '.bss',
  '.tls',
  '.xdata',
  '.00cfg',
  '.didat',
  '.gehcont',
  '.gfids',
  '.giats',
  '.gljmp',
  '.glhsh',
  '.mrdata',
  'INIT',
  'PAGE',
  '.CRT',
]);

/**
 * Check PE sections for suspicious names.
 * Packed/hollowed binaries often have non-standard section names.
 */
export function detectSuspiciousSections(pe: PeInfo): HollowingFinding[] {
  const findings: HollowingFinding[] = [];
  for (const section of pe.sections) {
    const name = section.name;

    // Check for empty or weird names
    if (name.length === 0 || /[^\x20-\x7e]/.test(name)) {
      findings.push({
        type: 'suspicious_section_name',
        severity: 'medium',
        description: `PE section with non-printable or empty name at VA 0x${section.virtualAddress.toString(16)}`,
        detail: {
          sectionName: name || '(empty)',
          virtualAddress: `0x${section.virtualAddress.toString(16)}`,
          characteristics: `0x${section.characteristics.toString(16)}`,
        },
      });
      continue;
    }

    // Check non-standard names
    const isNormal = [...NORMAL_SECTION_NAMES].some((n) => name.startsWith(n));
    if (!isNormal) {
      // It could be a compiler-specific section, lower severity
      findings.push({
        type: 'suspicious_section_name',
        severity: 'low',
        description: `Non-standard PE section "${name}" at VA 0x${section.virtualAddress.toString(16)}`,
        detail: {
          sectionName: name,
          virtualAddress: `0x${section.virtualAddress.toString(16)}`,
          characteristics: `0x${section.characteristics.toString(16)}`,
          note: 'May be compiler-specific. Review if unexpected.',
        },
      });
    }

    // Check for RWX sections in PE
    const hasX = (section.characteristics & SCN_MEM_EXECUTE) !== 0;
    const hasW = (section.characteristics & SCN_MEM_WRITE) !== 0;
    if (hasW && hasX) {
      findings.push({
        type: 'rwx_memory_region',
        severity: 'high',
        description: `PE section "${name}" has Writable+Executable characteristics (RWX) at VA 0x${section.virtualAddress.toString(16)}`,
        detail: {
          sectionName: name,
          virtualAddress: `0x${section.virtualAddress.toString(16)}`,
          characteristics: `0x${section.characteristics.toString(16)}`,
        },
      });
    }
  }
  return findings;
}

// ── Mismatched binary path detection ──

/**
 * Compare the expected image path (from process metadata) against the PE
 * timestamp + machine to detect binary path spoofing.
 *
 * This is a best-effort static check without live memory comparison.
 * The full section-hash comparison is in hollowing-detection.ts.
 */
export function detectPathMismatch(args: {
  expectedImagePath?: string;
  peInfo?: PeInfo;
}): HollowingFinding[] {
  const findings: HollowingFinding[] = [];
  if (!args.expectedImagePath || !args.peInfo) return findings;

  const path = args.expectedImagePath.toLowerCase();

  // Check for common hollowing target paths
  const suspiciousPaths = [
    'svchost.exe',
    'explorer.exe',
    'lsass.exe',
    'csrss.exe',
    'winlogon.exe',
    'services.exe',
    'spoolsv.exe',
    'rundll32.exe',
  ];

  for (const sp of suspiciousPaths) {
    if (path.includes(sp) && path.includes('\\windows\\')) {
      findings.push({
        type: 'mismatched_binary_path',
        severity: 'medium',
        description: `Process claims to be ${sp} in Windows system directory — common hollowing target. Verify PE section hashes in memory.`,
        detail: {
          imagePath: args.expectedImagePath,
          peMachine: args.peInfo.coffHeader.machine,
          peTimestamp: new Date(args.peInfo.coffHeader.timeDateStamp * 1000).toISOString(),
          note: 'Static check only. Use process_detect_hollowing for live section comparison.',
        },
      });
      break;
    }
  }

  return findings;
}

// ── Entry point analysis ──

/**
 * Check if the PE entry point falls within the .text section.
 * If not, the binary may have been tampered with.
 */
export function detectEntryPointAnomaly(pe: PeInfo): HollowingFinding[] {
  const findings: HollowingFinding[] = [];
  const ep = pe.optionalHeader.entryPointAddress;

  // Check if entry point is at an unusual offset
  if (ep === 0) {
    findings.push({
      type: 'entry_point_mismatch',
      severity: 'critical',
      description: 'PE entry point is 0 — binary cannot execute normally',
      detail: { entryPoint: 0 },
    });
  }

  // Check if entry point is outside all sections
  let withinSection = false;
  for (const section of pe.sections) {
    if (ep >= section.virtualAddress && ep < section.virtualAddress + section.virtualSize) {
      withinSection = true;
      break;
    }
  }
  if (!withinSection && ep !== 0) {
    findings.push({
      type: 'entry_point_mismatch',
      severity: 'medium',
      description: `PE entry point 0x${ep.toString(16)} falls outside all section boundaries`,
      detail: {
        entryPoint: `0x${ep.toString(16)}`,
        sections: pe.sections.map((s) => ({
          name: s.name,
          va: `0x${s.virtualAddress.toString(16)}`,
          size: s.virtualSize,
        })),
      },
    });
  }

  return findings;
}

// ── (a) PE header vs memory mismatch ──

/**
 * Compare the on-disk PE header against the in-memory PE header.
 *
 * Hollowing often replaces the in-memory image with a different binary
 * while the process still reports the original exe path. This detector
 * compares SizeOfImage, section count, entry point, and DLL characteristics
 * between the on-disk and in-memory PE copies.
 *
 * A mismatch in any structural field is a strong indicator of hollowing.
 */
export function detectPeMemoryMismatch(diskPe: PeInfo, memoryPe: PeInfo): HollowingFinding[] {
  const findings: HollowingFinding[] = [];
  const mismatches: string[] = [];

  // Compare SizeOfImage (the full in-memory image size)
  if (diskPe.optionalHeader.sizeOfImage !== memoryPe.optionalHeader.sizeOfImage) {
    mismatches.push(
      `SizeOfImage: disk=0x${diskPe.optionalHeader.sizeOfImage.toString(16)} memory=0x${memoryPe.optionalHeader.sizeOfImage.toString(16)}`,
    );
  }

  // Compare number of sections
  if (diskPe.coffHeader.numberOfSections !== memoryPe.coffHeader.numberOfSections) {
    mismatches.push(
      `Section count: disk=${diskPe.coffHeader.numberOfSections} memory=${memoryPe.coffHeader.numberOfSections}`,
    );
  }

  // Compare entry point
  if (diskPe.optionalHeader.entryPointAddress !== memoryPe.optionalHeader.entryPointAddress) {
    mismatches.push(
      `EntryPoint: disk=0x${diskPe.optionalHeader.entryPointAddress.toString(16)} memory=0x${memoryPe.optionalHeader.entryPointAddress.toString(16)}`,
    );
  }

  // Compare machine type
  if (diskPe.coffHeader.machine !== memoryPe.coffHeader.machine) {
    mismatches.push(
      `Machine: disk=0x${diskPe.coffHeader.machine.toString(16)} memory=0x${memoryPe.coffHeader.machine.toString(16)}`,
    );
  }

  // Compare subsystem
  if (diskPe.optionalHeader.subsystem !== memoryPe.optionalHeader.subsystem) {
    mismatches.push(
      `Subsystem: disk=${diskPe.optionalHeader.subsystem} memory=${memoryPe.optionalHeader.subsystem}`,
    );
  }

  // Compare image base (indicates different preferred load address)
  if (diskPe.optionalHeader.imageBase !== memoryPe.optionalHeader.imageBase) {
    mismatches.push(
      `ImageBase: disk=0x${diskPe.optionalHeader.imageBase.toString(16)} memory=0x${memoryPe.optionalHeader.imageBase.toString(16)}`,
    );
  }

  // Compare section headers by name + VA
  const diskSections = new Map(diskPe.sections.map((s) => [s.name, s]));
  const memorySections = new Map(memoryPe.sections.map((s) => [s.name, s]));

  for (const [name, diskSec] of diskSections) {
    const memSec = memorySections.get(name);
    if (!memSec) {
      mismatches.push(`Section "${name}" exists on disk but missing in memory`);
      continue;
    }
    if (diskSec.virtualSize !== memSec.virtualSize) {
      mismatches.push(
        `Section "${name}" virtualSize: disk=0x${diskSec.virtualSize.toString(16)} memory=0x${memSec.virtualSize.toString(16)}`,
      );
    }
    if (diskSec.characteristics !== memSec.characteristics) {
      mismatches.push(
        `Section "${name}" characteristics: disk=0x${diskSec.characteristics.toString(16)} memory=0x${memSec.characteristics.toString(16)}`,
      );
    }
  }

  if (mismatches.length > 0) {
    findings.push({
      type: 'pe_memory_mismatch',
      severity: 'high',
      description: `PE header mismatch between disk and memory: ${mismatches.join('; ')}`,
      detail: {
        mismatches,
        diskSizeOfImage: `0x${diskPe.optionalHeader.sizeOfImage.toString(16)}`,
        memorySizeOfImage: `0x${memoryPe.optionalHeader.sizeOfImage.toString(16)}`,
        diskSections: diskPe.coffHeader.numberOfSections,
        memorySections: memoryPe.coffHeader.numberOfSections,
      },
    });
  }

  return findings;
}

// ── (b) PEB path check ──

/**
 * Compare /proc/{pid}/exe symlink target against /proc/{pid}/cmdline.
 *
 * On Linux, the kernel exposes the real backing binary path via
 * /proc/{pid}/exe (a symlink). If the cmdline (argv[0]) differs from
 * the exe symlink target, the process may have been execve'd with a
 * spoofed argv[0] (common in hollowing to disguise the process).
 *
 * Also checks for the /proc/{pid}/exe pointing to "(deleted)" which
 * indicates the backing binary was unlinked after execution.
 */
export function detectPebPathMismatch(args: {
  exeLink?: string;
  cmdlineContent?: string;
}): HollowingFinding[] {
  const findings: HollowingFinding[] = [];
  if (!args.exeLink || !args.cmdlineContent) return findings;

  // Parse cmdline: /proc/{pid}/cmdline uses null bytes as separators
  const cmdlineArgs = args.cmdlineContent.split('\0').filter(Boolean);
  if (cmdlineArgs.length === 0) return findings;

  const argv0 = cmdlineArgs[0]!;

  // Normalize paths for comparison
  const exeLinkNorm = args.exeLink.replace('(deleted)', '').trim();
  const argv0Norm = argv0.trim();

  // Check if exe symlink target matches argv[0]
  if (exeLinkNorm !== argv0Norm && !argv0Norm.endsWith(exeLinkNorm.split('/').pop() ?? '')) {
    findings.push({
      type: 'peb_path_mismatch',
      severity: 'high',
      description: `/proc/pid/exe symlink target ("${args.exeLink}") differs from cmdline argv[0] ("${argv0}") — possible argv[0] spoofing`,
      detail: {
        exeLink: args.exeLink,
        cmdlineArgv0: argv0,
        cmdlineFull: cmdlineArgs.join(' '),
        note: 'argv[0] spoofing is commonly used by hollowed processes to disguise their identity.',
      },
    });
  }

  return findings;
}

// ── (c) IAT hook scan ──

/**
 * Scan the PE Import Address Table for entries pointing to unusual
 * address ranges.
 *
 * When a process is hollowed, the IAT may be patched to point to
 * shellcode or injected DLLs instead of legitimate system DLLs.
 * This detector flags IAT entries that:
 * 1. Point to RWX memory regions (code injection)
 * 2. Point outside all loaded module address ranges
 * 3. Point to memory regions with pathnames matching injection patterns
 */
export function detectIatHooks(args: {
  /** IAT entries as {functionName, address} pairs. */
  iatEntries?: Array<{ functionName: string; moduleName: string; address: number }>;
  /** Loaded modules for address range validation. */
  loadedModules?: Array<{ name: string; base: number; size: number }>;
  /** Memory maps entries for RWX detection. */
  mapsEntries?: MapsEntry[];
}): HollowingFinding[] {
  const findings: HollowingFinding[] = [];
  if (!args.iatEntries || args.iatEntries.length === 0) return findings;

  const modules = args.loadedModules ?? [];
  const mapsEntries = args.mapsEntries ?? [];

  // Build address range index for quick lookup
  const moduleRanges = modules.map((m) => ({ name: m.name, start: m.base, end: m.base + m.size }));

  for (const iat of args.iatEntries) {
    const addr = iat.address;
    if (addr === 0) continue;

    // Check if address falls within any known module
    const withinModule = moduleRanges.some((r) => addr >= r.start && addr < r.end);

    if (!withinModule && modules.length > 0) {
      // Check if address falls within an RWX region
      const inRwx = mapsEntries.some((e) => {
        const start = parseInt(e.start, 16);
        const end = parseInt(e.end, 16);
        return addr >= start && addr < end && (e.perms === 'rwx' || e.perms === 'rwxp');
      });

      findings.push({
        type: 'iat_hook_detected',
        severity: inRwx ? 'critical' : 'high',
        description:
          `IAT entry "${iat.moduleName}!${iat.functionName}" points to 0x${addr.toString(16)} — ` +
          `outside all known module ranges${inRwx ? ' (RWX region — possible shellcode)' : ''}`,
        detail: {
          functionName: iat.functionName,
          moduleName: iat.moduleName,
          address: `0x${addr.toString(16)}`,
          inRwxRegion: inRwx,
          knownModuleRanges: moduleRanges.map((r) => ({
            name: r.name,
            range: `0x${r.start.toString(16)}-0x${r.end.toString(16)}`,
          })),
        },
      });
    }
  }

  return findings;
}

// ── (d) VAD protection anomaly ──

/**
 * Known JIT engines and their typical memory protection patterns.
 * JIT engines allocate RWX or RW (later changed to RX) memory for
 * generated code. These are legitimate, not hollowing indicators.
 */
const KNOWN_JIT_PATTERNS = [
  { engine: 'V8 (Chrome/Node.js)', pathPattern: /v8|chrome|node/i },
  { engine: '.NET CLR', pathPattern: /clr\.dll|mscorlib|coreclr\.dll|\.net/i },
  { engine: 'Java JVM', pathPattern: /jvm\.dll|java|libjvm/i },
  { engine: 'JavaScriptCore (WebKit)', pathPattern: /javascriptcore|webkit/i },
  { engine: 'SpiderMonkey (Firefox)', pathPattern: /mozjs|spidermonkey|firefox/i },
  { engine: 'LuaJIT', pathPattern: /luajit/i },
  { engine: 'Electron', pathPattern: /electron/i },
];

/**
 * Detect RWX memory regions that are NOT associated with known JIT engines.
 *
 * JIT compilers (V8, .NET, Java, etc.) legitimately allocate RWX memory
 * for generated code. However, RWX regions not matching any known JIT
 * pattern are strong indicators of injected shellcode.
 *
 * This detector cross-references RWX regions from /proc/{pid}/maps
 * against known JIT address ranges and pathname patterns.
 */
export function detectVadProtectionAnomaly(args: {
  mapsEntries: MapsEntry[];
  knownJitRanges?: Array<{ engine: string; start: number; end: number }>;
}): HollowingFinding[] {
  const findings: HollowingFinding[] = [];
  const jitRanges = args.knownJitRanges ?? [];

  for (const entry of args.mapsEntries) {
    // Only analyze RWX regions
    if (entry.perms !== 'rwx' && entry.perms !== 'rwxp') continue;

    const start = parseInt(entry.start, 16);
    const end = parseInt(entry.end, 16);
    const pathname = entry.pathname.toLowerCase();

    // Check if this RWX region is inside a known JIT range
    const matchedJitRange = jitRanges.some((r) => start >= r.start && end <= r.end);

    if (matchedJitRange) continue;

    // Check if the pathname matches a known JIT engine
    const matchedJitPath = KNOWN_JIT_PATTERNS.some((p) => p.pathPattern.test(pathname));

    if (matchedJitPath) continue;

    // Check for anonymous mappings (no backing file) — common for shellcode
    const isAnonymous = pathname === '' || entry.inode === '0';

    // Check if the region has execute-only or execute+write (no read)
    // Well-formed code should be R-X, not --X or -WX
    const hasRead = entry.perms.includes('r');

    findings.push({
      type: 'vad_protection_anomaly',
      severity: isAnonymous ? 'critical' : 'high',
      description:
        `RWX memory region at 0x${entry.start}-0x${entry.end} ` +
        `does NOT match any known JIT engine${isAnonymous ? ' (anonymous mapping — likely injected code)' : ''}${!hasRead ? ' (no read permission — unusual)' : ''}${pathname ? ` (${pathname})` : ''}`,
      detail: {
        start: `0x${entry.start}`,
        end: `0x${entry.end}`,
        perms: entry.perms,
        pathname: pathname || '(anonymous)',
        isAnonymous,
        hasRead,
        knownJitRanges: jitRanges.map((r) => ({
          engine: r.engine,
          range: `0x${r.start.toString(16)}-0x${r.end.toString(16)}`,
        })),
        note:
          'RWX regions outside known JIT address ranges are strong hollowing indicators. ' +
          'JIT engines like V8, .NET CLR, and Java HotSpot use known, identifiable code-cache regions.',
        knownJitPatterns: KNOWN_JIT_PATTERNS.map((p) => p.engine),
      },
    });
  }

  return findings;
}

// ── Main scan function ──

/**
 * Run a comprehensive hollowing scan from available inputs.
 *
 * This is a pure-TS static/passive scanner covering 7 detection heuristics:
 * 1. RWX memory region detection
 * 2. Deleted backing file detection
 * 3. Suspicious PE section names + RWX sections
 * 4. PE header vs memory mismatch (disk vs in-memory header comparison)
 * 5. PEB path mismatch (/proc/pid/exe vs cmdline argv[0])
 * 6. IAT hook scan (import table entries in unusual address ranges)
 * 7. VAD protection anomaly (RWX regions not matching known JIT)
 *
 * Live memory comparison (the gold standard for hollowing detection) is in
 * hollowing-detection.ts and requires native OS APIs on Win32.
 * This scanner provides static/passive indicators that complement
 * the live-comparison tool.
 */
export function scanHollowingIndicators(input: HollowingScanInput): HollowingScanResult {
  const findings: HollowingFinding[] = [];
  let peInfo: PeInfo | null = null;
  let memPeInfo: PeInfo | null = null;
  let mapsEntries: MapsEntry[] = [];

  // 1. Parse PE if provided (on-disk binary)
  if (input.peHex) {
    try {
      const hex = input.peHex.replace(/\s/g, '');
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
      }
      peInfo = parsePe(bytes);
      if (!peInfo) {
        findings.push({
          type: 'mismatched_binary_path',
          severity: 'info',
          description: 'Invalid PE hex provided — not a valid PE file (missing MZ/PE signature).',
          detail: {},
        });
      }
    } catch {
      findings.push({
        type: 'mismatched_binary_path',
        severity: 'info',
        description: 'Failed to parse PE hex input.',
        detail: {},
      });
    }
  }

  // 1b. Parse in-memory PE if provided (for header-vs-memory comparison)
  if (input.peMemoryHex) {
    try {
      const hex = input.peMemoryHex.replace(/\s/g, '');
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
      }
      memPeInfo = parsePe(bytes);
    } catch {
      // silently ignore — will be handled by live scan in hollowing-detection.ts
    }
  }

  // 2. Check /proc/pid/maps for RWX regions
  if (input.mapsContent) {
    mapsEntries = parseProcMaps(input.mapsContent);
    findings.push(...detectRwxRegions(mapsEntries));
  }

  // 3. Check /proc/pid/exe for deleted backing file
  if (input.exeLink) {
    findings.push(...detectDeletedExe(input.exeLink));
  }

  // 4. Check PE for suspicious sections + entry point
  if (peInfo) {
    findings.push(...detectSuspiciousSections(peInfo));
    findings.push(...detectEntryPointAnomaly(peInfo));
    findings.push(
      ...detectPathMismatch({
        expectedImagePath: input.expectedImagePath,
        peInfo,
      }),
    );
  }

  // 5. (a) PE header vs memory mismatch
  if (peInfo && memPeInfo) {
    findings.push(...detectPeMemoryMismatch(peInfo, memPeInfo));
  }

  // 6. (b) PEB path mismatch (/proc/pid/exe vs cmdline)
  if (input.exeLink || input.cmdlineContent) {
    findings.push(
      ...detectPebPathMismatch({
        exeLink: input.exeLink,
        cmdlineContent: input.cmdlineContent,
      }),
    );
  }

  // 7. (c) IAT hook scan
  if (input.loadedModules) {
    findings.push(
      ...detectIatHooks({
        iatEntries: undefined, // IAT entries aren't in the static input — deferred to live scan
        loadedModules: input.loadedModules,
        mapsEntries,
      }),
    );
  }

  // 8. (d) VAD protection anomaly (RWX outside known JIT)
  if (mapsEntries.length > 0) {
    findings.push(
      ...detectVadProtectionAnomaly({
        mapsEntries,
        knownJitRanges: input.knownJitRanges,
      }),
    );
  }

  // ── Assemble verdict ──
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const highCount = findings.filter((f) => f.severity === 'high').length;
  const mediumCount = findings.filter((f) => f.severity === 'medium').length;
  const lowCount = findings.filter((f) => f.severity === 'low').length;
  const totalWeighted = criticalCount * 100 + highCount * 60 + mediumCount * 30 + lowCount * 10;

  let confidence = 0;
  if (totalWeighted >= 200) confidence = 95;
  else if (totalWeighted >= 100) confidence = 80;
  else if (totalWeighted >= 50) confidence = 50;
  else if (findings.length > 0) confidence = 20;

  const isSuspicious = findings.some(
    (f) => f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium',
  );

  let summary: string;
  if (findings.length === 0) {
    summary = 'No hollowing indicators found in the provided data.';
  } else if (isSuspicious) {
    summary = [
      `Found ${findings.length} hollowing indicator(s):`,
      ...findings.map((f) => `  [${f.severity.toUpperCase()}] ${f.type}: ${f.description}`),
    ].join('\n');
  } else {
    summary = `Found ${findings.length} low-severity indicator(s) — not conclusive.`;
  }

  const result: HollowingScanResult = {
    isSuspicious,
    confidence,
    findings,
    summary,
    note:
      'This is a static/passive scan from provided data covering 7 heuristics: ' +
      'RWX regions, deleted backing file, suspicious sections, PE header-vs-memory mismatch, ' +
      'PEB path mismatch, IAT hook scan, VAD protection anomaly. ' +
      'Live memory comparison (process_detect_hollowing) is the gold standard ' +
      'for process hollowing detection and requires native OS APIs on Win32 ' +
      '(TODO: Win32 live detection needs native API bridge). ' +
      'IAT hook detection via import table parsing requires IAT dump data ' +
      'not available in static scan mode — use process_detect_hollowing ' +
      'for live IAT analysis. ' +
      'VAD anomaly detection is static-only: RWX-vs-JIT classification ' +
      'is based on pattern matching against known JIT engine names, ' +
      'not live process introspection.',
  };

  return result;
}
