/**
 * Symbolizer — resolve Flutter/Dart obfuscated identifiers back to their
 * original names using a developer-provided obfuscation map.
 *
 * Flutter's `flutter build apk --obfuscate
 * --extra-gen-snapshot-options=--save-obfuscation-map=obfuscation-map.json`
 * emits a JSON file documenting how Dart symbols were rewritten. The map
 * is shipped *by the developer*, not extracted from the APK — we only
 * consume what the developer chose to retain.
 *
 * This module never recovers names that were dropped. It is a pure
 * read-only lookup:
 *  - input: a JSON file path + a list of obfuscated identifiers
 *  - output: original names (when present) + the unresolved residue
 *
 * Three on-disk shapes are accepted (the Dart toolchain emits the flat
 * array; community tools sometimes re-encode it):
 *  1. **Flat pair array** (Flutter default): `["orig1","obf1","orig2","obf2",…]`
 *  2. **Pairs array**: `[["orig1","obf1"],["orig2","obf2"],…]`
 *  3. **Object map**: `{"obf1":"orig1","obf2":"orig2"}`
 *
 * 100% read-only analysis. No payloads, no exploit code. The map is the
 * developer's choice to preserve; consuming it does not bypass any
 * protection the developer enabled.
 *
 * @see https://docs.flutter.dev/deployment/obfuscate — Flutter obfuscation guide
 */

import { readFile, stat } from 'node:fs/promises';

import { DART_MAX_MAP_BYTES } from '@src/constants';
import { ToolError } from '@errors/ToolError';

/**
 * Default ceiling on obfuscation-map file size — `DART_MAX_MAP_BYTES`
 * from {@link "@src/constants"}, runtime-tunable via the same env var.
 * Real Flutter obfuscation maps are typically a few hundred KB; 16 MiB
 * keeps memory bounded against pathological inputs.
 */
const DEFAULT_MAX_MAP_BYTES = DART_MAX_MAP_BYTES;

export type SymbolizerFormat = 'auto' | 'flat' | 'pairs' | 'object';

/** Resolve direction: obfuscated → original, or original → obfuscated. */
export type SymbolizerMode = 'forward' | 'reverse';

export interface SymbolizeOptions {
  /**
   * Force a specific on-disk format. `'auto'` (default) sniffs the JSON
   * shape and picks the parser; explicit values are useful for malformed
   * inputs whose top-level shape happens to coincide with another format.
   */
  format?: SymbolizerFormat;
  /**
   * Lookup direction. `'forward'` (default) maps obfuscated → original;
   * `'reverse'` maps original → obfuscated. Reverse mode is useful when
   * cross-referencing source code against a stripped binary.
   */
  mode?: SymbolizerMode;
  /** Cap on file size in bytes. Defaults to 16 MB. */
  maxMapBytes?: number;
  /**
   * When set, only the first N obfuscated lookups are attempted. Useful
   * for huge name lists; the rest go to `unresolved`.
   */
  maxLookups?: number;
}

export interface ResolvedSymbol {
  /** The name fed in as input (obfuscated in forward mode, original in reverse). */
  query: string;
  /** The resolved counterpart, if known. */
  resolved: string;
  /** Position in the on-disk map (informational). Always >= 0. */
  index: number;
}

export interface SymbolizeResult {
  /** Successful lookups, ordered to match the input array. */
  resolved: ResolvedSymbol[];
  /** Inputs with no entry in the map. */
  unresolved: string[];
  /** Total distinct keys parsed from the map (forward lookup table size). */
  mapEntries: number;
  /** Direction the lookup was performed in. */
  mode: SymbolizerMode;
  /** Format the parser actually used (auto-detection result). */
  format: Exclude<SymbolizerFormat, 'auto'>;
}

export class Symbolizer {
  /**
   * Resolve a batch of obfuscated names against the map at `mapPath`.
   *
   * Throws {@link ToolError} for:
   *  - `VALIDATION` — empty path, invalid format option, malformed input array
   *  - `NOT_FOUND` — map file missing
   *  - `RUNTIME` — JSON parse failure or unrecognized top-level shape
   *  - `PERMISSION` — file too large (exceeds `maxMapBytes`)
   */
  async resolveNames(
    queries: readonly string[],
    mapPath: string,
    opts: SymbolizeOptions = {},
  ): Promise<SymbolizeResult> {
    if (!mapPath || mapPath.length === 0) {
      throw new ToolError('VALIDATION', 'mapPath must be a non-empty string');
    }
    if (!Array.isArray(queries)) {
      throw new ToolError('VALIDATION', 'queries must be an array of strings');
    }
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      if (typeof q !== 'string') {
        throw new ToolError('VALIDATION', `queries[${i}] must be a string (got ${typeof q})`);
      }
    }
    const format = opts.format ?? 'auto';
    if (format !== 'auto' && format !== 'flat' && format !== 'pairs' && format !== 'object') {
      throw new ToolError(
        'VALIDATION',
        `format must be one of auto|flat|pairs|object (got "${format}")`,
      );
    }
    const mode = opts.mode ?? 'forward';
    if (mode !== 'forward' && mode !== 'reverse') {
      throw new ToolError(
        'VALIDATION',
        `mode must be either "forward" or "reverse" (got "${mode}")`,
      );
    }
    const maxMapBytes = opts.maxMapBytes ?? DEFAULT_MAX_MAP_BYTES;
    if (!Number.isInteger(maxMapBytes) || maxMapBytes <= 0) {
      throw new ToolError(
        'VALIDATION',
        `maxMapBytes must be a positive integer (got ${maxMapBytes})`,
      );
    }
    const maxLookups = opts.maxLookups;
    if (maxLookups !== undefined && (!Number.isInteger(maxLookups) || maxLookups < 0)) {
      throw new ToolError(
        'VALIDATION',
        `maxLookups must be a non-negative integer (got ${maxLookups})`,
      );
    }

    let size: number;
    try {
      size = (await stat(mapPath)).size;
    } catch (cause) {
      throw new ToolError('NOT_FOUND', `Obfuscation map not found: ${mapPath}`, {
        details: { mapPath },
        cause: cause as Error,
      });
    }
    if (size > maxMapBytes) {
      throw new ToolError(
        'PERMISSION',
        `Obfuscation map ${mapPath} is ${size} bytes, exceeds maxMapBytes (${maxMapBytes})`,
        { details: { size, maxMapBytes } },
      );
    }

    const raw = await readFile(mapPath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new ToolError('RUNTIME', `Failed to parse obfuscation map as JSON: ${mapPath}`, {
        details: { mapPath },
        cause: cause as Error,
      });
    }

    const { table, detectedFormat } = buildLookupTable(parsed, format);

    const limit = maxLookups ?? queries.length;
    const resolved: ResolvedSymbol[] = [];
    const unresolved: string[] = [];
    for (let i = 0; i < queries.length; i++) {
      if (i >= limit) {
        // Queries beyond the cap are returned as-is in unresolved so the
        // caller can see exactly which keys were dropped.
        const tail = queries[i];
        if (typeof tail === 'string') unresolved.push(tail);
        continue;
      }
      const q = queries[i] as string;
      const hit = mode === 'forward' ? table.forward.get(q) : table.reverse.get(q);
      if (hit !== undefined) {
        resolved.push({ query: q, resolved: hit.value, index: hit.index });
      } else {
        unresolved.push(q);
      }
    }

    return {
      resolved,
      unresolved,
      mapEntries: table.forward.size,
      mode,
      format: detectedFormat,
    };
  }
}

interface LookupTable {
  /** obfuscated → original */
  forward: Map<string, { value: string; index: number }>;
  /** original → obfuscated */
  reverse: Map<string, { value: string; index: number }>;
}

function buildLookupTable(
  parsed: unknown,
  format: SymbolizerFormat,
): { table: LookupTable; detectedFormat: Exclude<SymbolizerFormat, 'auto'> } {
  const detected = format === 'auto' ? detectFormat(parsed) : format;
  switch (detected) {
    case 'flat':
      return { table: parseFlat(parsed), detectedFormat: 'flat' };
    case 'pairs':
      return { table: parsePairs(parsed), detectedFormat: 'pairs' };
    case 'object':
      return { table: parseObject(parsed), detectedFormat: 'object' };
    default: {
      // Unreachable under TS, but keeps the JSON detector honest at runtime.
      const exhaustive: never = detected;
      throw new ToolError('RUNTIME', `Unknown format: ${String(exhaustive)}`);
    }
  }
}

function detectFormat(parsed: unknown): Exclude<SymbolizerFormat, 'auto'> {
  if (Array.isArray(parsed)) {
    // Empty array — either flat or pairs, doesn't matter; treat as flat.
    if (parsed.length === 0) return 'flat';
    const first = parsed[0];
    if (Array.isArray(first)) return 'pairs';
    if (typeof first === 'string') return 'flat';
    throw new ToolError(
      'RUNTIME',
      `Unrecognized obfuscation map element at index 0: expected string or array, got ${typeof first}`,
    );
  }
  if (parsed !== null && typeof parsed === 'object') {
    return 'object';
  }
  throw new ToolError(
    'RUNTIME',
    `Obfuscation map root must be an array or object (got ${typeof parsed})`,
  );
}

function parseFlat(parsed: unknown): LookupTable {
  if (!Array.isArray(parsed)) {
    throw new ToolError('RUNTIME', 'flat format requires a top-level JSON array');
  }
  if (parsed.length % 2 !== 0) {
    throw new ToolError(
      'RUNTIME',
      `flat obfuscation map has odd length ${parsed.length} (must be pairs)`,
    );
  }
  const forward = new Map<string, { value: string; index: number }>();
  const reverse = new Map<string, { value: string; index: number }>();
  for (let i = 0; i < parsed.length; i += 2) {
    const original = parsed[i];
    const obfuscated = parsed[i + 1];
    if (typeof original !== 'string' || typeof obfuscated !== 'string') {
      throw new ToolError(
        'RUNTIME',
        `flat map entry at index ${i} must be [string,string] (got [${typeof original},${typeof obfuscated}])`,
      );
    }
    const slot = i / 2;
    // Per Flutter source: pairs are [originalName, obfuscatedName].
    forward.set(obfuscated, { value: original, index: slot });
    reverse.set(original, { value: obfuscated, index: slot });
  }
  return { forward, reverse };
}

function parsePairs(parsed: unknown): LookupTable {
  if (!Array.isArray(parsed)) {
    throw new ToolError('RUNTIME', 'pairs format requires a top-level JSON array');
  }
  const forward = new Map<string, { value: string; index: number }>();
  const reverse = new Map<string, { value: string; index: number }>();
  parsed.forEach((entry, slot) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new ToolError(
        'RUNTIME',
        `pairs map entry at index ${slot} must be a 2-tuple (got length ${Array.isArray(entry) ? entry.length : 'n/a'})`,
      );
    }
    const [original, obfuscated] = entry;
    if (typeof original !== 'string' || typeof obfuscated !== 'string') {
      throw new ToolError('RUNTIME', `pairs map entry at index ${slot} must be [string,string]`);
    }
    forward.set(obfuscated, { value: original, index: slot });
    reverse.set(original, { value: obfuscated, index: slot });
  });
  return { forward, reverse };
}

function parseObject(parsed: unknown): LookupTable {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ToolError('RUNTIME', 'object format requires a top-level JSON object');
  }
  const forward = new Map<string, { value: string; index: number }>();
  const reverse = new Map<string, { value: string; index: number }>();
  const entries = Object.entries(parsed as Record<string, unknown>);
  entries.forEach(([obfuscated, original], slot) => {
    if (typeof original !== 'string') {
      throw new ToolError(
        'RUNTIME',
        `object map value for key "${obfuscated}" must be a string (got ${typeof original})`,
      );
    }
    forward.set(obfuscated, { value: original, index: slot });
    reverse.set(original, { value: obfuscated, index: slot });
  });
  return { forward, reverse };
}
