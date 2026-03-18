import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebuggerManager, RuntimeInspector } from '@server/domains/shared/modules';
import { ScopeInspectionHandlers } from '@server/domains/debugger/handlers/scope-inspection';

function parseJson(response: { content: Array<{ text: string }> }) {
  const firstContent = response.content[0];
  if (!firstContent) {
    throw new Error('Missing response content');
  }
  return JSON.parse(firstContent.text);
}

describe('ScopeInspectionHandlers', () => {
  type ScopeDebuggerManager = Pick<
    DebuggerManager,
    'getScopeVariables' | 'getObjectPropertiesById'
  >;

  const debuggerManager = {
    getScopeVariables: vi.fn(
      async (
        _options?: Parameters<DebuggerManager['getScopeVariables']>[0]
      ): Promise<Awaited<ReturnType<DebuggerManager['getScopeVariables']>>> => ({
        success: true,
        variables: [],
        callFrameId: 'frame-default',
        totalScopes: 0,
        successfulScopes: 0,
      })
    ),
    getObjectPropertiesById: vi.fn(
      async (
        _objectId: string
      ): Promise<Awaited<ReturnType<DebuggerManager['getObjectPropertiesById']>>> => []
    ),
  } satisfies ScopeDebuggerManager;
  const runtimeInspector = {} as unknown as RuntimeInspector;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards scope inspection arguments and returns the raw payload', async () => {
    debuggerManager.getScopeVariables.mockResolvedValueOnce({
      success: true,
      variables: [{ name: 'token', value: 'abc', type: 'string', scope: 'local' }],
      callFrameId: 'frame-1',
      totalScopes: 1,
      successfulScopes: 1,
    });
    const handlers = new ScopeInspectionHandlers({
      debuggerManager,
      runtimeInspector,
    } as any);

    const body = parseJson(
      await handlers.handleGetScopeVariablesEnhanced({
        callFrameId: 'frame-1',
        includeObjectProperties: true,
        maxDepth: 3,
      })
    );

    expect(debuggerManager.getScopeVariables).toHaveBeenCalledWith({
      callFrameId: 'frame-1',
      includeObjectProperties: true,
      maxDepth: 3,
      skipErrors: true,
    });
    expect(body).toEqual({
      success: true,
      variables: [{ name: 'token', value: 'abc', type: 'string', scope: 'local' }],
      callFrameId: 'frame-1',
      totalScopes: 1,
      successfulScopes: 1,
    });
  });

  it('returns a structured error when scope inspection fails', async () => {
    debuggerManager.getScopeVariables.mockRejectedValueOnce(new Error('scope failed'));
    const handlers = new ScopeInspectionHandlers({
      debuggerManager,
      runtimeInspector,
    } as any);

    const body = parseJson(await handlers.handleGetScopeVariablesEnhanced({}));

    expect(body).toEqual({
      success: false,
      message: 'scope failed',
      error: 'Error: scope failed',
    });
  });

  it('validates objectId before reading object properties', async () => {
    const handlers = new ScopeInspectionHandlers({
      debuggerManager,
      runtimeInspector,
    } as any);

    const body = parseJson(await handlers.handleGetObjectProperties({}));

    expect(body).toEqual({
      success: false,
      message: 'objectId parameter is required',
    });
  });

  it('returns object properties when a valid object id is provided', async () => {
    debuggerManager.getObjectPropertiesById.mockResolvedValueOnce([
      { name: 'answer', value: 42, type: 'number' },
    ]);
    const handlers = new ScopeInspectionHandlers({
      debuggerManager,
      runtimeInspector,
    } as any);

    const body = parseJson(await handlers.handleGetObjectProperties({ objectId: 'obj-1' }));

    expect(debuggerManager.getObjectPropertiesById).toHaveBeenCalledWith('obj-1');
    expect(body).toEqual({
      success: true,
      propertyCount: 1,
      properties: [{ name: 'answer', value: 42, type: 'number' }],
    });
  });

  it('returns a structured error when reading object properties fails', async () => {
    debuggerManager.getObjectPropertiesById.mockRejectedValueOnce('broken');
    const handlers = new ScopeInspectionHandlers({
      debuggerManager,
      runtimeInspector,
    } as any);

    const body = parseJson(await handlers.handleGetObjectProperties({ objectId: 'obj-1' }));

    expect(body).toEqual({
      success: false,
      message: 'Failed to get object properties',
      error: 'broken',
    });
  });
});
