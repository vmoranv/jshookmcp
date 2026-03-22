import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const promptState = vi.hoisted(() => ({
  generateTaintAnalysisPrompt: vi.fn(() => [{ role: 'user', content: 'analyze taint' }]),
}));

const sanitizerState = vi.hoisted(() => ({
  checkSanitizer: vi.fn((call: unknown) => {
    const callee = call.callee;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    return callee?.type === 'Identifier' && callee.name === 'sanitize';
  }),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@services/prompts/taint', () => ({
  generateTaintAnalysisPrompt: promptState.generateTaintAnalysisPrompt,
}));

vi.mock('@modules/analyzer/SecurityCodeAnalyzer', () => ({
  checkSanitizer: sanitizerState.checkSanitizer,
}));

import { analyzeDataFlowWithTaint } from '@modules/analyzer/CodeAnalyzerDataFlow';

describe('CodeAnalyzer data flow analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tracks taint from browser-controlled sources into xss and eval sinks', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const source = location.href;
      const cleaned = sanitize(source);
      document.body.innerHTML = source;
      eval(source);
    `);

    expect(result.sources.some((source) => source.type === 'user_input')).toBe(true);
    expect(result.sinks.some((sink) => sink.type === 'xss')).toBe(true);
    expect(result.sinks.some((sink) => sink.type === 'eval')).toBe(true);
    expect(result.taintPaths.some((path) => path.sink.type === 'xss')).toBe(true);
    expect(result.taintPaths.some((path) => path.sink.type === 'eval')).toBe(true);
  });

  it('uses llm taint enhancement to add additional unique taint paths', async () => {
    const llm = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          taintPaths: [
            {
              source: { type: 'network', location: { file: 'current', line: 1 } },
              sink: { type: 'eval', location: { file: 'current', line: 5 } },
              path: [
                { file: 'current', line: 1 },
                { file: 'current', line: 5 },
              ],
            },
          ],
        }),
      }),
    };

    const result = await analyzeDataFlowWithTaint(
      `
        const source = location.href;
        document.body.innerHTML = source;
      `,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      llm as any
    );

    expect(promptState.generateTaintAnalysisPrompt).toHaveBeenCalled();
    expect(llm.chat).toHaveBeenCalled();
    expect(result.taintPaths.some((path) => path.source.location.line === 1)).toBe(true);
  });
});
