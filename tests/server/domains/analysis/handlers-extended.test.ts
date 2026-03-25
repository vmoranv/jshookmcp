import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreAnalysisHandlers } from '@server/domains/analysis/handlers';

const webcrackState = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  runWebcrack: vi.fn<(...args: any[]) => Promise<Record<string, unknown>>>(async () => ({
    applied: true,
    code: 'decoded-bundle',
    bundle: null,
    optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@modules/deobfuscator/webcrack', () => ({
  runWebcrack: webcrackState.runWebcrack,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

interface BaseResponse {
  success?: boolean;
  error?: string;
  hint?: string;
  warning?: string;
  recommendations?: string[];
}

interface CollectCodeResponse extends BaseResponse {
  totalSize: number;
  files?: Array<{ url: string; type: string; size: number; content: string }>;
  mode?: string;
  filesCount?: number;
  summary?: Array<{ url: string; preview?: string; truncated?: boolean }>;
}

interface SearchInScriptsResponse extends BaseResponse {
  matches?: Array<{ scriptId: string; url: string; line: number; context: string }>;
  totalMatches?: number;
  matchesSummary?: string[];
  truncated?: boolean;
  reason?: string;
}

interface ExtractFunctionTreeResponse extends BaseResponse {
  functionName?: string;
  availableScripts?: string | string[];
}

interface UnderstandCodeResponse extends BaseResponse {
  structure?: Record<string, unknown>;
  complete?: boolean;
}

interface DetectCryptoResponse extends BaseResponse {
  algorithms?: string[];
}

interface ManageHooksResponse extends BaseResponse {
  hooks?: Array<{ id: string; target: string; type: string }>;
  records?: Array<{ timestamp: number; data: Record<string, unknown> }>;
  message?: string;
  id?: string;
}

interface DetectObfuscationResponse extends BaseResponse {
  techniques?: string[];
}

interface ClearCollectedDataResponse extends BaseResponse {
  cleared: { fileCache: boolean; scriptManager: boolean };
}

interface GetCollectionStatsResponse extends BaseResponse {
  summary: {
    totalCachedFiles: number;
    totalCacheSize: string;
    compressionRatio: string;
    cacheHitRate: string;
  };
}

interface WebcrackUnpackResponse extends BaseResponse {
  code?: string;
  bundle?: {
    type: string;
    entryId: string;
    moduleCount: number;
    truncated: boolean;
    modules: Array<{ id: string; path: string; isEntry: boolean; size: number }>;
  };
  savedTo?: string;
  savedArtifacts?: string[];
  engine?: string;
}

interface Mapping {
  path: string;
  pattern: string;
}

describe('CoreAnalysisHandlers — extended coverage', () => {
  const deps = {
    collector: {
      collect: vi.fn(),
      getActivePage: vi.fn(),
      clearAllData: vi.fn(),
      getAllStats: vi.fn(),
    },
    scriptManager: {
      init: vi.fn(),
      searchInScripts: vi.fn(),
      extractFunctionTree: vi.fn(),
      getAllScripts: vi.fn(),
      clear: vi.fn(),
    },
    deobfuscator: { deobfuscate: vi.fn() },
    advancedDeobfuscator: { deobfuscate: vi.fn() },
    obfuscationDetector: { detect: vi.fn(), generateReport: vi.fn() },
    analyzer: { understand: vi.fn() },
    cryptoDetector: { detect: vi.fn() },
    hookManager: {
      createHook: vi.fn(),
      getAllHooks: vi.fn(),
      getHookRecords: vi.fn(),
      clearHookRecords: vi.fn(),
    },
  };

  let handlers: CoreAnalysisHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    webcrackState.runWebcrack.mockClear();
    handlers = new CoreAnalysisHandlers(
      deps as unknown as ConstructorParameters<typeof CoreAnalysisHandlers>[0],
    );
  });

  // ─── handleCollectCode ────────────────────────────────────────────

  describe('handleCollectCode', () => {
    it('delegates to collector.collect with correct params', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.collector.collect.mockResolvedValue({
        totalSize: 1000,
        files: [{ url: 'test.js', type: 'external', size: 1000, content: 'var x=1;' }],
        collectTime: 50,
      });

      const result = await handlers.handleCollectCode({
        url: 'https://example.com',
        includeInline: false,
        includeExternal: true,
        includeDynamic: true,
        smartMode: 'priority',
        compress: true,
        maxTotalSize: 1024,
        maxFileSize: 100,
        priorities: ['app.js'],
      });

      expect(deps.collector.collect).toHaveBeenCalledWith({
        url: 'https://example.com',
        includeInline: false,
        includeExternal: true,
        includeDynamic: true,
        smartMode: 'priority',
        compress: true,
        maxTotalSize: 1024,
        maxFileSize: 102400, // 100 * 1024
        priorities: ['app.js'],
      });

      const body = parseJson<CollectCodeResponse>(result);
      expect(body.totalSize).toBe(1000);
    });

    it('returns summary mode when returnSummaryOnly is true', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.collector.collect.mockResolvedValue({
        totalSize: 500,
        files: [
          { url: 'a.js', type: 'inline', size: 250, content: 'console.log("a");' },
          {
            url: 'b.js',
            type: 'external',
            size: 250,
            content: 'console.log("b");',
            metadata: { truncated: true },
          },
        ],
        collectTime: 30,
      });

      const body = parseJson<CollectCodeResponse>(
        await handlers.handleCollectCode({ url: 'https://test.com', returnSummaryOnly: true }),
      );

      expect(body.mode).toBe('summary');
      expect(body.filesCount).toBe(2);
      expect(body.summary).toHaveLength(2);
      expect(body.summary?.[0].url).toBe('a.js');
      expect(body.summary?.[0].preview).toBeDefined();
      expect(body.summary?.[1].truncated).toBe(true);
      expect(body.hint).toContain('get_script_source');
    });

    it('auto-uses summary mode when returnSummaryOnly overrides smartMode', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.collector.collect.mockResolvedValue({
        totalSize: 100,
        files: [],
        collectTime: 5,
      });

      await handlers.handleCollectCode({ url: 'https://test.com', returnSummaryOnly: true });

      expect(deps.collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({ smartMode: 'summary' }),
      );
    });

    it('returns summary with warning when result is too large', async () => {
      const bigContent = 'x'.repeat(300 * 1024);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.collector.collect.mockResolvedValue({
        totalSize: 300 * 1024,
        files: [{ url: 'big.js', type: 'external', size: 300 * 1024, content: bigContent }],
        collectTime: 100,
      });

      const body = parseJson<CollectCodeResponse>(
        await handlers.handleCollectCode({ url: 'https://test.com' }),
      );

      expect(body.warning).toContain('safe response threshold');
      expect(body.recommendations).toBeDefined();
      expect(body.recommendations?.length).toBeGreaterThan(0);
    });
  });

  // ─── handleSearchInScripts ────────────────────────────────────────

  describe('handleSearchInScripts', () => {
    it('returns error when keyword is missing', async () => {
      const body = parseJson<BaseResponse>(await handlers.handleSearchInScripts({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('keyword is required');
    });

    it('delegates to scriptManager with search options', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.scriptManager.searchInScripts.mockResolvedValue({
        matches: [{ scriptId: '1', url: 'a.js', line: 5, context: 'var x = 1;' }],
      });

      const body = parseJson<SearchInScriptsResponse>(
        await handlers.handleSearchInScripts({
          keyword: 'var',
          isRegex: true,
          caseSensitive: true,
          contextLines: 5,
          maxMatches: 50,
        }),
      );

      expect(deps.scriptManager.init).toHaveBeenCalledOnce();
      expect(deps.scriptManager.searchInScripts).toHaveBeenCalledWith('var', {
        isRegex: true,
        caseSensitive: true,
        contextLines: 5,
        maxMatches: 50,
      });
      expect(body.matches).toHaveLength(1);
    });

    it('returns summary when returnSummary is true', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.scriptManager.searchInScripts.mockResolvedValue({
        matches: [
          { scriptId: '1', url: 'a.js', line: 5, context: 'var token = "abc";' },
          { scriptId: '2', url: 'b.js', line: 10, context: 'var token = "def";' },
        ],
      });

      const body = parseJson<SearchInScriptsResponse>(
        await handlers.handleSearchInScripts({
          keyword: 'token',
          returnSummary: true,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.totalMatches).toBe(2);
      expect(body.matchesSummary).toBeDefined();
      expect(body.matchesSummary?.length).toBeLessThanOrEqual(10);
    });

    it('auto-summarizes when result exceeds maxContextSize', async () => {
      const largeContext = 'x'.repeat(10000);
      const matches = Array.from({ length: 20 }, (_, i) => ({
        scriptId: String(i),
        url: `script-${i}.js`,
        line: i,
        context: largeContext,
      }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.scriptManager.searchInScripts.mockResolvedValue({ matches });

      const body = parseJson<SearchInScriptsResponse>(
        await handlers.handleSearchInScripts({
          keyword: 'test',
          maxContextSize: 100, // very small threshold
        }),
      );

      expect(body.truncated).toBe(true);
      expect(body.reason).toContain('too large');
      expect(body.recommendations).toBeDefined();
    });
  });

  // ─── handleExtractFunctionTree ────────────────────────────────────

  describe('handleExtractFunctionTree', () => {
    it('returns error when scriptId is missing', async () => {
      const body = parseJson<BaseResponse>(
        await handlers.handleExtractFunctionTree({ functionName: 'myFunc' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('scriptId is required');
    });

    it('returns error when functionName is missing', async () => {
      const body = parseJson<BaseResponse>(
        await handlers.handleExtractFunctionTree({ scriptId: '123' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('functionName is required');
    });

    it('returns error when script does not exist', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.scriptManager.getAllScripts.mockResolvedValue([{ scriptId: '1', url: 'a.js' }]);

      const body = parseJson<ExtractFunctionTreeResponse>(
        await handlers.handleExtractFunctionTree({ scriptId: '999', functionName: 'fn' }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('Script not found: 999');
      expect(body.availableScripts).toBeDefined();
    });

    it('returns "No scripts loaded" when no scripts exist', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.scriptManager.getAllScripts.mockResolvedValue([]);

      const body = parseJson<ExtractFunctionTreeResponse>(
        await handlers.handleExtractFunctionTree({ scriptId: '1', functionName: 'fn' }),
      );

      expect(body.success).toBe(false);
      expect(body.availableScripts).toBe('No scripts loaded. Navigate to a page first.');
    });

    it('delegates to scriptManager on success', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.scriptManager.getAllScripts.mockResolvedValue([{ scriptId: '42', url: 'app.js' }]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.scriptManager.extractFunctionTree.mockResolvedValue({
        functionName: 'init',
        tree: { depth: 2, nodes: 5 },
      });

      const body = parseJson<ExtractFunctionTreeResponse>(
        await handlers.handleExtractFunctionTree({
          scriptId: '42',
          functionName: 'init',
          maxDepth: 5,
          maxSize: 200,
          includeComments: false,
        }),
      );

      expect(deps.scriptManager.extractFunctionTree).toHaveBeenCalledWith('42', 'init', {
        maxDepth: 5,
        maxSize: 200,
        includeComments: false,
      });
      expect(body.success).toBe(true);
      expect(body.functionName).toBe('init');
    });

    it('returns structured error when extraction throws', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.scriptManager.getAllScripts.mockResolvedValue([{ scriptId: '1', url: 'test.js' }]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.scriptManager.extractFunctionTree.mockRejectedValue(new Error('Parse error'));

      const body = parseJson<BaseResponse>(
        await handlers.handleExtractFunctionTree({ scriptId: '1', functionName: 'broken' }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toBe('Parse error');
      expect(body.hint).toContain('function name exists');
    });
  });

  // ─── handleUnderstandCode ─────────────────────────────────────────

  describe('handleUnderstandCode', () => {
    it('returns error when code is missing', async () => {
      const body = parseJson<BaseResponse>(await handlers.handleUnderstandCode({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('code is required');
    });

    it('returns error when code is empty string', async () => {
      const body = parseJson<BaseResponse>(await handlers.handleUnderstandCode({ code: '  ' }));
      expect(body.success).toBe(false);
    });

    it('delegates to analyzer with focus', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.analyzer.understand.mockResolvedValue({
        structure: { classes: 1, functions: 5 },
      });

      const body = parseJson<UnderstandCodeResponse>(
        await handlers.handleUnderstandCode({
          code: 'class Foo {}',
          focus: 'structure',
          context: { filename: 'test.js' },
        }),
      );

      expect(deps.analyzer.understand).toHaveBeenCalledWith({
        code: 'class Foo {}',
        focus: 'structure',
        context: { filename: 'test.js' },
      });
      expect(body.structure).toBeDefined();
    });

    it('defaults focus to all when not specified', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.analyzer.understand.mockResolvedValue({ complete: true });

      await handlers.handleUnderstandCode({ code: 'x()' });

      expect(deps.analyzer.understand).toHaveBeenCalledWith({
        code: 'x()',
        focus: 'all',
        context: undefined,
      });
    });
  });

  // ─── handleDetectCrypto ───────────────────────────────────────────

  describe('handleDetectCrypto', () => {
    it('returns error when code is missing', async () => {
      const body = parseJson<BaseResponse>(await handlers.handleDetectCrypto({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('code is required');
    });

    it('delegates to cryptoDetector', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.cryptoDetector.detect.mockResolvedValue({
        algorithms: ['AES-256-CBC'],
        usages: ['encryption'],
      });

      const body = parseJson<DetectCryptoResponse>(
        await handlers.handleDetectCrypto({ code: 'crypto.subtle.encrypt()' }),
      );

      expect(deps.cryptoDetector.detect).toHaveBeenCalledWith({
        code: 'crypto.subtle.encrypt()',
      });
      expect(body.algorithms).toContain('AES-256-CBC');
    });
  });

  // ─── handleManageHooks ────────────────────────────────────────────

  describe('handleManageHooks', () => {
    it('lists all hooks', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.hookManager.getAllHooks.mockReturnValue([{ id: 'h1', target: 'fetch', type: 'fetch' }]);

      const body = parseJson<ManageHooksResponse>(
        await handlers.handleManageHooks({ action: 'list' }),
      );
      expect(body.hooks).toHaveLength(1);
      expect(body.hooks?.[0].id).toBe('h1');
    });

    it('returns records for a specific hook', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.hookManager.getHookRecords.mockReturnValue([{ timestamp: 123, data: { url: '/api' } }]);

      const body = parseJson<ManageHooksResponse>(
        await handlers.handleManageHooks({ action: 'records', hookId: 'h1' }),
      );

      expect(deps.hookManager.getHookRecords).toHaveBeenCalledWith('h1');
      expect(body.records).toHaveLength(1);
    });

    it('clears hook records', async () => {
      const body = parseJson<ManageHooksResponse>(
        await handlers.handleManageHooks({ action: 'clear', hookId: 'h2' }),
      );

      expect(deps.hookManager.clearHookRecords).toHaveBeenCalledWith('h2');
      expect(body.success).toBe(true);
      expect(body.message).toContain('cleared');
    });

    it('creates hook with custom code', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.hookManager.createHook.mockResolvedValue({ success: true, id: 'h3' });

      const body = parseJson<ManageHooksResponse>(
        await handlers.handleManageHooks({
          action: 'create',
          target: 'document.cookie',
          type: 'cookie',
          hookAction: 'modify',
          customCode: 'return "";',
        }),
      );

      expect(deps.hookManager.createHook).toHaveBeenCalledWith({
        target: 'document.cookie',
        type: 'cookie',
        action: 'modify',
        customCode: 'return "";',
      });
      expect(body.id).toBe('h3');
    });
  });

  // ─── handleDetectObfuscation ──────────────────────────────────────

  describe('handleDetectObfuscation', () => {
    it('returns error when code is missing', async () => {
      const body = parseJson<BaseResponse>(await handlers.handleDetectObfuscation({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('code is required');
    });

    it('returns detection result with report by default', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.obfuscationDetector.detect.mockReturnValue({
        techniques: ['string-encoding'],
        score: 85,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.obfuscationDetector.generateReport.mockReturnValue('High obfuscation detected');

      const result = await handlers.handleDetectObfuscation({
        code: 'var _0x1a2b = [];',
      });

      const textPart = result.content[0];
      expect(textPart?.type).toBe('text');
      if (textPart?.type !== 'text') {
        throw new Error('Expected text response');
      }

      const text = textPart.text;
      expect(text).toContain('string-encoding');
      expect(text).toContain('High obfuscation detected');
    });

    it('returns raw result when generateReport is false', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.obfuscationDetector.detect.mockReturnValue({
        techniques: ['eval'],
        score: 50,
      });

      const body = parseJson<DetectObfuscationResponse>(
        await handlers.handleDetectObfuscation({
          code: 'eval("code")',
          generateReport: false,
        }),
      );

      expect(deps.obfuscationDetector.generateReport).not.toHaveBeenCalled();
      expect(body.techniques).toContain('eval');
    });
  });

  // ─── handleClearCollectedData ─────────────────────────────────────

  describe('handleClearCollectedData', () => {
    it('clears collector and script manager data', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.collector.clearAllData.mockResolvedValue(undefined);

      const body = parseJson<ClearCollectedDataResponse>(await handlers.handleClearCollectedData());

      expect(deps.collector.clearAllData).toHaveBeenCalledOnce();
      expect(deps.scriptManager.clear).toHaveBeenCalledOnce();
      expect(body.success).toBe(true);
      expect(body.cleared.fileCache).toBe(true);
      expect(body.cleared.scriptManager).toBe(true);
    });

    it('returns error when clearing fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.collector.clearAllData.mockRejectedValue(new Error('disk error'));

      const body = parseJson<BaseResponse>(await handlers.handleClearCollectedData());

      expect(body.success).toBe(false);
      expect(body.error).toContain('disk error');
    });
  });

  // ─── handleGetCollectionStats ─────────────────────────────────────

  describe('handleGetCollectionStats', () => {
    it('returns formatted stats with summary', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.collector.getAllStats.mockResolvedValue({
        cache: { memoryEntries: 5, diskEntries: 3, totalSize: 10240 },
        compression: { averageRatio: 45.2, cacheHits: 10, cacheMisses: 5 },
        collector: { collectedUrls: ['https://a.com', 'https://b.com'] },
      });

      const body = parseJson<GetCollectionStatsResponse>(await handlers.handleGetCollectionStats());

      expect(body.success).toBe(true);
      expect(body.summary.totalCachedFiles).toBe(8);
      expect(body.summary.totalCacheSize).toContain('KB');
      expect(body.summary.compressionRatio).toContain('%');
      expect(body.summary.cacheHitRate).toContain('%');
    });

    it('handles zero cache hits', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.collector.getAllStats.mockResolvedValue({
        cache: { memoryEntries: 0, diskEntries: 0, totalSize: 0 },
        compression: { averageRatio: 0, cacheHits: 0, cacheMisses: 0 },
        collector: { collectedUrls: [] },
      });

      const body = parseJson<GetCollectionStatsResponse>(await handlers.handleGetCollectionStats());

      expect(body.success).toBe(true);
      expect(body.summary.cacheHitRate).toBe('0%');
    });

    it('returns error when stats retrieval fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.collector.getAllStats.mockRejectedValue(new Error('stats error'));

      const body = parseJson<BaseResponse>(await handlers.handleGetCollectionStats());

      expect(body.success).toBe(false);
      expect(body.error).toContain('stats error');
    });
  });

  // ─── handleDeobfuscate — additional edge cases ────────────────────

  describe('handleDeobfuscate edge cases', () => {
    it('adds error field when deobfuscation returns success: false without error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.deobfuscator.deobfuscate.mockResolvedValue({
        success: false,
        reason: 'unsupported format',
      });

      const body = parseJson<BaseResponse>(
        await handlers.handleDeobfuscate({ code: 'broken-code' }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toBe('unsupported format');
    });

    it('adds generic error when result has no reason', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.deobfuscator.deobfuscate.mockResolvedValue({
        success: false,
      });

      const body = parseJson<BaseResponse>(await handlers.handleDeobfuscate({ code: 'broken' }));

      expect(body.success).toBe(false);
      expect(body.error).toBe('deobfuscation failed');
    });

    it('filters invalid mapping rules from webcrack args', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.deobfuscator.deobfuscate.mockResolvedValue({ success: true, code: 'ok' });

      await handlers.handleDeobfuscate({
        code: 'bundle',
        mappings: [
          { path: './valid.js', pattern: 'bootstrap' }, // valid
          { noPath: true, pattern: 'bad' } as unknown as Mapping, // invalid: missing path
          { path: './also-valid.js', pattern: 'main' }, // valid
          null as unknown as Mapping, // invalid
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const call = deps.deobfuscator.deobfuscate.mock.calls[0][0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(call.mappings).toHaveLength(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(call.mappings[0].path).toBe('./valid.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(call.mappings[1].path).toBe('./also-valid.js');
    });

    it('does not pass empty outputDir', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.deobfuscator.deobfuscate.mockResolvedValue({ success: true, code: 'ok' });

      await handlers.handleDeobfuscate({ code: 'test', outputDir: '  ' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const call = deps.deobfuscator.deobfuscate.mock.calls[0][0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(call.outputDir).toBeUndefined();
    });
  });

  // ─── handleAdvancedDeobfuscate — additional edge cases ────────────

  describe('handleAdvancedDeobfuscate edge cases', () => {
    it('returns error when code is empty whitespace', async () => {
      const body = parseJson<BaseResponse>(
        await handlers.handleAdvancedDeobfuscate({ code: '   ' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('code is required');
    });

    it('passes detectOnly option when specified', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.advancedDeobfuscator.deobfuscate.mockResolvedValue({
        success: true,
        detected: ['string-array'],
      });

      await handlers.handleAdvancedDeobfuscate({
        code: 'obf()',
        detectOnly: true,
      });

      expect(deps.advancedDeobfuscator.deobfuscate).toHaveBeenCalledWith(
        expect.objectContaining({ detectOnly: true }),
      );
    });

    it('passes webcrack args to advancedDeobfuscator', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      deps.advancedDeobfuscator.deobfuscate.mockResolvedValue({
        success: true,
        code: 'clean',
      });

      await handlers.handleAdvancedDeobfuscate({
        code: 'obf()',
        unpack: true,
        unminify: false,
        jsx: false,
        mangle: true,
        outputDir: 'out',
        forceOutput: true,
        includeModuleCode: true,
        maxBundleModules: 50,
      });

      expect(deps.advancedDeobfuscator.deobfuscate).toHaveBeenCalledWith(
        expect.objectContaining({
          unpack: true,
          unminify: false,
          jsx: false,
          mangle: true,
          outputDir: 'out',
          forceOutput: true,
          includeModuleCode: true,
          maxBundleModules: 50,
        }),
      );
    });
  });

  // ─── handleWebcrackUnpack — additional cases ──────────────────────

  describe('handleWebcrackUnpack additional cases', () => {
    it('returns error when code is missing', async () => {
      const body = parseJson<BaseResponse>(await handlers.handleWebcrackUnpack({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('code is required');
    });

    it('returns bundle and savedTo on success', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      webcrackState.runWebcrack.mockResolvedValueOnce({
        applied: true,
        code: 'unpacked',
        bundle: {
          type: 'webpack',
          entryId: '0',
          moduleCount: 3,
          truncated: false,
          modules: [{ id: '0', path: './index.js', isEntry: true, size: 100 }],
        },
        savedTo: 'artifacts/webcrack',
        savedArtifacts: ['artifacts/webcrack/index.js'],
        optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
      });

      const body = parseJson<WebcrackUnpackResponse>(
        await handlers.handleWebcrackUnpack({ code: 'bundled' }),
      );

      expect(body.success).toBe(true);
      expect(body.code).toBe('unpacked');
      expect(body.bundle?.type).toBe('webpack');
      expect(body.savedTo).toBe('artifacts/webcrack');
      expect(body.savedArtifacts).toContain('artifacts/webcrack/index.js');
      expect(body.engine).toBe('webcrack');
    });

    it('passes custom options through to runWebcrack', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      webcrackState.runWebcrack.mockResolvedValueOnce({
        applied: true,
        code: 'ok',
        optionsUsed: {},
      });

      await handlers.handleWebcrackUnpack({
        code: 'src',
        unpack: false,
        unminify: false,
        jsx: false,
        mangle: true,
        outputDir: 'custom-dir',
        forceOutput: true,
      });

      expect(webcrackState.runWebcrack).toHaveBeenCalledWith(
        'src',
        expect.objectContaining({
          unpack: false,
          unminify: false,
          jsx: false,
          mangle: true,
          outputDir: 'custom-dir',
          forceOutput: true,
        }),
      );
    });
  });
});
