import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { AIEnvironmentAnalyzer } from '@modules/emulator/AIEnvironmentAnalyzer';

const detectedBase = {
  window: [] as string[],
  document: [] as string[],
  navigator: [] as string[],
  location: [] as string[],
  screen: [] as string[],
  other: [] as string[],
};

describe('AIEnvironmentAnalyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result when LLM is unavailable', async () => {
    const analyzer = new AIEnvironmentAnalyzer();
    const result = await analyzer.analyze('window.x', detectedBase, []);

    expect(result).toEqual({
      recommendedVariables: {},
      recommendedAPIs: [],
      antiCrawlFeatures: [],
      suggestions: [],
      confidence: 0,
    });
  });

  it('ignores legacy dependencies and still returns empty analysis', async () => {
    const legacy = {
      chat: vi.fn().mockResolvedValue({
        content: '{"recommendedVariables":{"window.foo":"bar"}}',
      }),
    };
    const analyzer = new AIEnvironmentAnalyzer(legacy as any);
    const result = await analyzer.analyze('window.foo', detectedBase, []);

    expect(result).toEqual({
      recommendedVariables: {},
      recommendedAPIs: [],
      antiCrawlFeatures: [],
      suggestions: [],
      confidence: 0,
    });
    expect(legacy.chat).not.toHaveBeenCalled();
  });

  it('returns empty anti-crawl features and null API implementations without AI inference', async () => {
    const legacy = {
      chat: vi.fn().mockResolvedValue({
        content: '[{"feature":"webdriver","severity":"critical"}]',
      }),
    };
    const analyzer = new AIEnvironmentAnalyzer(legacy as any);

    await expect(analyzer.analyzeAntiCrawl('navigator.webdriver')).resolves.toEqual([]);
    await expect(analyzer.inferAPIImplementation('window.test', 'ctx')).resolves.toBeNull();
    expect(legacy.chat).not.toHaveBeenCalled();
  });

  it('generates default suggestions without AI assistance', async () => {
    const analyzer = new AIEnvironmentAnalyzer();
    const suggestions = await analyzer.generateSuggestions(
      {
        ...detectedBase,
        window: ['window.browserRuntime'],
        navigator: ['navigator.webdriver', 'navigator.plugins'],
      },
      Array.from({ length: 11 }, () => ({})) as any,
      'browser' as any,
    );

    expect(suggestions).toContain('11 browser APIs missing, enable API emulation');
    expect(suggestions).toContain('webdriver flag detected, set navigator.webdriver = false');
    expect(suggestions).toContain('Empty plugins list detected, enable plugin emulation');
  });
});
