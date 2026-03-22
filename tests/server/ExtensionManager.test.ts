import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

// Mock logger to suppress output and verify calls
vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock ToolCatalog to avoid importing the full catalog
vi.mock('@src/server/ToolCatalog', () => ({
  allTools: [{ name: 'builtin_tool_a' }, { name: 'builtin_tool_b' }],
  getTierIndex: vi.fn((tier: string) => {
    const order = ['search', 'workflow', 'full'];
    return order.indexOf(tier);
  }),
}));

// Mock plugin-config
vi.mock('@src/server/extensions/plugin-config', () => ({
  getPluginBoostTier: vi.fn(() => 'full'),
}));

// We import after mocks are set up
const { reloadExtensions } = await import('@server/extensions/ExtensionManager');

type MockCtx = Record<string, unknown>;

function createMockCtx(overrides: Partial<MockCtx> = {}): MockCtx {
  return {
    config: { mcp: { version: '0.1.0' } },
    baseTier: 'full',
    extensionToolsByName: new Map(),
    extensionPluginsById: new Map(),
    extensionPluginRuntimeById: new Map(),
    extensionWorkflowsById: new Map(),
    extensionWorkflowRuntimeById: new Map(),
    lastExtensionReloadAt: undefined,
    activatedToolNames: new Set(),
    activatedRegisteredTools: new Map(),
    domainTtlEntries: new Map(),
    handlerDeps: {},
    router: {
      addHandlers: vi.fn(),
      removeHandler: vi.fn(),
      has: vi.fn(() => false),
    },
    registerSingleTool: vi.fn(() => ({ remove: vi.fn() })),
    executeToolWithTracking: vi.fn(),
    ...overrides,
  };
}

describe('ExtensionManager', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Point to a non-existent directory so no real plugins are discovered
    process.env.MCP_PLUGIN_ROOTS = join(__dirname, '__fixtures_nonexistent__');
    process.env.MCP_WORKFLOW_ROOTS = join(__dirname, '__fixtures_nonexistent__');
    delete process.env.MCP_PLUGIN_ALLOWED_DIGESTS;
    delete process.env.MCP_PLUGIN_SIGNATURE_REQUIRED;
    delete process.env.MCP_PLUGIN_STRICT_LOAD;
    delete process.env.MCP_PLUGIN_SIGNATURE_SECRET;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('strictLoad security gate', () => {
    it('blocks all plugin loading when strictLoad=true and no allowlist', async () => {
      process.env.MCP_PLUGIN_STRICT_LOAD = 'true';
      const ctx = createMockCtx();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await reloadExtensions(ctx as any);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('MCP_PLUGIN_ALLOWED_DIGESTS is required');
      expect(result.addedTools).toBe(0);
    });

    it('blocks all plugin loading when signature required and no allowlist', async () => {
      process.env.MCP_PLUGIN_SIGNATURE_REQUIRED = 'true';
      const ctx = createMockCtx();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await reloadExtensions(ctx as any);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('MCP_PLUGIN_ALLOWED_DIGESTS is required');
    });

    it('defaults to strict signature enforcement in production', async () => {
      process.env.NODE_ENV = 'production';
      const ctx = createMockCtx();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await reloadExtensions(ctx as any);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('MCP_PLUGIN_ALLOWED_DIGESTS is required');
    });

    it('allows opting out of production signature enforcement explicitly', async () => {
      process.env.NODE_ENV = 'production';
      process.env.MCP_PLUGIN_SIGNATURE_REQUIRED = 'false';
      process.env.MCP_PLUGIN_STRICT_LOAD = 'false';
      const ctx = createMockCtx();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await reloadExtensions(ctx as any);

      const strictErrors = result.errors.filter((e: string) =>
        e.includes('MCP_PLUGIN_ALLOWED_DIGESTS is required')
      );
      expect(strictErrors).toHaveLength(0);
    });

    it('proceeds when allowlist is provided with strictLoad', async () => {
      process.env.MCP_PLUGIN_STRICT_LOAD = 'true';
      process.env.MCP_PLUGIN_ALLOWED_DIGESTS = 'abc123';
      const ctx = createMockCtx();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await reloadExtensions(ctx as any);

      // No strictLoad blocking error — may have other warnings from empty dirs
      const strictErrors = result.errors.filter((e: string) =>
        e.includes('MCP_PLUGIN_ALLOWED_DIGESTS is required')
      );
      expect(strictErrors).toHaveLength(0);
    });
  });

  describe('empty plugin roots', () => {
    it('returns zero tools when no plugins are found', async () => {
      const ctx = createMockCtx();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await reloadExtensions(ctx as any);

      expect(result.addedTools).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('sets lastExtensionReloadAt timestamp', async () => {
      const ctx = createMockCtx();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await reloadExtensions(ctx as any);

      expect(ctx.lastExtensionReloadAt).toBeDefined();
      expect(typeof ctx.lastExtensionReloadAt).toBe('string');
    });
  });

  describe('concurrent reload mutex', () => {
    it('serializes concurrent reload calls', async () => {
      const ctx = createMockCtx();
      const callOrder: number[] = [];

      // Both should succeed without errors — the mutex ensures they don't corrupt state
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const p1 = reloadExtensions(ctx as any).then((r) => {
        callOrder.push(1);
        return r;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const p2 = reloadExtensions(ctx as any).then((r) => {
        callOrder.push(2);
        return r;
      });

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.errors).toHaveLength(0);
      expect(r2.errors).toHaveLength(0);
      expect(callOrder).toHaveLength(2);
    });
  });
});
