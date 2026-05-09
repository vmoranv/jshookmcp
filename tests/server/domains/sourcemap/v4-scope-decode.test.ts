import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decodeVlqSegment,
  decodeVlqSegmentUnsigned,
} from '@server/domains/sourcemap/handlers/shared';
import { SourcemapToolHandlers } from '@server/domains/sourcemap/handlers';
import { createCodeCollectorMock, parseJson } from '@tests/server/domains/shared/mock-factories';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const globalFetch = vi.fn();

global.fetch = globalFetch as unknown as typeof fetch;

function encodeVlqUnsigned(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Expected non-negative integer, got ${value}`);
  }

  let remaining = value;
  let encoded = '';
  do {
    let digit = remaining & 31;
    remaining >>= 5;
    if (remaining > 0) digit |= 32;
    encoded += BASE64_ALPHABET[digit];
  } while (remaining > 0);

  return encoded;
}

function encodeVlqSigned(value: number): string {
  const magnitude = Math.abs(value) << 1;
  const rawValue = value < 0 ? magnitude | 1 : magnitude;
  return encodeVlqUnsigned(rawValue);
}

describe('ECMA-426 Source Map V4 — VLQ decoding', () => {
  beforeEach(() => {
    globalFetch.mockReset();
  });

  describe('decodeVlqSegment (signed)', () => {
    it('decodes simple values', () => {
      // A=0, C=1 (+1), D=-1 (3: bit0=1 negative, >>1=1)
      expect(decodeVlqSegment('A')).toEqual([0]);
      expect(decodeVlqSegment('C')).toEqual([1]);
      expect(decodeVlqSegment('D')).toEqual([-1]);
      expect(decodeVlqSegment('AAAA')).toEqual([0, 0, 0, 0]);
    });

    it('handles negative deltas', () => {
      // D=3 → signed -1, J=9 → signed: isNeg=true, shifted=4, result=-4? No.
      // J base64 index = 9. fromVlqSigned(9): isNeg=(9&1)=1, shifted=9>>1=4, return -4
      expect(decodeVlqSegment('D')).toEqual([-1]);
      expect(decodeVlqSegment('J')).toEqual([-4]);
    });
  });

  describe('decodeVlqSegmentUnsigned (unsigned)', () => {
    it('returns raw unsigned values without sign conversion', () => {
      // A=0, B=1, C=2, D=3, H=7
      expect(decodeVlqSegmentUnsigned('A')).toEqual([0]);
      expect(decodeVlqSegmentUnsigned('B')).toEqual([1]);
      expect(decodeVlqSegmentUnsigned('C')).toEqual([2]);
      expect(decodeVlqSegmentUnsigned('D')).toEqual([3]);
      expect(decodeVlqSegmentUnsigned('H')).toEqual([7]);
    });

    it('differs from signed for odd raw values', () => {
      // D raw=3. Unsigned=[3], Signed=[-1]
      const unsigned = decodeVlqSegmentUnsigned('D');
      const signed = decodeVlqSegment('D');
      expect(unsigned[0]).not.toEqual(signed[0]);
      expect(unsigned[0]).toBe(3);
      expect(signed[0]).toBe(-1);
    });

    it('handles ECMA-426 flag bitmask values', () => {
      // For flags: 7 = 0b111 (name=1 + kind=2 + stackframe=4)
      expect(decodeVlqSegmentUnsigned('H')[0]).toBe(7);
      // 5 = 0b101 (name=1 + stackframe=4)
      expect(decodeVlqSegmentUnsigned('F')[0]).toBe(5);
    });
  });

  it('decodeVlqSegment throws on invalid base64 char', () => {
    expect(() => decodeVlqSegment('@')).toThrow(/Invalid VLQ base64 char/);
  });

  it('unsigned decoder handles multi-byte values', () => {
    // '+' is base64 index 62. 62 & 32 = 32 (continuation). 62 & 31 = 30.
    // 'B' is index 1. No continuation. result = 30 + (1 << 5) = 62.
    const result = decodeVlqSegmentUnsigned('+B');
    expect(result[0]).toBe(62);
  });

  describe('sourcemap_parse_v4 scope decoding', () => {
    it('uses unsigned decoding for original and generated range positions', async () => {
      const handlers = new SourcemapToolHandlers(createCodeCollectorMock() as any);
      const map = {
        version: 3,
        mappings: 'A',
        sources: ['input.ts'],
        names: [],
        scopes: [
          `B${encodeVlqUnsigned(0)}${encodeVlqUnsigned(3)}${encodeVlqUnsigned(5)}`,
          `C${encodeVlqUnsigned(0)}${encodeVlqUnsigned(7)}`,
          `E${encodeVlqUnsigned(1)}${encodeVlqUnsigned(3)}${encodeVlqUnsigned(5)}`,
          `F${encodeVlqUnsigned(7)}`,
        ].join(','),
      };

      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(map),
      });

      const result = parseJson<any>(
        await handlers.handleSourcemapParseV4({
          sourceMapUrl: withPath(TEST_URLS.root, 'app.js.map'),
        }),
      );

      expect(result.success).toBe(true);
      expect(result.scopes.originalScopes[0]).toMatchObject({
        start: { line: 3, column: 5 },
        end: { line: 3, column: 12 },
      });
      expect(result.scopes.generatedRanges[0]).toMatchObject({
        start: { line: 3, column: 5 },
        end: { line: 3, column: 12 },
      });
    });

    it('uses unsigned decoding for bindings, subranges, and callsites while keeping signed definition deltas', async () => {
      const handlers = new SourcemapToolHandlers(createCodeCollectorMock() as any);
      const map = {
        version: 3,
        mappings: 'A',
        sources: ['input.ts'],
        names: ['n0', 'n1', 'n2', 'n3'],
        scopes: [
          `B${encodeVlqUnsigned(0)}${encodeVlqUnsigned(0)}${encodeVlqUnsigned(0)}`,
          `C${encodeVlqUnsigned(0)}${encodeVlqUnsigned(1)}`,
          `E${encodeVlqUnsigned(3)}${encodeVlqUnsigned(3)}${encodeVlqUnsigned(5)}${encodeVlqSigned(-1)}`,
          `G${encodeVlqUnsigned(3)}`,
          `H${encodeVlqUnsigned(2)}${encodeVlqUnsigned(3)}${encodeVlqUnsigned(5)}${encodeVlqUnsigned(7)}`,
          `I${encodeVlqUnsigned(3)}${encodeVlqUnsigned(5)}${encodeVlqUnsigned(7)}`,
          `F${encodeVlqUnsigned(7)}`,
        ].join(','),
      };

      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(map),
      });

      const result = parseJson<any>(
        await handlers.handleSourcemapParseV4({
          sourceMapUrl: withPath(TEST_URLS.root, 'app.js.map'),
        }),
      );

      expect(result.success).toBe(true);
      expect(result.scopes.generatedRanges[0]).toMatchObject({
        start: { line: 3, column: 5 },
        end: { line: 3, column: 12 },
        definitionIndex: -1,
        callsite: { sourceIndex: 3, line: 5, column: 7 },
      });
      expect(result.scopes.generatedRanges[0].bindings[0]).toBe('n2');
      expect(result.scopes.generatedRanges[0].bindings[2]).toEqual([
        {
          from: { line: 8, column: 7 },
          expression: 'n2',
        },
      ]);
    });
  });
});
