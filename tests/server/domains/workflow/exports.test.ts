import { describe, it, expect, vi, beforeEach } from 'vitest';

import '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

describe('server/domains/workflow exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes workflow tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'workflow',
      definitionExportNames: ['workflowToolDefinitions'],
      loadDefinitions: () => import('@server/domains/workflow/definitions'),
      getToolArrays: (module) => [module.workflowToolDefinitions as Array<Record<string, unknown>>],
      loadManifest: () => import('@server/domains/workflow/manifest'),
    });
  });
});
