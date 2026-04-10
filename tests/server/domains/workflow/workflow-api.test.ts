// @ts-expect-error — auto-suppressed [TS2724]
import type { WorkflowRunResponse } from '@tests/server/domains/shared/common-test-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIsSsrfTarget } = vi.hoisted(() => ({
  mockIsSsrfTarget: vi.fn(async () => false),
}));

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: mockIsSsrfTarget,
  isPrivateHost: vi.fn(() => false),
  isLoopbackHost: vi.fn(() => false),
}));

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
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

import { WorkflowHandlersApi } from '@server/domains/workflow/handlers.impl.workflow-api';
import type {
  WorkflowHandlersDeps,
  ToolHandlerResult,
} from '@server/domains/workflow/handlers.impl.workflow-base';
import type { MCPServerContext } from '@server/MCPServer.context';

function parseJson<T = Record<string, unknown>>(response: ToolHandlerResult): T {
  // @ts-expect-error — auto-suppressed [TS2532]
  return JSON.parse(response.content[0].text) as T;
}

function makeTextResult(payload: Record<string, unknown>): ToolHandlerResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
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

describe('WorkflowHandlersApi', () => {
  let deps: WorkflowHandlersDeps;
  let handlers: WorkflowHandlersApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSsrfTarget.mockResolvedValue(false);
    deps = createDeps();
    handlers = new WorkflowHandlersApi(deps);
  });

  // ── handleApiProbeBatch ──────────────────────────────────────────

  describe('handleApiProbeBatch', () => {
    it('returns error when baseUrl is missing', async () => {
      const body = parseJson<WorkflowRunResponse>(await handlers.handleApiProbeBatch({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('baseUrl is required');
    });

    it('returns error when baseUrl is empty string', async () => {
      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleApiProbeBatch({ baseUrl: '' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('baseUrl is required');
    });

    it('returns error when baseUrl is whitespace only', async () => {
      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleApiProbeBatch({ baseUrl: '   ' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('baseUrl is required');
    });

    it('returns error for invalid URL', async () => {
      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleApiProbeBatch({ baseUrl: 'not-a-url' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid baseUrl');
    });

    it('returns error for unsupported protocol (ftp)', async () => {
      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleApiProbeBatch({ baseUrl: 'ftp://files.example.com' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('Unsupported protocol');
    });

    it('returns error for javascript: protocol', async () => {
      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleApiProbeBatch({ baseUrl: 'javascript:alert(1)' }),
      );
      expect(body.success).toBe(false);
      // Either "Invalid baseUrl" or "Unsupported protocol" depending on URL parser
      expect(body.success).toBe(false);
    });

    it('blocks SSRF targets', async () => {
      mockIsSsrfTarget.mockResolvedValue(true);

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleApiProbeBatch({
          baseUrl: 'http://169.254.169.254',
          paths: ['/latest/meta-data'],
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('Blocked');
      expect(body.error).toContain('private/reserved');
    });

    it('returns error when paths array is empty', async () => {
      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleApiProbeBatch({
          baseUrl: 'https://api.example.com',
          paths: [],
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('paths array is required');
    });

    it('returns error when paths is missing', async () => {
      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleApiProbeBatch({
          baseUrl: 'https://api.example.com',
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('paths array is required');
    });

    it('returns error when paths JSON is invalid', async () => {
      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleApiProbeBatch({
          baseUrl: 'https://api.example.com',
          paths: 'not-json',
        }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('paths array is required');
    });

    it('parses paths from JSON string', async () => {
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} }),
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: JSON.stringify(['/api/v1/users']),
      });

      expect(deps.browserHandlers.handlePageEvaluate).toHaveBeenCalledOnce();
    });

    it('evaluates probe code in browser context', async () => {
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockResolvedValue(
        makeTextResult({ probed: 2, method: 'GET', results: {} }),
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: ['/api/v1/users', '/api/v1/products'],
        method: 'GET',
      });

      expect(deps.browserHandlers.handlePageEvaluate).toHaveBeenCalledOnce();
      // @ts-expect-error — auto-suppressed [TS2532]
      const call = vi.mocked(deps.browserHandlers.handlePageEvaluate).mock.calls[0][0];
      expect(call.code).toContain('api.example.com');
      expect(call.code).toContain('users');
      expect(call.code).toContain('products');
    });

    it('normalizes trailing slash on baseUrl', async () => {
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} }),
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com/',
        paths: ['/test'],
      });

      // @ts-expect-error — auto-suppressed [TS2532]
      const call = vi.mocked(deps.browserHandlers.handlePageEvaluate).mock.calls[0][0];
      // The baseUrl should not have trailing slash in the injected code
      expect(call.code).toContain('"https://api.example.com"');
    });

    it('uses GET method by default', async () => {
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} }),
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: ['/test'],
      });

      // @ts-expect-error — auto-suppressed [TS2532]
      const call = vi.mocked(deps.browserHandlers.handlePageEvaluate).mock.calls[0][0];
      expect(call.code).toContain('"GET"');
    });

    it('uppercases custom method', async () => {
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} }),
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: ['/test'],
        method: 'post',
      });

      // @ts-expect-error — auto-suppressed [TS2532]
      const call = vi.mocked(deps.browserHandlers.handlePageEvaluate).mock.calls[0][0];
      expect(call.code).toContain('"POST"');
    });

    it('includes custom headers in probe code', async () => {
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} }),
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: ['/test'],
        headers: { 'X-Custom': 'value' },
      });

      // @ts-expect-error — auto-suppressed [TS2532]
      const call = vi.mocked(deps.browserHandlers.handlePageEvaluate).mock.calls[0][0];
      expect(call.code).toContain('X-Custom');
    });

    it('includes bodyTemplate for POST methods', async () => {
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} }),
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: ['/test'],
        method: 'POST',
        bodyTemplate: '{"key":"value"}',
      });

      // @ts-expect-error — auto-suppressed [TS2532]
      const call = vi.mocked(deps.browserHandlers.handlePageEvaluate).mock.calls[0][0];
      expect(call.code).toContain('bodyTemplate');
    });

    it('handles evaluation error gracefully', async () => {
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockRejectedValue(
        new Error('Page navigation timeout'),
      );

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleApiProbeBatch({
          baseUrl: 'https://api.example.com',
          paths: ['/test'],
        }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('Page navigation timeout');
    });

    it('clamps maxBodySnippetLength to 10000', async () => {
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} }),
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: ['/test'],
        maxBodySnippetLength: 99999,
      });

      // @ts-expect-error — auto-suppressed [TS2532]
      const call = vi.mocked(deps.browserHandlers.handlePageEvaluate).mock.calls[0][0];
      expect(call.code).toContain('10000');
    });

    it('uses default includeBodyStatuses of [200, 201, 204]', async () => {
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} }),
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: ['/test'],
      });

      // @ts-expect-error — auto-suppressed [TS2532]
      const call = vi.mocked(deps.browserHandlers.handlePageEvaluate).mock.calls[0][0];
      expect(call.code).toContain('[200,201,204]');
    });

    it('returns non-string baseUrl as error', async () => {
      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleApiProbeBatch({ baseUrl: 12345, paths: ['/test'] }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('baseUrl is required');
    });
  });

  // ── handleWebApiCaptureSession ───────────────────────────────────

  describe('handleWebApiCaptureSession', () => {
    function setupSuccessfulCapture() {
      vi.mocked(deps.advancedHandlers.handleNetworkEnable).mockResolvedValue(
        makeTextResult({ success: true }),
      );
      vi.mocked(deps.advancedHandlers.handleConsoleInjectFetchInterceptor).mockResolvedValue(
        makeTextResult({ success: true }),
      );
      vi.mocked(deps.advancedHandlers.handleConsoleInjectXhrInterceptor).mockResolvedValue(
        makeTextResult({ success: true }),
      );
      vi.mocked(deps.browserHandlers.handlePageNavigate).mockResolvedValue(
        makeTextResult({ success: true }),
      );
      vi.mocked(deps.advancedHandlers.handleNetworkGetStats).mockResolvedValue(
        makeTextResult({ stats: { totalRequests: 5 } }),
      );
      vi.mocked(deps.advancedHandlers.handleNetworkGetRequests).mockResolvedValue(
        makeTextResult({ stats: { total: 5 }, detailId: undefined }),
      );
      vi.mocked(deps.advancedHandlers.handleNetworkExtractAuth).mockResolvedValue(
        makeTextResult({ found: 1, findings: [{ type: 'bearer', confidence: 0.9 }] }),
      );
      vi.mocked(deps.advancedHandlers.handleNetworkExportHar).mockResolvedValue(
        makeTextResult({ success: true }),
      );
    }

    it('performs all workflow steps in order', async () => {
      setupSuccessfulCapture();

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.steps).toContain('network_enable');
      expect(body.steps).toContain('console_inject_fetch_interceptor');
      expect(body.steps).toContain('console_inject_xhr_interceptor');
      expect(body.steps).toContain('page_navigate(https://example.com)');
      expect(body.steps).toContain('network_get_stats');
      expect(body.steps).toContain('network_get_requests');
      expect(body.steps).toContain('network_extract_auth');
    });

    it('reports captured request count', async () => {
      setupSuccessfulCapture();

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.summary.capturedRequests).toBe(5);
    });

    it('includes auth findings in response', async () => {
      setupSuccessfulCapture();

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.authFindings).toHaveLength(1);
      expect(body.authFindings[0].type).toBe('bearer');
    });

    it('performs click action', async () => {
      setupSuccessfulCapture();
      vi.mocked(deps.browserHandlers.handlePageClick).mockResolvedValue(
        makeTextResult({ success: true }),
      );

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          actions: [{ type: 'click', selector: '#login-btn' }],
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.steps).toContain('page_click(#login-btn)');
      expect(deps.browserHandlers.handlePageClick).toHaveBeenCalledWith({ selector: '#login-btn' });
    });

    it('performs type action', async () => {
      setupSuccessfulCapture();
      vi.mocked(deps.browserHandlers.handlePageType).mockResolvedValue(
        makeTextResult({ success: true }),
      );

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          actions: [{ type: 'type', selector: '#email', text: 'test@example.com' }],
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      expect(deps.browserHandlers.handlePageType).toHaveBeenCalledOnce();
    });

    it('performs evaluate action', async () => {
      setupSuccessfulCapture();
      vi.mocked(deps.browserHandlers.handlePageEvaluate).mockResolvedValue(
        makeTextResult({ value: 'ok' }),
      );

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          actions: [{ type: 'evaluate', expression: 'document.title' }],
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      expect(deps.browserHandlers.handlePageEvaluate).toHaveBeenCalledOnce();
    });

    it('performs wait action', async () => {
      setupSuccessfulCapture();

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          actions: [{ type: 'wait', delayMs: 0 }],
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.steps).toContain('wait(0ms)');
    });

    it('records warnings for failed actions without aborting', async () => {
      setupSuccessfulCapture();
      vi.mocked(deps.browserHandlers.handlePageClick).mockRejectedValue(
        new Error('Element not found'),
      );

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          actions: [{ type: 'click', selector: '#missing' }],
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.warnings).toBeDefined();
      expect(
        body.warnings.some((w: string) => typeof w === 'string' && w.includes('Element not found')),
      ).toBe(true);
    });

    it('parses actions from JSON string', async () => {
      setupSuccessfulCapture();
      vi.mocked(deps.browserHandlers.handlePageClick).mockResolvedValue(
        makeTextResult({ success: true }),
      );

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          actions: JSON.stringify([{ type: 'click', selector: '#btn' }]),
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      expect(deps.browserHandlers.handlePageClick).toHaveBeenCalledOnce();
    });

    it('treats invalid actions JSON as an empty action list', async () => {
      setupSuccessfulCapture();

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          actions: 'not-json',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      expect(deps.browserHandlers.handlePageClick).not.toHaveBeenCalled();
      expect(deps.browserHandlers.handlePageType).not.toHaveBeenCalled();
    });

    it('filters out invalid action types', async () => {
      setupSuccessfulCapture();

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          actions: [{ type: 'invalid_action', selector: '#btn' }],
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      // Invalid action should be filtered out
      expect(deps.browserHandlers.handlePageClick).not.toHaveBeenCalled();
    });

    it('waits at the end of capture when waitAfterActionsMs is positive', async () => {
      setupSuccessfulCapture();

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 1,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.steps).toContain('wait(1ms)');
    });

    it('returns error when network_get_stats fails', async () => {
      vi.mocked(deps.advancedHandlers.handleNetworkEnable).mockResolvedValue(
        makeTextResult({ success: true }),
      );
      vi.mocked(deps.advancedHandlers.handleConsoleInjectFetchInterceptor).mockResolvedValue(
        makeTextResult({ success: true }),
      );
      vi.mocked(deps.advancedHandlers.handleConsoleInjectXhrInterceptor).mockResolvedValue(
        makeTextResult({ success: true }),
      );
      vi.mocked(deps.browserHandlers.handlePageNavigate).mockResolvedValue(
        makeTextResult({ success: true }),
      );
      vi.mocked(deps.advancedHandlers.handleNetworkGetStats).mockResolvedValue({
        content: [{ type: 'text' as const, text: undefined as unknown as string }],
      });

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    it('skips HAR export when exportHar is false', async () => {
      setupSuccessfulCapture();

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.summary.harExported).toBe('skipped');
      expect(deps.advancedHandlers.handleNetworkExportHar).not.toHaveBeenCalled();
    });

    it('exports HAR when exportHar is enabled', async () => {
      setupSuccessfulCapture();

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: true,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.summary.harExported).toBe(true);
      expect(body.summary.harPath).toContain('artifacts/har');
      expect(deps.advancedHandlers.handleNetworkExportHar).toHaveBeenCalledOnce();
    });

    it('skips report export when exportReport is false', async () => {
      setupSuccessfulCapture();

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.summary.reportExported).toBe('skipped');
    });

    it('returns detailId hint when requests payload has detailId', async () => {
      setupSuccessfulCapture();
      vi.mocked(deps.advancedHandlers.handleNetworkGetRequests).mockResolvedValue(
        makeTextResult({ stats: { total: 100 }, detailId: 'detail-abc' }),
      );

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.requestStats.detailId).toBe('detail-abc');
      expect(body.requestStats.hint).toContain('get_detailed_data');
    });

    it('records a warning when report export fails', async () => {
      setupSuccessfulCapture();
      vi.spyOn(handlers as any, 'safeWriteFile').mockRejectedValueOnce(new Error('disk full'));

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: true,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.report?.success).toBe(false);
      expect(body.report?.error).toContain('disk full');
      // @ts-expect-error
      expect(body.warnings?.some((warning) => warning.includes('Report export failed'))).toBe(true);
    });

    it('handles overall workflow error gracefully', async () => {
      vi.mocked(deps.advancedHandlers.handleNetworkEnable).mockRejectedValue(
        new Error('CDP connection lost'),
      );

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('CDP connection lost');
      expect(body.steps).toBeDefined();
    });
  });

  describe('additional coverage', () => {
    it('exports the markdown report when report export is enabled', async () => {
      vi.mocked(deps.advancedHandlers.handleNetworkEnable).mockResolvedValue(
        makeTextResult({ success: true }),
      );
      vi.mocked(deps.advancedHandlers.handleConsoleInjectFetchInterceptor).mockResolvedValue(
        makeTextResult({ success: true }),
      );
      vi.mocked(deps.advancedHandlers.handleConsoleInjectXhrInterceptor).mockResolvedValue(
        makeTextResult({ success: true }),
      );
      vi.mocked(deps.browserHandlers.handlePageNavigate).mockResolvedValue(
        makeTextResult({ success: true }),
      );
      vi.mocked(deps.advancedHandlers.handleNetworkGetStats).mockResolvedValue(
        makeTextResult({ stats: { totalRequests: 5 } }),
      );
      vi.mocked(deps.advancedHandlers.handleNetworkGetRequests).mockResolvedValue(
        makeTextResult({ stats: { total: 5 }, detailId: undefined }),
      );
      vi.mocked(deps.advancedHandlers.handleNetworkExtractAuth).mockResolvedValue(
        makeTextResult({ found: 1, findings: [{ type: 'bearer', confidence: 0.9 }] }),
      );
      vi.mocked(deps.advancedHandlers.handleNetworkExportHar).mockResolvedValue(
        makeTextResult({ success: true }),
      );

      const body = parseJson<WorkflowRunResponse>(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: true,
          waitAfterActionsMs: 0,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.summary.reportExported).toBe(true);
      expect(body.report?.success).toBe(true);
      expect(body.report?.outputPath).toContain('artifacts/reports');
    });
  });
});
