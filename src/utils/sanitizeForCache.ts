/**
 * sanitizeForCache — recursively replaces oversized string fields with compact
 * disk-backed placeholders BEFORE data enters the cache / a tool response.
 *
 * Motivation (issue #62): a captured network request whose `url` is an inline
 * `data:image/png;base64,...` blob can be several megabytes. Stored verbatim in
 * DetailedDataManager, any later `get_detailed_data` retrieval re-emits the full
 * base64 and overflows the LLM context window. This sanitizer intercepts such
 * fields, writes the raw bytes to `artifacts/offloaded/`, and leaves behind a
 * placeholder the LLM can still reason about:
 *
 *   { _offload: { type: 'file', path, size, mimeType?, sample } }
 *
 * Properties:
 *   - cycle-safe (WeakSet guards against circular references)
 *   - idempotent (an existing `{ _offload }` placeholder is returned untouched)
 *   - cheap for primitives / small strings (returned as-is, no allocation)
 *   - asynchronous disk write (await fs.promises.mkdir + fs.promises.writeFile)
 *     so the event loop is never frozen by a request-path offload write (a4-02/a2-02).
 *     Callers await sanitizeForCache — the placeholder still carries a fully-written
 *     file before the response is returned, only the blocking is removed.
 */

import { mkdir, writeFile, readdir, stat, rm } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { resolve, relative, isAbsolute, sep, join } from 'node:path';
import { generateShortId, getArtifactDir, getArtifactsRoot } from '@utils/artifacts';
import { getProjectRoot } from '@utils/outputPaths';
import { OFFLOAD_FIELD_SANITIZE_THRESHOLD_BYTES } from '@src/constants';
import { logger } from '@utils/logger';

/** Matches a base64 data URI prefix, capturing the MIME type. Shared across the offload pipeline. */
export const DATA_URI_RE = /^data:([a-zA-Z0-9/+.-]+);base64,/;

/** Length (chars) of the human-readable sample retained in the placeholder. */
const SAMPLE_LENGTH = 128;

/**
 * Default soft cap on the number of offloaded files kept in a single offload
 * directory. Offload writes were previously unbounded (see
 * enforceOffloadDirectoryQuota); this is the backstop the write path enforces
 * independent of the age/size retention scheduler.
 */
const OFFLOAD_MAX_FILES = 2000;

/**
 * Object keys that must never be copied when sanitizing captured data. Hostile
 * page content can carry `__proto__` / `constructor` / `prototype` as own keys
 * (via JSON.parse); assigning them onto a plain result object would pollute
 * its prototype chain. Such keys are dropped — they are never legitimate
 * payload fields for caching.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface OffloadFilePlaceholder {
  _offload: {
    type: 'file';
    /** Project-relative path to the offloaded file (forward slashes). */
    path: string;
    /** Human-readable size of the offloaded payload. */
    size: string;
    /** MIME type, present only when the source was a data: URI. */
    mimeType?: string;
    /** Leading slice of the original string, so the LLM knows what was removed. */
    sample: string;
  };
}

export interface SanitizeOptions {
  /** Strings longer than this (chars) are offloaded. Default: constant (64KB). */
  threshold?: number;
  /** Override the directory for offloaded files (absolute). Default: artifacts/offloaded. */
  outputDir?: string;
  /**
   * When false, oversized values are replaced with a placeholder WITHOUT writing
   * a file (no `path`). Used by defensive call sites that only need to shrink the
   * payload, not preserve it. Default: true.
   */
  writeFile?: boolean;
  /**
   * Soft cap on the number of offloaded files retained in the output directory.
   * When a write would exceed it, the oldest files are pruned (see
   * enforceOffloadDirectoryQuota). Default: OFFLOAD_MAX_FILES.
   */
  maxFiles?: number;
}

/** Format a byte count as a human-readable B/KB/MB string. Shared across the offload pipeline. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function isOffloadPlaceholder(value: object): boolean {
  // Own-property check only: a polluted prototype chain must not be able to
  // make arbitrary objects look like placeholders (which would bypass the
  // idempotency guard and pass attacker data through untouched).
  return Object.prototype.hasOwnProperty.call(value, '_offload');
}

/**
 * Enforce a soft file-count cap on an offload directory by deleting the oldest
 * files first (mtime order).
 *
 * Rationale (RAM audit #3): the offload write paths (sanitizeForCache and
 * ToolResponseOffloader) wrote into artifacts/offloaded/ with no cap, while
 * DetailedDataManager eviction only unlinks its OWN persistPath (a separate
 * tmp/detailed-data/ dir) — so DDM could never reclaim offloaded files. The only
 * cleanup was the 7-day retention scheduler, which is disabled when
 * MCP_ARTIFACT_RETENTION_DAYS=0, leaving truly unbounded growth. This backstop
 * bounds the FILE COUNT independent of the age/size retention scheduler, so
 * disabling retention can no longer fill the disk. Byte-level bounding remains
 * the retention scheduler's job; this is the last-resort count invariant.
 *
 * Callers await it AFTER writing a file, so the directory never exceeds
 * `maxFiles` once a write completes. The just-written file is the newest entry
 * and is therefore never the victim of its own prune.
 *
 * @returns the number of files removed.
 */
export async function enforceOffloadDirectoryQuota(
  outputDir: string,
  maxFiles: number = OFFLOAD_MAX_FILES,
  excludePath?: string,
): Promise<number> {
  if (maxFiles <= 0) return 0;

  let entries: Dirent[];
  try {
    entries = await readdir(outputDir, { withFileTypes: true });
  } catch {
    return 0; // directory absent/unreadable — nothing to prune
  }

  const files = entries.filter((entry) => entry.isFile());
  if (files.length <= maxFiles) return 0;

  const withMtime = await Promise.all(
    files.map(async (file) => {
      try {
        const info = await stat(join(outputDir, file.name));
        return { path: join(outputDir, file.name), mtimeMs: info.mtimeMs };
      } catch {
        return null;
      }
    }),
  );

  const prunable = withMtime
    .filter((x): x is { path: string; mtimeMs: number } => x !== null)
    .filter((x) => x.path !== excludePath);
  // mtime ties prune an arbitrary equally-old file — acceptable, since the
  // freshly written file is protected by excludePath, not by ordering.
  prunable.sort((a, b) => a.mtimeMs - b.mtimeMs);

  const victims = prunable.slice(0, files.length - maxFiles);
  // Best-effort removal: a concurrent reader (get_offloaded_data) must not turn
  // a failed unlink into a failed offload.
  await Promise.all(victims.map((file) => rm(file.path, { force: true }).catch(() => {})));
  return victims.length;
}

/** Write raw string bytes to artifacts/offloaded and return the project-relative path. */
async function writeOffloadFile(
  raw: string,
  mimeType: string | undefined,
  outputDir: string,
  maxFiles: number,
): Promise<string> {
  await mkdir(outputDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const ext = mimeType ? 'bin' : 'txt';
  // For a data: URI we persist the decoded bytes; otherwise the raw string.
  const dataUriMatch = mimeType ? raw.match(DATA_URI_RE) : null;
  const payload: string | Buffer = dataUriMatch
    ? Buffer.from(raw.slice(dataUriMatch[0].length), 'base64')
    : raw;

  // Exclusive create ('wx', same semantics as open with O_EXCL): a colliding
  // name fails with EEXIST instead of silently overwriting another session's
  // file (a2-08). Regenerate the UUID-derived ID once and retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    const absolutePath = resolve(outputDir, `offload-${ts}-${generateShortId()}.${ext}`);
    try {
      await writeFile(absolutePath, payload, { encoding: 'utf8', flag: 'wx' });
      // Bound the directory after the write so it never exceeds the cap once a
      // write completes. The freshly written file is excluded explicitly (and
      // via the name tie-break) so a prune can never delete the path we are
      // about to return.
      await enforceOffloadDirectoryQuota(outputDir, maxFiles, absolutePath);
      return relative(getProjectRoot(), absolutePath).replace(/\\/g, '/');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST' && attempt === 0) {
        continue;
      }
      throw error;
    }
  }
  // Unreachable: the second attempt either returns or throws.
  throw new Error(`[sanitizeForCache] could not reserve a unique offload file in ${outputDir}`);
}

/** Build the compact placeholder for an oversized string, scheduling its disk write. */
function offloadString(
  value: string,
  opts: Required<SanitizeOptions>,
  pendingWrites: Promise<void>[],
): OffloadFilePlaceholder {
  const mimeType = value.match(DATA_URI_RE)?.[1];
  const sample = value.slice(0, SAMPLE_LENGTH);

  const placeholder: OffloadFilePlaceholder = {
    _offload: {
      type: 'file',
      path: '',
      size: formatSize(Buffer.byteLength(value, 'utf8')),
      ...(mimeType ? { mimeType } : {}),
      sample,
    },
  };

  if (opts.writeFile) {
    // Fan the write out rather than awaiting inline: multiple oversized fields
    // (or array elements) write concurrently, and a single field's failure only
    // clears its own path — it never fails a sibling. The caller awaits
    // Promise.all(pendingWrites) before returning, so every placeholder still
    // carries a real, readable path.
    pendingWrites.push(
      writeOffloadFile(value, mimeType, opts.outputDir, opts.maxFiles)
        .then((path) => {
          placeholder._offload.path = path;
        })
        .catch((error) => {
          logger.warn(`[sanitizeForCache] Failed to offload field to disk: ${String(error)}`);
        }),
    );
  }

  return placeholder;
}

/** True when a string should be offloaded: any data: URI, or any string over the threshold. */
function shouldOffloadString(value: string, threshold: number): boolean {
  return DATA_URI_RE.test(value) || value.length > threshold;
}

async function sanitizeValue(
  value: unknown,
  opts: Required<SanitizeOptions>,
  seen: WeakSet<object>,
  pendingWrites: Promise<void>[],
): Promise<unknown> {
  if (typeof value === 'string') {
    return shouldOffloadString(value, opts.threshold)
      ? offloadString(value, opts, pendingWrites)
      : value;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  // Idempotent: an already-offloaded placeholder is left untouched.
  if (isOffloadPlaceholder(value)) {
    return value;
  }

  // Cycle guard (stack-scoped): if this object is an ancestor of itself we've hit
  // a cycle — return the reference to break it. We delete on exit (below) rather
  // than keeping a persistent "seen" set, so that a shared object referenced from
  // two distinct branches (a DAG, which JSON.stringify would expand anyway) is
  // sanitized at every occurrence instead of leaking the original at the second.
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    let mutated = false;
    const result: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const sanitized = await sanitizeValue(value[i], opts, seen, pendingWrites);
      if (sanitized !== value[i]) mutated = true;
      result.push(sanitized);
    }
    seen.delete(value);
    return mutated ? result : value;
  }

  let mutated = false;
  let skippedUnsafe = false;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) {
      skippedUnsafe = true;
      continue;
    }
    const sanitized = await sanitizeValue(item, opts, seen, pendingWrites);
    if (sanitized !== item) mutated = true;
    result[key] = sanitized;
  }
  seen.delete(value);
  // An unsafe key forces a fresh copy even when nothing else mutated, so the
  // original object (with its hostile own key) is never returned as-is.
  return mutated || skippedUnsafe ? result : value;
}

/** True when `target` resolves to `base` or a directory inside it. */
function isInsideDir(baseDir: string, targetPath: string): boolean {
  const rel = relative(baseDir, targetPath);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** True when a path is absolute on this platform (incl. Windows drive letters). */
function isUserAbsolutePath(inputPath: string): boolean {
  return isAbsolute(inputPath) || /^[A-Za-z]:[\\/]/.test(inputPath) || inputPath.startsWith('\\\\');
}

/**
 * Recursively sanitize a value for caching. Oversized strings and data: URIs are
 * replaced with disk-backed `{ _offload }` placeholders. Returns the original
 * reference unchanged when nothing needed offloading (so callers can cheaply
 * detect "no-op"). The write is asynchronous (a4-02/a2-02): callers await this
 * so the placeholder's file is fully written before the response is returned,
 * but the event loop is never blocked by a synchronous disk write.
 */
export async function sanitizeForCache<T>(data: T, options: SanitizeOptions = {}): Promise<T> {
  const projectRoot = getProjectRoot();
  const requestedDir = options.outputDir ?? getArtifactDir('offloaded');
  // Path-guard: offload files are only ever written inside the project root,
  // even when a caller supplies a custom outputDir (mirrors the guard in
  // resolveArtifactPath). A relative outputDir is resolved against the project
  // root; anything that escapes falls back to the default offload dir.
  const candidateDir = isUserAbsolutePath(requestedDir)
    ? resolve(requestedDir)
    : resolve(projectRoot, requestedDir);
  const outputDir = isInsideDir(projectRoot, candidateDir)
    ? candidateDir
    : (logger.warn(
        `[sanitizeForCache] Refusing outputDir outside project root (${requestedDir}); ` +
          `falling back to default offload dir`,
      ),
      getArtifactDir('offloaded'));

  const opts: Required<SanitizeOptions> = {
    threshold: options.threshold ?? OFFLOAD_FIELD_SANITIZE_THRESHOLD_BYTES,
    outputDir,
    writeFile: options.writeFile ?? true,
    maxFiles: options.maxFiles ?? OFFLOAD_MAX_FILES,
  };
  const pendingWrites: Promise<void>[] = [];
  const result = (await sanitizeValue(data, opts, new WeakSet<object>(), pendingWrites)) as T;
  // Wait for every offload write before returning so the placeholders all carry
  // a real, readable path (same guarantee as before, now written concurrently).
  await Promise.all(pendingWrites);
  return result;
}

/** Exposed for tests / callers that need the default offload directory. */
export function getOffloadDir(): string {
  return getArtifactDir('offloaded');
}

/** Exposed for the offloaded-data retrieval tool: the artifacts root for containment checks. */
export function getOffloadRoot(): string {
  return getArtifactsRoot();
}
