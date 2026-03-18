import { describe, it, expect, vi, beforeEach } from 'vitest';

import '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

describe('server/domains/sourcemap exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes sourcemap tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'sourcemap',
      definitionExportNames: ['sourcemapTools'],
      loadDefinitions: () => import('@server/domains/sourcemap/definitions'),
      getToolArrays: (module) => [module.sourcemapTools as Array<Record<string, unknown>>],
      loadManifest: () => import('@server/domains/sourcemap/manifest'),
    });
  });
});
