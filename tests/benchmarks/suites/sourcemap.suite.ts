/**
 * Sourcemap domain benchmark.
 *
 * External references:
 *  - Source map v3 mappings VLQ: the canonical segment "AAAA" = [genCol 0, srcIdx 0,
 *    origLine 0, origCol 0]; "AACA" adds originalColumn 1 (ECMA-426 / mozilla/source-map
 *    reference semantics)
 * Homemade fixtures:
 *  - bidirectional lookup roundtrip (generated → original → generated)
 *  - closest-preceding fallback semantics
 *  - coverage summary counts
 */
import { SourcemapToolHandlers } from '@server/domains/sourcemap/handlers';
import { body, expectSuccess, type BenchSuite } from '../harness';

const collector = { getActivePage: async () => null } as never;
const handlers = new SourcemapToolHandlers(collector);

function inlineMapUrl(map: Record<string, unknown>): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`;
}

// Minimal map: two sources, segments on two generated lines.
// Line 1: "AAAA,CAAC" → (col 0 → src0/orig 1:0), (col 2 → src0/orig 1:1)
// Line 2: "AACA" → (col 0 → src0/orig 1:2... wait: fields are [genCol, srcIdx, origLineDelta, origColDelta]) —
// for line 2 the deltas reset per line: AACA = genCol 0, srcIdx 0, origLine +0, origCol +1 relative to line 1 state.
const TEST_MAP = {
  version: 3,
  file: 'bench.min.js',
  sources: ['a.ts'],
  sourcesContent: ['line one\nline two\n'],
  names: [],
  mappings: 'AAAA;AACA',
};

export const sourcemapSuite: BenchSuite = {
  name: 'sourcemap',
  domain: 'sourcemap',
  description:
    'VLQ mapping decode (canonical AAAA segments), bidirectional position lookup, coverage accounting',
  cases: [
    {
      name: 'sourcemap_lookup/canonical-AAAA-segment',
      tool: 'sourcemap_lookup',
      origin: 'external-vector',
      reference:
        'source map v3 spec: mappings "AAAA;AACA" — generated 1:0 resolves to source a.ts original 1:0; 2:0 → original 1:1 (deltas per ECMA-426)',
      run: () =>
        handlers.handleSourcemapLookup({
          sourceMapUrl: inlineMapUrl(TEST_MAP),
          line: 1,
          column: 0,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const original = b.original as
          | { source?: string; line?: number; column?: number }
          | undefined;
        if (!original) return 'no original in response';
        if (original.source !== 'a.ts') return `expected source a.ts, got ${original.source}`;
        if (original.line !== 1) return `expected original line 1, got ${original.line}`;
        if (original.column !== 0) return `expected original column 0, got ${original.column}`;
        return true;
      },
    },
    {
      name: 'sourcemap_lookup/second-line-vlq-delta',
      tool: 'sourcemap_lookup',
      origin: 'external-vector',
      reference:
        'ECMA-426 VLQ semantics: line-2 segment AACA = [genCol 0, srcIdx 0, origLine +1, origCol +0] ⇒ original 2:0',
      run: () =>
        handlers.handleSourcemapLookup({
          sourceMapUrl: inlineMapUrl(TEST_MAP),
          line: 2,
          column: 0,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const original = b.original as { line?: number; column?: number } | undefined;
        if (!original) return 'no original in response';
        if (original.line !== 2 || original.column !== 0)
          return `expected original 2:0, got ${original.line}:${original.column}`;
        return true;
      },
    },
    {
      name: 'sourcemap_lookup/reverse-roundtrip',
      tool: 'sourcemap_lookup',
      origin: 'homemade',
      reference:
        'bidirectional contract: original (a.ts, 1, 0) must map back to generated 1:0 with matchType exact',
      run: () =>
        handlers.handleSourcemapLookup({
          sourceMapUrl: inlineMapUrl(TEST_MAP),
          originalSource: 'a.ts',
          originalLine: 1,
          originalColumn: 0,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        const generated = b.generated as { line?: number; column?: number } | undefined;
        if (!generated) return 'no generated in response';
        if (generated.line !== 1 || generated.column !== 0)
          return `expected generated 1:0, got ${generated.line}:${generated.column}`;
        if (b.matchType !== 'exact') return `expected matchType exact, got ${b.matchType}`;
        return true;
      },
    },
    {
      name: 'sourcemap_lookup/closest-preceding-fallback',
      tool: 'sourcemap_lookup',
      origin: 'homemade',
      reference:
        'lookup at an unmapped column must fall back to the closest-preceding segment on the same line',
      run: () =>
        handlers.handleSourcemapLookup({
          sourceMapUrl: inlineMapUrl(TEST_MAP),
          line: 1,
          column: 9,
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.matchType !== 'closest-preceding')
          return `expected closest-preceding, got ${b.matchType}`;
        const original = b.original as { source?: string } | undefined;
        return original?.source === 'a.ts' ? true : `unexpected source ${original?.source}`;
      },
    },
    {
      name: 'sourcemap_coverage/counts',
      tool: 'sourcemap_coverage',
      origin: 'homemade',
      reference:
        'coverage summary must count the 2 mapped segments of the fixture map and report source a.ts',
      run: () => handlers.handleSourcemapCoverageTool({ sourceMapUrl: inlineMapUrl(TEST_MAP) }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        const text = JSON.stringify(b);
        if (!text.includes('a.ts')) return 'fixture source a.ts missing from coverage';
        return true;
      },
    },
    {
      name: 'sourcemap_fetch_and_parse/inline-sources-content',
      tool: 'sourcemap_fetch_and_parse',
      origin: 'homemade',
      reference:
        'fetches and parses data: URI sourcemap directly, returning sources and sourcesContent',
      run: () =>
        handlers.handleSourcemapFetchAndParseTool({
          sourceMapUrl: inlineMapUrl(TEST_MAP),
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const text = JSON.stringify(b);
        if (!text.includes('a.ts') || !text.includes('line one')) {
          return `expected parsed sources with a.ts and contents, got: ${text.slice(0, 200)}`;
        }
        return true;
      },
    },
    {
      name: 'sourcemap_diff/identical-map-no-drift',
      tool: 'sourcemap_diff',
      origin: 'homemade',
      reference:
        'diff between identical sourcemaps reports 0 added/removed sources and no shifted segments',
      run: () =>
        handlers.handleSourcemapDiffTool({
          sourceMapUrl: inlineMapUrl(TEST_MAP),
          sourceMapUrlB: inlineMapUrl(TEST_MAP),
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const text = JSON.stringify(b);
        if (b.hasChanges === true || text.includes('"addedSources":["a.ts"]')) {
          return `expected no changes for identical maps, got: ${text.slice(0, 200)}`;
        }
        return true;
      },
    },
    {
      name: 'sourcemap_reconstruct_tree/tree-structure-contract',
      tool: 'sourcemap_reconstruct_tree',
      origin: 'homemade',
      reference:
        'reconstructs source file tree into report artifacts and returns written files list',
      run: () =>
        handlers.handleSourcemapReconstructTreeTool({
          sourceMapUrl: inlineMapUrl(TEST_MAP),
        }),
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        const text = JSON.stringify(b);
        if (!text.includes('writtenFiles') || !text.includes('outputDir')) {
          return `expected writtenFiles and outputDir in tree reconstruction, got: ${text.slice(0, 200)}`;
        }
        return true;
      },
    },
  ],
};
