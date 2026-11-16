/**
 * Content-addressed APK decompile cache (B-phase, change
 * `close-descoped-behaviors`).
 *
 * INTENT REVERSAL (user-approved): the previous `jadx_search_code` `apkPath`
 * path decompiled into a per-request `mkdtemp` scratch dir and deleted it in
 * a `finally` block. This module instead keys the decompile output by the
 * APK's SHA-256, so repeated searches of the same APK reuse the sources.
 * The domain handler no longer removes the directory on exit.
 *
 * Design:
 *   - `resolveCacheDir` is pure w.r.t. the filesystem except for READING the
 *     APK bytes (needed for the hash). It never writes.
 *   - `getOrCreateCachedSources` takes `runJadx` as an injected callback, so
 *     it is unit-testable without a real `jadx` binary or network.
 *   - A `.stamp` file records creation time; entries older than `maxAgeMs`
 *     are rebuilt. Missing/invalid stamp = rebuild (fail-closed).
 *   - All paths normalized to forward slashes in returned strings for
 *     deterministic cross-platform evidence metadata.
 */
import { createHash } from 'node:crypto';
import { readFileSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve as resolvePath, join } from 'node:path';

import { readEnvInteger, readEnvString } from '@src/config/environment';

/** Injected jadx runner: produce `sources/` under `outDir`. */
export type RunJadx = (jadxBin: string, args: readonly string[], outDir: string) => Promise<void>;

export interface CacheOptions {
  /** Cache root. Default: JADX_SEARCH_CACHE_ROOT env or `<tmp>/jshook-jadx-cache`. */
  readonly root?: string;
  /** Max entry age in ms. Default: JADX_SEARCH_CACHE_MAX_AGE_MS. */
  readonly maxAgeMs?: number;
  /** Injectable clock (tests). Default: Date.now. */
  readonly now?: () => number;
}

export interface CachedSources {
  readonly sourcesDir: string;
  readonly cacheHit: boolean;
}

function defaultRoot(): string {
  const raw = readEnvString('JADX_SEARCH_CACHE_ROOT', '').trim();
  return raw.length > 0 ? raw : join(tmpdir(), 'jshook-jadx-cache');
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Resolve the cache directory for an APK (content-addressed by SHA-256). */
export function resolveCacheDir(apkPath: string, opts: CacheOptions = {}): string {
  const digest = createHash('sha256').update(readFileSync(apkPath)).digest('hex');
  const root = resolvePath(opts.root ?? defaultRoot());
  return normalize(join(root, digest));
}

const STAMP_FILE = '.stamp';

function stampPath(dir: string): string {
  return join(dir, STAMP_FILE);
}

async function stampAgeMs(dir: string, now: () => number): Promise<number | null> {
  try {
    const raw = await fs.readFile(stampPath(dir), 'utf8');
    const created = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(created)) return null;
    return now() - created;
  } catch {
    return null; // missing/unreadable stamp -> treat as stale
  }
}

/**
 * Return cached `sources/` for `apkPath`, creating it via `runJadx` on a miss.
 * `cacheHit` is true only when an existing, non-stale entry was reused.
 */
export async function getOrCreateCachedSources(
  apkPath: string,
  jadxBin: string,
  args: readonly string[],
  runJadx: RunJadx,
  opts: CacheOptions = {},
): Promise<CachedSources> {
  const dir = resolveCacheDir(apkPath, opts);
  const maxAgeMs =
    opts.maxAgeMs ?? readEnvInteger('JADX_SEARCH_CACHE_MAX_AGE_MS', 7 * 24 * 60 * 60 * 1000);
  const now = opts.now ?? Date.now;
  const sourcesDir = normalize(join(dir, 'sources'));

  const ageMs = await stampAgeMs(dir, now);
  if (ageMs !== null && ageMs >= 0 && ageMs <= maxAgeMs) {
    try {
      const st = await fs.stat(join(dir, 'sources'));
      if (st.isDirectory()) return { sourcesDir, cacheHit: true };
    } catch {
      // sources missing -> fall through to rebuild
    }
  }

  // Miss or stale: rebuild from scratch.
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await runJadx(jadxBin, args, dir);
  await fs.mkdir(join(dir, 'sources'), { recursive: true });
  await fs.writeFile(stampPath(dir), String(now()), 'utf8');
  return { sourcesDir, cacheHit: false };
}
