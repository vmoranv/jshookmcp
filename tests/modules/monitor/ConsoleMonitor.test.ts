import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const networkState = vi.hoisted(() => ({
  ctor: null as any,
  instances: [] as any[],
}));

const playwrightNetworkState = vi.hoisted(() => ({
  ctor: null as any,
  instances: [] as any[],
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

vi.mock('../../../src/modules/monitor/NetworkMonitor.js', () => {
  const ctorSpy = vi.fn();
  networkState.ctor = ctorSpy;

  class NetworkMonitor {
    session: unknown;
    enabled = false;
    enable = vi.fn(async () => {
      this.enabled = true;
    });
    disable = vi.fn(async () => {
      this.enabled = false;
    });
    isEnabled = vi.fn(() => this.enabled);
    getStatus = vi.fn(() => ({
      enabled: this.enabled,
      requestCount: 1,
      responseCount: 1,
      listenerCount: 1,
      cdpSessionActive: true,
    }));
    getRequests = vi.fn(() => [{ requestId: 'req-1' }]);
    getResponses = vi.fn(() => [{ requestId: 'req-1', status: 200 }]);
    getActivity = vi.fn(() => ({ request: { requestId: 'req-1' } }));
    getResponseBody = vi.fn(async () => ({ body: 'body', base64Encoded: false }));
    getAllJavaScriptResponses = vi.fn(async () => []);
    clearRecords = vi.fn();
    clearInjectedBuffers = vi.fn(async () => ({ xhrCleared: 2, fetchCleared: 1 }));
    resetInjectedInterceptors = vi.fn(async () => ({ xhrReset: true, fetchReset: true }));
    getStats = vi.fn(() => ({
      totalRequests: 1,
      totalResponses: 1,
      byMethod: { GET: 1 },
      byStatus: { 200: 1 },
      byType: { XHR: 1 },
    }));
    injectXHRInterceptor = vi.fn(async () => {});
    injectFetchInterceptor = vi.fn(async () => {});
    getXHRRequests = vi.fn(async () => [{ id: 'xhr-1' }]);
    getFetchRequests = vi.fn(async () => [{ id: 'fetch-1' }]);

    constructor(session: unknown) {
      ctorSpy(session);
      this.session = session;
      networkState.instances.push(this);
    }
  }

  return { NetworkMonitor };
});

vi.mock('../../../src/modules/monitor/PlaywrightNetworkMonitor.js', () => {
  const ctorSpy = vi.fn();
  playwrightNetworkState.ctor = ctorSpy;

  class PlaywrightNetworkMonitor {
    page: unknown;
    enabled = false;
    enable = vi.fn(async () => {
      this.enabled = true;
    });
    disable = vi.fn(async () => {
      this.enabled = false;
    });
    isEnabled = vi.fn(() => this.enabled);
    getStatus = vi.fn(() => ({
      enabled: this.enabled,
      requestCount: 0,
      responseCount: 0,
      listenerCount: 2,
      cdpSessionActive: false,
    }));
    getRequests = vi.fn(() => []);
    getResponses = vi.fn(() => []);
    getActivity = vi.fn(() => ({}));
    getResponseBody = vi.fn(async () => ({ body: 'pw-body', base64Encoded: false }));
    getAllJavaScriptResponses = vi.fn(async () => []);
    clearRecords = vi.fn();
    clearInjectedBuffers = vi.fn(async () => ({ xhrCleared: 4, fetchCleared: 5 }));
    resetInjectedInterceptors = vi.fn(async () => ({ xhrReset: true, fetchReset: true }));
    getStats = vi.fn(() => ({
      totalRequests: 0,
      totalResponses: 0,
      byMethod: {},
      byStatus: {},
      byType: {},
    }));
    injectXHRInterceptor = vi.fn(async () => {});
    injectFetchInterceptor = vi.fn(async () => {});
    getXHRRequests = vi.fn(async () => []);
    getFetchRequests = vi.fn(async () => []);

    constructor(page: unknown) {
      ctorSpy(page);
      this.page = page;
      playwrightNetworkState.instances.push(this);
    }
  }

  return { PlaywrightNetworkMonitor };
});

import { ConsoleMonitor } from '../../../src/modules/monitor/ConsoleMonitor.js';

function createMockSession() {
  const listeners = new Map<string, Set<(payload: any) => void>>();
  const send = vi.fn(async () => ({}));
  const on = vi.fn((event: string, handler: (payload: any) => void) => {
    const group = listeners.get(event) ?? new Set<(payload: any) => void>();
    group.add(handler);
    listeners.set(event, group);
  });
  const off = vi.fn((event: string, handler: (payload: any) => void) => {
    listeners.get(event)?.delete(handler);
  });
  const detach = vi.fn(async () => {});

  const emit = (event: string, payload?: any) => {
    listeners.get(event)?.forEach((handler) => handler(payload));
  };

  return { session: { send, on, off, detach } as any, send, emit };
}

function createCollectorWithSessions(...sessions: Array<any>) {
  const createPage = (session: any) => ({
    createCDPSession: vi.fn(async () => session),
  });
  const getActivePage = vi.fn();
  sessions.forEach((session) => {
    getActivePage.mockResolvedValueOnce(createPage(session));
  });
  return { getActivePage };
}

describe('ConsoleMonitor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    loggerState.debug.mockReset();
    loggerState.info.mockReset();
    loggerState.warn.mockReset();
    loggerState.error.mockReset();

    networkState.instances.length = 0;
    playwrightNetworkState.instances.length = 0;
    networkState.ctor?.mockClear?.();
    playwrightNetworkState.ctor?.mockClear?.();
  });

  it('enables CDP monitoring and initializes network monitor when requested', async () => {
    const { session, send } = createMockSession();
    send.mockImplementation(async (method: string) => {
      if (method === 'Runtime.enable' || method === 'Console.enable') return {};
      return {};
    });

    const collector = createCollectorWithSessions(session);
    const monitor = new ConsoleMonitor(collector as any);

    await monitor.enable({ enableNetwork: true });

    expect(collector.getActivePage).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('Runtime.enable');
    expect(send).toHaveBeenCalledWith('Console.enable');
    expect(networkState.ctor).toHaveBeenCalledTimes(1);
    expect(networkState.instances[0]!.enable).toHaveBeenCalledTimes(1);
    expect(monitor.isNetworkEnabled()).toBe(true);
  });

  it('captures console events and supports typed/sliced log queries', async () => {
    const { session, emit } = createMockSession();
    const collector = createCollectorWithSessions(session);
    const monitor = new ConsoleMonitor(collector as any);

    await monitor.enable();

    emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ value: 'hello' }],
      timestamp: 100,
      stackTrace: { callFrames: [] },
    });
    emit('Runtime.consoleAPICalled', {
      type: 'warn',
      args: [{ value: 'warning' }],
      timestamp: 200,
      stackTrace: { callFrames: [] },
    });

    expect(monitor.getLogs()).toHaveLength(2);
    expect(monitor.getLogs({ type: 'log' })).toHaveLength(1);
    expect(monitor.getLogs({ limit: 1 })[0]!.text).toContain('warning');
    expect(monitor.getStats().byType.warn).toBe(1);
  });

  it('evaluates expressions and surfaces runtime exceptions', async () => {
    const { session, send } = createMockSession();
    send.mockImplementation(async (method: string, params?: { expression: string }) => {
      if (method === 'Runtime.enable' || method === 'Console.enable') return {};
      if (method === 'Runtime.evaluate' && params?.expression === 'ok') {
        return { result: { value: 42 } };
      }
      if (method === 'Runtime.evaluate' && params?.expression === 'bad') {
        return { exceptionDetails: { text: 'boom' } };
      }
      return {};
    });

    const collector = createCollectorWithSessions(session);
    const monitor = new ConsoleMonitor(collector as any);
    await monitor.enable();

    await expect(monitor.execute('ok')).resolves.toBe(42);
    await expect(monitor.execute('bad')).rejects.toThrow('boom');
  });

  it('re-initializes session after CDP disconnect', async () => {
    const first = createMockSession();
    const second = createMockSession();
    const collector = createCollectorWithSessions(first.session, second.session);
    const monitor = new ConsoleMonitor(collector as any);

    await monitor.enable();
    first.emit('disconnected');
    await monitor.ensureSession();

    expect(collector.getActivePage).toHaveBeenCalledTimes(2);
    expect(second.send).toHaveBeenCalledWith('Runtime.enable');
    expect(second.send).toHaveBeenCalledWith('Console.enable');
  });

  it('supports Playwright mode with console/error capture and network delegation', async () => {
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

    const monitor = new ConsoleMonitor({ getActivePage: vi.fn() } as any);
    monitor.setPlaywrightPage(page);
    await monitor.enable({ enableNetwork: true, enableExceptions: true });

    handlers.console!({
      type: () => 'error',
      text: () => 'playwright console failure',
    });
    handlers.pageerror!(new Error('playwright page error'));

    expect(playwrightNetworkState.ctor).toHaveBeenCalledTimes(1);
    expect(playwrightNetworkState.instances[0]!.enable).toHaveBeenCalledTimes(1);
    expect(monitor.getLogs({ type: 'error' })).toHaveLength(1);
    expect(monitor.getExceptions()).toHaveLength(1);
    expect(monitor.isNetworkEnabled()).toBe(true);
  });

  it('combines network and dynamic-script cleanup results', async () => {
    const { session, send } = createMockSession();
    send.mockImplementation(async (method: string) => {
      if (method === 'Runtime.enable' || method === 'Console.enable') return {};
      if (method === 'Runtime.evaluate') {
        return { result: { value: { dynamicScriptsCleared: 4 } } };
      }
      return {};
    });

    const collector = createCollectorWithSessions(session);
    const monitor = new ConsoleMonitor(collector as any);
    await monitor.enable({ enableNetwork: true });

    const result = await monitor.clearInjectedBuffers();

    expect(result).toEqual({
      xhrCleared: 2,
      fetchCleared: 1,
      dynamicScriptsCleared: 4,
    });
  });
});
