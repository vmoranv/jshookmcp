import { describe, it, expect, vi, beforeEach } from 'vitest';

import { manifestTestMocksInstalled } from '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

void manifestTestMocksInstalled;

describe('server/domains/network exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes network tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'network',
      definitionExportNames: ['advancedTools'],
      loadDefinitions: () => import('@server/domains/network/definitions'),
      getToolArrays: (module) => [module.advancedTools as Array<Record<string, unknown>>],
      loadManifest: () => import('@server/domains/network/manifest'),
    });
  });
});
