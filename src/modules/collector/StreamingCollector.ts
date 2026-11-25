import { logger } from '@utils/logger';
import { compileSafeRegex } from '@utils/safeRegExp';
import type { CodeFile } from '@internal-types/index';

/** Score weight per priority-pattern rank. */
const PRIORITY_MATCH_WEIGHT = 10;
/** Preview length for stream summaries (chars). */
const SUMMARY_PREVIEW_CHARS = 500;
/** Content signals used by both priority scoring and summary detection. */
const ENCRYPTION_CONTENT_RE = /encrypt|crypto|cipher/i;
/** Network signal for priority scoring (kept `request`-less to preserve scoring). */
const NETWORK_CONTENT_RE = /fetch|xhr|ajax/i;
/** Network signal for summary `hasAPI` (broader: includes `request`). */
const NETWORK_API_CONTENT_RE = /fetch|xhr|ajax|request/i;
/** Priority bonus when a file's content mentions crypto/network APIs. */
const CONTENT_ENCRYPTION_BONUS = 50;
const CONTENT_NETWORK_BONUS = 30;

export interface StreamChunk {
  chunkIndex: number;
  totalChunks: number;
  url: string;
  content: string;
  isLast: boolean;
  /** True when maxChunks cut the file short — the stream is NOT complete. */
  truncated?: boolean;
  metadata?: {
    fileSize: number;
    chunkSize: number;
    offset: number;
  };
}

export interface StreamOptions {
  chunkSize?: number;
  maxChunks?: number;
}

export class StreamingCollector {
  private readonly DEFAULT_CHUNK_SIZE = 100 * 1024;
  private readonly DEFAULT_MAX_CHUNKS = 50;

  async *streamFile(file: CodeFile, options: StreamOptions = {}): AsyncGenerator<StreamChunk> {
    const chunkSize = this.resolveChunkSize(options.chunkSize);
    const maxChunks = this.resolveMaxChunks(options.maxChunks);

    const content = file.content;
    const totalSize = content.length;

    // Precompute boundaries so a surrogate pair kept intact can shift every
    // following offset: trusting `i * chunkSize` would strand the low surrogate
    // at the head of the next chunk (silent character corruption) and report a
    // wrong metadata.offset.
    const boundaries: Array<{ start: number; end: number }> = [];
    let offset = 0;
    while (offset < totalSize && boundaries.length < maxChunks) {
      let end = Math.min(offset + chunkSize, totalSize);
      if (end < totalSize) {
        const lastCode = content.charCodeAt(end - 1);
        // Extend (never shrink) so the boundary never splits a pair.
        if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
          end += 1;
        }
      }
      boundaries.push({ start: offset, end });
      offset = end;
    }

    const totalChunks = boundaries.length;
    const capped = offset < totalSize;

    logger.debug(`Streaming file: ${file.url} (${totalChunks} chunks)`);

    for (let i = 0; i < totalChunks; i++) {
      const { start, end } = boundaries[i]!;
      const chunk = content.slice(start, end);
      const isLast = !capped && i === totalChunks - 1;

      yield {
        chunkIndex: i,
        totalChunks,
        url: file.url,
        content: chunk,
        isLast,
        // When maxChunks truncated the file, the final emitted chunk must not
        // claim completion — mark it so consumers can distinguish "done" from
        // "stopped early".
        truncated: capped && i === totalChunks - 1 ? true : undefined,
        metadata: {
          fileSize: totalSize,
          chunkSize: chunk.length,
          offset: start,
        },
      };
    }
  }

  private resolveChunkSize(requested: number | undefined): number {
    return Number.isFinite(requested) && (requested as number) > 0
      ? Math.floor(requested as number)
      : this.DEFAULT_CHUNK_SIZE;
  }

  private resolveMaxChunks(requested: number | undefined): number {
    return Number.isFinite(requested) && (requested as number) > 0
      ? Math.floor(requested as number)
      : this.DEFAULT_MAX_CHUNKS;
  }

  async *streamFiles(files: CodeFile[], options: StreamOptions = {}): AsyncGenerator<StreamChunk> {
    for (const file of files) {
      for await (const chunk of this.streamFile(file, options)) {
        yield chunk;
      }
    }
  }

  async collectStream(stream: AsyncGenerator<StreamChunk>): Promise<Map<string, string>> {
    const files = new Map<string, string[]>();

    for await (const chunk of stream) {
      if (!files.has(chunk.url)) {
        files.set(chunk.url, []);
      }

      files.get(chunk.url)!.push(chunk.content);
    }

    const result = new Map<string, string>();
    for (const [url, chunks] of files.entries()) {
      result.set(url, chunks.join(''));
    }

    return result;
  }

  async *streamByPriority(
    files: CodeFile[],
    priorities: string[],
    options: StreamOptions = {},
  ): AsyncGenerator<StreamChunk> {
    // Compile once: an invalid pattern must not abort prioritisation, and
    // rebuilding a RegExp per (file, pattern) pair invites pathological cost.
    const priorityRegexes: RegExp[] = [];
    for (const pattern of priorities) {
      try {
        priorityRegexes.push(compileSafeRegex(pattern, 'i'));
      } catch (error) {
        logger.warn(
          `[StreamingCollector] Ignoring invalid priority pattern "${pattern}": ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const scored = files.map((file) => ({
      file,
      score: this.calculatePriority(file, priorityRegexes),
    }));

    scored.sort((a, b) => b.score - a.score);

    for (const { file } of scored) {
      for await (const chunk of this.streamFile(file, options)) {
        yield chunk;
      }
    }
  }

  private calculatePriority(file: CodeFile, priorities: readonly RegExp[]): number {
    let score = 0;

    for (let i = 0; i < priorities.length; i++) {
      const pattern = priorities[i];
      if (pattern?.test(file.url)) {
        score += (priorities.length - i) * PRIORITY_MATCH_WEIGHT;
      }
    }

    if (ENCRYPTION_CONTENT_RE.test(file.content)) score += CONTENT_ENCRYPTION_BONUS;
    if (NETWORK_CONTENT_RE.test(file.content)) score += CONTENT_NETWORK_BONUS;

    return score;
  }

  async *streamFiltered(
    files: CodeFile[],
    filter: (file: CodeFile) => boolean,
    options: StreamOptions = {},
  ): AsyncGenerator<StreamChunk> {
    const filtered = files.filter(filter);

    for await (const chunk of this.streamFiles(filtered, options)) {
      yield chunk;
    }
  }

  async *streamSummaries(files: CodeFile[]): AsyncGenerator<{
    url: string;
    size: number;
    type: string;
    preview: string;
    hasEncryption: boolean;
    hasAPI: boolean;
  }> {
    for (const file of files) {
      const preview = file.content.substring(0, SUMMARY_PREVIEW_CHARS);

      yield {
        url: file.url,
        size: file.size,
        type: file.type,
        preview,
        hasEncryption: ENCRYPTION_CONTENT_RE.test(file.content),
        hasAPI: NETWORK_API_CONTENT_RE.test(file.content),
      };
    }
  }

  async getStreamStats(stream: AsyncGenerator<StreamChunk>): Promise<{
    totalChunks: number;
    totalSize: number;
    files: number;
  }> {
    let totalChunks = 0;
    let totalSize = 0;
    const urls = new Set<string>();

    for await (const chunk of stream) {
      totalChunks++;
      totalSize += chunk.content.length;
      urls.add(chunk.url);
    }

    return {
      totalChunks,
      totalSize,
      files: urls.size,
    };
  }
}
