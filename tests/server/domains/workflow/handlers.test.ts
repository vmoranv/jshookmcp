import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowHandlers } from '../../../../src/server/domains/workflow/handlers.js';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('WorkflowHandlers', () => {
  const deps = {
    browserHandlers: {
      handlePageEvaluate: vi.fn(),
      handlePageNavigate: vi.fn(),
      handleNetworkGetRequests: vi.fn(),
    },
    advancedHandlers: {},
  } as any;

  let handlers: WorkflowHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
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
});

