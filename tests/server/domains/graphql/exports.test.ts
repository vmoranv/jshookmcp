import { describe, it, expect, vi, beforeEach } from 'vitest';

import '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

describe('server/domains/graphql exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes GraphQL tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'graphql',
      definitionExportNames: ['graphqlTools'],
      loadDefinitions: () => import('@server/domains/graphql/definitions'),
      getToolArrays: (module) => [module.graphqlTools as Array<Record<string, unknown>>],
      loadManifest: () => import('@server/domains/graphql/manifest'),
    });
  });
});
