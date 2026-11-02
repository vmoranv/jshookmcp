/**
 * Pointer Map Persistence — Cheat Engine .PTR parity.
 *
 * CE saves complete pointer maps for cross-instance comparison. This handler
 * provides save/load/compare for pointer chain results in a JSON format
 * (not CE's binary .PTR — pure TS, portable).
 *
 * Files are stored in `<project>/.ptr/` directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argString, argStringArray } from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';

const TOOL_NAME = 'memory_pointer_map';
const PTR_DIR = '.ptr';

/** Schema version — increments when the file format changes. */
const PTR_VERSION = 1;

/** Maximum entries per pointer map file (safety cap). */
const MAX_ENTRIES = 10_000_000;

interface PointerMapEntry {
  /** Hex address string (e.g. "0x7FF612340000") */
  address: string;
  /** Hex value at the address */
  value: string;
  /** Optional module name if known */
  moduleName?: string;
  /** Optional human-readable label */
  label?: string;
}

interface PointerMapFile {
  version: typeof PTR_VERSION;
  createdAt: string;
  /** Target process ID at time of capture */
  pid: number;
  /** The target address these pointer chains resolve to */
  targetAddress: string;
  /** Total entries in this map */
  totalEntries: number;
  /** Pointer chain entries sorted by address */
  entries: PointerMapEntry[];
}

function ptrDirForProject(projectRoot?: string): string {
  const root = projectRoot ?? process.cwd();
  return path.join(root, PTR_DIR);
}

function ensurePtrDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ptrFilePath(ptrDir: string, name: string): string {
  // Sanitize name: replace path separators and traversal chars, then strip
  // leading dots/dashes to prevent hidden files and path traversal.
  let safe = name
    .replace(/[/\\]/g, '_') // path separators → underscore
    .replace(/\.\./g, '__') // double-dot traversal → double underscore
    .replace(/[^a-zA-Z0-9\-_.]/g, '_'); // remaining non-safe chars → underscore
  // Strip leading dashes (option prefix attack) and dots (hidden file)
  safe = safe.replace(/^[.-]+/, '');
  if (safe.length === 0) safe = 'unnamed';
  return path.join(ptrDir, `${safe}.ptr.json`);
}

function isValidPointerMapEntry(e: unknown): e is PointerMapEntry {
  if (!e || typeof e !== 'object') return false;
  const entry = e as Record<string, unknown>;
  return typeof entry.address === 'string' && typeof entry.value === 'string';
}

function isValidPointerMapFile(f: unknown): f is PointerMapFile {
  if (!f || typeof f !== 'object') return false;
  const file = f as Record<string, unknown>;
  return (
    file.version === PTR_VERSION &&
    typeof file.createdAt === 'string' &&
    typeof file.pid === 'number' &&
    typeof file.targetAddress === 'string' &&
    typeof file.totalEntries === 'number' &&
    Array.isArray(file.entries) &&
    file.entries.every(isValidPointerMapEntry)
  );
}

/**
 * Compute the intersection of pointer map entries across multiple maps.
 * Returns entries whose address appears in ALL maps (cross-instance filtering).
 */
function comparePointerMaps(maps: PointerMapFile[]): {
  intersection: PointerMapEntry[];
  perMapCounts: number[];
  totalUnique: number;
} {
  if (maps.length < 2) {
    throw new Error(
      `${TOOL_NAME}: compare requires at least 2 pointer map files, got ${maps.length}`,
    );
  }

  // Build address → entry lookup for each map
  const addressSets: Array<Map<string, PointerMapEntry>> = [];
  for (const map of maps) {
    const addrMap = new Map<string, PointerMapEntry>();
    for (const entry of map.entries) {
      // Normalize address to lowercase for comparison
      const normAddr = entry.address.toLowerCase();
      if (!addrMap.has(normAddr)) {
        addrMap.set(normAddr, entry);
      }
    }
    addressSets.push(addrMap);
  }

  // Find intersection: addresses present in ALL maps
  const [first, ...rest] = addressSets;
  const allUniqueAddresses = new Set<string>();
  for (const addrSet of addressSets) {
    for (const addr of addrSet.keys()) {
      allUniqueAddresses.add(addr);
    }
  }

  const intersection: PointerMapEntry[] = [];
  for (const addr of first!.keys()) {
    if (rest.every((s) => s.has(addr))) {
      intersection.push(first!.get(addr)!);
    }
  }

  // Sort by address for deterministic output
  intersection.sort((a, b) => {
    const addrA = BigInt(a.address.replace(/^0x/i, '0x'));
    const addrB = BigInt(b.address.replace(/^0x/i, '0x'));
    if (addrA < addrB) return -1;
    if (addrA > addrB) return 1;
    return 0;
  });

  return {
    intersection,
    perMapCounts: maps.map((m) => m.totalEntries),
    totalUnique: allUniqueAddresses.size,
  };
}

export class PointerMapHandlers {
  async handlePointerMap(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const action = String(args.action ?? '');
      const projectRoot = argString(args, 'projectRoot');

      switch (action) {
        case 'save':
          return this.handleSave(args, projectRoot);
        case 'load':
          return this.handleLoad(args, projectRoot);
        case 'compare':
          return this.handleCompare(args, projectRoot);
        default:
          throw new Error(
            `${TOOL_NAME}: unknown action "${action}". Expected one of: save, load, compare.`,
          );
      }
    });
  }

  private async handleSave(args: Record<string, unknown>, projectRoot?: string): Promise<unknown> {
    const name = String(args.name ?? '');
    if (!name || name.length === 0) {
      throw new Error(
        `${TOOL_NAME}: action "save" requires a non-empty "name" argument (file name without extension)`,
      );
    }

    const targetAddress = String(args.targetAddress ?? '');
    if (!targetAddress || targetAddress.length === 0) {
      throw new Error(
        `${TOOL_NAME}: action "save" requires a non-empty "targetAddress" argument (hex address)`,
      );
    }

    const pid = Number(args.pid ?? 0);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(
        `${TOOL_NAME}: action "save" requires a valid positive integer "pid", got: ${JSON.stringify(args.pid)}`,
      );
    }

    const rawEntries = args.entries;
    if (!Array.isArray(rawEntries)) {
      throw new Error(
        `${TOOL_NAME}: action "save" requires "entries" to be a non-empty array of {address, value} objects`,
      );
    }

    if (rawEntries.length === 0) {
      throw new Error(`${TOOL_NAME}: action "save" requires "entries" to be a non-empty array`);
    }

    if (rawEntries.length > MAX_ENTRIES) {
      throw new Error(
        `${TOOL_NAME}: entries count ${rawEntries.length} exceeds maximum ${MAX_ENTRIES}. ` +
          `Narrow the scan before saving.`,
      );
    }

    const entries: PointerMapEntry[] = [];
    for (let i = 0; i < rawEntries.length; i += 1) {
      const e = rawEntries[i] as Record<string, unknown> | undefined;
      if (!e || typeof e !== 'object') {
        throw new Error(
          `${TOOL_NAME}: entries[${i}] must be an object with "address" and "value" fields`,
        );
      }
      const address = String(e.address ?? '');
      const value = String(e.value ?? '');
      if (!address || !value) {
        throw new Error(
          `${TOOL_NAME}: entries[${i}] must have non-empty "address" and "value" strings`,
        );
      }
      entries.push({
        address,
        value,
        moduleName: typeof e.moduleName === 'string' ? e.moduleName : undefined,
        label: typeof e.label === 'string' ? e.label : undefined,
      });
    }

    const ptrDir = ptrDirForProject(projectRoot);
    ensurePtrDir(ptrDir);
    const filePath = ptrFilePath(ptrDir, name);

    const mapFile: PointerMapFile = {
      version: PTR_VERSION,
      createdAt: new Date().toISOString(),
      pid,
      targetAddress,
      totalEntries: entries.length,
      entries,
    };

    try {
      fs.writeFileSync(filePath, JSON.stringify(mapFile, null, 2), 'utf-8');
    } catch (err) {
      throw new Error(
        `${TOOL_NAME}: failed to write pointer map file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    logger.info(`Pointer map saved: ${filePath} (${entries.length} entries)`);

    return {
      success: true,
      filePath,
      name,
      totalEntries: entries.length,
      targetAddress,
      pid,
      hint:
        `Pointer map "${name}" saved with ${entries.length} entries to ${filePath}. ` +
        `Use action="load" to reload or action="compare" to cross-reference against another map.`,
    };
  }

  private async handleLoad(args: Record<string, unknown>, projectRoot?: string): Promise<unknown> {
    const name = argString(args, 'name') ?? '';
    const filePath = argString(args, 'filePath');
    let resolvedPath: string;

    if (filePath) {
      resolvedPath = path.resolve(filePath);
    } else if (name.length > 0) {
      const ptrDir = ptrDirForProject(projectRoot);
      resolvedPath = ptrFilePath(ptrDir, name);
    } else {
      throw new Error(
        `${TOOL_NAME}: action "load" requires either "name" (pointer map name) or "filePath" (absolute path)`,
      );
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `${TOOL_NAME}: pointer map file not found: "${resolvedPath}". ` +
          `Use action="save" to create one first.`,
      );
    }

    let raw: string;
    try {
      raw = fs.readFileSync(resolvedPath, 'utf-8');
    } catch (err) {
      throw new Error(
        `${TOOL_NAME}: failed to read pointer map file "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `${TOOL_NAME}: pointer map file "${resolvedPath}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    if (!isValidPointerMapFile(parsed)) {
      throw new Error(
        `${TOOL_NAME}: pointer map file "${resolvedPath}" has an invalid format. ` +
          `Expected PointerMapFile v${PTR_VERSION} with "version", "createdAt", "pid", "targetAddress", "totalEntries", and "entries" array.`,
      );
    }

    return {
      success: true,
      filePath: resolvedPath,
      map: parsed,
      hint: `Loaded pointer map with ${parsed.totalEntries} entries from ${resolvedPath}.`,
    };
  }

  private async handleCompare(
    args: Record<string, unknown>,
    projectRoot?: string,
  ): Promise<unknown> {
    const names = argStringArray(args, 'names');
    const filePaths = argStringArray(args, 'filePaths');

    if ((!names || names.length === 0) && (!filePaths || filePaths.length === 0)) {
      throw new Error(
        `${TOOL_NAME}: action "compare" requires "names" (array of pointer map names) or "filePaths" (array of absolute paths)`,
      );
    }

    const ptrDir = ptrDirForProject(projectRoot);
    const paths: string[] = [];

    if (filePaths && filePaths.length > 0) {
      for (const fp of filePaths) {
        paths.push(path.resolve(fp));
      }
    } else if (names && names.length > 0) {
      for (const name of names) {
        paths.push(ptrFilePath(ptrDir, name));
      }
    }

    if (paths.length < 2) {
      throw new Error(
        `${TOOL_NAME}: compare requires at least 2 pointer map files, got ${paths.length} path(s).`,
      );
    }

    // Verify all files exist before loading
    for (const fp of paths) {
      if (!fs.existsSync(fp)) {
        throw new Error(
          `${TOOL_NAME}: pointer map file not found: "${fp}". All files must exist for comparison.`,
        );
      }
    }

    // Load all maps
    const maps: PointerMapFile[] = [];
    for (const fp of paths) {
      let raw: string;
      try {
        raw = fs.readFileSync(fp, 'utf-8');
      } catch (err) {
        throw new Error(
          `${TOOL_NAME}: failed to read "${fp}": ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(
          `${TOOL_NAME}: "${fp}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      if (!isValidPointerMapFile(parsed)) {
        throw new Error(
          `${TOOL_NAME}: "${fp}" has an invalid format. Expected PointerMapFile v${PTR_VERSION}.`,
        );
      }
      maps.push(parsed);
    }

    const result = comparePointerMaps(maps);
    const intersectionRatio =
      result.totalUnique > 0
        ? ((result.intersection.length / result.totalUnique) * 100).toFixed(1)
        : '0.0';

    return {
      success: true,
      filesCompared: paths.length,
      intersectionCount: result.intersection.length,
      totalUniqueAddresses: result.totalUnique,
      intersectionRatio: `${intersectionRatio}%`,
      perMapCounts: result.perMapCounts,
      intersection: result.intersection,
      hint:
        result.intersection.length > 0
          ? `${result.intersection.length} addresses appear in ALL ${paths.length} maps (${intersectionRatio}% of ${result.totalUnique} unique addresses across maps). These are the most reliable pointer chains.`
          : `No addresses appear in all ${paths.length} maps. Try with more maps or wider pointer chain scans.`,
    };
  }
}
