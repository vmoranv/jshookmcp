import { describe, it, expect, vi, beforeEach } from 'vitest';

// oxlint-disable-next-line import/no-unassigned-import
import '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

describe('server/domains/analysis exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes core tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'core',
      definitionExportNames: ['coreTools'],
      loadDefinitions: () => import('@server/domains/analysis/definitions'),
      getToolArrays: (module) => [module.coreTools as Array<Record<string, unknown>>],
      loadManifest: () => import('@server/domains/analysis/manifest'),
    });
  });
});
