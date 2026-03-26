import { describe, it, expect, vi, beforeEach } from 'vitest';

import { manifestTestMocksInstalled } from '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

void manifestTestMocksInstalled;

describe('server/domains/platform exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes platform tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'platform',
      definitionExportNames: ['platformTools'],
      loadDefinitions: () => import('@server/domains/platform/definitions'),
      getToolArrays: (module) => [module.platformTools as Array<Record<string, unknown>>],
      loadManifest: () => import('@server/domains/platform/manifest'),
    });
  });
});
