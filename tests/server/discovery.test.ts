import { describe, expect, it, vi } from 'vitest';

// Mock logger
vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { discoverDomainManifests } = await import('@server/registry/discovery');

describe('discoverDomainManifests', () => {
  it('returns an array of valid domain manifests', async () => {
    const manifests = await discoverDomainManifests();

    expect(Array.isArray(manifests)).toBe(true);
    // Each manifest should have the required shape
    for (const manifest of manifests) {
      expect(manifest.kind).toBe('domain-manifest');
      expect(manifest.version).toBe(1);
      expect(typeof manifest.domain).toBe('string');
      expect(typeof manifest.depKey).toBe('string');
      expect(Array.isArray(manifest.profiles)).toBe(true);
      expect(Array.isArray(manifest.registrations)).toBe(true);
      expect(typeof manifest.ensure).toBe('function');
    }
  });

  it('discovers domains without duplicate domain names', async () => {
    const manifests = await discoverDomainManifests();
    const domainNames = manifests.map((m) => m.domain);
    const uniqueNames = new Set(domainNames);

    expect(domainNames.length).toBe(uniqueNames.size);
  });

  it('discovers domains without duplicate depKeys', async () => {
    const manifests = await discoverDomainManifests();
    const depKeys = manifests.map((m) => m.depKey);
    const uniqueKeys = new Set(depKeys);

    expect(depKeys.length).toBe(uniqueKeys.size);
  });

  it('every domain has at least one registration', async () => {
    const manifests = await discoverDomainManifests();

    for (const manifest of manifests) {
      expect(
        manifest.registrations.length,
        `Domain "${manifest.domain}" should have at least one registration`
      ).toBeGreaterThan(0);
    }
  });

  it('every registration has a valid tool definition', async () => {
    const manifests = await discoverDomainManifests();

    for (const manifest of manifests) {
      for (const reg of manifest.registrations) {
        expect(typeof reg.tool.name).toBe('string');
        expect(reg.tool.name.length).toBeGreaterThan(0);
        expect(typeof reg.bind).toBe('function');
      }
    }
  });

  it('no two registrations share the same tool name across all domains', async () => {
    const manifests = await discoverDomainManifests();
    const toolNames: string[] = [];

    for (const manifest of manifests) {
      for (const reg of manifest.registrations) {
        toolNames.push(reg.tool.name);
      }
    }

    const uniqueNames = new Set(toolNames);
    expect(toolNames.length).toBe(uniqueNames.size);
  });
});
