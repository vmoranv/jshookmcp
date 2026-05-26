import { describe, expect, it } from 'vitest';
import { shannonEntropy, slidingEntropy } from '@modules/binary-secrets/entropy';

describe('shannonEntropy', () => {
  it('returns 0 for an all-zero buffer', () => {
    const buf = new Uint8Array(64);
    expect(shannonEntropy(buf, 0, 64)).toBe(0);
  });

  it('returns 0 for a single distinct byte run', () => {
    const buf = new Uint8Array(32).fill(0x42);
    expect(shannonEntropy(buf, 0, 32)).toBe(0);
  });

  it('returns ~8 for a maximally diverse 256-byte sequence', () => {
    const buf = new Uint8Array(256);
    for (let i = 0; i < 256; i++) buf[i] = i;
    expect(shannonEntropy(buf, 0, 256)).toBeCloseTo(8, 5);
  });

  it('returns ~1 for a perfectly alternating two-symbol run', () => {
    const buf = new Uint8Array(32);
    for (let i = 0; i < 32; i++) buf[i] = i % 2 === 0 ? 0xaa : 0x55;
    expect(shannonEntropy(buf, 0, 32)).toBeCloseTo(1, 6);
  });

  it('returns 0 when length is zero or negative', () => {
    const buf = new Uint8Array(32);
    expect(shannonEntropy(buf, 0, 0)).toBe(0);
    expect(shannonEntropy(buf, 0, -1)).toBe(0);
  });

  it('returns 0 when the slice exceeds the buffer end', () => {
    const buf = new Uint8Array(16);
    expect(shannonEntropy(buf, 0, 32)).toBe(0);
  });

  it('respects start offset within the buffer', () => {
    const buf = new Uint8Array(64);
    for (let i = 0; i < 64; i++) buf[i] = i;
    // Last 32 bytes are still distinct → entropy = log2(32) = 5
    expect(shannonEntropy(buf, 32, 32)).toBeCloseTo(5, 5);
  });
});

describe('slidingEntropy', () => {
  it('emits no values when windowSize exceeds buffer length', () => {
    const buf = new Uint8Array(16);
    const yielded = [...slidingEntropy(buf, 32)];
    expect(yielded).toHaveLength(0);
  });

  it('emits buf.length - windowSize + 1 values', () => {
    const buf = new Uint8Array(64);
    for (let i = 0; i < 64; i++) buf[i] = i;
    const yielded = [...slidingEntropy(buf, 32)];
    expect(yielded).toHaveLength(64 - 32 + 1);
  });

  it('agrees with shannonEntropy at every offset', () => {
    const buf = new Uint8Array(96);
    // Seed with a moderate-entropy sequence (not perfectly uniform).
    for (let i = 0; i < 96; i++) buf[i] = (i * 37 + 13) & 0xff;
    const w = 24;
    for (const [offset, e] of slidingEntropy(buf, w)) {
      const expected = shannonEntropy(buf, offset, w);
      expect(e).toBeCloseTo(expected, 6);
    }
  });

  it('detects a high-entropy island embedded in a zero buffer', () => {
    const buf = new Uint8Array(128);
    // Inject 32 distinct bytes at offset 48.
    for (let i = 0; i < 32; i++) buf[48 + i] = i;
    let bestOffset = -1;
    let bestEntropy = -Infinity;
    for (const [offset, e] of slidingEntropy(buf, 32)) {
      if (e > bestEntropy) {
        bestEntropy = e;
        bestOffset = offset;
      }
    }
    expect(bestOffset).toBe(48);
    expect(bestEntropy).toBeCloseTo(5, 5);
  });
});
