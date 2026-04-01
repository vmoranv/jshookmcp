/**
 * Additional coverage tests for TransformToolHandlersCrypto.
 *
 * Focuses on handleCryptoCompare edge cases not yet covered:
 * - Both implementations having errors with same output
 * - Implementation returning non-Error rejection
 */
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

function depFn(value: string) {
  return value.toUpperCase();
}

class TestHandlers extends TransformToolHandlersCrypto {
  public getCryptoHarnessPool() {
    return this.cryptoHarnessPool;
  }
}

describe('TransformToolHandlersCrypto — edge case coverage', () => {
  const page = {
    evaluate: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
    getFileByUrl: vi.fn(() => null),
  } as any;

  let handlers: TestHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new TestHandlers(collector);
  });

  // ── handleCryptoCompare — both errors same output ──────────

  describe('handleCryptoCompare — both errors', () => {
    it('reports mismatch when both sides have errors even if outputs match', async () => {
      // @ts-expect-error — auto-suppressed [TS2339]
      const pool = handlers.getCryptoHarnessPool();
      pool.submit
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'x', output: '', duration: 0, error: 'err1' }],
        })
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'x', output: '', duration: 0, error: 'err2' }],
        });

      const body = parseJson<any>(
        await handlers.handleCryptoCompare({
          code1: 'broken1',
          code2: 'broken2',
          functionName: 'fn',
          testInputs: ['x'],
        }),
      );

      expect(body.results[0].match).toBe(false);
      expect(body.results[0].error1).toBe('err1');
      expect(body.results[0].error2).toBe('err2');
      expect(body.mismatches).toBe(1);
    });
  });

  // ── handleCryptoExtractStandalone — edge cases ─────────────

  describe('handleCryptoExtractStandalone — window.prefix in target', () => {
    it('handles targetFunction with window. prefix for name resolution', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: 'window.mySign',
        targetSource: 'function mySign() { return "signed"; }',
        candidates: [
          {
            path: 'window.mySign',
            source: 'function mySign() { return "signed"; }',
            score: 5,
          },
        ],
        dependencies: [],
        dependencySnippets: [],
      });

      const body = parseJson<any>(
        await handlers.handleCryptoExtractStandalone({
          targetFunction: 'window.mySign',
          includePolyfills: false,
        }),
      );

      // resolveFunctionName extracts 'mySign' from 'window.mySign'
      expect(body.extractedCode).toContain('const mySign');
      expect(body.extractedCode).toContain('globalThis.mySign');
    });

    it('executes the page evaluation callback against window globals and collects dependency snippets', async () => {
      const originalWindow = (globalThis as any).window;
      const fakeWindow = {
        depFn,
        helpers: { value: 'helper-value' },
        prefix: 'sig-',
        count: 7,
        flag: true,
        myNamespace: {
          sign(data: string) {
            return window.depFn(
              window.prefix + data + window.count + window.helpers.value + String(window.flag),
            );
          },
        },
      } as any;
      fakeWindow.window = fakeWindow;
      (globalThis as any).window = fakeWindow;

      page.evaluate.mockImplementationOnce(async (fn: (...args: any[]) => any, ...args: any[]) =>
        fn(...args),
      );

      try {
        const body = parseJson<any>(
          await handlers.handleCryptoExtractStandalone({
            targetFunction: 'window.myNamespace.sign',
            includePolyfills: false,
          }),
        );

        expect(body.extractedCode).toContain('const sign');
        expect(body.extractedCode).toContain('globalThis.sign');
        expect(Array.isArray(body.dependencies)).toBe(true);
        expect(body.size).toBeGreaterThan(0);
      } finally {
        (globalThis as any).window = originalWindow;
      }
    });

    it('returns a fail response when no crypto source is extracted', async () => {
      page.evaluate.mockResolvedValueOnce({
        targetPath: null,
        targetSource: '',
        candidates: [],
        dependencies: [],
        dependencySnippets: [],
      });

      const body = parseJson<any>(
        await handlers.handleCryptoExtractStandalone({
          targetFunction: 'window.unknown',
          includePolyfills: true,
        }),
      );

      expect(body.error).toContain('No crypto/signature-like function found on current page');
    });
  });

  // ── handleCryptoTestHarness — result mapping ──────────────

  describe('handleCryptoTestHarness — result mapping', () => {
    it('maps worker results and strips undefined errors', async () => {
      // @ts-expect-error — auto-suppressed [TS2339]
      const pool = handlers.getCryptoHarnessPool();
      pool.submit.mockResolvedValueOnce({
        ok: true,
        results: [
          { input: 'a', output: 'A', duration: 0.1 },
          { input: 'b', output: 'B', duration: 0.2, error: undefined },
        ],
      });

      const body = parseJson<any>(
        await handlers.handleCryptoTestHarness({
          code: 'function fn(x) { return x.toUpperCase(); }',
          functionName: 'fn',
          testInputs: ['a', 'b'],
        }),
      );

      expect(body.results).toHaveLength(2);
      expect(body.results[0]).not.toHaveProperty('error');
      expect(body.results[1]).not.toHaveProperty('error');
      expect(body.allPassed).toBe(true);
    });

    it('fails when the harness runner rejects with a non-Error value', async () => {
      const spy = vi.spyOn(handlers, 'runCryptoHarness').mockRejectedValueOnce('boom');

      const body = parseJson<any>(
        await handlers.handleCryptoTestHarness({
          code: 'function fn(x) { return x; }',
          functionName: 'fn',
          testInputs: ['x'],
        }),
      );

      expect(body.error).toContain('boom');
      spy.mockRestore();
    });
  });

  describe('handleCryptoCompare — matches', () => {
    it('reports matches when both implementations agree with no errors', async () => {
      const spy = vi
        .spyOn(handlers, 'runCryptoHarness')
        .mockResolvedValueOnce({
          results: [{ input: 'x', output: 'X', duration: 0.1 }],
          allPassed: true,
        })
        .mockResolvedValueOnce({
          results: [{ input: 'x', output: 'X', duration: 0.2 }],
          allPassed: true,
        });

      const body = parseJson<any>(
        await handlers.handleCryptoCompare({
          code1: 'code1',
          code2: 'code2',
          functionName: 'fn',
          testInputs: ['x'],
        }),
      );

      expect(body.matches).toBe(1);
      expect(body.mismatches).toBe(0);
      expect(body.results[0].match).toBe(true);
      expect(body.results[0]).not.toHaveProperty('error1');
      expect(body.results[0]).not.toHaveProperty('error2');

      spy.mockRestore();
    });
  });
});
