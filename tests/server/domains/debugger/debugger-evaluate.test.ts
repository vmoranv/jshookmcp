import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebuggerEvaluateHandlers } from '@server/domains/debugger/handlers/debugger-evaluate';
import type { RuntimeInspector } from '@server/domains/shared/modules';

type EvaluateRuntimeInspector = Pick<RuntimeInspector, 'evaluate' | 'evaluateGlobal'>;

function parseJson(response: { content: Array<{ text: string }> }): unknown {
  const firstContent = response.content[0];
  expect(firstContent).toBeDefined();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  return JSON.parse(firstContent!.text) as any;
}

describe('DebuggerEvaluateHandlers', () => {
  const runtimeInspector = {
    evaluate: vi.fn<EvaluateRuntimeInspector['evaluate']>(),
    evaluateGlobal: vi.fn<EvaluateRuntimeInspector['evaluateGlobal']>(),
  } satisfies EvaluateRuntimeInspector;

  function createHandlers() {
    return new DebuggerEvaluateHandlers({
      runtimeInspector: runtimeInspector as unknown as RuntimeInspector,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('evaluates an expression in a call frame', async () => {
    runtimeInspector.evaluate.mockResolvedValueOnce({ type: 'number', value: 5 } as Awaited<
      ReturnType<EvaluateRuntimeInspector['evaluate']>
    >);
    const handlers = createHandlers();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(
      await handlers.handleDebuggerEvaluate({
        expression: 'a + b',
        callFrameId: 'frame-1',
      })
    );

    expect(runtimeInspector.evaluate).toHaveBeenCalledWith('a + b', 'frame-1');
    expect(body).toEqual({
      success: true,
      expression: 'a + b',
      result: { type: 'number', value: 5 },
    });
  });

  it('evaluates a global expression', async () => {
    runtimeInspector.evaluateGlobal.mockResolvedValueOnce({
      type: 'string',
      value: 'ok',
    } as Awaited<ReturnType<EvaluateRuntimeInspector['evaluateGlobal']>>);
    const handlers = createHandlers();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(
      await handlers.handleDebuggerEvaluateGlobal({ expression: 'window.name' })
    );

    expect(runtimeInspector.evaluateGlobal).toHaveBeenCalledWith('window.name');
    expect(body).toEqual({
      success: true,
      expression: 'window.name',
      result: { type: 'string', value: 'ok' },
    });
  });

  it('propagates runtime inspector evaluation errors', async () => {
    runtimeInspector.evaluate.mockRejectedValueOnce(new Error('eval failed'));
    const handlers = createHandlers();

    await expect(handlers.handleDebuggerEvaluate({ expression: 'boom()' })).rejects.toThrow(
      'eval failed'
    );
  });
});
