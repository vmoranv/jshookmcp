import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebuggerManager } from '@server/domains/shared/modules';
import { XHRBreakpointHandlers } from '@server/domains/debugger/handlers/xhr-breakpoint';


describe('XHRBreakpointHandlers', () => {
  type XhrManager = ReturnType<DebuggerManager['getXHRManager']>;
  type XhrDebuggerManager = Pick<DebuggerManager, 'getXHRManager'> &
    Partial<Pick<DebuggerManager, 'ensureAdvancedFeatures'>>;

  const xhrManager = {
    setXHRBreakpoint: vi.fn(async (_urlPattern: string): Promise<string> => 'xhr-default'),
    removeXHRBreakpoint: vi.fn(async (_breakpointId: string): Promise<boolean> => false),
    getAllXHRBreakpoints: vi.fn((): ReturnType<XhrManager['getAllXHRBreakpoints']> => []),
  };

  function createDebuggerManager(
    withAdvancedFeatures: true
  ): XhrDebuggerManager & Required<Pick<DebuggerManager, 'ensureAdvancedFeatures'>>;
  function createDebuggerManager(withAdvancedFeatures: false): XhrDebuggerManager;
  function createDebuggerManager(withAdvancedFeatures = true): XhrDebuggerManager {
    const debuggerManager: XhrDebuggerManager = {
      getXHRManager: vi.fn((): XhrManager => xhrManager as unknown as XhrManager),
    };

    if (withAdvancedFeatures) {
      debuggerManager.ensureAdvancedFeatures = vi.fn(async (): Promise<void> => undefined);
    }

    return debuggerManager;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets an XHR breakpoint and initializes advanced features when supported', async () => {
    const debuggerManager = createDebuggerManager(true);
    xhrManager.setXHRBreakpoint.mockResolvedValueOnce('xhr-1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new XHRBreakpointHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleXHRBreakpointSet({ urlPattern: '/api/' }));

    expect(debuggerManager.ensureAdvancedFeatures).toHaveBeenCalledOnce();
    expect(xhrManager.setXHRBreakpoint).toHaveBeenCalledWith('/api/');
    expect(body).toEqual({
      success: true,
      message: 'XHR breakpoint set',
      breakpointId: 'xhr-1',
      urlPattern: '/api/',
    });
  });

  it('reports when an XHR breakpoint id is not found during removal', async () => {
    const debuggerManager = createDebuggerManager(true);
    xhrManager.removeXHRBreakpoint.mockResolvedValueOnce(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new XHRBreakpointHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleXHRBreakpointRemove({ breakpointId: 'missing' }));

    expect(body).toEqual({
      success: false,
      message: 'XHR breakpoint not found',
      breakpointId: 'missing',
    });
  });

  it('returns a structured failure when setting an XHR breakpoint fails', async () => {
    const debuggerManager = createDebuggerManager(true);
    xhrManager.setXHRBreakpoint.mockRejectedValueOnce(new Error('xhr boom'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new XHRBreakpointHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleXHRBreakpointSet({ urlPattern: '/broken/' }));

    expect(body).toEqual({
      success: false,
      message: 'Failed to set XHR breakpoint',
      error: 'xhr boom',
    });
  });

  it('lists all XHR breakpoints without requiring optional advanced support', async () => {
    const debuggerManager = createDebuggerManager(false);
    xhrManager.getAllXHRBreakpoints.mockReturnValueOnce([
      {
        id: 'xhr-1',
        urlPattern: '/api/',
        enabled: true,
        hitCount: 0,
        createdAt: 1,
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new XHRBreakpointHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleXHRBreakpointList({}));

    expect(body).toEqual({
      success: true,
      message: 'Found 1 XHR breakpoint(s)',
      breakpoints: [
        {
          id: 'xhr-1',
          urlPattern: '/api/',
          enabled: true,
          hitCount: 0,
          createdAt: 1,
        },
      ],
    });
  });
});
