import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BreakpointBasicHandlers } from '@server/domains/debugger/handlers/breakpoint-basic';


describe('BreakpointBasicHandlers', () => {
  const debuggerManager = {
    setBreakpointByUrl: vi.fn(),
    setBreakpoint: vi.fn(),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    const body = parseJson<any>(
      await handlers.handleBreakpointSet({
        url: 'app.js',
        lineNumber: 10,
        columnNumber: 2,
        condition: 'x > 1',
      })
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    const body = parseJson<any>(
      await handlers.handleBreakpointSet({
        scriptId: '42',
        lineNumber: 8,
      })
    );

    expect(debuggerManager.setBreakpoint).toHaveBeenCalledWith({
      scriptId: '42',
      lineNumber: 8,
      columnNumber: undefined,
      condition: undefined,
    });
    expect(body.breakpoint.breakpointId).toBe('bp-script');
  });

  it('throws when neither url nor scriptId is provided', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    await expect(handlers.handleBreakpointSet({ lineNumber: 1 })).rejects.toThrow(
      'Either url or scriptId must be provided'
    );
  });

  it('removes a breakpoint by id', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new BreakpointBasicHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleBreakpointList({}));

    expect(body).toEqual({
      count: 1,
      breakpoints: [
        {
          breakpointId: 'bp-1',
          location: { url: 'app.js', lineNumber: 3 },
          condition: 'ready',
          enabled: true,
          hitCount: 7,
        },
      ],
    });
  });
});
