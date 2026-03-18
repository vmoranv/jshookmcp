import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIsSsrfTarget, mockIsPrivateHost, mockIsLoopbackHost, mockLookup } = vi.hoisted(() => ({
  mockIsSsrfTarget: vi.fn(async () => false),
  mockIsPrivateHost: vi.fn(() => false),
  mockIsLoopbackHost: vi.fn(() => false),
  mockLookup: vi.fn(),
}));

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: mockIsSsrfTarget,
  isPrivateHost: mockIsPrivateHost,
  isLoopbackHost: mockIsLoopbackHost,
}));

vi.mock('node:dns/promises', () => ({
  lookup: mockLookup,
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  realpath: vi.fn(async (p: string) => p),
}));

vi.mock('@utils/outputPaths', () => ({
  getProjectRoot: vi.fn(() => '/project'),
}));

vi.mock('@server/workflows/WorkflowEngine', () => ({
  executeExtensionWorkflow: vi.fn(),
}));

import { WorkflowHandlersBase } from '@server/domains/workflow/handlers.impl.workflow-base';
import type { WorkflowHandlersDeps } from '@server/domains/workflow/handlers.impl.workflow-base';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
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
    } as any,
  };
}

describe('WorkflowHandlersBase', () => {
  let deps: WorkflowHandlersDeps;
  let handlers: WorkflowHandlersBase;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
    handlers = new WorkflowHandlersBase(deps);
  });

  // ── initBuiltinScripts ─────────────────────────────────────────────

  describe('initBuiltinScripts', () => {
    it('registers built-in scripts on construction', () => {
      const registry = (handlers as any).scriptRegistry as Map<string, any>;
      expect(registry.has('auth_extract')).toBe(true);
      expect(registry.has('bundle_search')).toBe(true);
      expect(registry.has('react_fill_form')).toBe(true);
      expect(registry.has('dom_find_upgrade_buttons')).toBe(true);
    });

    it('has description for each built-in script', () => {
      const registry = (handlers as any).scriptRegistry as Map<string, any>;
      for (const [, entry] of registry) {
        expect(entry.description).toBeDefined();
        expect(entry.description.length).toBeGreaterThan(0);
      }
    });

    it('has code for each built-in script', () => {
      const registry = (handlers as any).scriptRegistry as Map<string, any>;
      for (const [, entry] of registry) {
        expect(entry.code).toBeDefined();
        expect(entry.code.length).toBeGreaterThan(0);
      }
    });
  });

  // ── handlePageScriptRegister ───────────────────────────────────────

  describe('handlePageScriptRegister', () => {
    it('fails when name is empty', async () => {
      const body = parseJson(await handlers.handlePageScriptRegister({ name: '', code: 'x' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('name and code are required');
    });

    it('fails when code is empty', async () => {
      const body = parseJson(await handlers.handlePageScriptRegister({ name: 'test', code: '' }));
      expect(body.success).toBe(false);
    });

    it('fails when both name and code are missing', async () => {
      const body = parseJson(await handlers.handlePageScriptRegister({}));
      expect(body.success).toBe(false);
    });

    it('registers a new script', async () => {
      const body = parseJson(
        await handlers.handlePageScriptRegister({
          name: 'my_script',
          code: '(() => 42)()',
          description: 'A test script',
        })
      );

      expect(body.success).toBe(true);
      expect(body.action).toBe('registered');
      expect(body.name).toBe('my_script');
      expect(body.description).toBe('A test script');
      expect(body.available).toContain('my_script');
    });

    it('updates an existing script', async () => {
      await handlers.handlePageScriptRegister({
        name: 'my_script',
        code: 'original()',
      });

      const body = parseJson(
        await handlers.handlePageScriptRegister({
          name: 'my_script',
          code: 'updated()',
          description: 'Updated',
        })
      );

      expect(body.success).toBe(true);
      expect(body.action).toBe('updated');
    });

    it('evicts oldest non-builtin when at max capacity', async () => {
      const MAX = (WorkflowHandlersBase as any).MAX_SCRIPTS;
      // Fill with custom scripts up to limit
      for (let i = 0; i < MAX; i++) {
        await handlers.handlePageScriptRegister({
          name: `custom_${i}`,
          code: `(() => ${i})()`,
        });
      }

      // Adding one more should succeed with eviction
      const body = parseJson(
        await handlers.handlePageScriptRegister({
          name: 'overflow_script',
          code: '(() => "overflow")()',
        })
      );

      expect(body.success).toBe(true);
      const registry = (handlers as any).scriptRegistry as Map<string, any>;
      expect(registry.has('overflow_script')).toBe(true);
      // Built-in scripts should still be present
      expect(registry.has('auth_extract')).toBe(true);
    });

    it('uses empty string as default description', async () => {
      const body = parseJson(
        await handlers.handlePageScriptRegister({
          name: 'no_desc',
          code: '1',
        })
      );

      expect(body.success).toBe(true);
      expect(body.description).toBe('');
    });
  });

  // ── handlePageScriptRun ────────────────────────────────────────────

  describe('handlePageScriptRun', () => {
    it('fails when script name not found', async () => {
      const body = parseJson(await handlers.handlePageScriptRun({ name: 'nonexistent' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('not found');
      expect(Array.isArray(body.available)).toBe(true);
    });

    it('runs script without params', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ value: 'ok' }) }],
      });

      await handlers.handlePageScriptRegister({
        name: 'simple',
        code: '(() => "result")()',
      });

      const response = await handlers.handlePageScriptRun({ name: 'simple' });
      expect(deps.browserHandlers.handlePageEvaluate as any).toHaveBeenCalledOnce();
      expect(response.content[0]!.type).toBe('text');
    });

    it('injects params when provided', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue({
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

      const call = (deps.browserHandlers.handlePageEvaluate as any).mock.calls[0][0];
      expect(call.code).toContain('__params__');
      expect(call.code).toContain('JSON.parse');
    });

    it('returns error when script execution throws', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockRejectedValue(new Error('Eval failed'));

      await handlers.handlePageScriptRegister({
        name: 'failing',
        code: 'throw new Error("boom")',
      });

      const body = parseJson(await handlers.handlePageScriptRun({ name: 'failing' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('Eval failed');
      expect(body.script).toBe('failing');
    });

    it('runs built-in auth_extract script', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ token: 'abc' }) }],
      });

      const response = await handlers.handlePageScriptRun({ name: 'auth_extract' });
      expect(deps.browserHandlers.handlePageEvaluate as any).toHaveBeenCalledOnce();
      expect(response.content).toBeDefined();
    });
  });

  // ── normalizeOutputPath ────────────────────────────────────────────

  describe('normalizeOutputPath', () => {
    it('returns default path when input is undefined', () => {
      const result = (handlers as any).normalizeOutputPath(undefined, 'default/path', 'dir');
      expect(result).toBe('default/path');
    });

    it('returns default path when input is empty string', () => {
      const result = (handlers as any).normalizeOutputPath('', 'default/path', 'dir');
      expect(result).toBe('default/path');
    });

    it('returns default path when input is whitespace only', () => {
      const result = (handlers as any).normalizeOutputPath('   ', 'default/path', 'dir');
      expect(result).toBe('default/path');
    });

    it('returns default path for absolute paths', () => {
      const result = (handlers as any).normalizeOutputPath('/etc/passwd', 'default/path', 'dir');
      expect(result).toBe('default/path');
    });

    it('returns default path for Windows absolute paths', () => {
      const result = (handlers as any).normalizeOutputPath(
        'C:\\data\\file.txt',
        'default/path',
        'dir'
      );
      expect(result).toBe('default/path');
    });

    it('returns default path for path traversal attempts', () => {
      const result = (handlers as any).normalizeOutputPath(
        '../../../etc/passwd',
        'default/path',
        'dir'
      );
      expect(result).toBe('default/path');
    });

    it('prepends preferred directory for filename-only input', () => {
      const result = (handlers as any).normalizeOutputPath(
        'output.har',
        'default/path',
        'artifacts/har'
      );
      expect(result).toBe('artifacts/har/output.har');
    });

    it('returns path as-is for relative paths with directories', () => {
      const result = (handlers as any).normalizeOutputPath(
        'reports/output.md',
        'default/path',
        'dir'
      );
      expect(result).toBe('reports/output.md');
    });
  });

  // ── escapeInlineScriptLiteral ──────────────────────────────────────

  describe('escapeInlineScriptLiteral', () => {
    it('escapes < character', () => {
      const result = (handlers as any).escapeInlineScriptLiteral('<script>');
      expect(result).toContain('\\u003C');
      expect(result).toContain('\\u003E');
    });

    it('escapes / character', () => {
      const result = (handlers as any).escapeInlineScriptLiteral('a/b');
      expect(result).toContain('\\u002F');
    });

    it('escapes line separator and paragraph separator', () => {
      const result = (handlers as any).escapeInlineScriptLiteral('a\u2028b\u2029c');
      expect(result).toContain('\\u2028');
      expect(result).toContain('\\u2029');
    });

    it('returns string unchanged if no special chars', () => {
      const result = (handlers as any).escapeInlineScriptLiteral('hello world');
      expect(result).toBe('hello world');
    });
  });

  // ── evictBundleCache ───────────────────────────────────────────────

  describe('evictBundleCache', () => {
    it('removes expired entries', () => {
      const cache = (handlers as any).bundleCache as Map<string, any>;
      const ttl = WorkflowHandlersBase.BUNDLE_CACHE_TTL_MS;

      cache.set('old', { text: 'data', cachedAt: Date.now() - ttl - 1000 });
      (handlers as any).bundleCacheBytes = 4;

      (handlers as any).evictBundleCache();

      expect(cache.size).toBe(0);
      expect((handlers as any).bundleCacheBytes).toBe(0);
    });

    it('keeps unexpired entries', () => {
      const cache = (handlers as any).bundleCache as Map<string, any>;

      cache.set('recent', { text: 'data', cachedAt: Date.now() });
      (handlers as any).bundleCacheBytes = 4;

      (handlers as any).evictBundleCache();

      expect(cache.has('recent')).toBe(true);
    });

    it('evicts oldest when over entry limit', () => {
      const cache = (handlers as any).bundleCache as Map<string, any>;
      const maxEntries = WorkflowHandlersBase.MAX_BUNDLE_CACHE;

      for (let i = 0; i < maxEntries + 5; i++) {
        const text = `data_${i}`;
        cache.set(`key_${i}`, { text, cachedAt: Date.now() });
        (handlers as any).bundleCacheBytes += text.length;
      }

      (handlers as any).evictBundleCache();

      expect(cache.size).toBeLessThanOrEqual(maxEntries);
    });
  });

  // ── buildWebApiCaptureReportMarkdown ───────────────────────────────

  describe('buildWebApiCaptureReportMarkdown', () => {
    it('builds complete markdown report with all sections', () => {
      const report = (handlers as any).buildWebApiCaptureReportMarkdown({
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
      const report = (handlers as any).buildWebApiCaptureReportMarkdown({
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
      const report = (handlers as any).buildWebApiCaptureReportMarkdown({
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
      const report = (handlers as any).buildWebApiCaptureReportMarkdown({
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
      expect((handlers as any).getOptionalString('hello')).toBe('hello');
    });

    it('returns undefined for non-string', () => {
      expect((handlers as any).getOptionalString(123)).toBeUndefined();
      expect((handlers as any).getOptionalString(null)).toBeUndefined();
      expect((handlers as any).getOptionalString(undefined)).toBeUndefined();
    });
  });

  describe('getOptionalRecord', () => {
    it('returns object value', () => {
      const obj = { key: 'val' };
      expect((handlers as any).getOptionalRecord(obj)).toBe(obj);
    });

    it('returns undefined for null', () => {
      expect((handlers as any).getOptionalRecord(null)).toBeUndefined();
    });

    it('returns undefined for arrays', () => {
      expect((handlers as any).getOptionalRecord([1, 2])).toBeUndefined();
    });

    it('returns undefined for primitives', () => {
      expect((handlers as any).getOptionalRecord('str')).toBeUndefined();
      expect((handlers as any).getOptionalRecord(42)).toBeUndefined();
    });
  });

  // ── jsonTextResult ─────────────────────────────────────────────────

  describe('jsonTextResult', () => {
    it('wraps payload in standard tool response format', () => {
      const result = (handlers as any).jsonTextResult({ success: true, data: 'test' });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toBe('test');
    });
  });

  // ── handleListExtensionWorkflows ───────────────────────────────────

  describe('handleListExtensionWorkflows', () => {
    it('returns error when serverContext is unavailable', async () => {
      const noDeps = createDeps();
      noDeps.serverContext = undefined;
      const h = new WorkflowHandlersBase(noDeps);

      const body = parseJson(await h.handleListExtensionWorkflows());
      expect(body.success).toBe(false);
      expect(body.error).toContain('unavailable');
    });

    it('returns empty list when no workflows loaded', async () => {
      const body = parseJson(await handlers.handleListExtensionWorkflows());
      expect(body.success).toBe(true);
      expect(body.count).toBe(0);
      expect(body.workflows).toEqual([]);
    });

    it('returns sorted list of loaded workflows', async () => {
      const ctx = deps.serverContext as any;
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
      });

      const body = parseJson(await handlers.handleListExtensionWorkflows());
      expect(body.success).toBe(true);
      expect(body.count).toBe(2);
      expect(body.workflows[0].id).toBe('a-workflow');
      expect(body.workflows[1].id).toBe('z-workflow');
    });
  });

  // ── handleRunExtensionWorkflow ─────────────────────────────────────

  describe('handleRunExtensionWorkflow', () => {
    it('returns error when serverContext is unavailable', async () => {
      const noDeps = createDeps();
      noDeps.serverContext = undefined;
      const h = new WorkflowHandlersBase(noDeps);

      const body = parseJson(await h.handleRunExtensionWorkflow({ workflowId: 'test' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('unavailable');
    });

    it('returns error when workflowId is missing', async () => {
      const body = parseJson(await handlers.handleRunExtensionWorkflow({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('workflowId is required');
    });

    it('returns error when workflow not found', async () => {
      const body = parseJson(
        await handlers.handleRunExtensionWorkflow({ workflowId: 'nonexistent' })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('not found');
      expect(Array.isArray(body.available)).toBe(true);
    });

    it('accepts id as alias for workflowId', async () => {
      const body = parseJson(await handlers.handleRunExtensionWorkflow({ id: 'nonexistent' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('nonexistent');
    });

    it('handles workflow execution failure', async () => {
      const ctx = deps.serverContext as any;
      ctx.extensionWorkflowRuntimeById.set('failing', {
        workflow: {},
        source: 'fail.ts',
      });

      const { executeExtensionWorkflow } = await import('@server/workflows/WorkflowEngine');
      (executeExtensionWorkflow as any).mockRejectedValue(new Error('Workflow execution timeout'));

      const body = parseJson(await handlers.handleRunExtensionWorkflow({ workflowId: 'failing' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('Workflow execution timeout');
    });
  });
});
