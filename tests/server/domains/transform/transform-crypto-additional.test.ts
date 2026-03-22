import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@utils/WorkerPool', () => ({
  WorkerPool: class MockWorkerPool {
    submit = vi.fn();
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@src/constants', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    TRANSFORM_WORKER_TIMEOUT_MS: 5000,
    TRANSFORM_CRYPTO_POOL_MAX_WORKERS: 2,
    TRANSFORM_CRYPTO_POOL_IDLE_TIMEOUT_MS: 30000,
    TRANSFORM_CRYPTO_POOL_MAX_OLD_GEN_MB: 64,
    TRANSFORM_CRYPTO_POOL_MAX_YOUNG_GEN_MB: 32,
  };
});

vi.mock('@server/domains/shared/modules', () => ({
  ScriptManager: vi.fn(),
}));

import { TransformToolHandlersCrypto } from '@server/domains/transform/handlers.impl.transform-crypto';

class TestTransformToolHandlersCrypto extends TransformToolHandlersCrypto {
  public getCryptoHarnessPool() {
    return this.cryptoHarnessPool;
  }
}



interface CryptoExtractResponse {
  tool: string;
  error?: string;
  extractedCode?: string;
  dependencies?: string[];
  size?: number;
}

interface CryptoHarnessResult {
  input: string;
  output: string;
  duration: number;
  error?: string;
}

interface CryptoHarnessResponse {
  tool: string;
  error?: string;
  results: CryptoHarnessResult[];
  allPassed: boolean;
}

interface CryptoCompareResult {
  input: string;
  match: boolean;
  output1?: string;
  output2?: string;
  duration1?: number;
  duration2?: number;
  error1?: string;
  error2?: string;
}

interface CryptoCompareResponse {
  tool: string;
  error?: string;
  matches: number;
  mismatches: number;
  results: CryptoCompareResult[];
}



describe('TransformToolHandlersCrypto — additional coverage', () => {
  const page = {
    evaluate: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
    getFileByUrl: vi.fn(() => null),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;

  let handlers: TransformToolHandlersCrypto;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new TestTransformToolHandlersCrypto(collector);
  });

  // ── handleCryptoExtractStandalone — additional edge cases ──────

  describe('handleCryptoExtractStandalone — edge cases', () => {
    it('handles whitespace-only targetFunction', async () => {
      const body = parseJson<any>(
        await handlers.handleCryptoExtractStandalone({ targetFunction: '   ' })
      );

      expect(body.tool).toBe('crypto_extract_standalone');
      expect(body.error).toBeDefined();
    });

    it('handles extracted result with multiple dependency snippets', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: 'window.encrypt',
        targetSource: 'function encrypt(data) { return md5(sha256(data)); }',
        candidates: [
          {
            path: 'window.encrypt',
            source: 'function encrypt(data) { return md5(sha256(data)); }',
            score: 20,
          },
        ],
        dependencies: ['md5', 'sha256', 'helpers'],
        dependencySnippets: [
          'const md5 = function(v) { return v; };',
          'const sha256 = function(v) { return v; };',
          'const helpers = { util: 1 };',
        ],
      });

      const body = parseJson<any>(
        await handlers.handleCryptoExtractStandalone({
          targetFunction: 'encrypt',
          includePolyfills: true,
        })
      );

      expect(body.extractedCode).toContain("'use strict';");
      expect(body.extractedCode).toContain('const md5');
      expect(body.extractedCode).toContain('const sha256');
      expect(body.extractedCode).toContain('const helpers');
      expect(body.extractedCode).toContain('const encrypt');
      expect(body.extractedCode).toContain('globalThis.encrypt');
      expect(body.dependencies).toHaveLength(3);
      expect(body.size).toBeGreaterThan(0);
    });

    it('handles extracted with no dependency snippets and polyfills disabled', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: 'window.hash',
        targetSource: 'function hash(x) { return x.split("").reverse().join(""); }',
        candidates: [
          {
            path: 'window.hash',
            source: 'function hash(x) { return x.split("").reverse().join(""); }',
            score: 5,
          },
        ],
        dependencies: [],
        dependencySnippets: [],
      });

      const body = parseJson<any>(
        await handlers.handleCryptoExtractStandalone({
          targetFunction: 'hash',
          includePolyfills: false,
        })
      );

      expect(body.extractedCode).toContain("'use strict';");
      expect(body.extractedCode).not.toContain('atob');
      expect(body.extractedCode).not.toContain('btoa');
      expect(body.extractedCode).toContain('const hash');
      expect(body.extractedCode).toContain('globalThis.hash');
    });

    it('resolves function name from targetPath when targetFunction last segment is not a valid identifier', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: 'window.crypto.signData',
        targetSource: '(data) => data + "signed"',
        candidates: [
          { path: 'window.crypto.signData', source: '(data) => data + "signed"', score: 10 },
        ],
        dependencies: [],
        dependencySnippets: [],
      });

      const body = parseJson<any>(
        await handlers.handleCryptoExtractStandalone({
          // '123' is not a valid identifier (starts with digit), so falls back to targetPath
          targetFunction: '123',
        })
      );

      // resolveFunctionName: targetFunction='123' -> extractLastSegment -> '123' (invalid identifier)
      // then falls to targetPath: 'window.crypto.signData' -> extractLastSegment -> 'signData' (valid)
      expect(body.extractedCode).toContain('signData');
    });

    it('returns null extracted result', async () => {
      page.evaluate.mockResolvedValueOnce(null);

      const body = parseJson<any>(
        await handlers.handleCryptoExtractStandalone({ targetFunction: 'fn' })
      );
      expect(body.tool).toBe('crypto_extract_standalone');
      expect(body.error).toBeDefined();
    });

    it('handles includePolyfills as string "false"', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: 'window.fn',
        targetSource: 'function fn() { return 1; }',
        candidates: [{ path: 'window.fn', source: 'function fn() { return 1; }', score: 1 }],
        dependencies: [],
        dependencySnippets: [],
      });

      const body = parseJson<any>(
        await handlers.handleCryptoExtractStandalone({
          targetFunction: 'fn',
          includePolyfills: 'false',
        })
      );

      expect(body.extractedCode).not.toContain('atob');
    });

    it('handles includePolyfills as string "true"', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: 'window.fn',
        targetSource: 'function fn() { return 1; }',
        candidates: [{ path: 'window.fn', source: 'function fn() { return 1; }', score: 1 }],
        dependencies: [],
        dependencySnippets: [],
      });

      const body = parseJson<any>(
        await handlers.handleCryptoExtractStandalone({
          targetFunction: 'fn',
          includePolyfills: 'true',
        })
      );

      expect(body.extractedCode).toContain('atob');
    });

    it('handles includePolyfills as number 0', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: 'window.fn',
        targetSource: 'function fn() { return 1; }',
        candidates: [{ path: 'window.fn', source: 'function fn() { return 1; }', score: 1 }],
        dependencies: [],
        dependencySnippets: [],
      });

      const body = parseJson<any>(
        await handlers.handleCryptoExtractStandalone({
          targetFunction: 'fn',
          includePolyfills: 0,
        })
      );

      expect(body.extractedCode).not.toContain('atob');
    });
  });

  // ── handleCryptoTestHarness — additional edge cases ────────────

  describe('handleCryptoTestHarness — additional edge cases', () => {
    it('throws when testInputs is not an array', async () => {
      const body = parseJson<any>(
        await handlers.handleCryptoTestHarness({
          code: 'function fn(x) { return x; }',
          functionName: 'fn',
          testInputs: 'not-an-array',
        })
      );
      expect(body.tool).toBe('crypto_test_harness');
      expect(body.error).toContain('testInputs');
    });

    it('converts non-string test inputs to strings', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit.mockResolvedValueOnce({
        ok: true,
        results: [
          { input: '42', output: '42', duration: 0.1 },
          { input: 'true', output: 'true', duration: 0.1 },
        ],
      });

      const body = parseJson<any>(
        await handlers.handleCryptoTestHarness({
          code: 'function fn(x) { return x; }',
          functionName: 'fn',
          testInputs: [42, true],
        })
      );

      expect(body.results).toHaveLength(2);
      expect(body.allPassed).toBe(true);
    });

    it('strips error field from results when no error occurred', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit.mockResolvedValueOnce({
        ok: true,
        results: [{ input: 'a', output: 'b', duration: 0.1 }],
      });

      const body = parseJson<any>(
        await handlers.handleCryptoTestHarness({
          code: 'function fn(x) { return "b"; }',
          functionName: 'fn',
          testInputs: ['a'],
        })
      );

      expect(body.results[0]).not.toHaveProperty('error');
    });

    it('includes error field in results when error occurred', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit.mockResolvedValueOnce({
        ok: true,
        results: [{ input: 'a', output: '', duration: 0.0, error: 'something broke' }],
      });

      const body = parseJson<any>(
        await handlers.handleCryptoTestHarness({
          code: 'function fn() {}',
          functionName: 'fn',
          testInputs: ['a'],
        })
      );

      expect(body.results[0].error).toBe('something broke');
      expect(body.allPassed).toBe(false);
    });

    it('handles worker returning empty results array', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit.mockResolvedValueOnce({
        ok: true,
        results: [],
      });

      const body = parseJson<any>(
        await handlers.handleCryptoTestHarness({
          code: 'function fn(x) { return x; }',
          functionName: 'fn',
          testInputs: ['a'],
        })
      );

      expect(body.results).toHaveLength(0);
      expect(body.allPassed).toBe(true);
    });

    it('handles worker returning results without results field', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit.mockResolvedValueOnce({
        ok: true,
        // results field missing
      });

      const body = parseJson<any>(
        await handlers.handleCryptoTestHarness({
          code: 'function fn(x) { return x; }',
          functionName: 'fn',
          testInputs: ['a'],
        })
      );

      // Should handle gracefully - results would be []
      expect(body.results).toHaveLength(0);
      expect(body.allPassed).toBe(true);
    });

    it('handles worker ok:false without error message', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit.mockResolvedValueOnce({
        ok: false,
        // no error field
      });

      const body = parseJson<any>(
        await handlers.handleCryptoTestHarness({
          code: 'function fn() {}',
          functionName: 'fn',
          testInputs: ['x'],
        })
      );

      expect(body.allPassed).toBe(false);
      expect(body.results[0].error).toBe('Worker execution failed');
    });

    it('handles non-Error exception from pool.submit', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit.mockRejectedValueOnce('string error');

      const body = parseJson<any>(
        await handlers.handleCryptoTestHarness({
          code: 'function fn(x) { return x; }',
          functionName: 'fn',
          testInputs: ['a'],
        })
      );

      expect(body.allPassed).toBe(false);
      expect(body.results[0].error).toBe('string error');
    });
  });

  // ── handleCryptoCompare — additional edge cases ────────────────

  describe('handleCryptoCompare — additional edge cases', () => {
    it('throws when testInputs is missing', async () => {
      const body = parseJson<any>(
        await handlers.handleCryptoCompare({
          code1: 'function fn() {}',
          code2: 'function fn() {}',
          functionName: 'fn',
        })
      );
      expect(body.tool).toBe('crypto_compare');
      expect(body.error).toContain('testInputs');
    });

    it('throws when testInputs is empty array', async () => {
      const body = parseJson<any>(
        await handlers.handleCryptoCompare({
          code1: 'function fn() {}',
          code2: 'function fn() {}',
          functionName: 'fn',
          testInputs: [],
        })
      );
      expect(body.tool).toBe('crypto_compare');
      expect(body.error).toContain('testInputs');
    });

    it('handles missing result from one implementation (index out of range)', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit
        .mockResolvedValueOnce({
          ok: true,
          results: [
            { input: 'a', output: 'A', duration: 0.1 },
            { input: 'b', output: 'B', duration: 0.1 },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          results: [
            { input: 'a', output: 'A', duration: 0.1 },
            // second result missing
          ],
        });

      const body = parseJson<any>(
        await handlers.handleCryptoCompare({
          code1: 'function fn(x) { return x.toUpperCase(); }',
          code2: 'function fn(x) { return x.toUpperCase(); }',
          functionName: 'fn',
          testInputs: ['a', 'b'],
        })
      );

      expect(body.results).toHaveLength(2);
      expect(body.results[0].match).toBe(true);
      // Second result should have missing result from implementation #2
      expect(body.results[1].match).toBe(false);
      expect(body.results[1].error2).toBe('missing result from implementation #2');
    });

    it('handles missing result from both implementations', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit
        .mockResolvedValueOnce({
          ok: true,
          results: [], // no results from impl 1
        })
        .mockResolvedValueOnce({
          ok: true,
          results: [], // no results from impl 2
        });

      const body = parseJson<any>(
        await handlers.handleCryptoCompare({
          code1: 'function fn() {}',
          code2: 'function fn() {}',
          functionName: 'fn',
          testInputs: ['x'],
        })
      );

      expect(body.results).toHaveLength(1);
      expect(body.results[0].match).toBe(false);
      expect(body.results[0].error1).toBe('missing result from implementation #1');
      expect(body.results[0].error2).toBe('missing result from implementation #2');
    });

    it('marks match as false when one side has error even if outputs match', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'x', output: 'same', duration: 0.1, error: 'warning' }],
        })
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'x', output: 'same', duration: 0.1 }],
        });

      const body = parseJson<any>(
        await handlers.handleCryptoCompare({
          code1: 'function fn(x) { return "same"; }',
          code2: 'function fn(x) { return "same"; }',
          functionName: 'fn',
          testInputs: ['x'],
        })
      );

      // Even though outputs match, error in left means match=false
      expect(body.results[0].match).toBe(false);
      expect(body.results[0].error1).toBe('warning');
    });

    it('handles non-Error exception from crypto_compare', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit.mockRejectedValue(42); // non-Error throw

      const body = parseJson<any>(
        await handlers.handleCryptoCompare({
          code1: 'function fn() {}',
          code2: 'function fn() {}',
          functionName: 'fn',
          testInputs: ['a'],
        })
      );

      expect(body.results[0].match).toBe(false);
    });

    it('handles multiple test inputs with mixed results', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit
        .mockResolvedValueOnce({
          ok: true,
          results: [
            { input: 'a', output: 'X', duration: 0.1 },
            { input: 'b', output: 'Y', duration: 0.2 },
            { input: 'c', output: 'Z', duration: 0.3 },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          results: [
            { input: 'a', output: 'X', duration: 0.1 },
            { input: 'b', output: 'DIFFERENT', duration: 0.2 },
            { input: 'c', output: 'Z', duration: 0.3 },
          ],
        });

      const body = parseJson<any>(
        await handlers.handleCryptoCompare({
          code1: 'function fn(x) { return x; }',
          code2: 'function fn(x) { return x; }',
          functionName: 'fn',
          testInputs: ['a', 'b', 'c'],
        })
      );

      expect(body.matches).toBe(2);
      expect(body.mismatches).toBe(1);
      expect(body.results[0].match).toBe(true);
      expect(body.results[1].match).toBe(false);
      expect(body.results[2].match).toBe(true);
    });
  });
});
