/**
 * Linux /proc/{pid}/maps anomaly analyzer.
 *
 * `parseProcMaps` (sibling file) already turns the textual maps table into
 * structured `LinuxMemoryRegion[]` consumed by the memory scanner / region
 * enumerator. This module adds the analysis layer that the existing consumers
 * do not compute: it annotates each region with objective file-system /
 * permission facts and surfaces a small set of structural signals commonly
 * associated with code injection, packers, or replaced-on-disk images.
 *
 * Honesty notes (no built-in threat library):
 *   - The flags below are objective facts derived solely from the maps line
 *     (permission bits + whether a pathname backs the region). They are NOT a
 *     verdict. `anonymous-executable` is also produced by legitimate JITs
 *     (V8, OpenJIT, .NET); `writable-executable` by any RWX JIT arena;
 *     `deleted-backing` by a binary upgraded while running. The caller must
 *     interpret the signals in context.
 *   - No path blocklist, hash check, or "known malicious" heuristic is applied.
 *
 * Win32/macOS have no /proc equivalent; the handler returns an explicit
 * unsupported-platform result rather than fabricating data.
 */
import { formatLinuxProtection, type LinuxMemoryRegion } from './mapsParser';

/** A single maps region annotated with objective structural facts. */
export interface MapRegionSignal {
  start: string;
  end: string;
  /** Region size in bytes (derived from end-start; Number is ample for maps ranges). */
  size: number;
  /** Reconstructed permission string, e.g. "rwxp". */
  perms: string;
  offset: string;
  device: string;
  inode: number;
  pathname: string;
  readable: boolean;
  writable: boolean;
  executable: boolean;
  isPrivate: boolean;
  /** No pathname backs the region (anonymous mapping). */
  isAnonymous: boolean;
  /** Pathname ends with the kernel "(deleted)" suffix. */
  isDeletedBacking: boolean;
  /** Writable AND executable (rwx) — RWX page. */
  isWritableExecutable: boolean;
}

/** A region flagged by at least one objective signal, with the matched flags named. */
export interface MapsSignalEntry {
  start: string;
  pathname: string;
  perms: string;
  flags: string[];
}

export interface MapsAnalysis {
  regions: MapRegionSignal[];
  summary: {
    totalRegions: number;
    executable: number;
    anonymous: number;
    anonymousExecutable: number;
    writableExecutable: number;
    deletedBacking: number;
  };
  /** Regions matching ≥1 objective signal. Informational; NOT a threat verdict. */
  signals: MapsSignalEntry[];
  /** Honest framing reminder emitted alongside the signals. */
  note: string;
}

const DELETED_SUFFIX = '(deleted)';

/**
 * Annotate one parsed region with objective structural facts. Pure function.
 */
export function annotateRegion(region: LinuxMemoryRegion): MapRegionSignal {
  const pathname = region.pathname;
  const isAnonymous = pathname.length === 0;
  const isDeletedBacking = pathname.endsWith(DELETED_SUFFIX);
  const { write, exec } = region.permissions;
  return {
    start: `0x${region.start.toString(16)}`,
    end: `0x${region.end.toString(16)}`,
    size: Number(region.end - region.start),
    perms: `${formatLinuxProtection(region.permissions)}${region.permissions.private ? 'p' : 's'}`,
    offset: `0x${region.offset.toString(16)}`,
    device: region.dev,
    inode: region.inode,
    pathname,
    readable: region.permissions.read,
    writable: write,
    executable: exec,
    isPrivate: region.permissions.private,
    isAnonymous,
    isDeletedBacking,
    isWritableExecutable: write && exec,
  };
}

/**
 * Classify a region into objective signal flag names. Returns an empty array
 * for clean regions. Pure function — no I/O, no threat database.
 */
export function classifyRegion(region: MapRegionSignal): string[] {
  const flags: string[] = [];
  if (region.isAnonymous && region.executable) {
    flags.push('anonymous-executable');
  }
  if (region.isWritableExecutable) {
    flags.push('writable-executable');
  }
  if (region.isDeletedBacking) {
    flags.push('deleted-backing');
  }
  return flags;
}

const ANALYSIS_NOTE =
  'Structural facts derived from /proc/{pid}/maps only (permission bits + file backing). ' +
  'Not a threat verdict: anonymous-executable and writable-executable are also produced by ' +
  'legitimate JIT arenas (V8, .NET, OpenJIT); deleted-backing by binaries upgraded while running. ' +
  'Interpret the signals in process context.';

/**
 * Analyze parsed maps regions: annotate each, tally a summary, and collect the
 * objective signals. Pure function — safe to unit test without /proc.
 */
export function analyzeMaps(regions: LinuxMemoryRegion[]): MapsAnalysis {
  const annotated = regions.map(annotateRegion);
  let executable = 0;
  let anonymous = 0;
  let anonymousExecutable = 0;
  let writableExecutable = 0;
  let deletedBacking = 0;
  const signals: MapsSignalEntry[] = [];
  for (const r of annotated) {
    if (r.executable) executable += 1;
    if (r.isAnonymous) anonymous += 1;
    if (r.isAnonymous && r.executable) anonymousExecutable += 1;
    if (r.isWritableExecutable) writableExecutable += 1;
    if (r.isDeletedBacking) deletedBacking += 1;
    const flags = classifyRegion(r);
    if (flags.length > 0) {
      signals.push({ start: r.start, pathname: r.pathname, perms: r.perms, flags });
    }
  }
  return {
    regions: annotated,
    summary: {
      totalRegions: annotated.length,
      executable,
      anonymous,
      anonymousExecutable,
      writableExecutable,
      deletedBacking,
    },
    signals,
    note: ANALYSIS_NOTE,
  };
}
