import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BreakpointBasicHandlers } from '@server/domains/debugger/handlers/breakpoint-basic';

describe('BreakpointBasicHandlers', () => {
  const debuggerManager = {
    setBreakpointByUrl: vi.fn(),
    setBreakpoint: vi.fn(),
    setBreakpointOnFunctionCall: vi.fn(),
    removeBreakpoint: vi.fn(),
    listBreakpoints: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets a breakpoint by url', async () => {
    debuggerManager.setBreakpointByUrl.mockResolvedValueOnce({
      breakpointId: 'bp-url',
      location: { url: 'app.js', lineNumber: 10 },
      condition: 'x > 1',
      enabled: true,
    });
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    const body = parseJson<any>(
      await handlers.handleBreakpointSet({
        url: 'app.js',
        lineNumber: 10,
        columnNumber: 2,
        condition: 'x > 1',
      }),
    );

    expect(debuggerManager.setBreakpointByUrl).toHaveBeenCalledWith({
      url: 'app.js',
      lineNumber: 10,
      columnNumber: 2,
      condition: 'x > 1',
    });
    expect(body).toEqual({
      success: true,
      breakpoint: {
        breakpointId: 'bp-url',
        location: { url: 'app.js', lineNumber: 10 },
        condition: 'x > 1',
        enabled: true,
      },
    });
  });

  it('sets a breakpoint by script id', async () => {
    debuggerManager.setBreakpoint.mockResolvedValueOnce({
      breakpointId: 'bp-script',
      location: { scriptId: '42', lineNumber: 8 },
      condition: undefined,
      enabled: true,
    });
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    const body = parseJson<any>(
      await handlers.handleBreakpointSet({
        scriptId: '42',
        lineNumber: 8,
      }),
    );

    expect(debuggerManager.setBreakpoint).toHaveBeenCalledWith({
      scriptId: '42',
      lineNumber: 8,
      columnNumber: undefined,
      condition: undefined,
    });
    expect(body.breakpoint.breakpointId).toBe('bp-script');
  });

  it('rejects invalid breakpoint conditions before setting by url', async () => {
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    await expect(
      handlers.handleBreakpointSet({
        url: 'app.js',
        lineNumber: 10,
        condition: 'x >',
      }),
    ).rejects.toThrow('Invalid breakpoint condition');

    expect(debuggerManager.setBreakpointByUrl).not.toHaveBeenCalled();
    expect(debuggerManager.setBreakpoint).not.toHaveBeenCalled();
  });

  it('rejects invalid breakpoint conditions before setting by script id', async () => {
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    await expect(
      handlers.handleBreakpointSet({
        scriptId: '42',
        lineNumber: 8,
        condition: 'if (ready) true',
      }),
    ).rejects.toThrow('Invalid breakpoint condition');

    expect(debuggerManager.setBreakpoint).not.toHaveBeenCalled();
    expect(debuggerManager.setBreakpointByUrl).not.toHaveBeenCalled();
  });

  it('throws when neither url nor scriptId is provided', async () => {
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    await expect(handlers.handleBreakpointSet({ lineNumber: 1 })).rejects.toThrow(
      'Either url or scriptId must be provided',
    );
  });

  it('sets a breakpoint on a function name (type=function)', async () => {
    debuggerManager.setBreakpointOnFunctionCall.mockResolvedValueOnce({
      breakpointId: 'bp_fn_1',
      functionName: 'decrypt',
    });
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    const body = parseJson<any>(
      await handlers.handleBreakpointSetOnFunction({ functionName: 'decrypt' }),
    );

    expect(debuggerManager.setBreakpointOnFunctionCall).toHaveBeenCalledWith('decrypt');
    expect(body).toEqual({
      success: true,
      breakpoint: {
        breakpointId: 'bp_fn_1',
        type: 'function',
        functionName: 'decrypt',
      },
    });
  });

  it('trims whitespace before resolving the function name', async () => {
    debuggerManager.setBreakpointOnFunctionCall.mockResolvedValueOnce({
      breakpointId: 'bp_fn_2',
      functionName: 'decrypt',
    });
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    await handlers.handleBreakpointSetOnFunction({ functionName: '  decrypt  ' });

    expect(debuggerManager.setBreakpointOnFunctionCall).toHaveBeenCalledWith('decrypt');
  });

  it('throws when functionName is missing for type=function', async () => {
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    await expect(handlers.handleBreakpointSetOnFunction({})).rejects.toThrow(
      'functionName is required for type=function',
    );
  });

  it('throws when functionName is empty/whitespace for type=function', async () => {
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    await expect(handlers.handleBreakpointSetOnFunction({ functionName: '   ' })).rejects.toThrow(
      'functionName is required for type=function',
    );
  });

  it('sets a breakpoint with logMessage (logpoint)', async () => {
    debuggerManager.setBreakpointByUrl.mockResolvedValueOnce({
      breakpointId: 'bp-log',
      location: { url: 'app.js', lineNumber: 15 },
      condition: undefined,
      logMessage: 'x={x}, y={y}',
      enabled: true,
    });
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    const body = parseJson<any>(
      await handlers.handleBreakpointSet({
        url: 'app.js',
        lineNumber: 15,
        logMessage: 'x={x}, y={y}',
      }),
    );

    expect(debuggerManager.setBreakpointByUrl).toHaveBeenCalledWith({
      url: 'app.js',
      lineNumber: 15,
      columnNumber: undefined,
      condition: undefined,
      logMessage: 'x={x}, y={y}',
    });
    expect(body.breakpoint.logMessage).toBe('x={x}, y={y}');
    expect(body.success).toBe(true);
  });

  it('removes a breakpoint by id', async () => {
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleBreakpointRemove({ breakpointId: 'bp-1' }));

    expect(debuggerManager.removeBreakpoint).toHaveBeenCalledWith('bp-1');
    expect(body).toEqual({
      success: true,
      message: 'Breakpoint bp-1 removed',
    });
  });

  it('lists all breakpoints with hit counts', async () => {
    debuggerManager.listBreakpoints.mockReturnValueOnce([
      {
        breakpointId: 'bp-1',
        location: { url: 'app.js', lineNumber: 3 },
        condition: 'ready',
        enabled: true,
        hitCount: 7,
      },
    ]);
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleBreakpointList({}));

    expect(body).toEqual({
      count: 1,
      breakpoints: [
        {
          breakpointId: 'bp-1',
          location: { url: 'app.js', lineNumber: 3 },
          condition: 'ready',
          logMessage: undefined,
          enabled: true,
          hitCount: 7,
        },
      ],
    });
  });
});
