/**
 * Built-in snapshot hash → version lookup table.
 *
 * This table is intentionally sparse: the public domain projects that
 * publish hash↔release mappings (Phrack #71, reFlutter `enginehash.csv`,
 * `darter/info/versions.md`) own that data, and copying their entries
 * verbatim into this repo would (a) ship third-party tables we cannot
 * keep current and (b) create stale-data foot-guns when the upstream
 * projects revise their mappings.
 *
 * Instead, this file ships a **structural placeholder seed**: a small
 * set of synthetic-but-shape-correct rows covering Dart SDK 2.x → 3.6+
 * so the lookup pipeline, JSON merge path, and tests have something to
 * exercise. Real entries should be contributed via `DART_SNAPSHOT_TABLE_PATH`
 * (JSON file at runtime) or by adding rows to this table once the
 * provenance is recorded in a comment.
 *
 * **Hash values below are intentionally synthetic** (32-byte hex digests
 * generated for test fixtures). Do not ship them as authoritative
 * version pins.
 *
 * References (read-only, no data vendored):
 *  - Phrack #71 — Reversing Dart AOT Snapshots
 *  - reFlutter `enginehash.csv`
 *  - darter `info/versions.md`
 *  - nfalliere snapshot-hash gist
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ToolError } from '@errors/ToolError';
import { DART_SNAPSHOT_TABLE_PATH } from '@src/constants';

import type { VersionEntry } from './snapshot-types';

/**
 * Synthetic seed entries. The 64-char hex hashes are placeholders chosen
 * so the table has structural coverage from Dart 2.10 through 3.6+; they
 * are not real release pins. Replace via custom table or PR.
 */
const SEED_ENTRIES: ReadonlyArray<readonly [string, VersionEntry]> = [
  [
    '0000000000000000000000000000000000000000000000000000000000000001',
    {
      flutterVersion: '2.0.0',
      engineCommit: 'placeholder-engine-2-0-0',
      dartSdkRev: '2.12.0',
      releaseDate: '2021-03-03',
      abis: ['arm32', 'arm64', 'x64'],
    },
  ],
  [
    '0000000000000000000000000000000000000000000000000000000000000002',
    {
      flutterVersion: '2.10.0',
      engineCommit: 'placeholder-engine-2-10-0',
      dartSdkRev: '2.16.0',
      releaseDate: '2022-02-03',
      abis: ['arm32', 'arm64', 'x64'],
    },
  ],
  [
    '0000000000000000000000000000000000000000000000000000000000000003',
    {
      flutterVersion: '3.0.0',
      engineCommit: 'placeholder-engine-3-0-0',
      dartSdkRev: '2.17.0',
      releaseDate: '2022-05-11',
      abis: ['arm64', 'x64'],
    },
  ],
  [
    '0000000000000000000000000000000000000000000000000000000000000004',
    {
      flutterVersion: '3.10.0',
      engineCommit: 'placeholder-engine-3-10-0',
      dartSdkRev: '3.0.0',
      releaseDate: '2023-05-10',
      abis: ['arm64', 'x64'],
    },
  ],
  [
    '0000000000000000000000000000000000000000000000000000000000000005',
    {
      flutterVersion: '3.19.0',
      engineCommit: 'placeholder-engine-3-19-0',
      dartSdkRev: '3.3.0',
      releaseDate: '2024-02-15',
      abis: ['arm64', 'x64', 'riscv64'],
    },
  ],
  [
    '0000000000000000000000000000000000000000000000000000000000000006',
    {
      flutterVersion: '3.24.0',
      engineCommit: 'placeholder-engine-3-24-0',
      dartSdkRev: '3.5.0',
      releaseDate: '2024-08-06',
      abis: ['arm64', 'x64', 'riscv64'],
    },
  ],
  [
    '0000000000000000000000000000000000000000000000000000000000000007',
    {
      flutterVersion: '3.27.0',
      engineCommit: 'placeholder-engine-3-27-0',
      dartSdkRev: '3.6.0',
      releaseDate: '2024-12-11',
      abis: ['arm64', 'x64', 'riscv64'],
    },
  ],
];

/**
 * The built-in snapshot version table. Keys are lowercase 32-byte hex
 * digests of the snapshot identity hash; values are the structured
 * release info above.
 *
 * **Do not mutate.** Tests rely on the table being stable across runs.
 */
export const SNAPSHOT_VERSION_TABLE: ReadonlyMap<string, VersionEntry> = new Map(SEED_ENTRIES);

interface CachedUserTable {
  /** File mtime used to detect on-disk edits. */
  readonly mtimeMs: number;
  readonly size: number;
  readonly table: Map<string, VersionEntry>;
}

/** Bounded LRU cache of user tables, keyed by resolved absolute path. */
const USER_TABLE_CACHE_MAX = 8;
const userTableCache = new Map<string, CachedUserTable>();
/** Coalesces concurrent first loads for the same path. */
const userTableInflight = new Map<string, Promise<Map<string, VersionEntry>>>();

/**
 * Validate that an arbitrary value matches the {@link VersionEntry}
 * shape. Returns the typed entry or `undefined` when validation fails.
 */
function coerceEntry(raw: unknown): VersionEntry | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj['flutterVersion'] !== 'string') return undefined;
  const entry: VersionEntry = { flutterVersion: obj['flutterVersion'] };
  if (typeof obj['engineCommit'] === 'string') entry.engineCommit = obj['engineCommit'];
  if (typeof obj['dartSdkRev'] === 'string') entry.dartSdkRev = obj['dartSdkRev'];
  if (typeof obj['releaseDate'] === 'string') entry.releaseDate = obj['releaseDate'];
  if (obj['abis'] !== undefined) {
    // A present-but-malformed `abis` field is a shape error: silently dropping
    // bad values could let a broken user entry shadow a complete built-in one.
    const abisValue = obj['abis'];
    if (!Array.isArray(abisValue) || abisValue.length === 0) return undefined;
    const allowed = new Set(['arm32', 'arm64', 'x64', 'ia32', 'riscv64'] as const);
    type Abi = 'arm32' | 'arm64' | 'x64' | 'ia32' | 'riscv64';
    const abis: Abi[] = [];
    for (const candidate of abisValue) {
      if (typeof candidate !== 'string' || !allowed.has(candidate as Abi)) return undefined;
      abis.push(candidate as Abi);
    }
    entry.abis = abis;
  }
  return entry;
}

/**
 * Parse a user-supplied JSON file into a hash→VersionEntry map.
 * Expected JSON shape:
 *
 * ```json
 * {
 *   "<hex hash>": { "flutterVersion": "3.x", ... },
 *   ...
 * }
 * ```
 *
 * Throws `ToolError('RUNTIME')` on parse or shape errors (the message
 * always includes the offending path so the caller can correct it).
 */
async function parseUserTable(path: string): Promise<Map<string, VersionEntry>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    throw new ToolError('RUNTIME', `Failed to read custom snapshot table at ${path}`, {
      details: { path },
      cause: cause as Error,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ToolError('RUNTIME', `Invalid JSON in custom snapshot table at ${path}`, {
      details: { path },
      cause: cause as Error,
    });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ToolError(
      'RUNTIME',
      `Custom snapshot table at ${path} must be a JSON object keyed by hash`,
      { details: { path } },
    );
  }
  const out = new Map<string, VersionEntry>();
  for (const [key, value] of Object.entries(parsed)) {
    const entry = coerceEntry(value);
    if (!entry) {
      throw new ToolError(
        'RUNTIME',
        `Custom snapshot table entry "${key}" at ${path} has invalid shape`,
        { details: { path, key } },
      );
    }
    out.set(key.toLowerCase(), entry);
  }
  return out;
}

/**
 * Load (and cache) a user table, keyed by resolved absolute path so
 * equivalent spellings share one entry. Freshness is validated against
 * `mtimeMs` + size; concurrent first loads share one in-flight promise.
 */
async function loadUserTableCached(path: string): Promise<Map<string, VersionEntry>> {
  const cacheKey = resolve(path);

  let mtimeMs: number;
  let size: number;
  try {
    const st = await stat(cacheKey);
    mtimeMs = st.mtimeMs;
    size = st.size;
  } catch {
    // Fall through to parseUserTable so the documented RUNTIME error (with the
    // offending path in its message) is produced exactly once.
    return parseUserTable(cacheKey);
  }

  const cached = userTableCache.get(cacheKey);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    // Refresh LRU position.
    userTableCache.delete(cacheKey);
    userTableCache.set(cacheKey, cached);
    return cached.table;
  }

  const inFlight = userTableInflight.get(cacheKey);
  if (inFlight) return inFlight;

  const pending = parseUserTable(cacheKey)
    .then((table) => {
      userTableCache.set(cacheKey, { mtimeMs, size, table });
      while (userTableCache.size > USER_TABLE_CACHE_MAX) {
        const oldest = userTableCache.keys().next().value;
        if (oldest === undefined) break;
        userTableCache.delete(oldest);
      }
      return table;
    })
    .finally(() => {
      userTableInflight.delete(cacheKey);
    });
  userTableInflight.set(cacheKey, pending);
  return pending;
}

/**
 * Load the effective lookup table. User entries (from
 * `customTablePath` or `DART_SNAPSHOT_TABLE_PATH`) take precedence on
 * hash collisions with the built-in seed.
 *
 * User tables are cached by resolved path and revalidated against the file's
 * mtime/size on each call, so a corrected JSON table is picked up without a
 * process restart.
 */
export async function loadVersionTable(
  customTablePath?: string,
): Promise<ReadonlyMap<string, VersionEntry>> {
  const effectivePath =
    customTablePath && customTablePath.length > 0 ? customTablePath : DART_SNAPSHOT_TABLE_PATH;
  if (!effectivePath || effectivePath.length === 0) return SNAPSHOT_VERSION_TABLE;

  const userTable = await loadUserTableCached(effectivePath);

  const merged = new Map<string, VersionEntry>(SNAPSHOT_VERSION_TABLE);
  for (const [hash, entry] of userTable) {
    merged.set(hash, entry);
  }
  return merged;
}

/** Test-only: drop the user-table cache so subsequent loads re-read disk. */
export function resetUserTableCacheForTests(): void {
  userTableCache.clear();
  userTableInflight.clear();
}
