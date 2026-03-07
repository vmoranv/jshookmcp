import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSsrfTargetMock = vi.fn(async () => false);
const isPrivateHostMock = vi.fn(() => false);
const lookupMock = vi.fn();

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: (...args: any[]) => isSsrfTargetMock(...args),
  isPrivateHost: (...args: any[]) => isPrivateHostMock(...args),
}));

vi.mock('node:dns/promises', () => ({
  lookup: (...args: any[]) => lookupMock(...args),
}));

import { WorkflowHandlers } from '@server/domains/workflow/handlers';
import type { WorkflowContract } from '@server/workflows/WorkflowContract';
import { toolNode } from '@server/workflows/WorkflowContract';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('WorkflowHandlers', () => {
  const fetchMock = vi.fn();
  const deps = {
    browserHandlers: {
      handlePageEvaluate: vi.fn(),
      handlePageNavigate: vi.fn(),
      handleNetworkGetRequests: vi.fn(),
    },
    advancedHandlers: {},
    serverContext: {
      extensionWorkflowsById: new Map(),
      extensionWorkflowRuntimeById: new Map(),
      executeToolWithTracking: vi.fn(),
      currentTier: 'workflow',
      config: {},
    },
  } as any;

  let handlers: WorkflowHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    isSsrfTargetMock.mockResolvedValue(false);
    isPrivateHostMock.mockReturnValue(false);
    handlers = new WorkflowHandlers(deps);
  });

  it('validates page_script_register required fields', async () => {
    const body = parseJson(await handlers.handlePageScriptRegister({ name: '', code: '' }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('name and code are required');
  });

  it('registers a custom page script', async () => {
    const body = parseJson(
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
    const body = parseJson(await handlers.handlePageScriptRun({ name: 'nope' }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('not found');
    expect(Array.isArray(body.available)).toBe(true);
  });

  it('runs registered script through browser handlePageEvaluate', async () => {
    deps.browserHandlers.handlePageEvaluate.mockResolvedValue({
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
    const payload = deps.browserHandlers.handlePageEvaluate.mock.calls[0]?.[0];
    expect(payload.code).toContain('__params__');
    expect(response.content[0].type).toBe('text');
  });

  it('returns execution error when page script run throws', async () => {
    deps.browserHandlers.handlePageEvaluate.mockRejectedValue(new Error('eval failed'));
    await handlers.handlePageScriptRegister({
      name: 'script_fail',
      code: '(() => 1)()',
    });

    const body = parseJson(await handlers.handlePageScriptRun({ name: 'script_fail' }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('eval failed');
    expect(body.script).toBe('script_fail');
  });

  it('validates api_probe_batch baseUrl', async () => {
    const body = parseJson(await handlers.handleApiProbeBatch({}));
    expect(body.success).toBe(false);
    expect(body.error).toContain('baseUrl is required');
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

    const body = parseJson(await handlers.handleListExtensionWorkflows());
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.workflows[0].id).toBe('workflow.demo.v1');
  });

  it('executes a loaded extension workflow with node input overrides', async () => {
    const workflow: WorkflowContract = {
      kind: 'workflow-contract',
      version: 1,
      id: 'workflow.demo.v1',
      displayName: 'Demo Workflow',
      build() {
        return toolNode('demo-node', 'demo_tool', {
          input: { value: 'base' },
        });
      },
    };

    deps.serverContext.extensionWorkflowsById.set('workflow.demo.v1', {
      id: 'workflow.demo.v1',
      displayName: 'Demo Workflow',
      source: 'fixtures/demo.workflow.ts',
    });
    deps.serverContext.extensionWorkflowRuntimeById.set('workflow.demo.v1', {
      workflow,
      source: 'fixtures/demo.workflow.ts',
    });
    deps.serverContext.executeToolWithTracking.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true, echoed: true }) }],
    });

    const body = parseJson(await handlers.handleRunExtensionWorkflow({
      workflowId: 'workflow.demo.v1',
      nodeInputOverrides: {
        'demo-node': { value: 'override' },
      },
    }));

    expect(body.success).toBe(true);
    expect(body.workflowId).toBe('workflow.demo.v1');
    expect(deps.serverContext.executeToolWithTracking).toHaveBeenCalledWith('demo_tool', { value: 'override' });
    expect(body.stepResults['demo-node']).toBeDefined();
  });

  it('keeps https bundle fetches on hostname to preserve TLS validation', async () => {
    lookupMock.mockResolvedValue({ address: '203.0.113.10', family: 4 });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: vi.fn(() => null) },
      text: vi.fn(async () => 'const token = "abc";'),
    });

    const body = parseJson(await handlers.handleJsBundleSearch({
      url: 'https://assets.example.com/main.js',
      patterns: [{ name: 'auth', regex: 'token' }],
    }));

    expect(body.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://assets.example.com/main.js',
      expect.objectContaining({
        redirect: 'manual',
        headers: {},
      })
    );
  });

  it('pins http bundle fetches to the resolved IP with Host preserved', async () => {
    lookupMock.mockResolvedValue({ address: '203.0.113.10', family: 4 });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: vi.fn(() => null) },
      text: vi.fn(async () => 'const token = "abc";'),
    });

    const body = parseJson(await handlers.handleJsBundleSearch({
      url: 'http://assets.example.com/main.js',
      patterns: [{ name: 'auth', regex: 'token' }],
    }));

    expect(body.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://203.0.113.10/main.js',
      expect.objectContaining({
        redirect: 'manual',
        headers: { Host: 'assets.example.com' },
      })
    );
  });
});
