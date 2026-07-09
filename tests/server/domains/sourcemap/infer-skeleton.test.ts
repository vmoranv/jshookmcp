import { describe, expect, it } from 'vitest';

import { inferSourceSkeleton } from '@server/domains/sourcemap/handlers/sourcemap-parsing';
import type { DecodedMapping } from '@server/domains/sourcemap/handlers/shared';

describe('inferSourceSkeleton', () => {
  const map = {
    version: 3 as const,
    sources: ['app.js'],
    sourcesContent: [null],
    names: ['foo', 'bar'],
    mappings: '',
  };

  it('reconstructs a name+position skeleton from segments when sourcesContent is stripped', () => {
    const mappings: DecodedMapping[] = [
      {
        generatedLine: 0,
        generatedColumn: 0,
        sourceIndex: 0,
        originalLine: 1,
        originalColumn: 0,
        nameIndex: 0,
      },
      {
        generatedLine: 0,
        generatedColumn: 10,
        sourceIndex: 0,
        originalLine: 2,
        originalColumn: 4,
        nameIndex: 1,
      },
    ];
    const skeleton = inferSourceSkeleton(0, map, mappings);
    expect(skeleton).toContain('Inferred source skeleton');
    expect(skeleton).toContain('stripped');
    expect(skeleton).toContain('foo');
    expect(skeleton).toContain('bar');
    expect(skeleton).toContain('L1:0');
    expect(skeleton).toContain('L2:4');
  });

  it('reports zero segments when the source has no mappings', () => {
    const skeleton = inferSourceSkeleton(0, map, []);
    expect(skeleton).toContain('0 mapping segment');
  });

  it('filters segments to the requested source index', () => {
    const twoSrcMap = { ...map, sources: ['a.js', 'b.js'], sourcesContent: [null, null] };
    const mappings: DecodedMapping[] = [
      {
        generatedLine: 0,
        generatedColumn: 0,
        sourceIndex: 0,
        originalLine: 1,
        originalColumn: 0,
        nameIndex: 0,
      },
    ];
    const skeletonB = inferSourceSkeleton(1, twoSrcMap, mappings);
    expect(skeletonB).toContain('0 mapping segment');
    const skeletonA = inferSourceSkeleton(0, twoSrcMap, mappings);
    expect(skeletonA).toContain('foo');
  });

  it('sorts segments by original line then column', () => {
    const mappings: DecodedMapping[] = [
      {
        generatedLine: 0,
        generatedColumn: 20,
        sourceIndex: 0,
        originalLine: 2,
        originalColumn: 0,
      },
      {
        generatedLine: 0,
        generatedColumn: 0,
        sourceIndex: 0,
        originalLine: 1,
        originalColumn: 5,
      },
    ];
    const skeleton = inferSourceSkeleton(0, map, mappings);
    expect(skeleton.indexOf('L1:5')).toBeLessThan(skeleton.indexOf('L2:0'));
  });

  it('omits the name token when nameIndex is absent', () => {
    const mappings: DecodedMapping[] = [
      { generatedLine: 0, generatedColumn: 0, sourceIndex: 0, originalLine: 1, originalColumn: 0 },
    ];
    const skeleton = inferSourceSkeleton(0, map, mappings);
    expect(skeleton).toContain('L1:0');
    expect(skeleton).not.toContain('foo');
  });
});
