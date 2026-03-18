import { describe, it, expect, vi, beforeEach } from 'vitest';

import '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

describe('server/domains/streaming exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes streaming tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'streaming',
      definitionExportNames: ['streamingTools'],
      loadDefinitions: () => import('@server/domains/streaming/definitions'),
      getToolArrays: (module) => [module.streamingTools as Array<Record<string, unknown>>],
      loadManifest: () => import('@server/domains/streaming/manifest'),
    });
  });
});
