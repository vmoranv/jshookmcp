import { describe, it, expect } from 'vitest';
import { diffSourceMaps } from '../../../../src/server/domains/sourcemap/handlers/sourcemap-parsing';
import type {
  ParsedSourceMapResult,
  SourceMapV3,
} from '../../../../src/server/domains/sourcemap/handlers/shared';
import { decodeMappings } from '../../../../src/server/domains/sourcemap/handlers/shared';

function makeParsed(overrides: Partial<SourceMapV3> = {}): ParsedSourceMapResult {
  const map: SourceMapV3 = {
    version: 3,
    sources: overrides.sources ?? ['src/a.ts', 'src/b.ts'],
    names: overrides.names ?? ['foo', 'bar'],
    mappings: overrides.mappings ?? '',
    sourcesContent: overrides.sourcesContent,
    sourceRoot: overrides.sourceRoot,
  };
  return {
    resolvedUrl: 'https://example.com/bundle.js.map',
    map,
    mappings: decodeMappings(map.mappings),
    mappingsCount: 0,
    segmentCount: 0,
  };
}

function makeParsedWithSegments(
  sources: string[],
  names: string[],
  segmentsA: Array<[number, number, number, number, number?]>,
  segmentsB: Array<[number, number, number, number, number?]>,
): [ParsedSourceMapResult, ParsedSourceMapResult] {
  // Build mappings text from segments
  function encodeSegments(segs: Array<[number, number, number, number, number?]>): string {
    return segs
      .map((s, i) => {
        const prev = i > 0 ? segs[i - 1]! : undefined;
        const genCol = s[0] - (prev ? prev[0] : 0);
        const srcIdx = s[1] - (prev ? prev[1] : 0);
        const origLn = s[2] - (prev ? prev[2] : 0);
        const origCol = s[3] - (prev ? prev[3] : 0);
        const nameIdx =
          s[4] !== undefined ? s[4] - (prev && prev[4] !== undefined ? prev[4] : 0) : undefined;
        // Simple integer encoding (not full VLQ but testable with decodeMappings)
        const parts =
          nameIdx !== undefined
            ? [genCol, srcIdx, origLn, origCol, nameIdx]
            : [genCol, srcIdx, origLn, origCol];
        return parts.join('A'); // 'A' won't be a valid base64 char, but that's OK for testing
      })
      .join(',');
  }

  const mappingsA = encodeSegments(segmentsA);
  const mappingsB = encodeSegments(segmentsB);

  const mapA: SourceMapV3 = { version: 3, sources, names, mappings: mappingsA };
  const mapB: SourceMapV3 = { version: 3, sources, names, mappings: mappingsB };

  // Use simple line:col mapping for tests
  const parsedA: ParsedSourceMapResult = {
    resolvedUrl: 'https://a.com/map',
    map: mapA,
    mappings: segmentsA.map((s, i) => ({
      generatedLine: i + 1,
      generatedColumn: s[0],
      sourceIndex: s[1],
      originalLine: s[2],
      originalColumn: s[3],
      nameIndex: s[4],
    })),
    mappingsCount: segmentsA.length,
    segmentCount: segmentsA.length,
  };
  const parsedB: ParsedSourceMapResult = {
    resolvedUrl: 'https://b.com/map',
    map: mapB,
    mappings: segmentsB.map((s, i) => ({
      generatedLine: i + 1,
      generatedColumn: s[0],
      sourceIndex: s[1],
      originalLine: s[2],
      originalColumn: s[3],
      nameIndex: s[4],
    })),
    mappingsCount: segmentsB.length,
    segmentCount: segmentsB.length,
  };

  return [parsedA, parsedB];
}

describe('diffSourceMaps', () => {
  it('detects added sources', () => {
    const mapA = makeParsed({ sources: ['a.ts'], names: [] });
    const mapB = makeParsed({ sources: ['a.ts', 'b.ts'], names: [] });
    const diff = diffSourceMaps(mapA, mapB);
    expect(diff.sourcesAdded).toEqual(['b.ts']);
    expect(diff.sourcesRemoved).toEqual([]);
    expect(diff.sourcesUnmodified).toEqual(['a.ts']);
  });

  it('detects removed sources', () => {
    const mapA = makeParsed({ sources: ['a.ts', 'b.ts'], names: [] });
    const mapB = makeParsed({ sources: ['a.ts'], names: [] });
    const diff = diffSourceMaps(mapA, mapB);
    expect(diff.sourcesRemoved).toEqual(['b.ts']);
    expect(diff.sourcesAdded).toEqual([]);
  });

  it('detects added and removed names', () => {
    const mapA = makeParsed({ names: ['foo', 'bar'] });
    const mapB = makeParsed({ names: ['bar', 'baz'] });
    const diff = diffSourceMaps(mapA, mapB);
    expect(diff.namesAdded).toEqual(['baz']);
    expect(diff.namesRemoved).toEqual(['foo']);
  });

  it('reports segment counts and deltas', () => {
    const [parsedA, parsedB] = makeParsedWithSegments(
      ['a.ts'],
      ['foo'],
      [[0, 0, 0, 0]],
      [
        [0, 0, 0, 0],
        [5, 0, 1, 0],
      ],
    );
    const diff = diffSourceMaps(parsedA, parsedB);
    expect(diff.segmentsBefore).toBe(1);
    expect(diff.segmentsAfter).toBe(2);
    expect(diff.segmentDelta).toBe(1);
  });

  it('reports per-source segment counts', () => {
    const [parsedA, parsedB] = makeParsedWithSegments(
      ['a.ts', 'b.ts'],
      ['foo'],
      [
        [0, 0, 0, 0],
        [5, 1, 0, 0],
      ],
      [
        [0, 0, 0, 0],
        [5, 1, 0, 0],
        [10, 0, 2, 0],
      ],
    );
    const diff = diffSourceMaps(parsedA, parsedB);
    expect(diff.perSourceDeltas['a.ts']!.segmentsBefore).toBe(1);
    expect(diff.perSourceDeltas['a.ts']!.segmentsAfter).toBe(2);
    expect(diff.perSourceDeltas['a.ts']!.delta).toBe(1);
    expect(diff.perSourceDeltas['b.ts']!.segmentsBefore).toBe(1);
    expect(diff.perSourceDeltas['b.ts']!.segmentsAfter).toBe(1);
  });

  it('same original position → same generated line = no shift', () => {
    const mapA: ParsedSourceMapResult = {
      resolvedUrl: 'a',
      map: { version: 3, sources: ['a.ts'], names: [], mappings: '' },
      mappings: [
        {
          generatedLine: 5,
          generatedColumn: 0,
          sourceIndex: 0,
          originalLine: 2,
          originalColumn: 3,
        },
      ],
      mappingsCount: 1,
      segmentCount: 1,
    };
    const mapB: ParsedSourceMapResult = {
      resolvedUrl: 'b',
      map: { version: 3, sources: ['a.ts'], names: [], mappings: '' },
      mappings: [
        {
          generatedLine: 5,
          generatedColumn: 0,
          sourceIndex: 0,
          originalLine: 2,
          originalColumn: 3,
        },
      ],
      mappingsCount: 1,
      segmentCount: 1,
    };
    const diff = diffSourceMaps(mapA, mapB, 1);
    expect(diff.perSourceDeltas['a.ts']!.positionsShifted).toBe(0);
  });

  it('same original position → different generated line = shift', () => {
    // Same original source position, but moves from generated line 5 to line 12
    const mapA: ParsedSourceMapResult = {
      resolvedUrl: 'a',
      map: { version: 3, sources: ['a.ts'], names: [], mappings: '' },
      mappings: [
        {
          generatedLine: 5,
          generatedColumn: 10,
          sourceIndex: 0,
          originalLine: 2,
          originalColumn: 3,
        },
      ],
      mappingsCount: 1,
      segmentCount: 1,
    };
    const mapB: ParsedSourceMapResult = {
      resolvedUrl: 'b',
      map: { version: 3, sources: ['a.ts'], names: [], mappings: '' },
      mappings: [
        {
          generatedLine: 12,
          generatedColumn: 40,
          sourceIndex: 0,
          originalLine: 2,
          originalColumn: 3,
        },
      ],
      mappingsCount: 1,
      segmentCount: 1,
    };
    const diff = diffSourceMaps(mapA, mapB, 3); // line delta = 7, threshold 3 → flagged
    expect(diff.perSourceDeltas['a.ts']!.positionsShifted).toBe(1);
  });

  it('respects positionThreshold for shift detection', () => {
    const mapA: ParsedSourceMapResult = {
      resolvedUrl: 'a',
      map: { version: 3, sources: ['a.ts'], names: [], mappings: '' },
      mappings: [
        {
          generatedLine: 1,
          generatedColumn: 0,
          sourceIndex: 0,
          originalLine: 1,
          originalColumn: 0,
        },
      ],
      mappingsCount: 1,
      segmentCount: 1,
    };
    const mapB: ParsedSourceMapResult = {
      resolvedUrl: 'b',
      map: { version: 3, sources: ['a.ts'], names: [], mappings: '' },
      mappings: [
        {
          generatedLine: 3,
          generatedColumn: 0,
          sourceIndex: 0,
          originalLine: 1,
          originalColumn: 0,
        },
      ],
      mappingsCount: 1,
      segmentCount: 1,
    };
    // line delta = 2, threshold = 3 → not flagged
    const diffLow = diffSourceMaps(mapA, mapB, 3);
    expect(diffLow.perSourceDeltas['a.ts']!.positionsShifted).toBe(0);
    // line delta = 2, threshold = 1 → flagged
    const diffHigh = diffSourceMaps(mapA, mapB, 1);
    expect(diffHigh.perSourceDeltas['a.ts']!.positionsShifted).toBe(1);
  });

  it('handles empty source lists', () => {
    const mapA = makeParsed({ sources: [], names: [] });
    const mapB = makeParsed({ sources: [], names: [] });
    const diff = diffSourceMaps(mapA, mapB);
    expect(diff.sourcesAdded).toEqual([]);
    expect(diff.sourcesRemoved).toEqual([]);
    expect(diff.segmentDelta).toBe(0);
  });

  it('sorts sources alphabetically', () => {
    const mapA = makeParsed({ sources: ['z.ts', 'a.ts'], names: [] });
    const mapB = makeParsed({ sources: ['a.ts', 'b.ts', 'z.ts'], names: [] });
    const diff = diffSourceMaps(mapA, mapB);
    expect(diff.sourcesAdded).toEqual(['b.ts']);
    expect(diff.sourcesUnmodified).toEqual(['a.ts', 'z.ts']);
  });

  it('perSourceDeltas covers all sources across both maps', () => {
    const mapA = makeParsed({ sources: ['a.ts'], names: [] });
    const mapB = makeParsed({ sources: ['b.ts'], names: [] });
    const diff = diffSourceMaps(mapA, mapB);
    expect(Object.keys(diff.perSourceDeltas)).toEqual(expect.arrayContaining(['a.ts', 'b.ts']));
    expect(diff.perSourceDeltas['a.ts']!.segmentsAfter).toBe(0);
    expect(diff.perSourceDeltas['b.ts']!.segmentsBefore).toBe(0);
  });
});
