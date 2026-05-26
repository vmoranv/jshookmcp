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

import { readFile } from 'node:fs/promises';

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

/** Cache for the last loaded user table, keyed by absolute path. */
const userTableCache = new Map<string, Map<string, VersionEntry>>();

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
  if (Array.isArray(obj['abis'])) {
    const allowed = new Set(['arm32', 'arm64', 'x64', 'ia32', 'riscv64'] as const);
    type Abi = 'arm32' | 'arm64' | 'x64' | 'ia32' | 'riscv64';
    const abis: Abi[] = [];
    for (const candidate of obj['abis']) {
      if (typeof candidate === 'string' && allowed.has(candidate as Abi)) {
        abis.push(candidate as Abi);
      }
    }
    if (abis.length > 0) entry.abis = abis;
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
 * Load the effective lookup table. User entries (from
 * `customTablePath` or `DART_SNAPSHOT_TABLE_PATH`) take precedence on
 * hash collisions with the built-in seed.
 *
 * Reads are cached by absolute path so repeat calls do not re-hit disk.
 */
export async function loadVersionTable(
  customTablePath?: string,
): Promise<ReadonlyMap<string, VersionEntry>> {
  const effectivePath =
    customTablePath && customTablePath.length > 0 ? customTablePath : DART_SNAPSHOT_TABLE_PATH;
  if (!effectivePath || effectivePath.length === 0) return SNAPSHOT_VERSION_TABLE;

  let userTable = userTableCache.get(effectivePath);
  if (!userTable) {
    userTable = await parseUserTable(effectivePath);
    userTableCache.set(effectivePath, userTable);
  }

  const merged = new Map<string, VersionEntry>(SNAPSHOT_VERSION_TABLE);
  for (const [hash, entry] of userTable) {
    merged.set(hash, entry);
  }
  return merged;
}

/** Test-only: drop the user-table cache so subsequent loads re-read disk. */
export function resetUserTableCacheForTests(): void {
  userTableCache.clear();
}
