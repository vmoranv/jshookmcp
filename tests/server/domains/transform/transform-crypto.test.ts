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



describe('TransformToolHandlersCrypto', () => {
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

  // ── handleCryptoExtractStandalone ──────────────────────────────────

  describe('handleCryptoExtractStandalone', () => {
    it('throws when targetFunction is missing', async () => {
      const body = parseJson<CryptoExtractResponse>(await handlers.handleCryptoExtractStandalone({}));
      expect(body.tool).toBe('crypto_extract_standalone');
      expect(body.error).toContain('targetFunction');
    });

    it('throws when targetFunction is empty string', async () => {
      const body = parseJson<CryptoExtractResponse>(await handlers.handleCryptoExtractStandalone({ targetFunction: '' }));
      expect(body.tool).toBe('crypto_extract_standalone');
      expect(body.error).toContain('targetFunction');
    });

    it('throws when targetFunction is not a string', async () => {
      const body = parseJson<CryptoExtractResponse>(await handlers.handleCryptoExtractStandalone({ targetFunction: 123 }));
      expect(body.tool).toBe('crypto_extract_standalone');
      expect(body.error).toContain('targetFunction');
    });

    it('returns error when no crypto function found on page', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: null,
        targetSource: '',
        candidates: [],
        dependencies: [],
        dependencySnippets: [],
      });

      const body = parseJson<CryptoExtractResponse>(
        await handlers.handleCryptoExtractStandalone({ targetFunction: 'encrypt' })
      );
      expect(body.tool).toBe('crypto_extract_standalone');
      expect(body.error).toContain('No crypto/signature-like function found');
    });

    it('returns error when targetSource is whitespace only', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: 'window.encrypt',
        targetSource: '   ',
        candidates: [],
        dependencies: [],
        dependencySnippets: [],
      });

      const body = parseJson<CryptoExtractResponse>(
        await handlers.handleCryptoExtractStandalone({ targetFunction: 'encrypt' })
      );
      expect(body.error).toContain('No crypto/signature-like function found');
    });

    it('extracts standalone code with polyfills included', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: 'window.mySign',
        targetSource: 'function mySign(data) { return data + "signed"; }',
        candidates: [
          {
            path: 'window.mySign',
            source: 'function mySign(data) { return data + "signed"; }',
            score: 10,
          },
        ],
        dependencies: ['helpers'],
        dependencySnippets: ['const helpers = { hash: function(v) { return v; } };'],
      });

      const body = parseJson<CryptoExtractResponse>(
        await handlers.handleCryptoExtractStandalone({
          targetFunction: 'mySign',
          includePolyfills: true,
        })
      );

      expect(body.extractedCode).toContain("'use strict';");
      expect(body.extractedCode).toContain('atob');
      expect(body.extractedCode).toContain('btoa');
      expect(body.extractedCode).toContain('const helpers');
      expect(body.extractedCode).toContain('const mySign');
      expect(body.extractedCode).toContain('globalThis.mySign');
      expect(body.dependencies).toEqual(['helpers']);
      expect(body.size).toBeGreaterThan(0);
    });

    it('extracts standalone code without polyfills', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: 'window.mySign',
        targetSource: 'function mySign(data) { return data; }',
        candidates: [
          { path: 'window.mySign', source: 'function mySign(data) { return data; }', score: 5 },
        ],
        dependencies: [],
        dependencySnippets: [],
      });

      const body = parseJson<CryptoExtractResponse>(
        await handlers.handleCryptoExtractStandalone({
          targetFunction: 'mySign',
          includePolyfills: false,
        })
      );

      expect(body.extractedCode).toContain("'use strict';");
      expect(body.extractedCode).not.toContain('atob');
      expect(body.extractedCode).toContain('const mySign');
    });

    it('handles dot-separated targetFunction for function name resolution', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: 'window.CryptoJS.AES.encrypt',
        targetSource: 'function encrypt(data) { return data; }',
        candidates: [
          {
            path: 'window.CryptoJS.AES.encrypt',
            source: 'function encrypt(data) { return data; }',
            score: 15,
          },
        ],
        dependencies: [],
        dependencySnippets: [],
      });

      const body = parseJson<CryptoExtractResponse>(
        await handlers.handleCryptoExtractStandalone({
          targetFunction: 'window.CryptoJS.AES.encrypt',
        })
      );

      expect(body.extractedCode).toContain('const encrypt');
    });

    it('falls back to function name from source when target is not valid identifier', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: null,
        targetSource: 'function computeHmac(key, msg) { return key + msg; }',
        candidates: [
          { path: '', source: 'function computeHmac(key, msg) { return key + msg; }', score: 8 },
        ],
        dependencies: [],
        dependencySnippets: [],
      });

      const body = parseJson<CryptoExtractResponse>(
        await handlers.handleCryptoExtractStandalone({
          targetFunction: '123invalid',
        })
      );

      expect(body.extractedCode).toContain('const computeHmac');
    });

    it('uses default fallback name when no valid identifier found', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: null,
        targetSource: '(a, b) => a + b',
        candidates: [{ path: '', source: '(a, b) => a + b', score: 3 }],
        dependencies: [],
        dependencySnippets: [],
      });

      const body = parseJson<CryptoExtractResponse>(
        await handlers.handleCryptoExtractStandalone({
          targetFunction: '***',
        })
      );

      expect(body.extractedCode).toContain('extractedCryptoFn');
    });

    it('handles page.evaluate rejection', async () => {
      page.evaluate.mockRejectedValueOnce(new Error('Page not responding'));

      const body = parseJson<CryptoExtractResponse>(
        await handlers.handleCryptoExtractStandalone({ targetFunction: 'fn' })
      );
      expect(body.tool).toBe('crypto_extract_standalone');
      expect(body.error).toContain('Page not responding');
    });

    it('handles includePolyfills default to true', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: 'window.fn',
        targetSource: 'function fn() { return 1; }',
        candidates: [{ path: 'window.fn', source: 'function fn() { return 1; }', score: 1 }],
        dependencies: [],
        dependencySnippets: [],
      });

      const body = parseJson<CryptoExtractResponse>(
        await handlers.handleCryptoExtractStandalone({
          targetFunction: 'fn',
        })
      );

      expect(body.extractedCode).toContain('atob');
    });

    it('handles extracted with empty dependency snippets', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: 'window.fn',
        targetSource: 'function fn() { return "hello"; }',
        candidates: [{ path: 'window.fn', source: 'function fn() { return "hello"; }', score: 2 }],
        dependencies: ['dep1', 'dep2'],
        dependencySnippets: [],
      });

      const body = parseJson<CryptoExtractResponse>(
        await handlers.handleCryptoExtractStandalone({
          targetFunction: 'fn',
          includePolyfills: false,
        })
      );

      expect(body.extractedCode).toContain("'use strict';");
      expect(body.extractedCode).toContain('const fn');
      expect(body.dependencies).toEqual(['dep1', 'dep2']);
    });
  });

  // ── handleCryptoTestHarness ────────────────────────────────────────

  describe('handleCryptoTestHarness', () => {
    it('throws when code is missing', async () => {
      const body = parseJson<CryptoHarnessResponse>(
        await handlers.handleCryptoTestHarness({ functionName: 'fn', testInputs: ['a'] })
      );
      expect(body.tool).toBe('crypto_test_harness');
      expect(body.error).toContain('code');
    });

    it('throws when functionName is missing', async () => {
      const body = parseJson<CryptoHarnessResponse>(
        await handlers.handleCryptoTestHarness({ code: 'var x = 1;', testInputs: ['a'] })
      );
      expect(body.tool).toBe('crypto_test_harness');
      expect(body.error).toContain('functionName');
    });

    it('throws when testInputs is missing', async () => {
      const body = parseJson<CryptoHarnessResponse>(
        await handlers.handleCryptoTestHarness({ code: 'var x = 1;', functionName: 'fn' })
      );
      expect(body.tool).toBe('crypto_test_harness');
      expect(body.error).toContain('testInputs');
    });

    it('throws when testInputs is empty array', async () => {
      const body = parseJson<CryptoHarnessResponse>(
        await handlers.handleCryptoTestHarness({
          code: 'function fn() {}',
          functionName: 'fn',
          testInputs: [],
        })
      );
      expect(body.tool).toBe('crypto_test_harness');
      expect(body.error).toContain('testInputs');
    });

    it('returns successful harness results', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit.mockResolvedValueOnce({
        ok: true,
        results: [
          { input: 'test1', output: 'result1', duration: 0.5 },
          { input: 'test2', output: 'result2', duration: 0.3 },
        ],
      });

      const body = parseJson<CryptoHarnessResponse>(
        await handlers.handleCryptoTestHarness({
          code: 'function fn(x) { return x; }',
          functionName: 'fn',
          testInputs: ['test1', 'test2'],
        })
      );

      expect(body.results).toHaveLength(2);
      expect(body.results[0]?.input).toBe('test1');
      expect(body.results[0]?.output).toBe('result1');
      expect(body.results[0]?.duration).toBe(0.5);
      expect(body.allPassed).toBe(true);
    });

    it('handles worker returning errors for some inputs', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit.mockResolvedValueOnce({
        ok: true,
        results: [
          { input: 'ok', output: 'good', duration: 0.1 },
          { input: 'bad', output: '', duration: 0.0, error: 'ReferenceError: x is not defined' },
        ],
      });

      const body = parseJson<CryptoHarnessResponse>(
        await handlers.handleCryptoTestHarness({
          code: 'function fn(x) { return x; }',
          functionName: 'fn',
          testInputs: ['ok', 'bad'],
        })
      );

      expect(body.results).toHaveLength(2);
      expect(body.results[0]?.error).toBeUndefined();
      expect(body.results[1]?.error).toBe('ReferenceError: x is not defined');
      expect(body.allPassed).toBe(false);
    });

    it('handles worker overall failure', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit.mockResolvedValueOnce({
        ok: false,
        error: 'Syntax error in code',
        results: [],
      });

      const body = parseJson<CryptoHarnessResponse>(
        await handlers.handleCryptoTestHarness({
          code: 'invalid syntax {{{}}}',
          functionName: 'fn',
          testInputs: ['a', 'b'],
        })
      );

      expect(body.allPassed).toBe(false);
      expect(body.results).toHaveLength(2);
      expect(body.results[0]?.error).toBe('Syntax error in code');
      expect(body.results[1]?.error).toBe('Syntax error in code');
    });

    it('handles worker pool submit rejection', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit.mockRejectedValueOnce(new Error('Worker timed out'));

      const body = parseJson<CryptoHarnessResponse>(
        await handlers.handleCryptoTestHarness({
          code: 'function fn(x) { while(true); }',
          functionName: 'fn',
          testInputs: ['input1'],
        })
      );

      expect(body.allPassed).toBe(false);
      expect(body.results).toHaveLength(1);
      expect(body.results[0]?.error).toBe('Worker timed out');
    });
  });

  // ── handleCryptoCompare ────────────────────────────────────────────

  describe('handleCryptoCompare', () => {
    it('throws when code1 is missing', async () => {
      const body = parseJson<CryptoCompareResponse>(
        await handlers.handleCryptoCompare({
          code2: 'function fn() {}',
          functionName: 'fn',
          testInputs: ['a'],
        })
      );
      expect(body.tool).toBe('crypto_compare');
      expect(body.error).toContain('code1');
    });

    it('throws when code2 is missing', async () => {
      const body = parseJson<CryptoCompareResponse>(
        await handlers.handleCryptoCompare({
          code1: 'function fn() {}',
          functionName: 'fn',
          testInputs: ['a'],
        })
      );
      expect(body.tool).toBe('crypto_compare');
      expect(body.error).toContain('code2');
    });

    it('throws when functionName is missing', async () => {
      const body = parseJson<CryptoCompareResponse>(
        await handlers.handleCryptoCompare({
          code1: 'function fn() {}',
          code2: 'function fn() {}',
          testInputs: ['a'],
        })
      );
      expect(body.tool).toBe('crypto_compare');
      expect(body.error).toContain('functionName');
    });

    it('returns matching results when both implementations agree', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit
        .mockResolvedValueOnce({
          ok: true,
          results: [
            { input: 'hello', output: 'HELLO', duration: 0.1 },
            { input: 'world', output: 'WORLD', duration: 0.1 },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          results: [
            { input: 'hello', output: 'HELLO', duration: 0.2 },
            { input: 'world', output: 'WORLD', duration: 0.2 },
          ],
        });

      const body = parseJson<CryptoCompareResponse>(
        await handlers.handleCryptoCompare({
          code1: 'function fn(x) { return x.toUpperCase(); }',
          code2: 'function fn(x) { return x.split("").map(c=>c.toUpperCase()).join(""); }',
          functionName: 'fn',
          testInputs: ['hello', 'world'],
        })
      );

      expect(body.matches).toBe(2);
      expect(body.mismatches).toBe(0);
      expect(body.results).toHaveLength(2);
      expect(body.results[0]?.match).toBe(true);
      expect(body.results[0]?.output1).toBe('HELLO');
      expect(body.results[0]?.output2).toBe('HELLO');
    });

    it('detects mismatches when implementations differ', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'abc', output: 'ABC', duration: 0.1 }],
        })
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'abc', output: 'abc_v2', duration: 0.1 }],
        });

      const body = parseJson<CryptoCompareResponse>(
        await handlers.handleCryptoCompare({
          code1: 'function fn(x) { return x.toUpperCase(); }',
          code2: 'function fn(x) { return x + "_v2"; }',
          functionName: 'fn',
          testInputs: ['abc'],
        })
      );

      expect(body.matches).toBe(0);
      expect(body.mismatches).toBe(1);
      expect(body.results[0]?.match).toBe(false);
      expect(body.results[0]?.output1).toBe('ABC');
      expect(body.results[0]?.output2).toBe('abc_v2');
    });

    it('handles one implementation erroring and the other succeeding', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'test', output: 'ok', duration: 0.1 }],
        })
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'test', output: '', duration: 0.0, error: 'fn is not defined' }],
        });

      const body = parseJson<CryptoCompareResponse>(
        await handlers.handleCryptoCompare({
          code1: 'function fn(x) { return "ok"; }',
          code2: 'var broken = 1;',
          functionName: 'fn',
          testInputs: ['test'],
        })
      );

      expect(body.mismatches).toBe(1);
      expect(body.results[0]?.match).toBe(false);
      expect(body.results[0]?.error2).toBe('fn is not defined');
    });

    it('handles both implementations failing', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit
        .mockResolvedValueOnce({
          ok: false,
          error: 'Syntax error',
          results: [],
        })
        .mockResolvedValueOnce({
          ok: false,
          error: 'Syntax error',
          results: [],
        });

      const body = parseJson<CryptoCompareResponse>(
        await handlers.handleCryptoCompare({
          code1: '{{invalid}}',
          code2: '{{also invalid}}',
          functionName: 'fn',
          testInputs: ['x'],
        })
      );

      expect(body.mismatches).toBe(1);
      expect(body.results[0]?.match).toBe(false);
    });

    it('includes duration data for both implementations', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'x', output: 'y', duration: 1.5 }],
        })
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'x', output: 'y', duration: 3.2 }],
        });

      const body = parseJson<CryptoCompareResponse>(
        await handlers.handleCryptoCompare({
          code1: 'function fn(x) { return "y"; }',
          code2: 'function fn(x) { return "y"; }',
          functionName: 'fn',
          testInputs: ['x'],
        })
      );

      expect(body.results[0]?.duration1).toBe(1.5);
      expect(body.results[0]?.duration2).toBe(3.2);
      expect(body.results[0]?.match).toBe(true);
    });

    it('handles pool rejection for crypto compare', async () => {
      const pool = handlers.getCryptoHarnessPool();
      pool.submit.mockRejectedValue(new Error('Pool exhausted'));

      const body = parseJson<CryptoCompareResponse>(
        await handlers.handleCryptoCompare({
          code1: 'function fn() {}',
          code2: 'function fn() {}',
          functionName: 'fn',
          testInputs: ['a'],
        })
      );

      expect(body.mismatches).toBe(1);
      expect(body.results[0]?.match).toBe(false);
    });
  });

  // ── close ──────────────────────────────────────────────────────────

  describe('close', () => {
    it('closes the crypto harness pool', async () => {
      const pool = handlers.getCryptoHarnessPool();
      await handlers.close();
      expect(pool.close).toHaveBeenCalledOnce();
    });
  });
});
