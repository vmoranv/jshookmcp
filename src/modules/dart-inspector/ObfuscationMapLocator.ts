/**
 * ObfuscationMapLocator — auto-detect a Flutter obfuscation map sidecar.
 *
 * `dart_symbolize` otherwise hard-requires a developer-supplied map path. In
 * practice the map ships as a leaked sidecar in debug builds or inside
 * `assets/flutter_assets/` more often than expected. This locator scans a
 * directory tree or an APK (zip) for a matching sidecar so the path from
 * `apk_static_triage` → `dart_symbolize` is guided rather than manual.
 *
 * 100% read-only. Matched by filename only — never executes map contents.
 */

import {
  open as openZipArchive,
  type Entry as ZipEntry,
  type ZipFile as YauzlZipFile,
} from 'yauzl';
import { randomUUID } from 'node:crypto';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { ToolError } from '@errors/ToolError';
import {
  DART_MAX_MAP_BYTES,
  DART_OBFUSCATION_MAP_MAX_DIR_DEPTH,
  DART_OBFUSCATION_MAP_MAX_CANDIDATES,
} from '@src/constants';

/** Guard against a zip bomb / pathological tree. */
const MAX_MAP_BYTES = DART_MAX_MAP_BYTES;
const MAX_DIR_DEPTH = DART_OBFUSCATION_MAP_MAX_DIR_DEPTH;
const MAX_CANDIDATES = DART_OBFUSCATION_MAP_MAX_CANDIDATES;

export interface LocateResult {
  /** Usable path (extracted temp file for APK hits; source file for dir hits). */
  path: string;
  /** Provenance: `apk:<entryName>` or `directory:<dir>`. */
  source: string;
  /** Every sidecar candidate discovered (informational). */
  candidates: string[];
}

/**
 * A sidecar is any file whose name contains "obfuscation" with a known map
 * extension. Exported for unit testing.
 */
export function isObfuscationSidecar(name: string): boolean {
  const lower = name.toLowerCase();
  if (!lower.includes('obfuscation')) {
    return false;
  }
  return lower.endsWith('.txt') || lower.endsWith('.map') || lower.endsWith('.json');
}

export interface LocateInput {
  apkPath?: string;
  searchDir?: string;
}

/**
 * Locate an obfuscation map. `searchDir` takes precedence over `apkPath` when
 * both are supplied. Returns null when no sidecar is found.
 */
export async function locateObfuscationMap(input: LocateInput): Promise<LocateResult | null> {
  if (input.searchDir) {
    return locateInDirectory(input.searchDir);
  }
  if (input.apkPath) {
    return locateInApk(input.apkPath);
  }
  return null;
}

async function locateInDirectory(dir: string): Promise<LocateResult | null> {
  const found: string[] = [];
  await walk(dir, 0, found);
  if (found.length === 0) {
    return null;
  }
  const first = found[0];
  return {
    path: first!,
    source: `directory:${dir}`,
    candidates: found,
  };
}

async function walk(dir: string, depth: number, found: string[]): Promise<void> {
  if (depth > MAX_DIR_DEPTH || found.length >= MAX_CANDIDATES) {
    return;
  }
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (found.length >= MAX_CANDIDATES) {
      return;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, depth + 1, found);
    } else if (entry.isFile() && isObfuscationSidecar(entry.name)) {
      found.push(full);
    }
  }
}

async function locateInApk(apkPath: string): Promise<LocateResult | null> {
  if (!apkPath || apkPath.length === 0) {
    throw new ToolError('VALIDATION', 'apkPath must be a non-empty string');
  }
  return new Promise<LocateResult | null>((resolve, reject) => {
    openZipArchive(apkPath, { lazyEntries: true, autoClose: true }, (err, zipFile) => {
      if (err || !zipFile) {
        reject(
          new ToolError('VALIDATION', `Failed to open APK as ZIP: ${err?.message ?? 'unknown'}`, {
            details: { apkPath },
            cause: err ?? undefined,
          }),
        );
        return;
      }
      const zip = zipFile as YauzlZipFile;
      const candidates: string[] = [];
      let resolving = false;
      let settled = false;

      // We stop calling readEntry() after the first extraction attempt, so
      // yauzl's autoClose never fires. Close the fd before every settle to
      // avoid leaking descriptors across repeated triage runs.
      const settle = (action: () => void): void => {
        if (settled) return;
        settled = true;
        try {
          zip.close();
        } catch {
          // yauzl's close() is idempotent; ignore a double-close race.
        }
        action();
      };

      zip.on('entry', (entry: ZipEntry) => {
        if (isObfuscationSidecar(entry.fileName)) {
          candidates.push(entry.fileName);
          if (!resolving) {
            resolving = true;
            const matchName = entry.fileName;
            zip.openReadStream(entry, (streamErr, stream) => {
              if (streamErr || !stream) {
                settle(() =>
                  reject(
                    new ToolError(
                      'RUNTIME',
                      `Failed to read ${matchName}: ${streamErr?.message ?? 'unknown'}`,
                      { details: { apkPath, entry: matchName }, cause: streamErr ?? undefined },
                    ),
                  ),
                );
                return;
              }
              readStreamCapped(stream, MAX_MAP_BYTES).then(
                async (bytes) => {
                  const base = (matchName.split('/').pop() ?? 'obfuscation').replace(
                    /[^a-z0-9.-]/gi,
                    '_',
                  );
                  const tmpPath = join(
                    tmpdir(),
                    `jshook-obf-${base}-${process.pid}-${randomUUID()}`,
                  );
                  try {
                    await writeFile(tmpPath, bytes, { flag: 'wx' });
                  } catch (writeErr) {
                    settle(() =>
                      reject(
                        new ToolError(
                          'RUNTIME',
                          `Failed to write extracted map: ${(writeErr as Error).message}`,
                          {
                            cause: writeErr as Error,
                          },
                        ),
                      ),
                    );
                    return;
                  }
                  settle(() => resolve({ path: tmpPath, source: `apk:${matchName}`, candidates }));
                },
                (readErr: Error) => {
                  settle(() =>
                    reject(
                      new ToolError('RUNTIME', `Reading ${matchName} failed: ${readErr.message}`, {
                        details: { apkPath, entry: matchName },
                        cause: readErr,
                      }),
                    ),
                  );
                },
              );
            });
            return; // do not readEntry — we are extracting this one
          }
        }
        zip.readEntry();
      });

      zip.on('end', () => {
        if (!resolving) {
          // Scanned the whole archive, no sidecar extracted. If candidates were
          // found but none extracted (defensive — resolving flips on first hit),
          // still report null; callers ask for the map explicitly then.
          settle(() => resolve(null));
        }
      });

      zip.on('error', (zipErr: Error) => {
        settle(() =>
          reject(new ToolError('RUNTIME', `ZIP read error: ${zipErr.message}`, { cause: zipErr })),
        );
      });

      // lazyEntries: true requires an explicit read to emit the first entry.
      zip.readEntry();
    });
  });
}

async function readStreamCapped(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error(`stream exceeds maxBytes (${maxBytes})`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
