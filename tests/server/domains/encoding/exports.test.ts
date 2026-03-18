import { describe, it, expect, vi, beforeEach } from 'vitest';

import '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

describe('server/domains/encoding exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes encoding tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'encoding',
      definitionExportNames: ['encodingTools'],
      loadDefinitions: () => import('@server/domains/encoding/definitions'),
      getToolArrays: (module) => [module.encodingTools as Array<Record<string, unknown>>],
      loadManifest: () => import('@server/domains/encoding/manifest'),
    });
  });
});
