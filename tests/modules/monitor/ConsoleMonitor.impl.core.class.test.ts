import { beforeEach, describe, expect, it, vi } from 'vitest';

const classState = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  networkInstances: [] as Array<{
    enable: ReturnType<typeof vi.fn>;
    disable: ReturnType<typeof vi.fn>;
    isEnabled: ReturnType<typeof vi.fn>;
    setPage?: ReturnType<typeof vi.fn>;
  }>,
  playwrightInstances: [] as Array<{
    enable: ReturnType<typeof vi.fn>;
    disable: ReturnType<typeof vi.fn>;
    isEnabled: ReturnType<typeof vi.fn>;
    setPage: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@utils/logger', () => ({
  logger: classState.logger,
}));

vi.mock('@modules/monitor/NetworkMonitor', () => {
  class NetworkMonitor {
    public enable = vi.fn(async () => {});
    public disable = vi.fn(async () => {});
    public isEnabled = vi.fn(() => true);
    public getStatus = vi.fn(() => ({
      enabled: true,
      requestCount: 0,
      responseCount: 0,
      listenerCount: 0,
      cdpSessionActive: true,
    }));
    public getRequests = vi.fn(() => []);
    public getResponses = vi.fn(() => []);
    public getActivity = vi.fn(() => ({}));
    public getResponseBody = vi.fn(async () => null);
    public getAllJavaScriptResponses = vi.fn(async () => []);
    public clearRecords = vi.fn();
    public clearInjectedBuffers = vi.fn(async () => ({ xhrCleared: 0, fetchCleared: 0 }));
    public resetInjectedInterceptors = vi.fn(async () => ({ xhrReset: true, fetchReset: true }));
    public getStats = vi.fn(() => ({
      totalRequests: 0,
      totalResponses: 0,
      byMethod: {},
      byStatus: {},
      byType: {},
    }));
    public injectXHRInterceptor = vi.fn(async () => {});
    public injectFetchInterceptor = vi.fn(async () => {});
    public getXHRRequests = vi.fn(async () => []);
    public getFetchRequests = vi.fn(async () => []);

    constructor(_session: unknown) {
      classState.networkInstances.push(this);
    }
  }

  return { NetworkMonitor };
});

vi.mock('@modules/monitor/PlaywrightNetworkMonitor', () => {
  class PlaywrightNetworkMonitor {
    public enable = vi.fn(async () => {});
    public disable = vi.fn(async () => {});
    public isEnabled = vi.fn(() => true);
    public getStatus = vi.fn(() => ({
      enabled: true,
      requestCount: 0,
      responseCount: 0,
      listenerCount: 0,
      cdpSessionActive: false,
    }));
    public getRequests = vi.fn(() => []);
    public getResponses = vi.fn(() => []);
    public getActivity = vi.fn(() => ({}));
    public getResponseBody = vi.fn(async () => null);
    public getAllJavaScriptResponses = vi.fn(async () => []);
    public clearRecords = vi.fn();
    public clearInjectedBuffers = vi.fn(async () => ({ xhrCleared: 0, fetchCleared: 0 }));
    public resetInjectedInterceptors = vi.fn(async () => ({ xhrReset: true, fetchReset: true }));
    public getStats = vi.fn(() => ({
      totalRequests: 0,
      totalResponses: 0,
      byMethod: {},
      byStatus: {},
      byType: {},
    }));
    public injectXHRInterceptor = vi.fn(async () => {});
    public injectFetchInterceptor = vi.fn(async () => {});
    public getXHRRequests = vi.fn(async () => []);
    public getFetchRequests = vi.fn(async () => []);
    public setPage = vi.fn();

    constructor(_page: unknown) {
      classState.playwrightInstances.push(this);
    }
  }

  return { PlaywrightNetworkMonitor };
});

import { ConsoleMonitor } from '@modules/monitor/ConsoleMonitor.impl.core.class';

function createCdpSession() {
  const listeners = new Map<string, Set<(payload: any) => void>>();

  const session = {
    send: vi.fn(async (_method: string) => ({})),
    on: vi.fn((event: string, handler: (payload: any) => void) => {
      const handlers = listeners.get(event) ?? new Set<(payload: any) => void>();
      handlers.add(handler);
      listeners.set(event, handlers);
    }),
    off: vi.fn((event: string, handler: (payload: any) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    detach: vi.fn().mockResolvedValue(undefined),
    emit(event: string, payload?: any) {
      listeners.get(event)?.forEach((handler) => handler(payload));
    },
  };

  return session;
}

describe('ConsoleMonitor.impl.core.class.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    classState.networkInstances.length = 0;
    classState.playwrightInstances.length = 0;
  });

  it('enables CDP mode, captures console and exception events, and attaches network monitoring', async () => {
    const session = createCdpSession();
    const monitor = new ConsoleMonitor({
      getActivePage: vi.fn().mockResolvedValue({
        createCDPSession: vi.fn().mockResolvedValue(session),
      }),
    } as never);

    await monitor.enable({ enableNetwork: true, enableExceptions: true });

    session.emit('Runtime.consoleAPICalled', {
      type: 'warn',
      args: [{ value: 'careful' }],
      timestamp: 123,
      stackTrace: {
        callFrames: [
          {
            functionName: 'handler',
            url: 'https://site/app.js',
            lineNumber: 4,
            columnNumber: 2,
          },
        ],
      },
    });
    session.emit('Runtime.exceptionThrown', {
      exceptionDetails: {
        text: 'boom',
        exceptionId: 9,
        stackTrace: {
          callFrames: [
            {
              functionName: 'explode',
              url: 'https://site/app.js',
              lineNumber: 8,
              columnNumber: 1,
            },
          ],
        },
        url: 'https://site/app.js',
        lineNumber: 8,
        columnNumber: 1,
      },
    });

    expect(session.send).toHaveBeenCalledWith('Runtime.enable');
    expect(session.send).toHaveBeenCalledWith('Console.enable');
    expect(classState.networkInstances).toHaveLength(1);
    expect(classState.networkInstances[0]?.enable).toHaveBeenCalledTimes(1);
    expect(monitor.getLogs({ type: 'warn' })[0]).toMatchObject({
      text: 'careful',
      url: 'https://site/app.js',
      lineNumber: 4,
    });
    expect(monitor.getExceptions()[0]).toMatchObject({
      text: 'boom',
      url: 'https://site/app.js',
      lineNumber: 8,
    });
  });

  it('uses Playwright mode when a page is attached and cleans handlers on disable', async () => {
    const handlers: Record<string, (payload: any) => void> = {};
    const page = {
      on: vi.fn((event: string, handler: (payload: any) => void) => {
        handlers[event] = handler;
      }),
      off: vi.fn((event: string, handler: (payload: any) => void) => {
        if (handlers[event] === handler) {
          delete handlers[event];
        }
      }),
    };
    const monitor = new ConsoleMonitor({ getActivePage: vi.fn() } as never);

    monitor.setPlaywrightPage(page);
    await monitor.enable({ enableNetwork: true, enableExceptions: true });

    handlers.console?.({
      type: () => 'log',
      text: () => 'from-playwright',
    });
    handlers.pageerror?.(new Error('page exploded'));

    expect(classState.playwrightInstances).toHaveLength(1);
    expect(classState.playwrightInstances[0]?.enable).toHaveBeenCalledTimes(1);
    expect(monitor.getLogs({ type: 'log' })[0]?.text).toBe('from-playwright');
    expect(monitor.getExceptions()[0]?.text).toBe('page exploded');

    await monitor.disable();

    expect(page.off).toHaveBeenCalledWith('console', expect.any(Function));
    expect(page.off).toHaveBeenCalledWith('pageerror', expect.any(Function));
    expect(classState.playwrightInstances[0]?.disable).toHaveBeenCalledTimes(1);
  });
});
