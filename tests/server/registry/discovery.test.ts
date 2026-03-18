import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  fileURLToPath: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('node:fs/promises', () => ({
  readdir: state.readdir,
  stat: state.stat,
}));

vi.mock('node:url', () => ({
  fileURLToPath: state.fileURLToPath,
}));

vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

const fixtureRoot = join(process.cwd(), 'tests', 'server', 'registry', 'fixtures');
const registryFile = join(process.cwd(), 'src', 'server', 'registry', 'discovery.ts');

function makeDir(name: string) {
  return {
    name,
    isDirectory: () => true,
  };
}

describe('registry/discovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.DISCOVERY_STRICT;
    state.fileURLToPath.mockImplementation((value: URL | string) => {
      const href = typeof value === 'string' ? value : value.href;
      if (href.includes('/domains/')) {
        return fixtureRoot;
      }
      return registryFile;
    });
  });

  it('returns an empty list when the domains directory cannot be read', async () => {
    state.readdir.mockRejectedValue(new Error('cannot read'));
    const { discoverDomainManifests } = await import('@server/registry/discovery');

    await expect(discoverDomainManifests()).resolves.toEqual([]);
    expect(state.logger.error).toHaveBeenCalled();
  });

  it('loads valid manifests, skips invalid ones, and warns on duplicate domain or depKey', async () => {
    state.readdir.mockResolvedValue([
      makeDir('valid-default'),
      makeDir('valid-named'),
      makeDir('valid-alt'),
      makeDir('invalid'),
      makeDir('duplicate-domain'),
      makeDir('duplicate-dep'),
    ]);
    state.stat.mockImplementation(async (filePath: string) => {
      if (
        filePath === join(fixtureRoot, 'valid-default', 'manifest.ts') ||
        filePath === join(fixtureRoot, 'valid-named', 'manifest.ts') ||
        filePath === join(fixtureRoot, 'valid-alt', 'manifest.ts') ||
        filePath === join(fixtureRoot, 'invalid', 'manifest.ts') ||
        filePath === join(fixtureRoot, 'duplicate-domain', 'manifest.ts') ||
        filePath === join(fixtureRoot, 'duplicate-dep', 'manifest.ts')
      ) {
        return { isFile: () => true };
      }
      throw new Error('missing');
    });
    const { discoverDomainManifests } = await import('@server/registry/discovery');

    const manifests = await discoverDomainManifests();

    expect(manifests.map((item) => item.domain)).toEqual(['alpha', 'beta', 'gamma']);
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no valid DomainManifest export')
    );
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate domain "alpha"')
    );
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate depKey "alphaDep"')
    );
    expect(state.logger.info).toHaveBeenCalledWith(
      '[discovery] Discovered 3 domains, 3 tools total'
    );
  });

  it('prefers manifest.js before manifest.ts and rethrows import errors in strict mode', async () => {
    state.readdir.mockResolvedValue([makeDir('js-first'), makeDir('throw-on-import')]);
    state.stat.mockImplementation(async (filePath: string) => {
      if (
        filePath === join(fixtureRoot, 'js-first', 'manifest.js') ||
        filePath === join(fixtureRoot, 'throw-on-import', 'manifest.ts')
      ) {
        return { isFile: () => true };
      }
      throw new Error('missing');
    });
    process.env.DISCOVERY_STRICT = 'true';
    const { discoverDomainManifests } = await import('@server/registry/discovery');

    await expect(discoverDomainManifests()).rejects.toThrow('fixture import failed');
  });
});
