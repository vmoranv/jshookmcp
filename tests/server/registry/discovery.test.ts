import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  mockManifests: [] as unknown[],
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@server/registry/generated-domains.js', () => ({
  get generatedManifests() {
    return state.mockManifests;
  },
}));

vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

describe('registry/discovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.DISCOVERY_STRICT;
    state.mockManifests = [];
  });

  it('handles empty generated manifests', async () => {
    const { discoverDomainManifests } = await import('@server/registry/discovery');
    await expect(discoverDomainManifests()).resolves.toEqual([]);
    expect(state.logger.info).toHaveBeenCalledWith(
      '[discovery] Discovered 0 domains, 0 tools total',
    );
  });

  it('loads valid manifests, skips invalid ones, and warns on duplicate domain or depKey', async () => {
    const valid1 = {
      kind: 'domain-manifest',
      version: 1,
      domain: 'alpha',
      depKey: 'alphaDep',
      profiles: [],
      registrations: [{}],
      ensure: () => {},
    };
    const valid2 = {
      kind: 'domain-manifest',
      version: 1,
      domain: 'beta',
      depKey: 'betaDep',
      profiles: [],
      registrations: [{}, {}],
      ensure: () => {},
    };
    const invalid = { kind: 'invalid' };
    const duplicateDomain = {
      kind: 'domain-manifest',
      version: 1,
      domain: 'alpha',
      depKey: 'differentDep',
      profiles: [],
      registrations: [],
      ensure: () => {},
    };
    const duplicateDep = {
      kind: 'domain-manifest',
      version: 1,
      domain: 'gamma',
      depKey: 'betaDep',
      profiles: [],
      registrations: [],
      ensure: () => {},
    };

    state.mockManifests = [valid1, valid2, invalid, duplicateDomain, duplicateDep];

    const { discoverDomainManifests } = await import('@server/registry/discovery');
    const manifests = await discoverDomainManifests();

    expect(manifests.map((item) => item.domain)).toEqual(['alpha', 'beta']);
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no valid DomainManifest export'),
    );
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate domain "alpha"'),
    );
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate depKey "betaDep"'),
    );
    expect(state.logger.info).toHaveBeenCalledWith(
      '[discovery] Discovered 2 domains, 3 tools total',
    );
  });

  it('rethrows errors in strict mode when processing a manifest throws', async () => {
    // We can simulate an error by making a getter throw
    const throwingManifest = {
      get kind() {
        throw new Error('fixture import failed');
      },
    };
    state.mockManifests = [throwingManifest];

    process.env.DISCOVERY_STRICT = 'true';
    const { discoverDomainManifests } = await import('@server/registry/discovery');

    await expect(discoverDomainManifests()).rejects.toThrow('fixture import failed');
  });
});
