/**
 * Additional coverage tests for TransformToolHandlersBase.
 *
 * Focuses on remaining uncovered branches:
 * - resolveScriptSource: different fallback paths
 * - resolveFunctionName: edge cases
 * - runCryptoHarness: edge cases
 * - close: error handling
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TransformToolHandlersBase,
  CRYPTO_KEYWORDS,
  NUMERIC_BINARY_EXPR,
  STRING_CONCAT_EXPR,
  STRING_LITERAL_EXPR,
  DEAD_CODE_IF_FALSE,
  DEAD_CODE_IF_FALSE_WITH_ELSE,
  TransformLimit,
} from '@server/domains/transform/handlers.impl.transform-base';

// vi.hoisted creates refs BEFORE vi.mock hoisting so factories can close over them
const getScriptSourceMock = vi.hoisted(() =>
  vi.fn<() => Promise<{ source: string; url?: string } | null>>(),
);
const scriptManagerCloseMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const workerPoolCloseMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const workerPoolSubmitMock = vi.hoisted(() => vi.fn());

vi.mock('@utils/WorkerPool', () => {
  class MockWorkerPool {
    submit = workerPoolSubmitMock;
    close = workerPoolCloseMock;
  }
  return { WorkerPool: MockWorkerPool };
});

vi.mock('@server/domains/shared/modules', () => {
  class MockScriptManager {
    getScriptSource = getScriptSourceMock;
    close = scriptManagerCloseMock;
  }
  return { ScriptManager: MockScriptManager };
});

class TestableBase extends TransformToolHandlersBase {
  public testParseTransforms(raw: any) {
    return this.parseTransforms(raw);
  }
  public testParseBoolean(raw: any, def: boolean) {
    return this.parseBoolean(raw, def);
  }
  public testRequireString(raw: any, field: string) {
    return this.requireString(raw, field);
  }
  public testEscapeStringContent(v: string, q: string) {
    return this.escapeStringContent(v, q);
  }
  public testDecodeEscapedString(v: string) {
    return this.decodeEscapedString(v);
  }
  public testIsValidIdentifier(v: string) {
    return this.isValidIdentifier(v);
  }
  public testParseTestInputs(raw: any) {
    return this.parseTestInputs(raw);
  }
  public testResolveFunctionName(targetFunction: string, targetPath: string, source: string) {
    return this.resolveFunctionName(targetFunction, targetPath, source);
  }
  public testBuildCryptoPolyfills() {
    return this.buildCryptoPolyfills();
  }
  public async testResolveScriptSource(scriptId: string) {
    return this.resolveScriptSource(scriptId);
  }
  public async testRunCryptoHarness(code: string, functionName: string, testInputs: string[]) {
    return this.runCryptoHarness(code, functionName, testInputs);
  }
  public getPool() {
    return this.cryptoHarnessPool;
  }
  public testToTextResponse(payload: any) {
    return this.toTextResponse(payload);
  }
  public testFail(tool: string, error: any) {
    return this.fail(tool, error);
  }
}

describe('TransformToolHandlersBase — additional coverage', () => {
  const page = {
    evaluate: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
    getFileByUrl: vi.fn(() => null),
  } as any;

  let base: TestableBase;

  beforeEach(() => {
    vi.clearAllMocks();
    getScriptSourceMock.mockReset();
    scriptManagerCloseMock.mockReset();
    scriptManagerCloseMock.mockResolvedValue(undefined);
    base = new TestableBase(collector);
  });

  // ── Exported constants ────────────────────────────────────

  describe('exported constants', () => {
    it('exports CRYPTO_KEYWORDS array', () => {
      expect(Array.isArray(CRYPTO_KEYWORDS)).toBe(true);
      expect(CRYPTO_KEYWORDS).toContain('cryptojs');
      expect(CRYPTO_KEYWORDS).toContain('md5');
      expect(CRYPTO_KEYWORDS).toContain('sha');
    });

    it('exports NUMERIC_BINARY_EXPR regex', () => {
      expect(NUMERIC_BINARY_EXPR instanceof RegExp).toBe(true);
      expect('1+2'.match(NUMERIC_BINARY_EXPR)).toBeTruthy();
    });

    it('exports STRING_CONCAT_EXPR regex', () => {
      expect(STRING_CONCAT_EXPR instanceof RegExp).toBe(true);
      expect(`'a'+'b'`.match(STRING_CONCAT_EXPR)).toBeTruthy();
    });

    it('exports STRING_LITERAL_EXPR regex', () => {
      expect(STRING_LITERAL_EXPR instanceof RegExp).toBe(true);
      expect(`'hello'`.match(STRING_LITERAL_EXPR)).toBeTruthy();
    });

    it('exports DEAD_CODE_IF_FALSE regex', () => {
      expect(DEAD_CODE_IF_FALSE instanceof RegExp).toBe(true);
    });

    it('exports DEAD_CODE_IF_FALSE_WITH_ELSE regex', () => {
      expect(DEAD_CODE_IF_FALSE_WITH_ELSE instanceof RegExp).toBe(true);
    });

    it('exports TransformLimit enum', () => {
      expect(TransformLimit.MAX_LCS_CELLS).toBe(250000);
    });
  });

  // ── resolveFunctionName ───────────────────────────────────

  describe('resolveFunctionName — edge cases', () => {
    it('extracts function name from window.prefix target', () => {
      const name = base.testResolveFunctionName('window.myFunc', '', '() => {}');
      expect(name).toBe('myFunc');
    });

    it('extracts function name from nested path without window prefix', () => {
      const name = base.testResolveFunctionName('CryptoJS.AES.encrypt', '', '() => {}');
      expect(name).toBe('encrypt');
    });

    it('falls back to targetPath when targetFunction has invalid last segment', () => {
      const name = base.testResolveFunctionName(
        '123', // invalid identifier
        'window.validName',
        '() => {}',
      );
      expect(name).toBe('validName');
    });

    it('falls back to source function declaration when both targets are invalid', () => {
      const name = base.testResolveFunctionName(
        '123',
        '456',
        'function actualName(x) { return x; }',
      );
      expect(name).toBe('actualName');
    });

    it('returns default name when all fallbacks fail', () => {
      const name = base.testResolveFunctionName(
        '123',
        '456',
        '(x) => x', // arrow function, no name
      );
      expect(name).toBe('extractedCryptoFn');
    });

    it('handles empty targetFunction and targetPath', () => {
      const name = base.testResolveFunctionName('', '', 'function foo() {}');
      expect(name).toBe('foo');
    });

    it('handles window.prefix removal correctly', () => {
      const name = base.testResolveFunctionName('window.', '', '() => {}');
      expect(name).toBe('extractedCryptoFn');
    });
  });

  // ── buildCryptoPolyfills ──────────────────────────────────

  describe('buildCryptoPolyfills', () => {
    it('includes atob and btoa polyfills', () => {
      const polyfills = base.testBuildCryptoPolyfills();
      expect(polyfills).toContain('globalThis.atob');
      expect(polyfills).toContain('globalThis.btoa');
      expect(polyfills).toContain('TextEncoder');
      expect(polyfills).toContain('TextDecoder');
    });
  });

  // ── resolveScriptSource ───────────────────────────────────

  describe('resolveScriptSource — fallback paths', () => {
    it('falls back to collector.getFileByUrl when ScriptManager returns nothing', async () => {
      collector.getFileByUrl.mockReturnValueOnce({ content: 'cached source' });
      const source = await base.testResolveScriptSource('some-script-id');
      expect(source).toBe('cached source');
    });

    it('falls back to page.evaluate when collector returns null', async () => {
      collector.getFileByUrl.mockReturnValueOnce(null);
      page.evaluate.mockResolvedValueOnce('inline script content');

      const source = await base.testResolveScriptSource('inline-0');
      expect(source).toBe('inline script content');
    });

    it('throws when all fallbacks fail', async () => {
      collector.getFileByUrl.mockReturnValueOnce(null);
      page.evaluate.mockResolvedValueOnce('');

      await expect(base.testResolveScriptSource('nonexistent')).rejects.toThrow(
        'Unable to resolve source from scriptId: nonexistent',
      );
    });

    it('continues fallback when ScriptManager throws before caching', async () => {
      // ScriptManager is mocked; getFileByUrl fallback is tested directly
      collector.getFileByUrl.mockReturnValueOnce({ content: 'cached fallback' });

      const source = await base.testResolveScriptSource('script-with-error');
      expect(source).toBe('cached fallback');
    });
  });

  // ── runCryptoHarness ──────────────────────────────────────

  describe('runCryptoHarness — edge cases', () => {
    it('returns allPassed=true when all results have no errors', async () => {
      const pool = base.getPool();
      pool.submit.mockResolvedValueOnce({
        ok: true,
        results: [
          { input: 'a', output: 'A', duration: 0.1 },
          { input: 'b', output: 'B', duration: 0.2 },
        ],
      });

      const result = await base.testRunCryptoHarness('fn', 'fn', ['a', 'b']);
      expect(result.allPassed).toBe(true);
      expect(result.results).toHaveLength(2);
    });

    it('returns allPassed=false when some results have errors', async () => {
      const pool = base.getPool();
      pool.submit.mockResolvedValueOnce({
        ok: true,
        results: [
          { input: 'a', output: 'A', duration: 0.1 },
          { input: 'b', output: '', duration: 0, error: 'fail' },
        ],
      });

      const result = await base.testRunCryptoHarness('fn', 'fn', ['a', 'b']);
      expect(result.allPassed).toBe(false);
    });

    it('handles non-Error exception from pool.submit', async () => {
      const pool = base.getPool();
      pool.submit.mockRejectedValueOnce('string error');

      const result = await base.testRunCryptoHarness('fn', 'fn', ['x']);
      expect(result.allPassed).toBe(false);
      expect(result.results[0].error).toBe('string error');
    });

    it('handles worker returning undefined results', async () => {
      const pool = base.getPool();
      pool.submit.mockResolvedValueOnce({
        ok: true,
        // results is undefined
      });

      const result = await base.testRunCryptoHarness('fn', 'fn', ['x']);
      expect(result.results).toEqual([]);
      expect(result.allPassed).toBe(true);
    });
  });

  // ── toTextResponse and fail ───────────────────────────────

  describe('toTextResponse', () => {
    it('wraps payload in MCP text content format', () => {
      const response = base.testToTextResponse({ key: 'value' });
      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');
      expect(JSON.parse(response.content[0].text)).toEqual({ key: 'value' });
    });
  });

  describe('fail', () => {
    it('formats Error instance message', () => {
      const response = base.testFail('test_tool', new Error('Something broke'));
      const body = JSON.parse(response.content[0].text);
      expect(body.tool).toBe('test_tool');
      expect(body.error).toBe('Something broke');
    });

    it('formats non-Error value as string', () => {
      const response = base.testFail('test_tool', 42);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toBe('42');
    });

    it('formats object as string', () => {
      const response = base.testFail('test_tool', { custom: 'error' });
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toBe('[object Object]');
    });
  });

  // ── close ─────────────────────────────────────────────────

  describe('close', () => {
    it('closes the crypto harness pool', async () => {
      const pool = base.getPool();
      await base.close();
      expect(pool.close).toHaveBeenCalledOnce();
    });
  });

  // ── parseBoolean additional branches ──────────────────────

  describe('parseBoolean — additional branches', () => {
    it('handles numeric 1 and 0', () => {
      expect(base.testParseBoolean(1, false)).toBe(true);
      expect(base.testParseBoolean(0, true)).toBe(false);
    });

    it('returns default for numbers other than 1 and 0', () => {
      expect(base.testParseBoolean(2, true)).toBe(true);
      expect(base.testParseBoolean(-1, false)).toBe(false);
    });

    it('handles string variants case-insensitively', () => {
      expect(base.testParseBoolean('YES', false)).toBe(true);
      expect(base.testParseBoolean('NO', true)).toBe(false);
      expect(base.testParseBoolean('ON', false)).toBe(true);
      expect(base.testParseBoolean('OFF', true)).toBe(false);
    });
  });

  // ── parseTransforms / parseTestInputs / escapeStringContent ───────

  describe('parseTransforms and parseTestInputs', () => {
    it('normalizes, deduplicates, and validates transforms', () => {
      expect(base.testParseTransforms('constant_fold, dead_code_remove, constant_fold')).toEqual([
        'constant_fold',
        'dead_code_remove',
      ]);
      expect(base.testParseTransforms(['string_decrypt', 'rename_vars', 'string_decrypt'])).toEqual(
        ['string_decrypt', 'rename_vars'],
      );
      expect(() => base.testParseTransforms('')).toThrow('transforms must contain at least one');
      expect(() => base.testParseTransforms(['unsupported'])).toThrow('Unsupported transform');
    });

    it('validates testInputs arrays', () => {
      expect(base.testParseTestInputs(['a', 1, null])).toEqual(['a', '1', 'null']);
      expect(() => base.testParseTestInputs('nope' as any)).toThrow(
        'testInputs must be an array of strings',
      );
      expect(() => base.testParseTestInputs([])).toThrow('testInputs cannot be empty');
    });
  });

  describe('escapeStringContent', () => {
    it('escapes quotes and control characters for both quote styles', () => {
      expect(base.testEscapeStringContent(`a"b\\c\n`, '"')).toBe('a\\"b\\\\c\\n');
      expect(base.testEscapeStringContent(`a'b\\c\t`, "'")).toBe("a\\'b\\\\c\\t");
    });
  });

  describe('runCryptoHarness — worker status failures', () => {
    it('returns input rows when the worker reports ok=false', async () => {
      const pool = base.getPool();
      pool.submit.mockResolvedValueOnce({
        ok: false,
        error: 'worker rejected payload',
      });

      const result = await base.testRunCryptoHarness('fn', 'fn', ['x', 'y']);
      expect(result.allPassed).toBe(false);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]!.error).toBe('worker rejected payload');
    });
  });

  // ── resolveScriptSource — ScriptManager returns content (line 325) ──────

  describe('resolveScriptSource — ScriptManager early return (line 325)', () => {
    it('returns early when ScriptManager returns non-empty source', async () => {
      // ScriptManager returns a script with non-empty source → early return
      // This bypasses the collector.getFileByUrl and page.evaluate fallbacks
      vi.mocked(getScriptSourceMock).mockResolvedValueOnce({
        source: 'const x = 1;',
        url: 'http://example.com/script.js',
      });

      const source = await base.testResolveScriptSource('some-script-id');
      expect(source).toBe('const x = 1;');
      // page.evaluate must NOT be called since we returned early
      expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('continues to collector fallback when ScriptManager source is empty object', async () => {
      // ScriptManager returns object with empty source → falls through
      collector.getFileByUrl.mockReturnValueOnce({ content: 'cached source' });

      vi.mocked(getScriptSourceMock).mockResolvedValueOnce({
        source: '',
        url: '',
      });

      const source = await base.testResolveScriptSource('id-with-empty-source');
      expect(source).toBe('cached source');
    });

    it('returns whitespace when ScriptManager source is whitespace only', async () => {
      // whitespace '   ' has length > 0, so it is returned (not a falsy empty string)
      vi.mocked(getScriptSourceMock).mockResolvedValueOnce({
        source: '   ',
        url: '',
      });

      const source = await base.testResolveScriptSource('whitespace-script');
      expect(source).toBe('   ');
    });
  });

  // ── resolveScriptSource — page.evaluate callback branches (lines 346-399) ─

  describe('resolveScriptSource — page.evaluate callback branches (lines 346-399)', () => {
    it('returns content from page.evaluate when collector returns null', async () => {
      collector.getFileByUrl.mockReturnValueOnce(null);
      page.evaluate.mockResolvedValueOnce('// content from page.evaluate');

      const source = await base.testResolveScriptSource('some-script-id');
      expect(source).toBe('// content from page.evaluate');
    });

    it('throws when all fallbacks including page.evaluate return empty', async () => {
      collector.getFileByUrl.mockReturnValueOnce(null);
      page.evaluate.mockResolvedValueOnce('');

      await expect(base.testResolveScriptSource('nonexistent')).rejects.toThrow(
        'Unable to resolve source from scriptId: nonexistent',
      );
    });

    it('returns whitespace when page.evaluate returns whitespace', async () => {
      // whitespace has length > 0, so it is returned (not thrown)
      collector.getFileByUrl.mockReturnValueOnce(null);
      page.evaluate.mockResolvedValueOnce('   \n\t  ');

      const source = await base.testResolveScriptSource('whitespace-only');
      expect(source).toBe('   \n\t  ');
    });
  });

  // ── resolveScriptSource — ScriptManager throws ─────────────────────────────────

  describe('resolveScriptSource — ScriptManager throws', () => {
    // Note: ScriptManager constructor is synchronous (just assigns collector).
    // Throwing during construction would require a module factory that changes per-test,
    // which breaks vi.mock isolation. The fallback path when getScriptSource() throws
    // is already covered by other tests.

    it('continues to page.evaluate when ScriptManager throws on getScriptSource', async () => {
      collector.getFileByUrl.mockReturnValueOnce(null);
      page.evaluate.mockResolvedValueOnce('content after sm.getScriptSource throws');

      vi.mocked(getScriptSourceMock).mockRejectedValueOnce(new Error('getScriptSource failed'));

      const source = await base.testResolveScriptSource('sm-throws-script');
      expect(source).toBe('content after sm.getScriptSource throws');
    });

    it('continues to collector fallback when ScriptManager close throws', async () => {
      collector.getFileByUrl.mockReturnValueOnce({ content: 'content-after-sm-close-throws' });

      vi.mocked(scriptManagerCloseMock).mockRejectedValueOnce(new Error('close failed'));

      const source = await base.testResolveScriptSource('sm-close-throws-script');
      expect(source).toBe('content-after-sm-close-throws');
    });
  });

  // ── decodeEscapedString additional patterns ───────────────

  describe('decodeEscapedString — additional patterns', () => {
    it('decodes \\v and \\f control characters', () => {
      expect(base.testDecodeEscapedString('\\v')).toBe('\v');
      expect(base.testDecodeEscapedString('\\f')).toBe('\f');
    });

    it('decodes \\0 null character', () => {
      expect(base.testDecodeEscapedString('\\0')).toBe('\0');
    });

    it('decodes mixed escape sequences', () => {
      const decoded = base.testDecodeEscapedString('\\x41\\u0042\\n\\t');
      expect(decoded).toBe('AB\n\t');
    });
  });
});
