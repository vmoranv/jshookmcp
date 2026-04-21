import { beforeEach, describe, expect, it } from 'vitest';
import { BM25ScorerImpl } from '@server/search/BM25Scorer';

describe('search/BM25Scorer', () => {
  const scorer = new BM25ScorerImpl();

  beforeEach(() => {
    // Keep a stable test structure.
  });

  it('uses default query category profiles and boosts matched domains', () => {
    expect(scorer.detectQueryCategoryBoosts('debug breakpoint request')).toEqual(
      new Map([
        ['debugger', 1.6],
        ['v8-inspector', 1.2],
        ['network', 1.6],
        ['browser', 1.1],
      ]),
    );
  });

  it('expands built-in CJK aliases using the default alias list', () => {
    expect(scorer.expandCjkAliasTokens('账号注册验证码')).toEqual(
      expect.arrayContaining(['account', 'user', 'register']),
    );
    expect(scorer.expandCjkAliasTokens('plain english')).toEqual([]);
  });

  it('tokenises separators, camelCase, and CJK text', () => {
    expect(scorer.tokenise('page_navigate userToken')).toEqual(
      expect.arrayContaining(['page', 'navigate', 'user', 'token', 'usertoken']),
    );
    expect(scorer.tokenise('api capture')).toEqual(expect.arrayContaining(['api', 'capture']));
  });

  it('returns the BM25 tuning constants', () => {
    expect(scorer.getK1()).toBe(1.5);
    expect(scorer.getB()).toBe(0.75);
  });

  it('compiles and applies custom search config rules', () => {
    const customScorer = new BM25ScorerImpl({
      queryCategoryProfiles: [
        {
          pattern: '自定义查询',
          flags: 'i',
          domainBoosts: [{ domain: 'workflow', weight: 2.4 }],
        },
      ],
      cjkQueryAliases: [
        {
          pattern: '特征词',
          tokens: ['feature-flag'],
        },
      ],
    });

    expect(customScorer.detectQueryCategoryBoosts('自定义查询')).toEqual(
      new Map([['workflow', 2.4]]),
    );
    expect(customScorer.expandCjkAliasTokens('特征词')).toEqual(['feature-flag']);
  });

  it('ignores invalid custom search config rules', () => {
    const customScorer = new BM25ScorerImpl({
      queryCategoryProfiles: [
        {
          pattern: '[invalid',
          domainBoosts: [{ domain: 'workflow', weight: 2.4 }],
        },
      ],
      cjkQueryAliases: [
        {
          pattern: '[invalid',
          tokens: ['feature-flag'],
        },
      ],
    });

    expect(customScorer.detectQueryCategoryBoosts('自定义查询')).toEqual(new Map());
    expect(customScorer.expandCjkAliasTokens('特征词')).toEqual([]);
  });
});
