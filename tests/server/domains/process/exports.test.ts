import { describe, it, expect, vi, beforeEach } from 'vitest';

// oxlint-disable-next-line import/no-unassigned-import
import '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

describe('server/domains/process exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes process tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'process',
      definitionExportNames: ['processToolDefinitions'],
      loadDefinitions: () => import('@server/domains/process/definitions'),
      getToolArrays: (module) => [module.processToolDefinitions as Array<Record<string, unknown>>],
      loadManifest: () => import('@server/domains/process/manifest'),
    });
  });
});
