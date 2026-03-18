import { describe, it, expect, vi, beforeEach } from 'vitest';

import '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

describe('server/domains/maintenance exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes maintenance tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'maintenance',
      definitionExportNames: ['artifactTools', 'cacheTools', 'extensionTools', 'tokenBudgetTools'],
      loadDefinitions: () => import('@server/domains/maintenance/definitions'),
      getToolArrays: (module) => [
        module.tokenBudgetTools as Array<Record<string, unknown>>,
        module.cacheTools as Array<Record<string, unknown>>,
        module.artifactTools as Array<Record<string, unknown>>,
        module.extensionTools as Array<Record<string, unknown>>,
      ],
      loadManifest: () => import('@server/domains/maintenance/manifest'),
    });
  });
});
