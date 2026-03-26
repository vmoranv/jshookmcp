import { describe, it, expect, vi, beforeEach } from 'vitest';

// oxlint-disable-next-line import/no-unassigned-import
import '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

describe('server/domains/debugger exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes debugger tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'debugger',
      definitionExportNames: ['debuggerTools'],
      loadDefinitions: () => import('@server/domains/debugger/definitions'),
      getToolArrays: (module) => [module.debuggerTools as Array<Record<string, unknown>>],
      loadManifest: () => import('@server/domains/debugger/manifest'),
    });
  });
});
