import { beforeEach, describe, expect, it, vi } from 'vitest';

// oxlint-disable-next-line import/no-unassigned-import
import '../shared/manifest-test-mocks';

interface Tool {
  name: string;
}

interface Registration {
  domain: string;
  tool: Tool;
  bind: () => void;
}

interface Manifest {
  kind: string;
  version: number;
  domain: string;
  depKey: string;
  profiles: string[];
  ensure: (ctx: Record<string, unknown>) => unknown;
  registrations: Registration[];
}

interface Context extends Record<string, unknown> {
  collector: Record<string, unknown>;
  pageController: Record<string, unknown>;
  domInspector: Record<string, unknown>;
  scriptManager: Record<string, unknown>;
  consoleMonitor: Record<string, unknown>;
  llm: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  coreAnalysisHandlers?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  deobfuscator?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  advancedDeobfuscator?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  obfuscationDetector?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  analyzer?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  cryptoDetector?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  hookManager?: any;
}

describe('server/domains/analysis/manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exports a valid domain manifest as default', async () => {
    const { default: manifest } = (await import('@server/domains/analysis/manifest')) as {
      default: Manifest;
    };

    expect(manifest).toEqual(
      expect.objectContaining({
        kind: 'domain-manifest',
        version: 1,
        domain: 'core',
        depKey: 'coreAnalysisHandlers',
        profiles: ['workflow', 'full'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        ensure: expect.any(Function),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        registrations: expect.any(Array),
      }),
    );
  });

  it('has registrations that all reference the core domain', async () => {
    const { default: manifest } = (await import('@server/domains/analysis/manifest')) as {
      default: Manifest;
    };

    expect(manifest.registrations.length).toBeGreaterThan(0);

    manifest.registrations.forEach((reg) => {
      expect(reg.domain).toBe('core');
      expect(reg.tool).toBeDefined();
      expect(typeof reg.bind).toBe('function');
    });
  });

  it('includes all expected core analysis tools', async () => {
    const { default: manifest } = (await import('@server/domains/analysis/manifest')) as {
      default: Manifest;
    };

    const toolNames = manifest.registrations.map((r) => r.tool.name);

    expect(toolNames).toContain('collect_code');
    expect(toolNames).toContain('search_in_scripts');
    expect(toolNames).toContain('extract_function_tree');
    expect(toolNames).toContain('deobfuscate');
    expect(toolNames).toContain('understand_code');
    expect(toolNames).toContain('detect_crypto');
    expect(toolNames).toContain('manage_hooks');
    expect(toolNames).toContain('detect_obfuscation');
    expect(toolNames).toContain('advanced_deobfuscate');
    expect(toolNames).toContain('webcrack_unpack');
    expect(toolNames).toContain('clear_collected_data');
    expect(toolNames).toContain('get_collection_stats');
    expect(toolNames).toContain('webpack_enumerate');
    expect(toolNames).toContain('source_map_extract');
  });

  it('has no duplicate tool names across registrations', async () => {
    const { default: manifest } = (await import('@server/domains/analysis/manifest')) as {
      default: Manifest;
    };

    const toolNames = manifest.registrations.map((r) => r.tool.name);

    expect(new Set(toolNames).size).toBe(toolNames.length);
  });

  it('ensure function initializes all required dependencies', async () => {
    const { default: manifest } = (await import('@server/domains/analysis/manifest')) as {
      default: Manifest;
    };

    const ctx: Context = {
      collector: {},
      pageController: {},
      domInspector: {},
      scriptManager: {},
      consoleMonitor: {},
      llm: {},
      coreAnalysisHandlers: undefined,
      deobfuscator: undefined,
      advancedDeobfuscator: undefined,
      obfuscationDetector: undefined,
      analyzer: undefined,
      cryptoDetector: undefined,
      hookManager: undefined,
    };

    const result = manifest.ensure(ctx);

    expect(result).toBeDefined();
    expect(ctx.coreAnalysisHandlers).toBeDefined();
    expect(ctx.deobfuscator).toBeDefined();
    expect(ctx.advancedDeobfuscator).toBeDefined();
    expect(ctx.obfuscationDetector).toBeDefined();
    expect(ctx.analyzer).toBeDefined();
    expect(ctx.cryptoDetector).toBeDefined();
    expect(ctx.hookManager).toBeDefined();
  });

  it('ensure function returns existing handlers on subsequent calls', async () => {
    const { default: manifest } = (await import('@server/domains/analysis/manifest')) as {
      default: Manifest;
    };

    const existingHandlers = { existing: true };
    const ctx: Context = {
      collector: {},
      pageController: {},
      domInspector: {},
      scriptManager: {},
      consoleMonitor: {},
      llm: {},
      coreAnalysisHandlers: existingHandlers,
      deobfuscator: {},
      advancedDeobfuscator: {},
      obfuscationDetector: {},
      analyzer: {},
      cryptoDetector: {},
      hookManager: {},
    };

    const result = manifest.ensure(ctx);
    expect(result).toBe(existingHandlers);
  });
});
