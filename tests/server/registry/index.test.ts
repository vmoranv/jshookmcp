import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  discoverDomainManifests: vi.fn(),
  domainProfileMap: {} as Record<string, readonly string[]>,
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@server/registry/discovery', () => ({
  discoverDomainManifests: state.discoverDomainManifests,
}));

vi.mock('@server/registry/generated-domains.js', () => ({
  get DOMAIN_PROFILE_MAP() {
    return state.domainProfileMap;
  },
}));

vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

function makeRegistration(name: string, domain: string) {
  const handler = vi.fn(async () => `${name}:ok`);
  const bind = vi.fn(() => handler);
  return {
    tool: {
      name,
      description: `${name} description`,
      inputSchema: { type: 'object', properties: {} },
    },
    domain,
    bind,
  };
}

function makeManifest(
  domain: string,
  depKey: string,
  profiles: Array<'search' | 'workflow' | 'full'>,
  registrations: ReturnType<typeof makeRegistration>[],
) {
  return {
    kind: 'domain-manifest' as const,
    version: 1 as const,
    domain,
    depKey,
    profiles,
    registrations,
    ensure: vi.fn(() => ({ domain })),
  };
}

describe('registry/index', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    state.domainProfileMap = {};
  });

  it('throws from getters before initialization', async () => {
    const registry = await import('@server/registry/index');

    expect(() => registry.getAllDomains()).toThrow('Not initialised');
    expect(() => registry.getAllRegistrations()).toThrow('Not initialised');
    expect(() => registry.buildAllTools()).toThrow('Not initialised');
  });

  it('initializes once, deduplicates tool names, and exposes views', async () => {
    const alphaTool = makeRegistration('shared_tool', 'alpha');
    const betaTool = makeRegistration('shared_tool', 'beta');
    const gammaTool = makeRegistration('gamma_tool', 'gamma');
    state.discoverDomainManifests.mockResolvedValue([
      makeManifest('alpha', 'alphaDep', ['search', 'workflow', 'full'], [alphaTool]),
      makeManifest('beta', 'betaDep', ['workflow', 'full'], [betaTool]),
      makeManifest('gamma', 'gammaDep', ['full'], [gammaTool]),
    ]);
    const registry = await import('@server/registry/index');

    await Promise.all([registry.initRegistry(), registry.initRegistry()]);

    expect(state.discoverDomainManifests).toHaveBeenCalledTimes(1);
    expect(state.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate tool name "shared_tool"'),
    );
    expect([...registry.getAllDomains()]).toEqual(['alpha', 'beta', 'gamma']);
    expect(registry.getAllToolNames().has('shared_tool')).toBe(true);
    expect(registry.getAllManifests().length).toBe(3);
    expect(registry.getAllRegistrations().length).toBe(2);
    expect(registry.buildAllTools().map((item) => item.name)).toEqual([
      'shared_tool',
      'gamma_tool',
    ]);
  });

  it('builds handler maps and filters by selected tool names', async () => {
    const alphaTool = makeRegistration('alpha_tool', 'alpha');
    const betaTool = makeRegistration('beta_tool', 'beta');
    state.discoverDomainManifests.mockResolvedValue([
      makeManifest('alpha', 'alphaDep', ['search', 'workflow', 'full'], [alphaTool]),
      makeManifest('beta', 'betaDep', ['workflow', 'full'], [betaTool]),
    ]);
    const registry = await import('@server/registry/index');
    await registry.initRegistry();

    const handlers = registry.buildHandlerMapFromRegistry({ dep: true }, new Set(['beta_tool']));

    expect(Object.keys(handlers)).toEqual(['beta_tool']);
    expect(betaTool.bind).toHaveBeenCalledTimes(1);
    expect(alphaTool.bind).not.toHaveBeenCalled();
    await expect(handlers.beta_tool!({ test: true } as never)).resolves.toBe('beta_tool:ok');
  });

  it('warns when profile hierarchies are not proper subsets', async () => {
    state.domainProfileMap = {
      'search-only': ['search'],
      'workflow-only': ['workflow'],
      'full-only': ['full'],
    };
    state.discoverDomainManifests.mockResolvedValue([
      makeManifest(
        'search-only',
        'searchDep',
        ['search'],
        [makeRegistration('search_tool', 'search-only')],
      ),
      makeManifest(
        'workflow-only',
        'workflowDep',
        ['workflow'],
        [makeRegistration('workflow_tool', 'workflow-only')],
      ),
      makeManifest('full-only', 'fullDep', ['full'], [makeRegistration('full_tool', 'full-only')]),
    ]);
    const registry = await import('@server/registry/index');
    await registry.initRegistry();

    const profiles = registry.buildProfileDomains();

    expect(profiles).toEqual({
      search: ['search-only'],
      workflow: ['workflow-only'],
      full: ['full-only'],
    });
    expect(state.logger.warn).toHaveBeenCalledWith(
      '[registry] Profile hierarchy: search not subset of workflow',
    );
    expect(state.logger.warn).toHaveBeenCalledWith(
      '[registry] Profile hierarchy: workflow not subset of full',
    );
  });
});
