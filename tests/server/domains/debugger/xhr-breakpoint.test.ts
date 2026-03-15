// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { XHRBreakpointHandlers } from '@server/domains/debugger/handlers/xhr-breakpoint';

function parseJson(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

describe('XHRBreakpointHandlers', () => {
  const xhrManager = {
    setXHRBreakpoint: vi.fn(),
    removeXHRBreakpoint: vi.fn(),
    getAllXHRBreakpoints: vi.fn(),
  };

  function createDebuggerManager(withAdvancedFeatures = true) {
    return {
      getXHRManager: vi.fn(() => xhrManager),
      ...(withAdvancedFeatures
        ? {
            ensureAdvancedFeatures: vi.fn().mockResolvedValue(undefined),
          }
        : {}),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets an XHR breakpoint and initializes advanced features when supported', async () => {
    const debuggerManager = createDebuggerManager(true);
    xhrManager.setXHRBreakpoint.mockResolvedValueOnce('xhr-1');
    const handlers = new XHRBreakpointHandlers({ debuggerManager } as any);

    const body = parseJson(
      await handlers.handleXHRBreakpointSet({ urlPattern: '/api/' })
    );

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
    const handlers = new XHRBreakpointHandlers({ debuggerManager } as any);

    const body = parseJson(
      await handlers.handleXHRBreakpointRemove({ breakpointId: 'missing' })
    );

    expect(body).toEqual({
      success: false,
      message: 'XHR breakpoint not found',
      breakpointId: 'missing',
    });
  });

  it('returns a structured failure when setting an XHR breakpoint fails', async () => {
    const debuggerManager = createDebuggerManager(true);
    xhrManager.setXHRBreakpoint.mockRejectedValueOnce(new Error('xhr boom'));
    const handlers = new XHRBreakpointHandlers({ debuggerManager } as any);

    const body = parseJson(
      await handlers.handleXHRBreakpointSet({ urlPattern: '/broken/' })
    );

    expect(body).toEqual({
      success: false,
      message: 'Failed to set XHR breakpoint',
      error: 'xhr boom',
    });
  });

  it('lists all XHR breakpoints without requiring optional advanced support', async () => {
    const debuggerManager = createDebuggerManager(false);
    xhrManager.getAllXHRBreakpoints.mockReturnValueOnce([
      { breakpointId: 'xhr-1', urlPattern: '/api/' },
    ]);
    const handlers = new XHRBreakpointHandlers({ debuggerManager } as any);

    const body = parseJson(await handlers.handleXHRBreakpointList({}));

    expect(body).toEqual({
      success: true,
      message: 'Found 1 XHR breakpoint(s)',
      breakpoints: [{ breakpointId: 'xhr-1', urlPattern: '/api/' }],
    });
  });
});
