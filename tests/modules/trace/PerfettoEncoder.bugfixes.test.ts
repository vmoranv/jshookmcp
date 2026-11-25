import { describe, expect, it } from 'vitest';
import { encodePerfettoTrace } from '@modules/trace/PerfettoEncoder';

describe('PerfettoEncoder bug fixes', () => {
  it('encodes pid/tid as varints (wire type 0), not fixed32', () => {
    const trace = encodePerfettoTrace(
      [{ tid: 42, pid: 7, name: 'main', uuid: 1 }],
      [{ name: 's', category: 'c', timestampUs: 1, durationUs: 1, tid: 42, pid: 7 }],
      [],
    );
    const bytes = Array.from(trace);

    // Field 1 (pid) as fixed32 would carry tag 0x0d; as varint it is 0x08.
    // Field 2 (tid) as fixed32 would carry tag 0x15; as varint it is 0x10.
    expect(bytes).toContain(0x08);
    expect(bytes).toContain(0x10);
    expect(bytes).not.toContain(0x0d);
    expect(bytes).not.toContain(0x15);
  });

  it('emits double_counter_value (field 44, fixed64) for counter events', () => {
    const trace = encodePerfettoTrace(
      [{ tid: 1, pid: 1, name: 'main', uuid: 1 }],
      [],
      [{ name: 'mem', category: 'c', timestampUs: 100, value: 12.5, tid: 1, pid: 1 }],
    );
    const bytes = Array.from(trace);

    // Tag for field 44, wire type 1 (fixed64): (44 << 3) | 1 = 353, encoded as
    // the varint [0xe1, 0x02].
    expect(findSubsequence(bytes, [0xe1, 0x02])).toBeGreaterThanOrEqual(0);
  });

  it('counter_value bytes are non-zero for a non-zero value', () => {
    const trace = encodePerfettoTrace(
      [{ tid: 1, pid: 1, name: 'main', uuid: 1 }],
      [],
      [{ name: 'mem', category: 'c', timestampUs: 100, value: 42, tid: 1, pid: 1 }],
    );
    const bytes = Array.from(trace);
    const tagIndex = findSubsequence(bytes, [0xe1, 0x02]);
    expect(tagIndex).toBeGreaterThanOrEqual(0);
    const valueBytes = bytes.slice(tagIndex + 2, tagIndex + 10);
    expect(valueBytes.some((b) => b !== 0)).toBe(true);
  });

  it('writes track_uuid to field 11 (not timestamp_delta_us field 1)', () => {
    const trace = encodePerfettoTrace(
      [{ tid: 1, pid: 1, name: 'main', uuid: 0x1122334455 }],
      [{ name: 's', category: 'c', timestampUs: 1, durationUs: 1, tid: 1, pid: 1 }],
      [],
    );
    // Field 11 varint tag: (11 << 3) | 0 = 88 = 0x58.
    expect(Array.from(trace)).toContain(0x58);
  });
});

/** First index at which `needle` occurs in `haystack`, or -1. */
function findSubsequence(haystack: number[], needle: number[]): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
