/**
 * Shannon entropy helpers for the binary-secrets module.
 *
 * The implementation is intentionally tight: it uses a fixed 256-slot
 * histogram array (no Map allocation) and a precomputed `log2` of the
 * window length so the inner loop is allocation-free.
 *
 * Two flavours are exported:
 *
 *  - {@link shannonEntropy}: compute entropy over a slice in O(N).
 *  - {@link slidingEntropy}: emit a stride-1 sequence of entropy
 *    values for every position whose window fits inside the buffer.
 *
 * Both treat the inputs as **bytes** (0..255) and never throw on
 * out-of-range slice indices — callers are expected to pass valid
 * `start`/`length` pairs.
 */

/**
 * Compute the Shannon entropy of `length` bytes starting at `start` in
 * `buf`. Returns a value in `[0, 8]`. An empty or zero-length slice
 * deterministically returns `0`.
 */
export function shannonEntropy(buf: Uint8Array, start: number, length: number): number {
  if (length <= 0) return 0;
  const end = start + length;
  if (end > buf.length) return 0;

  // 256-slot histogram. New ArrayBuffer per call keeps the function pure;
  // hot paths (sliding scans) should use slidingEntropy() which reuses
  // its histogram across positions.
  const hist = new Uint32Array(256);
  for (let i = start; i < end; i++) {
    hist[buf[i] as number] = ((hist[buf[i] as number] as number) + 1) >>> 0;
  }

  const invN = 1 / length;
  let h = 0;
  for (let i = 0; i < 256; i++) {
    const c = hist[i] as number;
    if (c === 0) continue;
    const p = c * invN;
    h -= p * Math.log2(p);
  }
  // Numerical guard: with the 256-bucket cap and finite-precision math,
  // we can occasionally overshoot 8 by ~1e-12. Clamp for sanity.
  if (h > 8) return 8;
  if (h < 0) return 0;
  return h;
}

/**
 * Emit Shannon entropy at every byte offset where a window of
 * `windowSize` fits in `buf`. Allocation-free body: we maintain a
 * single 256-slot histogram and update it incrementally as the window
 * slides by one byte per iteration.
 *
 * Yields `[offset, entropy]` pairs (relative to the start of `buf`,
 * which the caller is expected to translate to an absolute file offset
 * by adding the chunk's base offset).
 */
export function* slidingEntropy(
  buf: Uint8Array,
  windowSize: number,
): Generator<readonly [number, number]> {
  if (windowSize <= 0 || windowSize > buf.length) return;

  const hist = new Uint32Array(256);
  // Seed: count bytes in the first window.
  for (let i = 0; i < windowSize; i++) {
    hist[buf[i] as number] = ((hist[buf[i] as number] as number) + 1) >>> 0;
  }
  yield [0, computeEntropyFromHist(hist, windowSize)] as const;

  for (let i = windowSize; i < buf.length; i++) {
    const outByte = buf[i - windowSize] as number;
    const inByte = buf[i] as number;
    hist[outByte] = ((hist[outByte] as number) - 1) >>> 0;
    hist[inByte] = ((hist[inByte] as number) + 1) >>> 0;
    yield [i - windowSize + 1, computeEntropyFromHist(hist, windowSize)] as const;
  }
}

function computeEntropyFromHist(hist: Uint32Array, n: number): number {
  const invN = 1 / n;
  let h = 0;
  for (let i = 0; i < 256; i++) {
    const c = hist[i] as number;
    if (c === 0) continue;
    const p = c * invN;
    h -= p * Math.log2(p);
  }
  if (h > 8) return 8;
  if (h < 0) return 0;
  return h;
}
