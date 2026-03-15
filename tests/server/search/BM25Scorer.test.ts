import { beforeEach, describe, expect, it } from 'vitest';
import {
  BM25ScorerImpl,
  QUERY_CATEGORY_PROFILES,
} from '@server/search/BM25Scorer';

describe('search/BM25Scorer', () => {
  const scorer = new BM25ScorerImpl();

  beforeEach(() => {
    // Keep a stable test structure.
  });

  it('exposes query category profiles and boosts matched domains', () => {
    expect(QUERY_CATEGORY_PROFILES.length).toBeGreaterThan(0);
    expect(scorer.detectQueryCategoryBoosts('debug 断点 request')).toEqual(
      new Map([
        ['debugger', 1.6],
        ['runtime', 1.2],
        ['network', 1.6],
        ['browser', 1.1],
      ]),
    );
  });

  it('expands Chinese aliases for search intent', () => {
    expect(scorer.expandCjkAliasTokens('账号注册验证码')).toEqual(
      expect.arrayContaining(['account', 'register', 'signup', 'captcha', 'verify', 'verification']),
    );
    expect(scorer.expandCjkAliasTokens('plain english')).toEqual([]);
  });

  it('tokenises separators, camelCase, and CJK text', () => {
    expect(scorer.tokenise('page_navigate userToken')).toEqual(
      expect.arrayContaining(['page', 'navigate', 'user', 'token', 'usertoken']),
    );
    expect(scorer.tokenise('抓取接口')).toEqual(expect.arrayContaining(['抓', '取', '接', '口', 'capture', 'api']));
  });

  it('returns the BM25 tuning constants', () => {
    expect(scorer.getK1()).toBe(1.5);
    expect(scorer.getB()).toBe(0.3);
  });
});
