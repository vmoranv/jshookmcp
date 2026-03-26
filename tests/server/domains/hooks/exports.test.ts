import { describe, it, expect, vi, beforeEach } from 'vitest';

// oxlint-disable-next-line import/no-unassigned-import
import '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

describe('server/domains/hooks exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes hook tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'hooks',
      definitionExportNames: ['aiHookTools', 'hookPresetTools'],
      loadDefinitions: () => import('@server/domains/hooks/definitions'),
      getToolArrays: (module) => [
        module.aiHookTools as Array<Record<string, unknown>>,
        module.hookPresetTools as Array<Record<string, unknown>>,
      ],
      loadManifest: () => import('@server/domains/hooks/manifest'),
    });
  });
});
