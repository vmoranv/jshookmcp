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

  describe('stem mode (SEARCH_STEM_MODE)', () => {
    const withMode = <T>(mode: string | undefined, run: () => T): T => {
      const previous = process.env['SEARCH_STEM_MODE'];
      if (mode === undefined) delete process.env['SEARCH_STEM_MODE'];
      else process.env['SEARCH_STEM_MODE'] = mode;
      try {
        return run();
      } finally {
        if (previous === undefined) delete process.env['SEARCH_STEM_MODE'];
        else process.env['SEARCH_STEM_MODE'] = previous;
      }
    };

    it('folds verb inflection in the production default mode', () => {
      withMode(undefined, () => {
        expect(process.env['SEARCH_STEM_MODE']).toBeUndefined();
        expect(QueryNormalizer.stemTokenSetToken('running')).toBe('run');
        expect(QueryNormalizer.stemTokenSetToken('collected')).toBe('collect');
        expect(QueryNormalizer.stemTokenSetToken('captured')).toBe('captur');
        expect(QueryNormalizer.stemTokenSetToken('capture')).toBe('captur');
        // Verb mode folds only -ing/-ed; plural forms stay verbatim.
        expect(QueryNormalizer.stemTokenSetToken('executes')).toBe('executes');
      });
    });

    it('keeps plural-bearing and protected tokens intact in the default mode', () => {
      withMode(undefined, () => {
        expect(QueryNormalizer.stemTokenSetToken('sessions')).toBe('sessions');
        expect(QueryNormalizer.stemTokenSetToken('process')).toBe('process');
        expect(QueryNormalizer.stemTokenSetToken('status')).toBe('status');
        expect(QueryNormalizer.stemTokenSetToken('address')).toBe('address');
        expect(QueryNormalizer.stemTokenSetToken('this')).toBe('this');
        expect(QueryNormalizer.stemTokenSetToken('fields')).toBe('fields');
      });
    });

    it('folds plurals only behind the plural variants', () => {
      withMode('plural', () => {
        expect(QueryNormalizer.stemTokenSetToken('sessions')).toBe('session');
        expect(QueryNormalizer.stemTokenSetToken('captchas')).toBe('captcha');
        expect(QueryNormalizer.stemTokenSetToken('process')).toBe('process');
      });
      withMode('off', () => {
        expect(QueryNormalizer.stemTokenSetToken('running')).toBe('running');
        expect(QueryNormalizer.stemRerankToken('running')).toBe('running');
      });
    });

    it('gates each wiring independently', () => {
      withMode('rerank-verb', () => {
        expect(QueryNormalizer.stemRerankToken('running')).toBe('run');
        expect(QueryNormalizer.stemTokenSetToken('running')).toBe('running');
      });
      withMode('tokenset-verb', () => {
        expect(QueryNormalizer.stemTokenSetToken('running')).toBe('run');
        expect(QueryNormalizer.stemRerankToken('running')).toBe('running');
      });
    });

    it('keeps inflected and base forms on one canonical stem', () => {
      withMode(undefined, () => {
        // Short -ing / -ed forms and their silent-e bases (PR #282 finding #6).
        expect(QueryNormalizer.stemTokenSetToken('using')).toBe(
          QueryNormalizer.stemTokenSetToken('use'),
        );
        expect(QueryNormalizer.stemTokenSetToken('moving')).toBe(
          QueryNormalizer.stemTokenSetToken('move'),
        );
        expect(QueryNormalizer.stemTokenSetToken('moved')).toBe(
          QueryNormalizer.stemTokenSetToken('move'),
        );
        // Doubled-stem verbs must not lose a stem letter (#3).
        expect(QueryNormalizer.stemTokenSetToken('processing')).toBe('process');
        expect(QueryNormalizer.stemTokenSetToken('process')).toBe('process');
        expect(QueryNormalizer.stemTokenSetToken('passing')).toBe('pass');
        expect(QueryNormalizer.stemTokenSetToken('pass')).toBe('pass');
        // The tuned happy path still holds.
        expect(QueryNormalizer.stemTokenSetToken('running')).toBe('run');
        expect(QueryNormalizer.stemTokenSetToken('collected')).toBe('collect');
        expect(QueryNormalizer.stemTokenSetToken('captured')).toBe('captur');
        expect(QueryNormalizer.stemTokenSetToken('capture')).toBe('captur');
      });
    });

    it('does not fold -ing nouns or protected trailing-e words into unrelated tokens', () => {
      withMode(undefined, () => {
        // -ing nouns (#1/#2).
        expect(QueryNormalizer.stemTokenSetToken('string')).toBe('string');
        expect(QueryNormalizer.stemTokenSetToken('spring')).toBe('spring');
        expect(QueryNormalizer.stemTokenSetToken('thing')).toBe('thing');
        expect(QueryNormalizer.stemTokenSetToken('handling')).toBe('handling');
        // Trailing-e words that are overwhelmingly nouns/adjectives (#1).
        expect(QueryNormalizer.stemTokenSetToken('state')).toBe('state');
        expect(QueryNormalizer.stemTokenSetToken('drive')).toBe('drive');
        expect(QueryNormalizer.stemTokenSetToken('value')).toBe('value');
      });
    });
  });
});
