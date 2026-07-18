import { logger } from '@utils/logger';

export class ResponseBodyCache {
  private cache = new Map<
    string,
    { value: { body: string; base64Encoded: boolean }; sizeBytes: number }
  >();
  private maxEntries: number;
  private maxBytes: number;
  private maxBodyBytes: number;
  private totalBytes = 0;

  constructor(maxEntries = 200, maxBytes = 64 * 1024 * 1024, maxBodyBytes = 1024 * 1024) {
    this.maxEntries = Math.max(1, maxEntries);
    this.maxBytes = Math.max(0, maxBytes);
    this.maxBodyBytes = Math.max(0, maxBodyBytes);
  }

  setMaxEntries(max: number): void {
    this.maxEntries = Math.max(1, max);
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      if (oldest) this.totalBytes -= oldest.sizeBytes;
    }
  }

  set(
    requestId: string,
    body: string,
    base64Encoded: boolean,
    _mimeType: string,
    _sizeBytes: number,
  ): void {
    const measuredBytes = base64Encoded
      ? Buffer.byteLength(body, 'base64')
      : Buffer.byteLength(body, 'utf8');
    const bodyBytes = measuredBytes;
    if (bodyBytes > this.maxBodyBytes || bodyBytes > this.maxBytes) {
      logger.debug(`[PW-BodyCache] Skipping oversized body for ${requestId} (${bodyBytes} bytes)`);
      return;
    }

    const existing = this.cache.get(requestId);
    if (existing) {
      this.totalBytes -= existing.sizeBytes;
      this.cache.delete(requestId);
    }
    this.evictToBudget(bodyBytes);

    this.cache.set(requestId, {
      value: { body, base64Encoded },
      sizeBytes: bodyBytes,
    });
    this.totalBytes += bodyBytes;
    logger.debug(`[PW-BodyCache] Cached body for ${requestId} (${bodyBytes} bytes)`);
  }

  get(requestId: string): { body: string; base64Encoded: boolean } | null {
    const cached = this.cache.get(requestId);
    if (cached) {
      // LRU refresh: move to end
      this.cache.delete(requestId);
      this.cache.set(requestId, cached);
      logger.debug(`[PW-BodyCache] Cache hit for ${requestId}`);
      return cached.value;
    }
    logger.warn(`getResponseBody: no cached body for ${requestId} in Playwright mode`);
    return null;
  }

  clear(): void {
    this.cache.clear();
    this.totalBytes = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  get byteSize(): number {
    return this.totalBytes;
  }

  private evictToBudget(incomingBytes: number): void {
    while (
      this.cache.size > 0 &&
      (this.cache.size >= this.maxEntries || this.totalBytes + incomingBytes > this.maxBytes)
    ) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      if (oldest) this.totalBytes -= oldest.sizeBytes;
    }
  }
}

export function isTextMimeType(mimeType: string): boolean {
  return /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded))/i.test(mimeType);
}
