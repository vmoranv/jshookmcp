import { parseJson, WorkflowRunResponse } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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

import { WorkflowHandlers } from '@server/domains/workflow/handlers';
import { createWorkflow, ToolNodeBuilder, type WorkflowContract } from '@server/workflows/WorkflowContract';

interface PageScriptResponse {
  success: boolean;
  error?: string;
  name?: string;
  action?: string;
  description?: string;
  available?: string[];
  script?: string;
  value?: unknown;
}

interface ApiProbeResponse {
  success: boolean;
  error?: string;
  probed?: number;
  results?: Record<string, unknown>;
}

interface WebApiCaptureResponse {
  success: boolean;
  error?: string;
  steps: string[];
  summary: {
    capturedRequests: number;
    succeeded?: number;
    failed?: number;
  };
  authFindings: Array<{ type: string; confidence: number }>;
  requestStats: {
    detailId?: string;
    hint?: string;
  };
  warnings?: string[];
}

interface ListWorkflowsResponse {
  success: boolean;
  count: number;
  workflows: Array<{ id: string }>;
}

interface RunWorkflowResponse {
  success: boolean;
  workflowId: string;
  stepResults: Record<string, unknown>;
}

interface BundleSearchResponse {
  success: boolean;
  error?: string;
}

function buildReservedDocIpv4(): string {
  return [203, 0, 113, 10].map(String).join('.');
}

describe('WorkflowHandlers', () => {
  const fetchMock = vi.fn();
  const deps = {
    browserHandlers: {
      handlePageEvaluate: vi.fn(),
      handlePageNavigate: vi.fn(),
      handlePageClick: vi.fn(),
      handlePageType: vi.fn(),
      handleNetworkGetRequests: vi.fn(),
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
      executeToolWithTracking: vi.fn(),
      baseTier: 'workflow',
      config: {},
    },
  };

  let handlers: WorkflowHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    mockIsSsrfTarget.mockResolvedValue(false);
    mockIsPrivateHost.mockReturnValue(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (deps.advancedHandlers.handleNetworkGetStats as any).mockResolvedValue({
      content: [
        { type: 'text', text: JSON.stringify({ success: true, stats: { totalRequests: 3 } }) },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (deps.advancedHandlers.handleNetworkGetRequests as any).mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            requests: [{ url: 'https://vmoranv.github.io/jshookmcp/api' }],
          }),
        },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (deps.advancedHandlers.handleNetworkExtractAuth as any).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true, findings: [] }) }],
    });
    handlers = new WorkflowHandlers(deps as unknown as ConstructorParameters<typeof WorkflowHandlers>[0]);
  });

  it('validates page_script_register required fields', async () => {
    const body = parseJson<PageScriptResponse>(
      await handlers.handlePageScriptRegister({ name: '', code: '' })
    );
    expect(body.success).toBe(false);
    expect(body.error).toContain('name and code are required');
  });

  it('registers a custom page script', async () => {
    const body = parseJson<PageScriptResponse>(
      await handlers.handlePageScriptRegister({
        name: 'my_script',
        code: '(() => 123)()',
        description: 'demo',
      })
    );
    expect(body.success).toBe(true);
    expect(body.name).toBe('my_script');
    expect(body.action).toBe('registered');
  });

  it('returns available scripts when script is missing', async () => {
    const body = parseJson<PageScriptResponse>(await handlers.handlePageScriptRun({ name: 'nope' }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('not found');
    expect(Array.isArray(body.available)).toBe(true);
  });

  it('runs registered script through browser handlePageEvaluate', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true, value: 123 }) }],
    });

    await handlers.handlePageScriptRegister({
      name: 'script_ok',
      code: '(function(){ return { ok: true }; })()',
    });

    const response = await handlers.handlePageScriptRun({
      name: 'script_ok',
      params: { a: 1 },
    });
    expect(deps.browserHandlers.handlePageEvaluate).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const payload = (deps.browserHandlers.handlePageEvaluate as unknown).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(String(payload.code)).toContain('__params__');
    expect(response.content[0]!.type).toBe('text');
  });

  it('returns execution error when page script run throws', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (deps.browserHandlers.handlePageEvaluate as any).mockRejectedValue(new Error('eval failed'));
    await handlers.handlePageScriptRegister({
      name: 'script_fail',
      code: '(() => 1)()',
    });

    const body = parseJson<PageScriptResponse>(
      await handlers.handlePageScriptRun({ name: 'script_fail' })
    );
    expect(body.success).toBe(false);
    expect(body.error).toContain('eval failed');
    expect(body.script).toBe('script_fail');
  });

  it('validates api_probe_batch baseUrl', async () => {
    const body = parseJson<ApiProbeResponse>(await handlers.handleApiProbeBatch({}));
    expect(body.success).toBe(false);
    expect(body.error).toContain('baseUrl is required');
  });

  it('builds api_probe_batch page code with concurrent probing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (deps.browserHandlers.handlePageEvaluate as any).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true, probed: 2, results: {} }) }],
    });

    await handlers.handleApiProbeBatch({
      baseUrl: 'https://vmoranv.github.io/jshookmcp',
      paths: ['/a', '/b'],
      method: 'GET',
    });

    expect(deps.browserHandlers.handlePageEvaluate).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const payload = (deps.browserHandlers.handlePageEvaluate as unknown).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(String(payload.code)).toContain('Promise.all');
    expect(String(payload.code)).toContain('maxConcurrency');
  });

  it('executes web_api_capture_session without exporting files', async () => {
    const body = parseJson<WebApiCaptureResponse>(
      await handlers.handleWebApiCaptureSession({
        url: 'https://vmoranv.github.io/jshookmcp',
        waitUntil: 'domcontentloaded',
        actions: [{ type: 'click', selector: 'button.capture' }],
        exportHar: false,
        exportReport: false,
        waitAfterActionsMs: 0,
      })
    );

    expect(body.success).toBe(true);
    expect(deps.advancedHandlers.handleNetworkEnable).toHaveBeenCalledOnce();
    expect(deps.browserHandlers.handlePageNavigate).toHaveBeenCalledWith({
      url: 'https://vmoranv.github.io/jshookmcp',
      waitUntil: 'domcontentloaded',
      enableNetworkMonitoring: true,
    });
    expect(deps.browserHandlers.handlePageClick).toHaveBeenCalledWith({
      selector: 'button.capture',
    });
  });

  it('retries batch_register accounts and summarizes success', async () => {
    const successResult = {
      content: [{ type: 'text', text: JSON.stringify({ success: true, verified: true }) }],
    };
    const failureResult = {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'temporary' }) }],
    };

    const flowSpy = vi
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .spyOn(handlers as any, 'handleRegisterAccountFlow')
      .mockResolvedValueOnce(failureResult)
      .mockResolvedValueOnce(successResult);

    const body = parseJson<WebApiCaptureResponse>(
      await handlers.handleBatchRegister({
        registerUrl: 'https://vmoranv.github.io/jshookmcp/register',
        accounts: [{ fields: { email: 'alice@example.com', password: 'secret' } }],
        maxRetries: 1,
        retryBackoffMs: 0,
        timeoutPerAccountMs: 5000,
      })
    );

    expect(flowSpy).toHaveBeenCalledTimes(2);
    expect(body.success).toBe(true);
    expect(body.summary.succeeded).toBe(1);
    expect(body.summary.failed).toBe(0);
  });

  it('lists loaded extension workflows', async () => {
    deps.serverContext.extensionWorkflowsById.set('workflow.demo.v1', {
      id: 'workflow.demo.v1',
      displayName: 'Demo Workflow',
      source: 'fixtures/demo.workflow.ts',
      description: 'demo description',
      tags: ['demo'],
      timeoutMs: 5000,
      defaultMaxConcurrency: 2,
    });

    const body = parseJson<ListWorkflowsResponse>(await handlers.handleListExtensionWorkflows());
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.workflows[0].id).toBe('workflow.demo.v1');
  });

  it('executes a loaded extension workflow with node input overrides', async () => {
    const workflow: WorkflowContract = createWorkflow('workflow.demo.v1', 'Demo Workflow')
      .buildGraph(() => new ToolNodeBuilder('demo-node', 'demo_tool').input({ value: 'base' }))
      .build();

    deps.serverContext.extensionWorkflowsById.set('workflow.demo.v1', {
      id: 'workflow.demo.v1',
      displayName: 'Demo Workflow',
      source: 'fixtures/demo.workflow.ts',
    });
    deps.serverContext.extensionWorkflowRuntimeById.set('workflow.demo.v1', {
      workflow,
      source: 'fixtures/demo.workflow.ts',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (deps.serverContext.executeToolWithTracking as any).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true, echoed: true }) }],
    });

    const body = parseJson<RunWorkflowResponse>(
      await handlers.handleRunExtensionWorkflow({
        workflowId: 'workflow.demo.v1',
        nodeInputOverrides: {
          'demo-node': { value: 'override' },
        },
      })
    );

    expect(body.success).toBe(true);
    expect(body.workflowId).toBe('workflow.demo.v1');
    expect(deps.serverContext.executeToolWithTracking).toHaveBeenCalledWith('demo_tool', {
      value: 'override',
    });
    expect(body.stepResults['demo-node']).toBeDefined();
  });

  it('keeps https bundle fetches on hostname to preserve TLS validation', async () => {
    mockLookup.mockResolvedValue({ address: buildReservedDocIpv4(), family: 4 });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: vi.fn(() => null) },
      text: vi.fn(async () => 'const token = "abc";'),
    });

    const body = parseJson<BundleSearchResponse>(
      await handlers.handleJsBundleSearch({
        url: 'https://vmoranv.github.io/jshookmcp/assets/main.js',
        patterns: [{ name: 'auth', regex: 'token' }],
      })
    );

    expect(body.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://vmoranv.github.io/jshookmcp/assets/main.js',
      expect.objectContaining({
        redirect: 'manual',
        headers: {},
      })
    );
  });

  it('blocks remote http bundle fetches unless they are loopback', async () => {
    const resolvedAddress = buildReservedDocIpv4();
    mockLookup.mockResolvedValue({ address: resolvedAddress, family: 4 });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: vi.fn(() => null) },
      text: vi.fn(async () => 'const token = "abc";'),
    });

    const body = parseJson<BundleSearchResponse>(
      await handlers.handleJsBundleSearch({
        url: 'http://vmoranv.github.io/jshookmcp/assets/main.js',
        patterns: [{ name: 'auth', regex: 'token' }],
      })
    );

    expect(body.success).toBe(false);
    expect(body.error).toContain('insecure HTTP is only allowed for loopback targets');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
