import { describe, expect, it } from 'vitest';

import {
  ToolSearchEngine as DeprecatedToolSearchEngine,
  type ToolSearchResult as DeprecatedToolSearchResult,
} from '@server/ToolSearch';
import {
  ToolSearchEngine as ImplToolSearchEngine,
  type ToolSearchResult as ImplToolSearchResult,
} from '@server/search/ToolSearchEngineImpl';

describe('ToolSearch.ts deprecated re-exports', () => {
  it('re-exports ToolSearchEngine from search/ToolSearchEngineImpl', () => {
    expect(DeprecatedToolSearchEngine).toBe(ImplToolSearchEngine);
  });

  it('exports ToolSearchResult type compatible with the impl module', () => {
    const result: DeprecatedToolSearchResult = {
      name: 'browser_launch',
      description: 'Launch browser',
      score: 0.95,
      domain: 'browser',
    };
    const implResult: ImplToolSearchResult = result;
    expect(implResult.name).toBe('browser_launch');
    expect(implResult.score).toBe(0.95);
    expect(implResult.domain).toBe('browser');
  });
});
