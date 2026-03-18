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

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

function makeTextResult(payload: Record<string, unknown>): ToolHandlerResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
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
    } as any,
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
      const body = parseJson(await handlers.handleApiProbeBatch({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('baseUrl is required');
    });

    it('returns error when baseUrl is empty string', async () => {
      const body = parseJson(await handlers.handleApiProbeBatch({ baseUrl: '' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('baseUrl is required');
    });

    it('returns error when baseUrl is whitespace only', async () => {
      const body = parseJson(await handlers.handleApiProbeBatch({ baseUrl: '   ' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('baseUrl is required');
    });

    it('returns error for invalid URL', async () => {
      const body = parseJson(await handlers.handleApiProbeBatch({ baseUrl: 'not-a-url' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid baseUrl');
    });

    it('returns error for unsupported protocol (ftp)', async () => {
      const body = parseJson(
        await handlers.handleApiProbeBatch({ baseUrl: 'ftp://files.example.com' })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('Unsupported protocol');
    });

    it('returns error for javascript: protocol', async () => {
      const body = parseJson(
        await handlers.handleApiProbeBatch({ baseUrl: 'javascript:alert(1)' })
      );
      expect(body.success).toBe(false);
      // Either "Invalid baseUrl" or "Unsupported protocol" depending on URL parser
      expect(body.success).toBe(false);
    });

    it('blocks SSRF targets', async () => {
      mockIsSsrfTarget.mockResolvedValue(true);

      const body = parseJson(
        await handlers.handleApiProbeBatch({
          baseUrl: 'http://169.254.169.254',
          paths: ['/latest/meta-data'],
        })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('Blocked');
      expect(body.error).toContain('private/reserved');
    });

    it('returns error when paths array is empty', async () => {
      const body = parseJson(
        await handlers.handleApiProbeBatch({
          baseUrl: 'https://api.example.com',
          paths: [],
        })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('paths array is required');
    });

    it('returns error when paths is missing', async () => {
      const body = parseJson(
        await handlers.handleApiProbeBatch({
          baseUrl: 'https://api.example.com',
        })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('paths array is required');
    });

    it('parses paths from JSON string', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} })
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: JSON.stringify(['/api/v1/users']),
      });

      expect(deps.browserHandlers.handlePageEvaluate).toHaveBeenCalledOnce();
    });

    it('evaluates probe code in browser context', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue(
        makeTextResult({ probed: 2, method: 'GET', results: {} })
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: ['/api/v1/users', '/api/v1/products'],
        method: 'GET',
      });

      expect(deps.browserHandlers.handlePageEvaluate).toHaveBeenCalledOnce();
      const call = (deps.browserHandlers.handlePageEvaluate as any).mock.calls[0][0];
      expect(call.code).toContain('api.example.com');
      expect(call.code).toContain('users');
      expect(call.code).toContain('products');
    });

    it('normalizes trailing slash on baseUrl', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} })
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com/',
        paths: ['/test'],
      });

      const call = (deps.browserHandlers.handlePageEvaluate as any).mock.calls[0][0];
      // The baseUrl should not have trailing slash in the injected code
      expect(call.code).toContain('"https://api.example.com"');
    });

    it('uses GET method by default', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} })
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: ['/test'],
      });

      const call = (deps.browserHandlers.handlePageEvaluate as any).mock.calls[0][0];
      expect(call.code).toContain('"GET"');
    });

    it('uppercases custom method', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} })
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: ['/test'],
        method: 'post',
      });

      const call = (deps.browserHandlers.handlePageEvaluate as any).mock.calls[0][0];
      expect(call.code).toContain('"POST"');
    });

    it('includes custom headers in probe code', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} })
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: ['/test'],
        headers: { 'X-Custom': 'value' },
      });

      const call = (deps.browserHandlers.handlePageEvaluate as any).mock.calls[0][0];
      expect(call.code).toContain('X-Custom');
    });

    it('includes bodyTemplate for POST methods', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} })
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: ['/test'],
        method: 'POST',
        bodyTemplate: '{"key":"value"}',
      });

      const call = (deps.browserHandlers.handlePageEvaluate as any).mock.calls[0][0];
      expect(call.code).toContain('bodyTemplate');
    });

    it('handles evaluation error gracefully', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockRejectedValue(
        new Error('Page navigation timeout')
      );

      const body = parseJson(
        await handlers.handleApiProbeBatch({
          baseUrl: 'https://api.example.com',
          paths: ['/test'],
        })
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('Page navigation timeout');
    });

    it('clamps maxBodySnippetLength to 10000', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} })
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: ['/test'],
        maxBodySnippetLength: 99999,
      });

      const call = (deps.browserHandlers.handlePageEvaluate as any).mock.calls[0][0];
      expect(call.code).toContain('10000');
    });

    it('uses default includeBodyStatuses of [200, 201, 204]', async () => {
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue(
        makeTextResult({ probed: 1, results: {} })
      );

      await handlers.handleApiProbeBatch({
        baseUrl: 'https://api.example.com',
        paths: ['/test'],
      });

      const call = (deps.browserHandlers.handlePageEvaluate as any).mock.calls[0][0];
      expect(call.code).toContain('[200,201,204]');
    });

    it('returns non-string baseUrl as error', async () => {
      const body = parseJson(
        await handlers.handleApiProbeBatch({ baseUrl: 12345, paths: ['/test'] })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('baseUrl is required');
    });
  });

  // ── handleWebApiCaptureSession ───────────────────────────────────

  describe('handleWebApiCaptureSession', () => {
    function setupSuccessfulCapture() {
      (deps.advancedHandlers.handleNetworkEnable as any).mockResolvedValue(
        makeTextResult({ success: true })
      );
      (deps.advancedHandlers.handleConsoleInjectFetchInterceptor as any).mockResolvedValue(
        makeTextResult({ success: true })
      );
      (deps.advancedHandlers.handleConsoleInjectXhrInterceptor as any).mockResolvedValue(
        makeTextResult({ success: true })
      );
      (deps.browserHandlers.handlePageNavigate as any).mockResolvedValue(
        makeTextResult({ success: true })
      );
      (deps.advancedHandlers.handleNetworkGetStats as any).mockResolvedValue(
        makeTextResult({ stats: { totalRequests: 5 } })
      );
      (deps.advancedHandlers.handleNetworkGetRequests as any).mockResolvedValue(
        makeTextResult({ stats: { total: 5 }, detailId: undefined })
      );
      (deps.advancedHandlers.handleNetworkExtractAuth as any).mockResolvedValue(
        makeTextResult({ found: 1, findings: [{ type: 'bearer', confidence: 0.9 }] })
      );
      (deps.advancedHandlers.handleNetworkExportHar as any).mockResolvedValue(
        makeTextResult({ success: true })
      );
    }

    it('performs all workflow steps in order', async () => {
      setupSuccessfulCapture();

      const body = parseJson(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        })
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

      const body = parseJson(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        })
      );

      expect(body.summary.capturedRequests).toBe(5);
    });

    it('includes auth findings in response', async () => {
      setupSuccessfulCapture();

      const body = parseJson(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        })
      );

      expect(body.authFindings).toHaveLength(1);
      expect(body.authFindings[0].type).toBe('bearer');
    });

    it('performs click action', async () => {
      setupSuccessfulCapture();
      (deps.browserHandlers.handlePageClick as any).mockResolvedValue(
        makeTextResult({ success: true })
      );

      const body = parseJson(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          actions: [{ type: 'click', selector: '#login-btn' }],
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        })
      );

      expect(body.success).toBe(true);
      expect(body.steps).toContain('page_click(#login-btn)');
      expect(deps.browserHandlers.handlePageClick).toHaveBeenCalledWith({ selector: '#login-btn' });
    });

    it('performs type action', async () => {
      setupSuccessfulCapture();
      (deps.browserHandlers.handlePageType as any).mockResolvedValue(
        makeTextResult({ success: true })
      );

      const body = parseJson(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          actions: [{ type: 'type', selector: '#email', text: 'test@example.com' }],
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        })
      );

      expect(body.success).toBe(true);
      expect(deps.browserHandlers.handlePageType).toHaveBeenCalledOnce();
    });

    it('performs evaluate action', async () => {
      setupSuccessfulCapture();
      (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue(
        makeTextResult({ value: 'ok' })
      );

      const body = parseJson(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          actions: [{ type: 'evaluate', expression: 'document.title' }],
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        })
      );

      expect(body.success).toBe(true);
      expect(deps.browserHandlers.handlePageEvaluate).toHaveBeenCalledOnce();
    });

    it('records warnings for failed actions without aborting', async () => {
      setupSuccessfulCapture();
      (deps.browserHandlers.handlePageClick as any).mockRejectedValue(
        new Error('Element not found')
      );

      const body = parseJson(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          actions: [{ type: 'click', selector: '#missing' }],
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        })
      );

      expect(body.success).toBe(true);
      expect(body.warnings).toBeDefined();
      expect(body.warnings.some((w: string) => w.includes('Element not found'))).toBe(true);
    });

    it('parses actions from JSON string', async () => {
      setupSuccessfulCapture();
      (deps.browserHandlers.handlePageClick as any).mockResolvedValue(
        makeTextResult({ success: true })
      );

      const body = parseJson(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          actions: JSON.stringify([{ type: 'click', selector: '#btn' }]),
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        })
      );

      expect(body.success).toBe(true);
      expect(deps.browserHandlers.handlePageClick).toHaveBeenCalledOnce();
    });

    it('filters out invalid action types', async () => {
      setupSuccessfulCapture();

      const body = parseJson(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          actions: [{ type: 'invalid_action', selector: '#btn' }],
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        })
      );

      expect(body.success).toBe(true);
      // Invalid action should be filtered out
      expect(deps.browserHandlers.handlePageClick).not.toHaveBeenCalled();
    });

    it('returns error when network_get_stats fails', async () => {
      (deps.advancedHandlers.handleNetworkEnable as any).mockResolvedValue(
        makeTextResult({ success: true })
      );
      (deps.advancedHandlers.handleConsoleInjectFetchInterceptor as any).mockResolvedValue(
        makeTextResult({ success: true })
      );
      (deps.advancedHandlers.handleConsoleInjectXhrInterceptor as any).mockResolvedValue(
        makeTextResult({ success: true })
      );
      (deps.browserHandlers.handlePageNavigate as any).mockResolvedValue(
        makeTextResult({ success: true })
      );
      (deps.advancedHandlers.handleNetworkGetStats as any).mockResolvedValue({
        content: [{ type: 'text', text: undefined }],
      });

      const body = parseJson(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        })
      );

      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    it('skips HAR export when exportHar is false', async () => {
      setupSuccessfulCapture();

      const body = parseJson(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        })
      );

      expect(body.success).toBe(true);
      expect(body.summary.harExported).toBe('skipped');
      expect(deps.advancedHandlers.handleNetworkExportHar).not.toHaveBeenCalled();
    });

    it('skips report export when exportReport is false', async () => {
      setupSuccessfulCapture();

      const body = parseJson(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        })
      );

      expect(body.success).toBe(true);
      expect(body.summary.reportExported).toBe('skipped');
    });

    it('returns detailId hint when requests payload has detailId', async () => {
      setupSuccessfulCapture();
      (deps.advancedHandlers.handleNetworkGetRequests as any).mockResolvedValue(
        makeTextResult({ stats: { total: 100 }, detailId: 'detail-abc' })
      );

      const body = parseJson(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          exportHar: false,
          exportReport: false,
          waitAfterActionsMs: 0,
        })
      );

      expect(body.requestStats.detailId).toBe('detail-abc');
      expect(body.requestStats.hint).toContain('get_detailed_data');
    });

    it('handles overall workflow error gracefully', async () => {
      (deps.advancedHandlers.handleNetworkEnable as any).mockRejectedValue(
        new Error('CDP connection lost')
      );

      const body = parseJson(
        await handlers.handleWebApiCaptureSession({
          url: 'https://example.com',
          waitAfterActionsMs: 0,
        })
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('CDP connection lost');
      expect(body.steps).toBeDefined();
    });
  });
});
