import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

import { CodeAnalyzer } from '@modules/analyzer/CodeAnalyzer';

describe('CodeAnalyzer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    loggerState.debug.mockReset();
    loggerState.info.mockReset();
    loggerState.warn.mockReset();
    loggerState.error.mockReset();
    loggerState.success.mockReset();
  });

  it('extracts structure with functions, classes, modules and call graph edges', async () => {
    const analyzer = new CodeAnalyzer();
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
      result.structure.callGraph.edges.some((edge) => edge.from === 'a' && edge.to === 'b'),
    ).toBe(true);
  });

  it('detects non-empty tech stack heuristics from common code patterns', async () => {
    const analyzer = new CodeAnalyzer();
    const code = `
      function view() { const [v] = useState(1); return v; }
      export { view };
    `;

    const result = await analyzer.understand({ code });

    expect(typeof result.techStack.framework).toBe('string');
    expect((result.techStack.framework ?? '').length).toBeGreaterThan(0);
  });

  it('keeps context data model even when AI business logic is disabled', async () => {
    const legacy = { chat: vi.fn() } as any;
    const analyzer = new CodeAnalyzer(legacy);

    const result = await analyzer.understand({
      code: 'function pay(total){ return total; }',
      context: { tenant: 'acme', region: 'us-east-1' },
      focus: 'business',
    });

    expect(result.businessLogic.mainFeatures).toEqual([]);
    expect(result.businessLogic.rules).toEqual([]);
    expect(result.businessLogic.dataModel).toMatchObject({
      tenant: 'acme',
      region: 'us-east-1',
    });
    expect(legacy.chat).not.toHaveBeenCalled();
  });

  it('tracks tainted data paths from sources to eval sinks', async () => {
    const analyzer = new CodeAnalyzer();
    const code = `
      const payload = location.search;
      eval(payload);
    `;

    const result = await analyzer.understand({ code, focus: 'security' });

    expect(result.dataFlow.sources.length).toBeGreaterThan(0);
    expect(result.dataFlow.sinks.some((sink) => sink.type === 'eval')).toBe(true);
    expect(result.dataFlow.taintPaths.length).toBeGreaterThan(0);
  });

  it('ignores legacy dependencies during understanding', async () => {
    const legacy = { chat: vi.fn() } as any;
    const analyzer = new CodeAnalyzer(legacy);

    const result = await analyzer.understand({
      code: 'function fallback(x){ return x + 1; }',
      focus: 'all',
    });

    expect(legacy.chat).not.toHaveBeenCalled();
    expect(result.structure.functions.some((fn) => fn.name === 'fallback')).toBe(true);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
  });

  it('covers catch block in understand when a dependency throws', async () => {
    const analyzer = new CodeAnalyzer();
    // Force analyzeDataFlowWithTaint to throw by providing completely broken code
    // which it doesn't handle gracefully
    // Actually, to be safe, we can mock analyzeDataFlow
    const spy = vi
      .spyOn(analyzer as any, 'analyzeDataFlow')
      .mockRejectedValue(new Error('mock mock'));
    await expect(analyzer.understand({ code: 'valid' })).rejects.toThrow('mock mock');
    spy.mockRestore();
  });

  it('covers syntax error catch blocks in AST parsing', async () => {
    const analyzer = new CodeAnalyzer();
    // analyzeStructure and analyzeModules catch blocks
    const result = await analyzer.understand({ code: 'const a = {' });
    expect(result.structure.functions).toEqual([]);
    expect(result.structure.modules).toEqual([]);
  });

  it('extracts named and anonymous function expressions', async () => {
    const analyzer = new CodeAnalyzer();
    const code = `
      const a = function(p1) {};
      let b; b = function(p2) {};
      const c = (p3) => {};
      export { foo } from 'bar';
    `;
    const result = await analyzer.understand({ code });
    const fnNames = result.structure.functions.map((f) => f.name);

    expect(fnNames).toContain('a');
    expect(fnNames).toContain('b');
    expect(fnNames).toContain('c');
    expect(result.structure.modules[0]!.exports).toContain('bar');
  });

  it('builds call graph with various call expressions', async () => {
    const analyzer = new CodeAnalyzer();
    const code = `
      const target1 = function() {};
      function target2() {}
      const caller = function() {
        target1();
        obj.target2();
      };
    `;
    const result = await analyzer.understand({ code });
    const edges = result.structure.callGraph.edges;
    expect(edges.some((e) => e.from === 'caller' && e.to === 'target1')).toBe(true);
    expect(edges.some((e) => e.from === 'caller' && e.to === 'target2')).toBe(true);
  });

  it('calculates complexity through various statements', async () => {
    const analyzer = new CodeAnalyzer();
    const code = `
      function complexFn() {
        if (true) {}
        switch(x) { case 1: break; }
        for (let i=0; i<1; i++) {}
        while(false) {}
        do {} while(false);
        const y = true ? 1 : 2;
        const z = a && b || c;
        try {} catch(e) {}
      }
    `;
    const result = await analyzer.understand({ code });
    const fn = result.structure.functions.find((f) => f.name === 'complexFn');
    expect(fn!.complexity).toBeGreaterThan(5);
  });

  it('detects tech stack and business logic from aiAnalyze mocked result', async () => {
    const analyzer = new CodeAnalyzer();
    // Mock the aiAnalyze method to return fake extracted logic
    vi.spyOn(analyzer as any, 'aiAnalyze').mockResolvedValue({
      techStack: {
        framework: 'Svelte',
        bundler: 'Vite',
        libraries: ['axios'],
      },
      businessLogic: {
        mainFeatures: ['login'],
        dataFlow: 'user -> db',
      },
    });

    const code = `
      Vue.createApp();
      import { Component } from '@angular/core';
      __webpack_require__();
      import CryptoJS from 'crypto-js';
      import JSEncrypt from 'JSEncrypt';
    `;
    const result = await analyzer.understand({ code });

    expect(result.techStack.framework).toBe('Vue'); // Because it hits Vue first in the else if chain
    expect(result.techStack.bundler).toBe('Webpack'); // Overridden
    expect(result.techStack.cryptoLibrary).toContain('CryptoJS');
    expect(result.techStack.cryptoLibrary).toContain('crypto-js');
    expect(result.techStack.cryptoLibrary).toContain('JSEncrypt');

    expect(result.businessLogic.mainFeatures).toContain('login');
    expect(result.businessLogic.rules).toContain('user -> db');
  });
});
