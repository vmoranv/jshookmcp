import { describe, expect, it } from 'vitest';

import { QueryNormalizer } from '@server/search/QueryNormalizer';

describe('search/QueryNormalizer', () => {
  it('extracts parameter name and description tokens while removing stop words', () => {
    const tokens = QueryNormalizer.extractParamTokens({
      properties: {
        targetUrl: {
          description: 'The target URL for the browser request with retries and timeout handling.',
        },
        max_results: {
          description: 'Optional max results to return from search.',
        },
      },
    });

    expect(tokens).toEqual(
      expect.arrayContaining([
        'target',
        'url',
        'browser',
        'request',
        'retries',
        'timeout',
        'handling',
        'max',
        'results',
        'return',
        'search',
      ]),
    );
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('for');
    expect(tokens).not.toContain('optional');
  });

  it('returns an empty array when schema is invalid or has no properties', () => {
    expect(QueryNormalizer.extractParamTokens(null)).toEqual([]);
    expect(QueryNormalizer.extractParamTokens('schema')).toEqual([]);
    expect(QueryNormalizer.extractParamTokens({})).toEqual([]);
    expect(QueryNormalizer.extractParamTokens({ properties: null })).toEqual([]);
  });

  it('extracts short descriptions from the first sentence and truncates long text', () => {
    expect(
      QueryNormalizer.extractShortDescription('First sentence. Second sentence should not appear.'),
    ).toBe('First sentence.');

    const longDescription =
      'A'.repeat(130) + ' Remaining text that should be truncated away completely.';
    expect(QueryNormalizer.extractShortDescription(longDescription)).toBe(`${'A'.repeat(117)}...`);
    expect(QueryNormalizer.extractShortDescription('')).toBe('');
  });

  it('detects CJK text and normalizes tool names', () => {
    expect(QueryNormalizer.containsCJK('测试 query')).toBe(true);
    expect(QueryNormalizer.containsCJK('plain latin query')).toBe(false);
    expect(QueryNormalizer.normalizeToolName('Page Navigate-Now')).toBe('page_navigate_now');
  });
});
