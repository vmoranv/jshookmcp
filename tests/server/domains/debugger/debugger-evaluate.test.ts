import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebuggerEvaluateHandlers } from '@server/domains/debugger/handlers/debugger-evaluate';

function parseJson(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

describe('DebuggerEvaluateHandlers', () => {
  const runtimeInspector = {
    evaluate: vi.fn(),
    evaluateGlobal: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('evaluates an expression in a call frame', async () => {
    runtimeInspector.evaluate.mockResolvedValueOnce({ type: 'number', value: 5 });
    const handlers = new DebuggerEvaluateHandlers({ runtimeInspector } as any);

    const body = parseJson(
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
    });
    const handlers = new DebuggerEvaluateHandlers({ runtimeInspector } as any);

    const body = parseJson(
      await handlers.handleDebuggerEvaluateGlobal({ expression: 'window.name' })
    );

    expect(runtimeInspector.evaluateGlobal).toHaveBeenCalledWith('window.name');
    expect(body.result).toEqual({ type: 'string', value: 'ok' });
  });

  it('propagates runtime inspector evaluation errors', async () => {
    runtimeInspector.evaluate.mockRejectedValueOnce(new Error('eval failed'));
    const handlers = new DebuggerEvaluateHandlers({ runtimeInspector } as any);

    await expect(
      handlers.handleDebuggerEvaluate({ expression: 'boom()' })
    ).rejects.toThrow('eval failed');
  });
});
