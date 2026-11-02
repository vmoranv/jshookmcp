import { logger } from '@utils/logger';
import type { CodeFile } from '@internal-types/index';
import { truncateUtf16Safe } from '@modules/collector/collector-utils';

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
    const chunkSize = options.chunkSize || this.DEFAULT_CHUNK_SIZE;
    const maxChunks = options.maxChunks || this.DEFAULT_MAX_CHUNKS;

    const content = file.content;
    const totalSize = content.length;
    const rawTotalChunks = Math.ceil(totalSize / chunkSize);
    const capped = rawTotalChunks > maxChunks;
    const totalChunks = Math.min(rawTotalChunks, maxChunks);

    logger.debug(`Streaming file: ${file.url} (${totalChunks} chunks)`);

    for (let i = 0; i < totalChunks; i++) {
      const offset = i * chunkSize;
      // Do not split a UTF-16 surrogate pair across chunk boundaries — reuse
      // the same safe-truncation helper as SmartCodeCollector.
      const chunk = truncateUtf16Safe(content, Math.min(offset + chunkSize, totalSize)).substring(
        offset,
      );
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
          offset,
        },
      };
    }
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
    const scored = files.map((file) => ({
      file,
      score: this.calculatePriority(file, priorities),
    }));

    scored.sort((a, b) => b.score - a.score);

    for (const { file } of scored) {
      for await (const chunk of this.streamFile(file, options)) {
        yield chunk;
      }
    }
  }

  private calculatePriority(file: CodeFile, priorities: string[]): number {
    let score = 0;

    for (let i = 0; i < priorities.length; i++) {
      const pattern = priorities[i];
      if (pattern && new RegExp(pattern, 'i').test(file.url)) {
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
