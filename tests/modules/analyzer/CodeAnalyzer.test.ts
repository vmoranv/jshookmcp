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
});
