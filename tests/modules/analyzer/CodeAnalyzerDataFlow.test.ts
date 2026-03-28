import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const sanitizerState = vi.hoisted(() => ({
  checkSanitizer: vi.fn((call: any) => {
    const callee = call.callee;
    return callee?.type === 'Identifier' && callee.name === 'sanitize';
  }),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
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

  it('ignores legacy extra arguments and keeps local taint analysis', async () => {
    const llm = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          taintPaths: [
            {
              source: { type: 'network', location: { file: 'current', line: 99 } },
              sink: { type: 'eval', location: { file: 'current', line: 5 } },
              path: [
                { file: 'current', line: 99 },
                { file: 'current', line: 5 },
              ],
            },
          ],
        }),
      }),
    };

    const result = await (analyzeDataFlowWithTaint as any)(
      `
        const source = location.href;
        document.body.innerHTML = source;
      `,
      llm,
    );

    expect(llm.chat).not.toHaveBeenCalled();
    expect(result.taintPaths.length).toBeGreaterThan(0);
    expect(result.taintPaths.some((path) => path.sink.type === 'xss')).toBe(true);
  });
});
