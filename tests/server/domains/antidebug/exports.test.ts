import { describe, it, expect, vi, beforeEach } from 'vitest';

// oxlint-disable-next-line import/no-unassigned-import
import '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

describe('server/domains/antidebug exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes anti-debug tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'antidebug',
      definitionExportNames: ['antidebugTools'],
      loadDefinitions: () => import('@server/domains/antidebug/definitions'),
      getToolArrays: (module) => [module.antidebugTools as Array<Record<string, unknown>>],
      loadManifest: () => import('@server/domains/antidebug/manifest'),
    });
  });
});
