import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIsSsrfTarget, mockIsPrivateHost, mockIsLoopbackHost, mockLookup } = vi.hoisted(() => ({
  mockIsSsrfTarget: vi.fn(async () => false),
  mockIsPrivateHost: vi.fn(() => false),
  mockIsLoopbackHost: vi.fn(() => false),
  mockLookup: vi.fn(),
}));

const { mockEnsureWorkflowsLoaded } = vi.hoisted(() => ({
  mockEnsureWorkflowsLoaded: vi.fn(async () => undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: mockIsSsrfTarget,
  isPrivateHost: mockIsPrivateHost,
  isLoopbackHost: mockIsLoopbackHost,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('node:dns/promises', () => ({
  lookup: mockLookup,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  realpath: vi.fn(async (p: string) => p),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/outputPaths', () => ({
  getProjectRoot: vi.fn(() => '/project'),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/extensions/ExtensionManager', () => ({
  ensureWorkflowsLoaded: mockEnsureWorkflowsLoaded,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/workflows/WorkflowEngine', () => ({
  executeExtensionWorkflow: vi.fn(),
}));

import { WorkflowHandlersBase } from '@server/domains/workflow/handlers.impl.workflow-base';
import type {
  WorkflowHandlersDeps,
  ToolHandlerResult,
} from '@server/domains/workflow/handlers.impl.workflow-base';
import type { MCPServerContext } from '@server/MCPServer.context';
import type {
  WorkflowScriptRegisterResponse,
  WorkflowScriptRunResponse,
  WorkflowListExtensionsResponse,
  WorkflowRunExtensionResponse,
} from '@tests/shared/common-test-types';

class TestWorkflowHandlersBase extends WorkflowHandlersBase {
  public get scriptRegistryExposed() {
    return this.scriptRegistry;
  }

  public get bundleCacheExposed() {
    return this.bundleCache;
  }

  public get bundleCacheBytesExposed() {
    return this.bundleCacheBytes;
  }

  public set bundleCacheBytesExposed(value: number) {
    this.bundleCacheBytes = value;
  }

  public evictBundleCacheExposed(): void {
    this.evictBundleCache();
  }

  public normalizeOutputPathExposed(
    inputPath: string | undefined,
    defaultPath: string,
    preferredDir: string,
  ): string {
    return this.normalizeOutputPath(inputPath, defaultPath, preferredDir);
  }

  public escapeInlineScriptLiteralExposed(value: string): string {
    return this.escapeInlineScriptLiteral(value);
  }

  public buildWebApiCaptureReportMarkdownExposed(args: {
    generatedAt: string;
    url: string;
    waitUntil: string;
    waitAfterActionsMs: number;
    steps: string[];
    warnings: string[];
    totalCaptured: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    authFindings: any[];
    harExported: boolean;
    harOutputPath?: string;
  }): string {
    return this.buildWebApiCaptureReportMarkdown(args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  public getOptionalStringExposed(value: any): string | undefined {
    return this.getOptionalString(value);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  public getOptionalRecordExposed(value: any): Record<string, unknown> | undefined {
    return this.getOptionalRecord(value);
  }

  public jsonTextResultExposed(payload: Record<string, unknown>): ToolHandlerResult {
    return this.jsonTextResult(payload);
  }
}

function parseJson<T = Record<string, unknown>>(response: ToolHandlerResult): T {
  return JSON.parse(response.content[0].text) as T;
}

function createDeps(): WorkflowHandlersDeps {
  return {
    browserHandlers: {
      handlePageEvaluate: vi.fn(),
      handlePageNavigate: vi.fn(),
      handlePageType: vi.fn(),
      handlePageClick: vi.fn(),
      handleTabWorkflow: vi.fn(),
    },
    advancedHandlers: {
      handleNetworkEnable: vi.fn(),
      handleConsoleInjectFetchInterceptor: vi.fn(),
      handleConsoleInjectXhrInterceptor: vi.fn(),
      handleNetworkGetStats: vi.fn(),
      handleNetworkGetRequests: vi.fn(),
      handleNetworkExtractAuth: vi.fn(),
      handleNetworkExportHar: vi.fn(),
    },
    serverContext: {
      extensionWorkflowsById: new Map(),
      extensionWorkflowRuntimeById: new Map(),
    } as unknown as MCPServerContext,
  };
}

describe('WorkflowHandlersBase', () => {
  let deps: WorkflowHandlersDeps;
  let handlers: TestWorkflowHandlersBase;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureWorkflowsLoaded.mockResolvedValue(undefined);
    deps = createDeps();
    handlers = new TestWorkflowHandlersBase(deps);
  });

  // ── initBuiltinScripts ─────────────────────────────────────────────

  describe('initBuiltinScripts', () => {
    it('registers built-in scripts on construction', () => {
      const registry = handlers.scriptRegistryExposed;
      expect(registry.has('auth_extract')).toBe(true);
      expect(registry.has('bundle_search')).toBe(true);
      expect(registry.has('react_fill_form')).toBe(true);
      expect(registry.has('dom_find_upgrade_buttons')).toBe(true);
    });

    it('has description for each built-in script', () => {
      const registry = handlers.scriptRegistryExposed;
      for (const [, entry] of registry) {
        expect(entry.description).toBeDefined();
        expect(entry.description.length).toBeGreaterThan(0);
      }
    });

    it('has code for each built-in script', () => {
      const registry = handlers.scriptRegistryExposed;
      for (const [, entry] of registry) {
        expect(entry.code).toBeDefined();
        expect(entry.code.length).toBeGreaterThan(0);
      }
    });

    it('marks built-in scripts as protected core presets', () => {
      const registry = handlers.scriptRegistryExposed;
      const authExtract = registry.get('auth_extract');

      expect(authExtract?.source).toBe('core');
      expect(authExtract?.protectedFromEviction).toBe(true);
    });
  });

  // ── handlePageScriptRegister ───────────────────────────────────────

  describe('handlePageScriptRegister', () => {
    it('fails when name is empty', async () => {
      const body = parseJson<WorkflowScriptRegisterResponse>(
        await handlers.handlePageScriptRegister({ name: '', code: 'x' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('name and code are required');
    });

    it('fails when code is empty', async () => {
      const body = parseJson<WorkflowScriptRegisterResponse>(
        await handlers.handlePageScriptRegister({ name: 'test', code: '' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
    });

    it('fails when both name and code are missing', async () => {
      const body = parseJson<WorkflowScriptRegisterResponse>(
        await handlers.handlePageScriptRegister({}),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
    });

    it('registers a new script', async () => {
      const body = parseJson<WorkflowScriptRegisterResponse>(
        await handlers.handlePageScriptRegister({
          name: 'my_script',
          code: '(() => 42)()',
          description: 'A test script',
        }),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.action).toBe('registered');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.name).toBe('my_script');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.description).toBe('A test script');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.available).toContain('my_script');
    });

    it('updates an existing script', async () => {
      await handlers.handlePageScriptRegister({
        name: 'my_script',
        code: 'original()',
      });

      const body = parseJson<WorkflowScriptRegisterResponse>(
        await handlers.handlePageScriptRegister({
          name: 'my_script',
          code: 'updated()',
          description: 'Updated',
        }),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.action).toBe('updated');
    });

    it('preserves built-in metadata when updating a built-in script', async () => {
      await handlers.handlePageScriptRegister({
        name: 'auth_extract',
        code: 'updated()',
        description: 'Updated auth extract',
      });

      const entry = handlers.scriptRegistryExposed.get('auth_extract');

      expect(entry?.code).toBe('updated()');
      expect(entry?.description).toBe('Updated auth extract');
      expect(entry?.source).toBe('core');
      expect(entry?.protectedFromEviction).toBe(true);
    });

    it('evicts oldest non-builtin when at max capacity', async () => {
      const MAX = WorkflowHandlersBase.MAX_SCRIPTS;
      // Fill with custom scripts up to limit
      for (let i = 0; i < MAX; i++) {
        await handlers.handlePageScriptRegister({
          name: `custom_${i}`,
          code: `(() => ${i})()`,
        });
      }

      // Adding one more should succeed with eviction
      const body = parseJson<WorkflowScriptRegisterResponse>(
        await handlers.handlePageScriptRegister({
          name: 'overflow_script',
          code: '(() => "overflow")()',
        }),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      const registry = handlers.scriptRegistryExposed;
      expect(registry.has('overflow_script')).toBe(true);
      // Built-in scripts should still be present
      expect(registry.has('auth_extract')).toBe(true);
    });

    it('uses empty string as default description', async () => {
      const body = parseJson<WorkflowScriptRegisterResponse>(
        await handlers.handlePageScriptRegister({
          name: 'no_desc',
          code: '1',
        }),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.description).toBe('');
    });
  });

  // ── handlePageScriptRun ────────────────────────────────────────────

  describe('handlePageScriptRun', () => {
    it('fails when script name not found', async () => {
      const body = parseJson<WorkflowScriptRunResponse>(
        await handlers.handlePageScriptRun({ name: 'nonexistent' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('not found');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(Array.isArray(body.available)).toBe(true);
    });

    it('runs script without params', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ value: 'ok' }) }],
      });

      await handlers.handlePageScriptRegister({
        name: 'simple',
        code: '(() => "result")()',
      });

      const response = await handlers.handlePageScriptRun({ name: 'simple' });
      expect(deps.browserHandlers.handlePageEvaluate).toHaveBeenCalledOnce();
      expect(response.content[0]!.type).toBe('text');
    });

    it('injects params when provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ value: 'ok' }) }],
      });

      await handlers.handlePageScriptRegister({
        name: 'parameterized',
        code: '(function(){ return __params__; })()',
      });

      await handlers.handlePageScriptRun({
        name: 'parameterized',
        params: { key: 'value' },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const call = vi.mocked(deps.browserHandlers.handlePageEvaluate).mock.calls[0][0];
      expect(call.code).toContain('__params__');
      expect(call.code).toContain('JSON.parse');
    });

    it('returns error when script execution throws', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockRejectedValue(
        new Error('Eval failed'),
      );

      await handlers.handlePageScriptRegister({
        name: 'failing',
        code: 'throw new Error("boom")',
      });

      const body = parseJson<WorkflowScriptRunResponse>(
        await handlers.handlePageScriptRun({ name: 'failing' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Eval failed');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.script).toBe('failing');
    });

    it('runs built-in auth_extract script', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ token: 'abc' }) }],
      });

      const response = await handlers.handlePageScriptRun({ name: 'auth_extract' });
      expect(deps.browserHandlers.handlePageEvaluate).toHaveBeenCalledOnce();
      expect(response.content).toBeDefined();
    });
  });

  // ── normalizeOutputPath ────────────────────────────────────────────

  describe('normalizeOutputPath', () => {
    it('returns default path when input is undefined', () => {
      const result = handlers.normalizeOutputPathExposed(undefined, 'default/path', 'dir');
      expect(result).toBe('default/path');
    });

    it('returns default path when input is empty string', () => {
      const result = handlers.normalizeOutputPathExposed('', 'default/path', 'dir');
      expect(result).toBe('default/path');
    });

    it('returns default path when input is whitespace only', () => {
      const result = handlers.normalizeOutputPathExposed('   ', 'default/path', 'dir');
      expect(result).toBe('default/path');
    });

    it('returns default path for absolute paths', () => {
      const result = handlers.normalizeOutputPathExposed('/etc/passwd', 'default/path', 'dir');
      expect(result).toBe('default/path');
    });

    it('returns default path for Windows absolute paths', () => {
      const result = handlers.normalizeOutputPathExposed(
        'C:\\data\\file.txt',
        'default/path',
        'dir',
      );
      expect(result).toBe('default/path');
    });

    it('returns default path for path traversal attempts', () => {
      const result = handlers.normalizeOutputPathExposed(
        '../../../etc/passwd',
        'default/path',
        'dir',
      );
      expect(result).toBe('default/path');
    });

    it('prepends preferred directory for filename-only input', () => {
      const result = handlers.normalizeOutputPathExposed(
        'output.har',
        'default/path',
        'artifacts/har',
      );
      expect(result).toBe('artifacts/har/output.har');
    });

    it('returns path as-is for relative paths with directories', () => {
      const result = handlers.normalizeOutputPathExposed(
        'reports/output.md',
        'default/path',
        'dir',
      );
      expect(result).toBe('reports/output.md');
    });
  });

  // ── escapeInlineScriptLiteral ──────────────────────────────────────

  describe('escapeInlineScriptLiteral', () => {
    it('escapes < character', () => {
      const result = handlers.escapeInlineScriptLiteralExposed('<script>');
      expect(result).toContain('\\u003C');
      expect(result).toContain('\\u003E');
    });

    it('escapes / character', () => {
      const result = handlers.escapeInlineScriptLiteralExposed('a/b');
      expect(result).toContain('\\u002F');
    });

    it('escapes line separator and paragraph separator', () => {
      const result = handlers.escapeInlineScriptLiteralExposed('a\u2028b\u2029c');
      expect(result).toContain('\\u2028');
      expect(result).toContain('\\u2029');
    });

    it('returns string unchanged if no special chars', () => {
      const result = handlers.escapeInlineScriptLiteralExposed('hello world');
      expect(result).toBe('hello world');
    });
  });

  // ── evictBundleCache ───────────────────────────────────────────────

  describe('evictBundleCache', () => {
    it('removes expired entries', () => {
      const cache = handlers.bundleCacheExposed;
      const ttl = WorkflowHandlersBase.BUNDLE_CACHE_TTL_MS;

      cache.set('old', { text: 'data', cachedAt: Date.now() - ttl - 1000 });
      handlers.bundleCacheBytesExposed = 4;

      handlers.evictBundleCacheExposed();

      expect(cache.size).toBe(0);
      expect(handlers.bundleCacheBytesExposed).toBe(0);
    });

    it('keeps unexpired entries', () => {
      const cache = handlers.bundleCacheExposed;

      cache.set('recent', { text: 'data', cachedAt: Date.now() });
      handlers.bundleCacheBytesExposed = 4;

      handlers.evictBundleCacheExposed();

      expect(cache.has('recent')).toBe(true);
    });

    it('evicts oldest when over entry limit', () => {
      const cache = handlers.bundleCacheExposed;
      const maxEntries = WorkflowHandlersBase.MAX_BUNDLE_CACHE;

      for (let i = 0; i < maxEntries + 5; i++) {
        const text = `data_${i}`;
        cache.set(`key_${i}`, { text, cachedAt: Date.now() });
        handlers.bundleCacheBytesExposed += text.length;
      }

      handlers.evictBundleCacheExposed();

      expect(cache.size).toBeLessThanOrEqual(maxEntries);
    });
  });

  // ── buildWebApiCaptureReportMarkdown ───────────────────────────────

  describe('buildWebApiCaptureReportMarkdown', () => {
    it('builds complete markdown report with all sections', () => {
      const report = handlers.buildWebApiCaptureReportMarkdownExposed({
        generatedAt: '2026-03-15T12:00:00Z',
        url: 'https://api.example.com',
        waitUntil: 'networkidle0',
        waitAfterActionsMs: 2000,
        steps: ['network_enable', 'page_navigate(https://api.example.com)'],
        warnings: ['Action click failed: element not found'],
        totalCaptured: 42,
        authFindings: [
          { type: 'bearer', location: 'header', confidence: 0.95, maskedValue: 'ey***' },
        ],
        harExported: true,
        harOutputPath: 'artifacts/har/capture.har',
      });

      expect(report).toContain('# Web API Capture Report');
      expect(report).toContain('URL: https://api.example.com');
      expect(report).toContain('Wait Until: networkidle0');
      expect(report).toContain('Wait After Actions (ms): 2000');
      expect(report).toContain('Captured Requests: 42');
      expect(report).toContain('HAR Exported: yes');
      expect(report).toContain('## Steps');
      expect(report).toContain('- network_enable');
      expect(report).toContain('## Auth Findings');
      expect(report).toContain('type=bearer');
      expect(report).toContain('confidence=0.95');
      expect(report).toContain('## Warnings');
      expect(report).toContain('Action click failed');
    });

    it('reports "(none)" for empty steps', () => {
      const report = handlers.buildWebApiCaptureReportMarkdownExposed({
        generatedAt: '2026-03-15T12:00:00Z',
        url: 'https://api.example.com',
        waitUntil: 'load',
        waitAfterActionsMs: 0,
        steps: [],
        warnings: [],
        totalCaptured: 0,
        authFindings: [],
        harExported: false,
      });

      expect(report).toContain('## Steps\n- (none)');
      expect(report).toContain('## Auth Findings\n- (none)');
      expect(report).toContain('## Warnings\n- (none)');
    });

    it('handles auth finding with masked field fallback chain', () => {
      const report = handlers.buildWebApiCaptureReportMarkdownExposed({
        generatedAt: '2026-03-15T12:00:00Z',
        url: 'https://example.com',
        waitUntil: 'load',
        waitAfterActionsMs: 0,
        steps: [],
        warnings: [],
        totalCaptured: 0,
        authFindings: [{ type: 'cookie', location: 'response', value: 'session=abc123' }],
        harExported: false,
      });

      expect(report).toContain('type=cookie');
      expect(report).toContain('value=session=abc123');
    });

    it('handles HAR path n/a when not provided', () => {
      const report = handlers.buildWebApiCaptureReportMarkdownExposed({
        generatedAt: '2026-03-15T12:00:00Z',
        url: 'https://example.com',
        waitUntil: 'load',
        waitAfterActionsMs: 0,
        steps: [],
        warnings: [],
        totalCaptured: 0,
        authFindings: [],
        harExported: false,
      });

      expect(report).toContain('HAR Path: n/a');
    });
  });

  // ── getOptionalString / getOptionalRecord ──────────────────────────

  describe('getOptionalString', () => {
    it('returns string value', () => {
      expect(handlers.getOptionalStringExposed('hello')).toBe('hello');
    });

    it('returns undefined for non-string', () => {
      expect(handlers.getOptionalStringExposed(123)).toBeUndefined();
      expect(handlers.getOptionalStringExposed(null)).toBeUndefined();
      expect(handlers.getOptionalStringExposed(undefined)).toBeUndefined();
    });
  });

  describe('getOptionalRecord', () => {
    it('returns object value', () => {
      const obj = { key: 'val' };
      expect(handlers.getOptionalRecordExposed(obj)).toBe(obj);
    });

    it('returns undefined for null', () => {
      expect(handlers.getOptionalRecordExposed(null)).toBeUndefined();
    });

    it('returns undefined for arrays', () => {
      expect(handlers.getOptionalRecordExposed([1, 2])).toBeUndefined();
    });

    it('returns undefined for primitives', () => {
      expect(handlers.getOptionalRecordExposed('str')).toBeUndefined();
      expect(handlers.getOptionalRecordExposed(42)).toBeUndefined();
    });
  });

  // ── jsonTextResult ─────────────────────────────────────────────────

  describe('jsonTextResult', () => {
    it('wraps payload in standard tool response format', () => {
      const result = handlers.jsonTextResultExposed({ success: true, data: 'test' });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.data).toBe('test');
    });
  });

  // ── handleListExtensionWorkflows ───────────────────────────────────

  describe('handleListExtensionWorkflows', () => {
    it('returns error when serverContext is unavailable', async () => {
      const noDeps = createDeps();
      noDeps.serverContext = undefined;
      const h = new WorkflowHandlersBase(noDeps);

      const body = parseJson<WorkflowListExtensionsResponse>(
        await h.handleListExtensionWorkflows(),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('unavailable');
    });

    it('returns empty list when no workflows loaded', async () => {
      const body = parseJson<WorkflowListExtensionsResponse>(
        await handlers.handleListExtensionWorkflows(),
      );
      expect(mockEnsureWorkflowsLoaded).toHaveBeenCalledWith(deps.serverContext);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.count).toBe(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.workflows).toEqual([]);
    });

    it('returns sorted list of loaded workflows', async () => {
      const ctx = deps.serverContext as MCPServerContext;
      ctx.extensionWorkflowsById.set('z-workflow', {
        id: 'z-workflow',
        displayName: 'Z Workflow',
        description: 'last',
        tags: [],
        timeoutMs: 10000,
        defaultMaxConcurrency: 1,
        source: 'z.ts',
      });
      ctx.extensionWorkflowsById.set('a-workflow', {
        id: 'a-workflow',
        displayName: 'A Workflow',
        description: 'first',
        tags: ['demo'],
        timeoutMs: 5000,
        defaultMaxConcurrency: 2,
        source: 'a.ts',
        route: {
          kind: 'workflow',
          triggerPatterns: [/alpha/i],
          requiredDomains: ['workflow'],
          priority: 70,
          steps: [
            {
              id: 'capture',
              toolName: 'network_get_requests',
              description: 'Capture requests',
              prerequisites: [],
            },
          ],
        },
      });

      const body = parseJson<WorkflowListExtensionsResponse>(
        await handlers.handleListExtensionWorkflows(),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.count).toBe(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.workflows[0].id).toBe('a-workflow');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.workflows[0].route).toEqual({
        kind: 'workflow',
        triggerPatterns: ['alpha'],
        requiredDomains: ['workflow'],
        priority: 70,
        steps: [
          {
            id: 'capture',
            toolName: 'network_get_requests',
            description: 'Capture requests',
            prerequisites: [],
          },
        ],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.workflows[1].id).toBe('z-workflow');
    });

    it('omits routing presets from the executable workflow list', async () => {
      const ctx = deps.serverContext as MCPServerContext;
      ctx.extensionWorkflowsById.set('preset-only', {
        id: 'preset-only',
        displayName: 'Preset Only',
        description: 'router-only preset',
        tags: ['preset'],
        timeoutMs: 1000,
        defaultMaxConcurrency: 1,
        source: 'preset.ts',
        route: {
          kind: 'preset',
          triggerPatterns: [/preset/i],
          requiredDomains: ['workflow'],
          priority: 50,
          steps: [],
        },
      });

      const body = parseJson<WorkflowListExtensionsResponse>(
        await handlers.handleListExtensionWorkflows(),
      );

      expect(body.success).toBe(true);
      expect(body.workflows.some((workflow) => workflow.id === 'preset-only')).toBe(false);
    });
  });

  // ── handleRunExtensionWorkflow ─────────────────────────────────────

  describe('handleRunExtensionWorkflow', () => {
    it('returns error when serverContext is unavailable', async () => {
      const noDeps = createDeps();
      noDeps.serverContext = undefined;
      const h = new WorkflowHandlersBase(noDeps);

      const body = parseJson<WorkflowRunExtensionResponse>(
        await h.handleRunExtensionWorkflow({ workflowId: 'test' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('unavailable');
    });

    it('returns error when workflowId is missing', async () => {
      const body = parseJson<WorkflowRunExtensionResponse>(
        await handlers.handleRunExtensionWorkflow({}),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('workflowId is required');
    });

    it('returns error when workflow not found', async () => {
      const body = parseJson<WorkflowRunExtensionResponse>(
        await handlers.handleRunExtensionWorkflow({ workflowId: 'nonexistent' }),
      );
      expect(mockEnsureWorkflowsLoaded).toHaveBeenCalledWith(deps.serverContext);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('not found');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(Array.isArray(body.available)).toBe(true);
    });

    it('accepts id as alias for workflowId', async () => {
      const body = parseJson<WorkflowRunExtensionResponse>(
        await handlers.handleRunExtensionWorkflow({ id: 'nonexistent' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('nonexistent');
    });

    it('rejects routing presets for direct execution', async () => {
      const ctx = deps.serverContext as MCPServerContext;
      ctx.extensionWorkflowRuntimeById.set('preset-only', {
        workflow: {
          kind: 'workflow-contract',
          version: 1,
          id: 'preset-only',
          displayName: 'Preset Only',
          route: {
            kind: 'preset',
            triggerPatterns: [/preset/i],
            requiredDomains: ['workflow'],
            priority: 50,
            steps: [],
          },
          build: () => ({ kind: 'sequence', id: 'root', steps: [] }),
        },
        source: 'preset.ts',
        route: {
          kind: 'preset',
          triggerPatterns: [/preset/i],
          requiredDomains: ['workflow'],
          priority: 50,
          steps: [],
        },
      });

      const body = parseJson<WorkflowRunExtensionResponse>(
        await handlers.handleRunExtensionWorkflow({ workflowId: 'preset-only' }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('routing preset');
    });

    it('handles workflow execution failure', async () => {
      const ctx = deps.serverContext as MCPServerContext;
      ctx.extensionWorkflowRuntimeById.set('failing', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        workflow: {} as any,
        source: 'fail.ts',
      });

      const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.mocked(executeExtensionWorkflow).mockRejectedValue(
        new Error('Workflow execution timeout'),
      );

      const body = parseJson<WorkflowRunExtensionResponse>(
        await handlers.handleRunExtensionWorkflow({ workflowId: 'failing' }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Workflow execution timeout');
    });
  });
});
