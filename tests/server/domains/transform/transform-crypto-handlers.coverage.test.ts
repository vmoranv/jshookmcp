import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CryptoHandlers } from '@server/domains/transform/handlers/crypto-handlers';
import type { TransformSharedState } from '@server/domains/transform/handlers/shared';

function parseBody(result: any) {
  return JSON.parse(result.content[0].text);
}

const mockSubmit = vi.fn();

const mockPool = {
  submit: mockSubmit,
} as any;

const mockGetActivePage = vi.fn();

function createMockState(): TransformSharedState {
  mockGetActivePage.mockResolvedValue({
    evaluate: vi.fn().mockResolvedValue({
      targetPath: 'window.myEncrypt',
      targetSource: 'function myEncrypt(a){return a}',
      candidates: [
        { path: 'window.myEncrypt', source: 'function myEncrypt(a){return a}', score: 5 },
      ],
      dependencies: [],
      dependencySnippets: [],
    }),
  });

  return {
    collector: { getActivePage: mockGetActivePage } as any,
    chains: new Map(),
    cryptoHarnessPool: mockPool,
  };
}

describe('CryptoHandlers', () => {
  let handler: CryptoHandlers;
  let state: TransformSharedState;

  beforeEach(() => {
    vi.clearAllMocks();
    state = createMockState();
    handler = new CryptoHandlers(state);
  });

  describe('runCryptoHarnessProxy', () => {
    it('delegates to runCryptoHarness with pool', async () => {
      mockSubmit.mockResolvedValue({
        ok: true,
        results: [{ input: 'a', output: 'b', duration: 1 }],
      });

      const result = await handler.runCryptoHarnessProxy('function fn(x){return x}', 'fn', ['a']);
      expect(result.results).toHaveLength(1);
      expect(result.allPassed).toBe(true);
    });
  });

  describe('handleCryptoExtractStandalone', () => {
    it('returns error on missing targetFunction', async () => {
      const result = await handler.handleCryptoExtractStandalone({});
      const body = parseBody(result);
      expect(body.error).toBeDefined();
      expect(body.tool).toBe('crypto_extract_standalone');
    });

    it('returns error on empty targetFunction', async () => {
      const result = await handler.handleCryptoExtractStandalone({ targetFunction: '' });
      const body = parseBody(result);
      expect(body.error).toBeDefined();
    });

    it('returns error when no function found', async () => {
      mockGetActivePage.mockResolvedValue({
        evaluate: vi.fn().mockResolvedValue({
          targetPath: null,
          targetSource: '',
          candidates: [],
          dependencies: [],
          dependencySnippets: [],
        }),
      });

      const result = await handler.handleCryptoExtractStandalone({ targetFunction: 'nonexistent' });
      const body = parseBody(result);
      expect(body.error).toContain('No crypto/signature-like function found');
    });

    it('returns error when extraction returns null', async () => {
      mockGetActivePage.mockResolvedValue({
        evaluate: vi.fn().mockResolvedValue(null),
      });

      const result = await handler.handleCryptoExtractStandalone({ targetFunction: 'test' });
      const body = parseBody(result);
      expect(body.error).toBeDefined();
    });

    it('extracts function with polyfills', async () => {
      const result = await handler.handleCryptoExtractStandalone({
        targetFunction: 'myEncrypt',
        includePolyfills: true,
      });
      const body = parseBody(result);
      expect(body.extractedCode).toContain("'use strict'");
      expect(body.extractedCode).toContain('myEncrypt');
      expect(body.size).toBeGreaterThan(0);
    });

    it('extracts function without polyfills', async () => {
      const result = await handler.handleCryptoExtractStandalone({
        targetFunction: 'myEncrypt',
        includePolyfills: false,
      });
      const body = parseBody(result);
      expect(body.extractedCode).toContain('myEncrypt');
    });

    it('includes dependency snippets', async () => {
      mockGetActivePage.mockResolvedValue({
        evaluate: vi.fn().mockResolvedValue({
          targetPath: 'window.fn',
          targetSource: 'function fn(){return 1}',
          candidates: [{ path: 'window.fn', source: 'function fn(){return 1}', score: 3 }],
          dependencies: ['dep1'],
          dependencySnippets: ['const dep1 = 42;'],
        }),
      });

      const result = await handler.handleCryptoExtractStandalone({ targetFunction: 'fn' });
      const body = parseBody(result);
      expect(body.extractedCode).toContain('const dep1 = 42;');
    });

    it('handles page error gracefully', async () => {
      mockGetActivePage.mockRejectedValue(new Error('No active page'));

      const result = await handler.handleCryptoExtractStandalone({ targetFunction: 'test' });
      const body = parseBody(result);
      expect(body.error).toBe('No active page');
      expect(body.tool).toBe('crypto_extract_standalone');
    });
  });

  describe('handleCryptoTestHarness', () => {
    it('returns error on missing code', async () => {
      const result = await handler.handleCryptoTestHarness({
        functionName: 'fn',
        testInputs: ['a'],
      });
      const body = parseBody(result);
      expect(body.error).toBeDefined();
    });

    it('returns error on missing functionName', async () => {
      const result = await handler.handleCryptoTestHarness({
        code: 'function fn(){}',
        testInputs: ['a'],
      });
      const body = parseBody(result);
      expect(body.error).toBeDefined();
    });

    it('returns error on missing testInputs', async () => {
      const result = await handler.handleCryptoTestHarness({
        code: 'function fn(){}',
        functionName: 'fn',
      });
      const body = parseBody(result);
      expect(body.error).toBeDefined();
    });

    it('returns error on empty testInputs array', async () => {
      const result = await handler.handleCryptoTestHarness({
        code: 'function fn(){}',
        functionName: 'fn',
        testInputs: [],
      });
      const body = parseBody(result);
      expect(body.error).toBeDefined();
    });

    it('runs harness and returns results', async () => {
      mockSubmit.mockResolvedValue({
        ok: true,
        results: [
          { input: 'a', output: 'b', duration: 5 },
          { input: 'c', output: 'd', duration: 3 },
        ],
      });

      const result = await handler.handleCryptoTestHarness({
        code: 'function fn(x){return x}',
        functionName: 'fn',
        testInputs: ['a', 'c'],
      });
      const body = parseBody(result);
      expect(body.results).toHaveLength(2);
      expect(body.allPassed).toBe(true);
    });

    it('reports failed tests', async () => {
      mockSubmit.mockResolvedValue({
        ok: true,
        results: [{ input: 'a', output: '', duration: 5, error: 'TypeError' }],
      });

      const result = await handler.handleCryptoTestHarness({
        code: 'function fn(){throw new Error()}',
        functionName: 'fn',
        testInputs: ['a'],
      });
      const body = parseBody(result);
      expect(body.allPassed).toBe(false);
      expect(body.results[0].error).toBe('TypeError');
    });

    it('handles worker error', async () => {
      mockSubmit.mockResolvedValue({
        ok: false,
        error: 'Worker timeout',
      });

      const result = await handler.handleCryptoTestHarness({
        code: 'function fn(x){return x}',
        functionName: 'fn',
        testInputs: ['a'],
      });
      const body = parseBody(result);
      expect(body.allPassed).toBe(false);
    });
  });

  describe('handleCryptoCompare', () => {
    it('returns error on missing code1', async () => {
      const result = await handler.handleCryptoCompare({
        code2: 'fn2',
        functionName: 'fn',
        testInputs: ['a'],
      });
      const body = parseBody(result);
      expect(body.error).toBeDefined();
    });

    it('returns error on missing code2', async () => {
      const result = await handler.handleCryptoCompare({
        code1: 'fn1',
        functionName: 'fn',
        testInputs: ['a'],
      });
      const body = parseBody(result);
      expect(body.error).toBeDefined();
    });

    it('compares two matching implementations', async () => {
      mockSubmit
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'a', output: 'x', duration: 5 }],
        })
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'a', output: 'x', duration: 4 }],
        });

      const result = await handler.handleCryptoCompare({
        code1: 'function fn(x){return x}',
        code2: 'function fn(x){return x}',
        functionName: 'fn',
        testInputs: ['a'],
      });
      const body = parseBody(result);
      expect(body.matches).toBe(1);
      expect(body.mismatches).toBe(0);
      expect(body.results[0].match).toBe(true);
    });

    it('detects mismatches', async () => {
      mockSubmit
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'a', output: 'x', duration: 5 }],
        })
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'a', output: 'z', duration: 4 }],
        });

      const result = await handler.handleCryptoCompare({
        code1: 'fn1',
        code2: 'fn2',
        functionName: 'fn',
        testInputs: ['a'],
      });
      const body = parseBody(result);
      expect(body.mismatches).toBe(1);
      expect(body.results[0].match).toBe(false);
      expect(body.results[0].output1).toBe('x');
      expect(body.results[0].output2).toBe('z');
    });

    it('handles error in one implementation', async () => {
      mockSubmit
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'a', output: 'x', duration: 5 }],
        })
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'a', output: '', duration: 4, error: 'boom' }],
        });

      const result = await handler.handleCryptoCompare({
        code1: 'fn1',
        code2: 'fn2',
        functionName: 'fn',
        testInputs: ['a'],
      });
      const body = parseBody(result);
      expect(body.mismatches).toBe(1);
      expect(body.results[0].error2).toBe('boom');
    });

    it('handles missing results from implementation', async () => {
      mockSubmit
        .mockResolvedValueOnce({
          ok: true,
          results: [{ input: 'a', output: 'x', duration: 5 }],
        })
        .mockResolvedValueOnce({
          ok: true,
          results: [],
        });

      const result = await handler.handleCryptoCompare({
        code1: 'fn1',
        code2: 'fn2',
        functionName: 'fn',
        testInputs: ['a'],
      });
      const body = parseBody(result);
      expect(body.mismatches).toBe(1);
      expect(body.results[0].error2).toContain('missing result');
    });
  });
});
