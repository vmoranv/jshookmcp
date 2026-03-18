import { describe, it, expect, vi, beforeEach } from 'vitest';

import '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

describe('server/domains/transform exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes transform tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'transform',
      definitionExportNames: ['transformTools'],
      loadDefinitions: () => import('@server/domains/transform/definitions'),
      getToolArrays: (module) => [module.transformTools as Array<Record<string, unknown>>],
      loadManifest: () => import('@server/domains/transform/manifest'),
    });
  });
});
