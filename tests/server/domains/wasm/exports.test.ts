import { describe, it, expect, vi, beforeEach } from 'vitest';

// oxlint-disable-next-line import/no-unassigned-import
import '../shared/manifest-test-mocks';
import { assertDomainExportContract } from '../shared/export-contract-helpers';

describe('server/domains/wasm exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes wasm tool definitions and a matching manifest', async () => {
    expect.hasAssertions();

    await assertDomainExportContract({
      expectedDomain: 'wasm',
      definitionExportNames: ['wasmTools'],
      loadDefinitions: () => import('@server/domains/wasm/definitions'),
      getToolArrays: (module) => [module.wasmTools as Array<Record<string, unknown>>],
      loadManifest: () => import('@server/domains/wasm/manifest'),
    });
  });
});
