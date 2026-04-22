import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  mockLoaders: [] as Array<{
    domain: string;
    depKey: string;
    profiles: readonly string[];
    secondaryDepKeys: readonly string[];
    load: () => Promise<unknown>;
  }>,
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@server/registry/generated-domains.js', () => ({
  get generatedManifestLoaders() {
    return state.mockLoaders;
  },
  get DOMAIN_PROFILE_MAP() {
    const map: Record<string, readonly string[]> = {};
    for (const l of state.mockLoaders) {
      map[l.domain] = l.profiles;
    }
    return map;
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
    state.mockLoaders = [];
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

    state.mockLoaders = [
      {
        domain: 'alpha',
        depKey: 'a',
        profiles: ['full'],
        secondaryDepKeys: [],
        load: () => Promise.resolve({ default: valid1 }),
      },
      {
        domain: 'beta',
        depKey: 'b',
        profiles: ['full'],
        secondaryDepKeys: [],
        load: () => Promise.resolve({ default: valid2 }),
      },
      {
        domain: 'invalid',
        depKey: 'c',
        profiles: ['full'],
        secondaryDepKeys: [],
        load: () => Promise.resolve({ default: invalid }),
      },
      {
        domain: 'alpha-dup',
        depKey: 'd',
        profiles: ['full'],
        secondaryDepKeys: [],
        load: () => Promise.resolve({ default: duplicateDomain }),
      },
      {
        domain: 'gamma',
        depKey: 'e',
        profiles: ['full'],
        secondaryDepKeys: [],
        load: () => Promise.resolve({ default: duplicateDep }),
      },
    ];

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
    state.mockLoaders = [
      {
        domain: 'broken',
        depKey: 'broken',
        profiles: ['full'],
        secondaryDepKeys: [],
        load: () => Promise.reject(new Error('fixture import failed')),
      },
    ];

    process.env.DISCOVERY_STRICT = 'true';
    const { discoverDomainManifests } = await import('@server/registry/discovery');

    await expect(discoverDomainManifests()).rejects.toThrow('fixture import failed');
  });

  it('logs domain name when loader fails in non-strict mode', async () => {
    state.mockLoaders = [
      {
        domain: 'broken-domain',
        depKey: 'broken',
        profiles: ['full'],
        secondaryDepKeys: [],
        load: () => Promise.reject(new Error('chunk missing')),
      },
    ];

    const { discoverDomainManifests } = await import('@server/registry/discovery');
    const manifests = await discoverDomainManifests();

    expect(manifests).toEqual([]);
    expect(state.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('broken-domain'),
      expect.any(Error),
    );
  });

  describe('selective loading', () => {
    it('only loads domains in the provided set', async () => {
      const manifestA = {
        kind: 'domain-manifest',
        version: 1,
        domain: 'a',
        depKey: 'aDep',
        profiles: ['workflow', 'full'],
        registrations: [{}],
        ensure: () => {},
      };
      const manifestB = {
        kind: 'domain-manifest',
        version: 1,
        domain: 'b',
        depKey: 'bDep',
        profiles: ['full'],
        registrations: [{}],
        ensure: () => {},
      };
      const loadA = vi.fn().mockResolvedValue({ default: manifestA });
      const loadB = vi.fn().mockResolvedValue({ default: manifestB });

      state.mockLoaders = [
        {
          domain: 'a',
          depKey: 'a',
          profiles: ['workflow', 'full'],
          secondaryDepKeys: [],
          load: loadA,
        },
        { domain: 'b', depKey: 'b', profiles: ['full'], secondaryDepKeys: [], load: loadB },
      ];

      const { discoverDomainManifests } = await import('@server/registry/discovery');
      const manifests = await discoverDomainManifests(new Set(['a']));

      expect(manifests).toHaveLength(1);
      expect(manifests[0].domain).toBe('a');
      expect(loadA).toHaveBeenCalled();
      expect(loadB).not.toHaveBeenCalled();
    });

    it('returns empty when no domains match the filter set', async () => {
      const manifestX = {
        kind: 'domain-manifest',
        version: 1,
        domain: 'x',
        depKey: 'xDep',
        profiles: ['full'],
        registrations: [{}],
        ensure: () => {},
      };

      state.mockLoaders = [
        {
          domain: 'x',
          depKey: 'x',
          profiles: ['full'],
          secondaryDepKeys: [],
          load: () => Promise.resolve({ default: manifestX }),
        },
      ];

      const { discoverDomainManifests } = await import('@server/registry/discovery');
      const manifests = await discoverDomainManifests(new Set(['nonexistent']));

      expect(manifests).toEqual([]);
    });
  });

  describe('loadSingleManifest', () => {
    it('loads a single domain by name', async () => {
      const manifest = {
        kind: 'domain-manifest',
        version: 1,
        domain: 'target',
        depKey: 'targetDep',
        profiles: ['full'],
        registrations: [{}, {}],
        ensure: () => {},
      };

      state.mockLoaders = [
        {
          domain: 'target',
          depKey: 't',
          profiles: ['full'],
          secondaryDepKeys: [],
          load: () => Promise.resolve({ default: manifest }),
        },
        { domain: 'other', depKey: 'o', profiles: ['full'], secondaryDepKeys: [], load: vi.fn() },
      ];

      const { loadSingleManifest } = await import('@server/registry/discovery');
      const result = await loadSingleManifest('target');

      expect(result).not.toBeNull();
      expect(result!.domain).toBe('target');
      expect(result!.registrations).toHaveLength(2);
    });

    it('returns null for unknown domain', async () => {
      const { loadSingleManifest } = await import('@server/registry/discovery');
      const result = await loadSingleManifest('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null for invalid manifest', async () => {
      state.mockLoaders = [
        {
          domain: 'bad',
          depKey: 'b',
          profiles: ['full'],
          secondaryDepKeys: [],
          load: () => Promise.resolve({ default: { kind: 'invalid' } }),
        },
      ];

      const { loadSingleManifest } = await import('@server/registry/discovery');
      const result = await loadSingleManifest('bad');
      expect(result).toBeNull();
    });
  });

  describe('getDomainsForProfile', () => {
    it('returns domains matching the profile', async () => {
      state.mockLoaders = [
        {
          domain: 'a',
          depKey: 'a',
          profiles: ['search', 'workflow', 'full'],
          secondaryDepKeys: [],
          load: vi.fn(),
        },
        {
          domain: 'b',
          depKey: 'b',
          profiles: ['workflow', 'full'],
          secondaryDepKeys: [],
          load: vi.fn(),
        },
        { domain: 'c', depKey: 'c', profiles: ['full'], secondaryDepKeys: [], load: vi.fn() },
      ];

      const { getDomainsForProfile } = await import('@server/registry/discovery');
      expect(getDomainsForProfile('search')).toEqual(new Set(['a']));
      expect(getDomainsForProfile('workflow')).toEqual(new Set(['a', 'b']));
      expect(getDomainsForProfile('full')).toEqual(new Set(['a', 'b', 'c']));
    });
  });

  describe('getAllKnownDomainNames', () => {
    it('returns all domain names from metadata', async () => {
      state.mockLoaders = [
        { domain: 'alpha', depKey: 'a', profiles: ['full'], secondaryDepKeys: [], load: vi.fn() },
        { domain: 'beta', depKey: 'b', profiles: ['full'], secondaryDepKeys: [], load: vi.fn() },
      ];

      const { getAllKnownDomainNames } = await import('@server/registry/discovery');
      expect(getAllKnownDomainNames()).toEqual(new Set(['alpha', 'beta']));
    });
  });
});
