import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock shared modules before imports
vi.mock('@server/domains/shared/modules', () => ({
  CodeCollector: vi.fn(),
  CodeAnalyzer: vi.fn(),
  CamoufoxBrowserManager: vi.fn(),
  AICaptchaDetector: vi.fn(),
  DOMInspector: vi.fn(),
  PageController: vi.fn(),
  CryptoDetector: vi.fn(),
  ASTOptimizer: vi.fn(),
  AdvancedDeobfuscator: vi.fn(),
  Deobfuscator: vi.fn(),
  ObfuscationDetector: vi.fn(),
  DebuggerManager: vi.fn(),
  RuntimeInspector: vi.fn(),
  ScriptManager: vi.fn(),
  BlackboxManager: vi.fn(),
  ExternalToolRunner: vi.fn(),
  ToolRegistry: vi.fn(),
  AIHookGenerator: vi.fn(),
  HookManager: vi.fn(),
  ConsoleMonitor: vi.fn(),
  PerformanceMonitor: vi.fn(),
  MemoryManager: vi.fn(),
  UnifiedProcessManager: vi.fn(),
  StealthScripts: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('TransformToolHandlersCrypto', () => {
  let TransformToolHandlersCrypto: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@server/domains/transform/handlers.impl.transform-crypto');
    TransformToolHandlersCrypto = mod.TransformToolHandlersCrypto;
  });

  function createHandler(pageOverrides: Record<string, unknown> = {}) {
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue({
        targetPath: 'window.CryptoJS.AES.encrypt',
        targetSource: 'function encrypt(a,b){return a+b}',
        candidates: [
          {
            path: 'window.CryptoJS.AES.encrypt',
            source: 'function encrypt(a,b){return a+b}',
            score: 5,
          },
        ],
        dependencies: ['CryptoJS'],
        dependencySnippets: ['const CryptoJS = {};'],
      }),
      ...pageOverrides,
    };
    const collector = {
      getActivePage: vi.fn().mockResolvedValue(mockPage),
    } as any;
    return { handler: new TransformToolHandlersCrypto(collector), mockPage, collector };
  }

  describe('handleCryptoExtractStandalone', () => {
    it('extracts crypto function with default options', async () => {
      const { handler } = createHandler();
      const result = await handler.handleCryptoExtractStandalone({
        targetFunction: 'window.CryptoJS.AES.encrypt',
      });
      const body = parseJson(result);
      expect(body.extractedCode).toBeDefined();
      expect(body.extractedCode).toContain("'use strict'");
      expect(body.dependencies).toContain('CryptoJS');
      expect(body.size).toBeGreaterThan(0);
    });

    it('includes polyfills when includePolyfills=true', async () => {
      const { handler } = createHandler();
      const result = await handler.handleCryptoExtractStandalone({
        targetFunction: 'encrypt',
        includePolyfills: true,
      });
      const body = parseJson(result);
      expect(body.extractedCode).toBeDefined();
    });

    it('excludes polyfills when includePolyfills=false', async () => {
      const { handler } = createHandler();
      const result = await handler.handleCryptoExtractStandalone({
        targetFunction: 'encrypt',
        includePolyfills: false,
      });
      const body = parseJson(result);
      expect(body.extractedCode).toBeDefined();
    });

    it('handles no function found on page', async () => {
      const { handler } = createHandler({
        evaluate: vi.fn().mockResolvedValue({
          targetPath: null,
          targetSource: '',
          candidates: [],
          dependencies: [],
          dependencySnippets: [],
        }),
      });
      const result = await handler.handleCryptoExtractStandalone({
        targetFunction: 'nonexistent',
      });
      const body = parseJson(result);
      expect(body.error).toContain('No crypto/signature-like function found');
      expect(body.tool).toBe('crypto_extract_standalone');
    });

    it('handles null result from evaluate', async () => {
      const { handler } = createHandler({
        evaluate: vi.fn().mockResolvedValue(null),
      });
      const result = await handler.handleCryptoExtractStandalone({
        targetFunction: 'test',
      });
      const body = parseJson(result);
      expect(body.error).toBeDefined();
    });

    it('handles page error', async () => {
      const collector = {
        getActivePage: vi.fn().mockRejectedValue(new Error('No page')),
      } as any;
      const handler = new TransformToolHandlersCrypto(collector);
      const result = await handler.handleCryptoExtractStandalone({
        targetFunction: 'test',
      });
      const body = parseJson(result);
      expect(body.error).toBe('No page');
      expect(body.tool).toBe('crypto_extract_standalone');
    });

    it('returns error on missing targetFunction', async () => {
      const { handler } = createHandler();
      const result = await handler.handleCryptoExtractStandalone({});
      const body = parseJson(result);
      expect(body.error).toBeDefined();
    });

    it('includes dependency snippets in output', async () => {
      const { handler } = createHandler({
        evaluate: vi.fn().mockResolvedValue({
          targetPath: 'window.fn',
          targetSource: 'function fn(){return 1}',
          candidates: [{ path: 'window.fn', source: 'function fn(){return 1}', score: 3 }],
          dependencies: ['dep1', 'dep2'],
          dependencySnippets: ['const dep1 = 42;', 'const dep2 = "hello";'],
        }),
      });
      const result = await handler.handleCryptoExtractStandalone({
        targetFunction: 'fn',
      });
      const body = parseJson(result);
      expect(body.extractedCode).toContain('const dep1 = 42');
      expect(body.extractedCode).toContain('const dep2 = "hello"');
    });

    it('handles empty dependency snippets', async () => {
      const { handler } = createHandler({
        evaluate: vi.fn().mockResolvedValue({
          targetPath: 'window.fn',
          targetSource: 'function fn(){return 1}',
          candidates: [{ path: 'window.fn', source: 'function fn(){return 1}', score: 3 }],
          dependencies: [],
          dependencySnippets: [],
        }),
      });
      const result = await handler.handleCryptoExtractStandalone({
        targetFunction: 'fn',
      });
      const body = parseJson(result);
      expect(body.extractedCode).not.toContain('const dep');
    });
  });

  describe('handleCryptoTestHarness', () => {
    it('runs test harness and returns results', async () => {
      const { handler } = createHandler();
      // Mock runCryptoHarness - it's a protected method, so we spy on it
      (handler as any).runCryptoHarness = vi.fn().mockResolvedValue({
        results: [
          { input: 'test1', output: 'result1', duration: 5 },
          { input: 'test2', output: 'result2', duration: 3 },
        ],
        allPassed: true,
      });

      const result = await handler.handleCryptoTestHarness({
        code: 'function fn(x){return x}',
        functionName: 'fn',
        testInputs: ['test1', 'test2'],
      });
      const body = parseJson(result);
      expect(body.results).toHaveLength(2);
      expect(body.allPassed).toBe(true);
    });

    it('includes error field when a test fails', async () => {
      const { handler } = createHandler();
      (handler as any).runCryptoHarness = vi.fn().mockResolvedValue({
        results: [
          { input: 'test1', output: '', duration: 5, error: 'ReferenceError: x is not defined' },
        ],
        allPassed: false,
      });

      const result = await handler.handleCryptoTestHarness({
        code: 'function fn(x){return y}',
        functionName: 'fn',
        testInputs: ['test1'],
      });
      const body = parseJson(result);
      expect(body.allPassed).toBe(false);
      expect(body.results[0].error).toBeDefined();
    });

    it('returns error on missing code', async () => {
      const { handler } = createHandler();
      const result = await handler.handleCryptoTestHarness({
        functionName: 'fn',
        testInputs: ['test'],
      });
      const body = parseJson(result);
      expect(body.error).toBeDefined();
    });

    it('returns error on missing functionName', async () => {
      const { handler } = createHandler();
      const result = await handler.handleCryptoTestHarness({
        code: 'function fn(x){return x}',
        testInputs: ['test'],
      });
      const body = parseJson(result);
      expect(body.error).toBeDefined();
    });
  });

  describe('handleCryptoCompare', () => {
    it('compares two implementations', async () => {
      const { handler } = createHandler();
      (handler as any).runCryptoHarness = vi
        .fn()
        .mockResolvedValueOnce({
          results: [
            { input: 'a', output: 'x', duration: 5 },
            { input: 'b', output: 'y', duration: 3 },
          ],
          allPassed: true,
        })
        .mockResolvedValueOnce({
          results: [
            { input: 'a', output: 'x', duration: 4 },
            { input: 'b', output: 'y', duration: 2 },
          ],
          allPassed: true,
        });

      const result = await handler.handleCryptoCompare({
        code1: 'function fn(x){return x}',
        code2: 'function fn(x){return x}',
        functionName: 'fn',
        testInputs: ['a', 'b'],
      });
      const body = parseJson(result);
      expect(body.matches).toBe(2);
      expect(body.mismatches).toBe(0);
      expect(body.results).toHaveLength(2);
      expect(body.results[0].match).toBe(true);
    });

    it('detects mismatches', async () => {
      const { handler } = createHandler();
      (handler as any).runCryptoHarness = vi
        .fn()
        .mockResolvedValueOnce({
          results: [{ input: 'a', output: 'x', duration: 5 }],
          allPassed: true,
        })
        .mockResolvedValueOnce({
          results: [{ input: 'a', output: 'z', duration: 4 }],
          allPassed: true,
        });

      const result = await handler.handleCryptoCompare({
        code1: 'function fn(x){return x}',
        code2: 'function fn(x){return x+1}',
        functionName: 'fn',
        testInputs: ['a'],
      });
      const body = parseJson(result);
      expect(body.mismatches).toBe(1);
      expect(body.results[0].match).toBe(false);
    });

    it('handles errors in one implementation', async () => {
      const { handler } = createHandler();
      (handler as any).runCryptoHarness = vi
        .fn()
        .mockResolvedValueOnce({
          results: [{ input: 'a', output: 'x', duration: 5 }],
          allPassed: true,
        })
        .mockResolvedValueOnce({
          results: [{ input: 'a', output: '', duration: 4, error: 'some error' }],
          allPassed: false,
        });

      const result = await handler.handleCryptoCompare({
        code1: 'function fn(x){return x}',
        code2: 'broken code',
        functionName: 'fn',
        testInputs: ['a'],
      });
      const body = parseJson(result);
      expect(body.mismatches).toBe(1);
      expect(body.results[0].error2).toBe('some error');
    });

    it('returns error on missing code1', async () => {
      const { handler } = createHandler();
      const result = await handler.handleCryptoCompare({
        code2: 'function fn(x){return x}',
        functionName: 'fn',
        testInputs: ['a'],
      });
      const body = parseJson(result);
      expect(body.error).toBeDefined();
    });

    it('handles missing results from an implementation', async () => {
      const { handler } = createHandler();
      (handler as any).runCryptoHarness = vi
        .fn()
        .mockResolvedValueOnce({
          results: [{ input: 'a', output: 'x', duration: 5 }],
          allPassed: true,
        })
        .mockResolvedValueOnce({
          results: [], // No results for impl 2
          allPassed: false,
        });

      const result = await handler.handleCryptoCompare({
        code1: 'fn1',
        code2: 'fn2',
        functionName: 'fn',
        testInputs: ['a'],
      });
      const body = parseJson(result);
      expect(body.mismatches).toBe(1);
      expect(body.results[0].error2).toContain('missing result');
    });
  });
});
