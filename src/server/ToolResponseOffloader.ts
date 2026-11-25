/**
 * ToolResponseOffloader — response middleware that automatically offloads large data
 * from tool responses to disk, replacing the payload with a compact reference.
 *
 * Placement in the call chain (see MCPServer.executeToolWithTracking):
 *
 *   router.execute()       ← handler returns raw response
 *     → LargeDataOffloader.offload()     ← this: writes large data → file/detailId
 *     → contextGuard.recordCall()
 *     → contextGuard.enrichResponse()   ← tab context + repeat warnings
 *     → appendExecutionMetrics()
 *     → tokenBudget.recordToolCall()
 *
 * What gets offloaded:
 *   - data:image/...;base64,...  → binary file on disk
 *   - large JSON strings (> threshold)  → DetailedDataManager → detailId reference
 *   - large raw strings (> file threshold) → .txt file on disk
 *
 * The placeholder format replaces large values in-place:
 *   { _offload: { type: 'detailId' | 'file', path?: string, detailId?: string, size: number } }
 *
 * offload() is async: file writes complete before the response is returned, so
 * the placeholder always carries a real, readable path (the previous design
 * deferred the write to an offloadAsync() pass that could never reconstruct the
 * already-replaced payload — the placeholder never reached disk).
 */

import { promises as fs } from 'node:fs';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import {
  sanitizeForCache,
  formatSize,
  DATA_URI_RE,
  getOffloadDir,
  enforceOffloadDirectoryQuota,
} from '@utils/sanitizeForCache';
import { resolveArtifactPath } from '@utils/artifacts';
import { logger } from '@utils/logger';
import { OFFLOADER_DETAIL_THRESHOLD_BYTES, OFFLOADER_FILE_THRESHOLD_BYTES } from '@src/constants';

export interface OffloaderConfig {
  /** Strings larger than this (bytes) go to DetailedDataManager. Default: 512KB */
  detailThreshold?: number;
  /** Strings larger than this (bytes) go directly to a file. Default: 4MB */
  fileThreshold?: number;
  /** Subdirectory under project root for offloaded files. Default: artifacts/offloaded */
  outputDir?: string;
  /** Tools excluded from offloading (e.g. tools that intentionally return large data). */
  excludeTools?: Set<string>;
  /**
   * Soft cap on the number of offloaded files retained in the output directory
   * (RAM audit #3). Default: OFFLOAD_MAX_FILES.
   */
  maxOffloadFiles?: number;
}

interface OffloadPlaceholder {
  _offload: {
    type: 'detailId' | 'file';
    /** Project-relative path (type=file) */
    path?: string;
    /** Detail ID (type=detailId) */
    detailId?: string;
    /** Human-readable size */
    size: string;
    /** MIME type hint (type=file, data URI only) */
    mimeType?: string;
  };
}

const DETAILID_RE = /"_?offload"|detailId|_filePath/;

export class LargeDataOffloader {
  private readonly detailedData: DetailedDataManager;
  private readonly detailThreshold: number;
  private readonly fileThreshold: number;
  private readonly excludeTools: Set<string>;
  private readonly outputDir: string;
  private readonly maxOffloadFiles: number | undefined;

  constructor(detailedData: DetailedDataManager, config: OffloaderConfig = {}) {
    this.detailedData = detailedData;
    this.detailThreshold = config.detailThreshold ?? OFFLOADER_DETAIL_THRESHOLD_BYTES;
    this.fileThreshold = config.fileThreshold ?? OFFLOADER_FILE_THRESHOLD_BYTES;
    this.excludeTools = config.excludeTools ?? new Set();
    this.outputDir = config.outputDir ?? getOffloadDir();
    this.maxOffloadFiles = config.maxOffloadFiles;
  }

  /**
   * Store structured data in DetailedDataManager. Returns the placeholder.
   */
  private async storeInDetailManager(
    data: unknown,
    _toolName: string,
    _idx: number,
  ): Promise<OffloadPlaceholder> {
    const detailId = await this.detailedData.store(data);
    const entry = (
      this.detailedData as unknown as { cache: Map<string, { size: number }> }
    ).cache.get(detailId);
    const size = entry?.size ?? 0;

    logger.info(
      `[Offloader] Stored in DetailDataManager (${formatSize(size)}) → detailId=${detailId}`,
    );
    return {
      _offload: {
        type: 'detailId',
        detailId,
        size: formatSize(size),
      },
    };
  }

  /**
   * Write raw string bytes to the offload directory and return the
   * project-relative path. Data URIs are persisted as decoded binary; anything
   * else as UTF-8 text.
   *
   * Reuses the shared artifact path resolver from `src/utils/artifacts.ts`
   * (same timestamped/shortId filename template), which also applies the
   * PathGuard the previous local copy lacked — a configured outputDir that
   * escapes the project root is rejected instead of silently writing outside.
   */
  private async writeOffloadedFile(
    raw: string,
    mimeType: string | undefined,
  ): Promise<{ path: string; size: string }> {
    const { absolutePath, displayPath } = await resolveArtifactPath({
      category: 'offloaded',
      toolName: 'offload',
      ext: mimeType ? 'bin' : 'txt',
      customDir: this.outputDir,
    });

    if (mimeType) {
      const dataUriMatch = raw.match(DATA_URI_RE);
      const base64 = dataUriMatch ? raw.slice(dataUriMatch[0].length) : raw;
      await fs.writeFile(absolutePath, Buffer.from(base64, 'base64'));
    } else {
      await fs.writeFile(absolutePath, raw, 'utf8');
    }

    // Bound the offload directory after the write (RAM audit #3): the file this
    // call just wrote is the newest and survives its own prune.
    await enforceOffloadDirectoryQuota(this.outputDir, this.maxOffloadFiles);

    return {
      path: displayPath,
      size: formatSize(raw.length),
    };
  }

  /**
   * Detect a "detail wrapper" response shape — an object carrying a string
   * `detailId` plus a `data` / `summary` / `preview` payload field. These come
   * from get_detailed_data and similar tools; their payload may contain
   * un-offloaded oversized fields that must be sanitized rather than skipped.
   */
  private isDetailWrapper(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    if (typeof obj.detailId !== 'string') return false;
    return 'data' in obj || 'summary' in obj || 'preview' in obj;
  }

  /**
   * Try to parse a string as JSON. Returns the parsed object or null.
   * Parse failures are not errors — non-JSON strings simply fall through to
   * the raw-string offload path.
   */
  private tryParseJson(str: string): unknown | null {
    try {
      const trimmed = str.trim();
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        return JSON.parse(trimmed);
      }
    } catch {
      // Not JSON
    }
    return null;
  }

  /**
   * Offload large data in a tool response. Mutates the response in-place and
   * actually writes offloaded files before returning.
   *
   * Returns the same response object (mutated) for chaining convenience.
   */
  async offload<T extends { content?: unknown[]; isError?: boolean }>(
    toolName: string,
    response: T,
  ): Promise<T> {
    if (response.isError) return response;
    if (this.excludeTools.has(toolName)) return response;

    const content = response.content;
    if (!Array.isArray(content)) return response;

    // Collect one task per offloadable entry, then fan them out with
    // Promise.all. Each task mutates only its own content[i] slot and resolves
    // to whether it changed anything, so concurrent writes can't race and a
    // single entry's failure never prevents its siblings from offloading.
    const tasks: Array<() => Promise<boolean>> = [];

    for (let i = 0; i < content.length; i++) {
      const entry = content[i];
      if (typeof entry !== 'object' || entry === null) continue;

      const record = entry as Record<string, unknown>;
      // Only plain text blocks carry a top-level `text` payload. MCP embedded
      // resources are shaped `{ type: 'resource', resource: { uri, text|blob } }`,
      // so the previous `'resource'` branch never matched `record.text` and
      // silently skipped every resource block. Resource payloads stay intact by
      // design: replacing `resource.text` / `resource.blob` would break the
      // resource contract and needs its own placeholder protocol.
      if (record.type !== 'text') continue;

      const text = record.text as string | undefined;
      if (typeof text !== 'string' || text.length < this.detailThreshold) continue;

      // ── Detail wrapper (e.g. get_detailed_data) → sanitize its data branch ──
      // A response like { detailId, path, data } always carries a literal
      // "detailId", so the old blunt DETAILID_RE skip let multi-MB blobs inside
      // `data` escape unmodified (issue #62). Instead of skipping the whole
      // entry, recursively offload oversized fields within it. This is
      // defense-in-depth: the primary fix sanitizes at DetailedDataManager.store,
      // but this also catches any future path that bypasses the cache.
      const detailWrapper = this.tryParseJson(text);
      if (detailWrapper !== null && this.isDetailWrapper(detailWrapper)) {
        tasks.push(async () => {
          try {
            const sanitized = await sanitizeForCache(detailWrapper);
            if (sanitized !== detailWrapper) {
              content[i] = { ...record, text: JSON.stringify(sanitized, null, 2) };
              return true;
            }
            return false;
          } catch (error) {
            // Same contract as the sibling tasks: an offload failure must never
            // reject `offload()` and drop the tool's payload.
            logger.warn(
              `[Offloader] Failed to sanitize ${toolName} detail wrapper (entry ${i}), keeping original text`,
              error,
            );
            return false;
          }
        });
        continue;
      }

      // Skip pure offload placeholders / file-reference responses (idempotent).
      if (DETAILID_RE.test(text)) continue;

      // ── Data URI (base64 image) → write binary file ──
      const dataUriMatch = text.match(DATA_URI_RE);
      if (dataUriMatch) {
        tasks.push(async () => {
          try {
            const file = await this.writeOffloadedFile(text, dataUriMatch[1]);
            content[i] = {
              ...record,
              text: JSON.stringify(
                {
                  _offload: {
                    type: 'file',
                    path: file.path,
                    size: file.size,
                    mimeType: dataUriMatch[1],
                  },
                },
                null,
                2,
              ),
            };
            return true;
          } catch (error) {
            // Never drop the tool's payload because offloading failed — keep
            // the original text and surface a warning instead.
            logger.warn(
              `[Offloader] Failed to offload data URI from ${toolName} (entry ${i}), keeping original text`,
              error,
            );
            return false;
          }
        });
        continue;
      }

      // ── Large JSON string → DetailedDataManager ──
      const parsed = this.tryParseJson(text);
      if (parsed !== null) {
        tasks.push(async () => {
          try {
            content[i] = {
              ...record,
              text: JSON.stringify(await this.storeInDetailManager(parsed, toolName, i), null, 2),
            };
            return true;
          } catch (error) {
            logger.warn(
              `[Offloader] Failed to store ${toolName} payload (entry ${i}) in DetailDataManager, keeping original text`,
              error,
            );
            return false;
          }
        });
        continue;
      }

      // ── Large non-JSON string → file ──
      if (text.length >= this.fileThreshold) {
        tasks.push(async () => {
          try {
            const file = await this.writeOffloadedFile(text, undefined);
            content[i] = {
              ...record,
              text: JSON.stringify(
                {
                  _offload: {
                    type: 'file',
                    path: file.path,
                    size: file.size,
                  },
                },
                null,
                2,
              ),
            };
            return true;
          } catch (error) {
            logger.warn(
              `[Offloader] Failed to offload large string from ${toolName} (entry ${i}), keeping original text`,
              error,
            );
            return false;
          }
        });
        continue;
      }
    }

    const results = await Promise.all(tasks.map((task) => task()));
    if (results.some((changed) => changed)) {
      logger.debug(`[Offloader] Offloaded large data from ${toolName}`);
    }
    return response;
  }
}
