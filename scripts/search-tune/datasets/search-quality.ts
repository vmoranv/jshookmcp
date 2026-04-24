/**
 * Dataset loader for search-quality fixture.
 * Re-exports fixture data for worker consumption.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { SearchEvalCase } from '../../../tests/server/search/fixtures/search-quality.fixture';
import { buildSearchQualityFixture } from '../../../tests/server/search/fixtures/search-quality.fixture';

export type { SearchEvalCase } from '../../../tests/server/search/fixtures/search-quality.fixture';

export interface LoadedSearchDataset {
  readonly name: 'search-quality';
  readonly tools: readonly Tool[];
  readonly domainOverrides: ReadonlyMap<string, string>;
  readonly cases: readonly SearchEvalCase[];
}

export function loadSearchQualityDataset(): LoadedSearchDataset {
  const fixture = buildSearchQualityFixture();
  return {
    name: 'search-quality',
    tools: fixture.tools,
    domainOverrides: fixture.domainByToolName,
    cases: fixture.cases,
  };
}
