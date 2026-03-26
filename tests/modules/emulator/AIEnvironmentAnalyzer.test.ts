import { describe, it, expect, vi, beforeEach } from 'vitest';

const promptState = vi.hoisted(() => ({
  generateBrowserEnvAnalysisMessages: vi.fn(() => [{ role: 'user', content: 'analyze' }]),
  generateAntiCrawlAnalysisMessages: vi.fn(() => [{ role: 'user', content: 'anti' }]),
  generateAPIImplementationMessages: vi.fn(() => [{ role: 'user', content: 'api' }]),
  generateEnvironmentSuggestionsMessages: vi.fn(() => [{ role: 'user', content: 'suggest' }]),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/services/prompts/environment', () => ({
  generateBrowserEnvAnalysisMessages: promptState.generateBrowserEnvAnalysisMessages,
  generateAntiCrawlAnalysisMessages: promptState.generateAntiCrawlAnalysisMessages,
  generateAPIImplementationMessages: promptState.generateAPIImplementationMessages,
  generateEnvironmentSuggestionsMessages: promptState.generateEnvironmentSuggestionsMessages,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

  it('parses fenced JSON analysis response', async () => {
    const llm = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      chat: vi.fn().mockResolvedValue({
        content: `\`\`\`json
{"recommendedVariables":{"window.foo":"bar"},"recommendedAPIs":[{"path":"window.fetch","implementation":"function(){}","reason":"needed"}],"antiCrawlFeatures":[{"feature":"fp","severity":"high","description":"x","mitigation":"y"}],"suggestions":["a"],"confidence":0.88}
\`\`\``,
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const analyzer = new AIEnvironmentAnalyzer(llm as any);
    const result = await analyzer.analyze('window.foo', detectedBase, []);

    expect(llm.chat).toHaveBeenCalledOnce();
    expect(result.recommendedVariables['window.foo']).toBe('bar');
    expect(result.recommendedAPIs[0]?.path).toBe('window.fetch');
    expect(result.confidence).toBe(0.88);
  });

  it('falls back to empty result on invalid JSON', async () => {
    const llm = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      chat: vi.fn().mockResolvedValue({ content: 'not-json-response' }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const analyzer = new AIEnvironmentAnalyzer(llm as any);
    const result = await analyzer.analyze('window.foo', detectedBase, []);

    expect(result.confidence).toBe(0);
    expect(result.recommendedAPIs).toEqual([]);
  });

  it('extracts anti-crawl list from JSON array response', async () => {
    const llm = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      chat: vi.fn().mockResolvedValue({
        content: `\`\`\`json
[{"feature":"webdriver","severity":"critical","description":"d","mitigation":"m"}]
\`\`\``,
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const analyzer = new AIEnvironmentAnalyzer(llm as any);
    const features = await analyzer.analyzeAntiCrawl('navigator.webdriver');

    expect(features).toHaveLength(1);
    expect(features[0]?.feature).toBe('webdriver');
  });

  it('infers API implementation from fenced code block', async () => {
    const llm = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      chat: vi.fn().mockResolvedValue({
        content: '```js\nfunction test(){ return 1; }\n```',
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const analyzer = new AIEnvironmentAnalyzer(llm as any);
    const impl = await analyzer.inferAPIImplementation('window.test', 'ctx');

    expect(impl).toBe('function test(){ return 1; }');
  });

  it('generates default suggestions when LLM output is unusable', async () => {
    const llm = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      chat: vi.fn().mockResolvedValue({ content: '{"unexpected":true}' }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const analyzer = new AIEnvironmentAnalyzer(llm as any);
    const suggestions = await analyzer.generateSuggestions(
      {
        ...detectedBase,
        window: ['window.browserRuntime'],
        navigator: ['navigator.webdriver', 'navigator.plugins'],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      Array.from({ length: 11 }, () => ({})) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      'browser' as any,
    );

    expect(suggestions).toContain('11 browser APIs missing, enable API emulation');
    expect(suggestions).toContain('webdriver flag detected, set navigator.webdriver = false');
    expect(suggestions).toContain('Empty plugins list detected, enable plugin emulation');
  });
});
