import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const promptState = vi.hoisted(() => ({
  generateCodeAnalysisPrompt: vi.fn(() => [{ role: 'user', content: 'analyze code' }]),
  generateTaintAnalysisPrompt: vi.fn(() => [{ role: 'user', content: 'analyze taint' }]),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

vi.mock('../../../src/services/prompts/analysis.js', () => ({
  generateCodeAnalysisPrompt: promptState.generateCodeAnalysisPrompt,
}));

vi.mock('../../../src/services/prompts/taint.js', () => ({
  generateTaintAnalysisPrompt: promptState.generateTaintAnalysisPrompt,
}));

import { CodeAnalyzer } from '../../../src/modules/analyzer/CodeAnalyzer.js';

function createLLM(responses: Array<string | Error>) {
  const queue = [...responses];
  const chat = vi.fn(async () => {
    const next = queue.shift() ?? '{}';
    if (next instanceof Error) {
      throw next;
    }
    return { content: next };
  });
  return { llm: { chat } as any, chat };
}

describe('CodeAnalyzer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    loggerState.debug.mockReset();
    loggerState.info.mockReset();
    loggerState.warn.mockReset();
    loggerState.error.mockReset();
    loggerState.success.mockReset();
    promptState.generateCodeAnalysisPrompt.mockReset();
    promptState.generateCodeAnalysisPrompt.mockReturnValue([
      { role: 'user', content: 'analyze code' },
    ]);
    promptState.generateTaintAnalysisPrompt.mockReset();
    promptState.generateTaintAnalysisPrompt.mockReturnValue([
      { role: 'user', content: 'analyze taint' },
    ]);
  });

  it('extracts structure with functions, classes, modules and call graph edges', async () => {
    const { llm } = createLLM(['{"businessLogic":{"mainFeatures":["auth"]}}']);
    const analyzer = new CodeAnalyzer(llm);
    const code = `
      import helper from './helper';
      function b() { return 1; }
      function a() { return b(); }
      class Box {
        value = 1;
        m(p) { return p; }
      }
      export default a;
    `;

    const result = await analyzer.understand({ code });

    const functionNames = result.structure.functions.map((fn) => fn.name);
    expect(functionNames).toContain('a');
    expect(functionNames).toContain('b');
    expect(result.structure.classes[0]!.name).toBe('Box');
    expect(result.structure.classes[0]!.methods.some((m) => m.name === 'm')).toBe(true);
    expect(result.structure.modules[0]!.imports).toContain('./helper');
    expect(
      result.structure.callGraph.edges.some((edge) => edge.from === 'a' && edge.to === 'b')
    ).toBe(true);
  });

  it('detects framework, bundler and crypto library from code heuristics', async () => {
    const { llm } = createLLM(['{}']);
    const analyzer = new CodeAnalyzer(llm);
    const code = `
      import React, { useState } from 'react';
      const value = CryptoJS.AES.encrypt('x', 'k');
      function view() { const [v] = useState(1); return v; }
      const req = __webpack_require__;
      export { view };
    `;

    const result = await analyzer.understand({ code });

    expect(result.techStack.framework).toBe('React');
    expect(result.techStack.bundler).toBe('Webpack');
    expect(result.techStack.cryptoLibrary).toContain('CryptoJS');
  });

  it('merges AI business logic output with provided context data model', async () => {
    const { llm } = createLLM([
      '{"businessLogic":{"mainFeatures":["checkout"],"dataFlow":"calculate totals"}}',
    ]);
    const analyzer = new CodeAnalyzer(llm);

    const result = await analyzer.understand({
      code: 'function pay(total){ return total; }',
      context: { tenant: 'acme', region: 'us-east-1' },
      focus: 'business',
    });

    expect(result.businessLogic.mainFeatures).toEqual(['checkout']);
    expect(result.businessLogic.rules).toContain('calculate totals');
    expect(result.businessLogic.dataModel).toMatchObject({
      tenant: 'acme',
      region: 'us-east-1',
    });
  });

  it('tracks tainted data paths from sources to eval sinks', async () => {
    const { llm } = createLLM(['{}', '{}']);
    const analyzer = new CodeAnalyzer(llm);
    const code = `
      const payload = location.search;
      eval(payload);
    `;

    const result = await analyzer.understand({ code, focus: 'security' });

    expect(result.dataFlow.sources.length).toBeGreaterThan(0);
    expect(result.dataFlow.sinks.some((sink) => sink.type === 'eval')).toBe(true);
    expect(result.dataFlow.taintPaths.length).toBeGreaterThan(0);
  });

  it('falls back gracefully when LLM analysis fails', async () => {
    const { llm, chat } = createLLM([new Error('LLM unavailable')]);
    const analyzer = new CodeAnalyzer(llm);

    const result = await analyzer.understand({
      code: 'function fallback(x){ return x + 1; }',
      focus: 'all',
    });

    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.structure.functions.some((fn) => fn.name === 'fallback')).toBe(true);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
  });
});
