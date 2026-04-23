/**
 * Zero-copy buffer chain — avoids repeated Buffer.concat allocations.
 *
 * Appends chunks without copying. Materializes into a single Buffer only
 * when `toBuffer()` is called. Tracks total byte length for size limits.
 */
export class BufferChain {
  private chunks: Buffer[] = [];
  private totalLength = 0;

  /** Number of bytes accumulated so far. */
  get length(): number {
    return this.totalLength;
  }

  /** Append a chunk without copying. */
  append(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.totalLength += chunk.length;
  }

  /** Materialize all chunks into a single Buffer. */
  toBuffer(): Buffer {
    if (this.chunks.length === 0) return Buffer.alloc(0);
    if (this.chunks.length === 1) return this.chunks[0]!;
    const result = Buffer.concat(this.chunks, this.totalLength);
    this.chunks = [result];
    return result;
  }

  /** Reset the chain, releasing all chunk references. */
  reset(): void {
    this.chunks = [];
    this.totalLength = 0;
  }

  /** Whether any data has been accumulated. */
  get isEmpty(): boolean {
    return this.totalLength === 0;
  }
}
