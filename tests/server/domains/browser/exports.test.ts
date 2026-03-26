import { describe, it, expect, vi, beforeEach } from 'vitest';

// oxlint-disable-next-line import/no-unassigned-import
import '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

describe('server/domains/browser exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes browser tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'browser',
      definitionExportNames: ['advancedBrowserToolDefinitions', 'browserTools'],
      loadDefinitions: () => import('@server/domains/browser/definitions'),
      getToolArrays: (module) => [
        module.browserTools as Array<Record<string, unknown>>,
        module.advancedBrowserToolDefinitions as Array<Record<string, unknown>>,
      ],
      loadManifest: () => import('@server/domains/browser/manifest'),
    });
  });
});
