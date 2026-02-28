import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const promptState = vi.hoisted(() => ({
  generateFileSummaryMessages: vi.fn((url: string, snippet: string) => [
    { role: 'user', content: `${url}:${snippet}` },
  ]),
  generateProjectSummaryMessages: vi.fn((files: any[]) => [
    { role: 'user', content: `files:${files.length}` },
  ]),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

vi.mock('../../../src/services/prompts/analysis.js', () => ({
  generateFileSummaryMessages: promptState.generateFileSummaryMessages,
  generateProjectSummaryMessages: promptState.generateProjectSummaryMessages,
}));

import { AISummarizer } from '../../../src/modules/analyzer/AISummarizer.js';

function makeFile(overrides: Partial<any> = {}) {
  return {
    url: 'https://cdn.test/app.js',
    type: 'js',
    size: 120,
    content: 'function hello(){return 1;}',
    ...overrides,
  };
}

describe('AISummarizer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    loggerState.debug.mockReset();
    loggerState.info.mockReset();
    loggerState.warn.mockReset();
    loggerState.error.mockReset();
    promptState.generateFileSummaryMessages.mockClear();
    promptState.generateProjectSummaryMessages.mockClear();
  });

  it('parses AI JSON summary for a file', async () => {
    const llm = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          summary: 'ok',
          purpose: 'auth',
          keyFunctions: ['hello'],
          hasAPI: true,
          complexity: 'low',
        }),
      })),
    } as any;

    const result = await new AISummarizer(llm).summarizeFile(makeFile());

    expect(result.summary).toBe('ok');
    expect(result.purpose).toBe('auth');
    expect(result.keyFunctions).toEqual(['hello']);
    expect(result.hasAPI).toBe(true);
    expect(result.complexity).toBe('low');
    expect(result.linesOfCode).toBe(1);
  });

  it('truncates long source before sending prompt', async () => {
    const llm = { chat: vi.fn(async () => ({ content: '{}' })) } as any;
    const longContent = 'a'.repeat(11050);

    await new AISummarizer(llm).summarizeFile(makeFile({ content: longContent }));

    const [, snippet] = promptState.generateFileSummaryMessages.mock.calls[0]!;
    expect(snippet.length).toBeGreaterThan(10000);
    expect(snippet).toContain('... (truncated)');
  });

  it('falls back to basic analysis when LLM call throws', async () => {
    const llm = { chat: vi.fn(async () => Promise.reject(new Error('down'))) } as any;
    const content = 'function encryptData(){}\nfetch("/api/x")\neval("1")';

    const result = await new AISummarizer(llm).summarizeFile(makeFile({ content }));

    expect(result.summary).toContain('Basic analysis');
    expect(result.hasEncryption).toBe(true);
    expect(result.hasAPI).toBe(true);
    expect(result.hasObfuscation).toBe(true);
    expect(result.keyFunctions).toContain('encryptData');
  });

  it('falls back when AI response is not valid JSON', async () => {
    const llm = { chat: vi.fn(async () => ({ content: 'not-json' })) } as any;
    const result = await new AISummarizer(llm).summarizeFile(makeFile());

    expect(result.summary).toContain('Basic analysis');
    expect(loggerState.warn).toHaveBeenCalled();
  });

  it('summarizes files in batches with configured concurrency', async () => {
    const llm = {
      chat: vi.fn(async ({ 0: msg }: any) => ({
        content: JSON.stringify({
          summary: String(msg.content).includes('a.js') ? 'A' : 'B',
          purpose: 'x',
        }),
      })),
    } as any;
    const files = [
      makeFile({ url: 'a.js', content: 'function a(){}' }),
      makeFile({ url: 'b.js', content: 'function b(){}' }),
      makeFile({ url: 'c.js', content: 'function c(){}' }),
    ];

    const result = await new AISummarizer(llm).summarizeBatch(files, 2);

    expect(result).toHaveLength(3);
    expect(llm.chat).toHaveBeenCalledTimes(3);
  });

  it('parses project-level summary and computes totals', async () => {
    const llm = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          mainPurpose: 'platform',
          architecture: 'modular',
          technologies: ['ts'],
          securityConcerns: ['xss'],
          recommendations: ['harden'],
        }),
      })),
    } as any;

    const result = await new AISummarizer(llm).summarizeProject([
      makeFile({ size: 10 }),
      makeFile({ size: 20 }),
    ]);

    expect(result.totalFiles).toBe(2);
    expect(result.totalSize).toBe(30);
    expect(result.mainPurpose).toBe('platform');
    expect(result.technologies).toEqual(['ts']);
  });

  it('returns safe defaults when project summary fails', async () => {
    const llm = { chat: vi.fn(async () => ({ content: '{' })) } as any;
    const result = await new AISummarizer(llm).summarizeProject([makeFile({ size: 7 })]);

    expect(result.mainPurpose).toBe('Analysis failed');
    expect(result.totalSize).toBe(7);
    expect(result.technologies).toEqual([]);
  });
});

