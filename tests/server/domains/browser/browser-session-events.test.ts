/**
 * Proves the browser-domain session lifecycle events are emitted from the real
 * launch/close paths with the resolved payload, and — just as importantly —
 * that they do NOT fire on paths where nothing was actually launched/closed.
 *
 *   session:browser_launched  ← browser-control.ts handleBrowserLaunch (chrome)
 *                             ← camoufox-flow.ts handleCamoufoxLaunchFlow
 *   session:browser_closed    ← browser-control.ts handleBrowserClose (real close only)
 */
import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { createPageMock, parseJson } from '@tests/server/domains/shared/mock-factories';
import { createServerEventBus, type EventBus, type ServerEventMap } from '@server/EventBus';

vi.mock('@utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('fs/promises', () => ({ readFile: vi.fn(), writeFile: vi.fn() }));

vi.mock('@src/config/env-bootstrap', () => ({
  bootstrapRuntimeEnv: () => ({
    projectRoot: '/fake/project',
    envPath: '/fake/project/.env',
    loaded: false,
  }),
}));

const mockCamoufox = vi.hoisted(() => ({
  launch: vi.fn(),
  connectToServer: vi.fn(),
}));

vi.mock('@modules/browser/CamoufoxBrowserManager', () => ({
  CamoufoxBrowserManager: class MockCamoufoxBrowserManager {
    launch = mockCamoufox.launch;
    connectToServer = mockCamoufox.connectToServer;
  },
}));

import { BrowserControlHandlers } from '@server/domains/browser/handlers/browser-control';
import { handleCamoufoxLaunchFlow } from '@server/domains/browser/handlers/camoufox-flow';
import { BrowserSessionCoordinator } from '@server/runtime/BrowserSessionCoordinator';

interface CollectorMock {
  connect: Mock<(args: any) => Promise<void>>;
  launch: Mock<(args: any) => Promise<any>>;
  close: Mock<() => Promise<void>>;
  createPage: Mock<() => Promise<unknown>>;
  listPages: Mock<() => Promise<Array<{ index: number; url: string; title: string }>>>;
  selectPage: Mock<(index: number) => Promise<void>>;
  getStatus: Mock<() => Promise<{ connected: boolean; pages?: number }>>;
  getChromePid: Mock<() => number | null>;
  getSelectedPageHandle: Mock<() => { index: number; page: object } | null>;
}

/** `emitBusEvent` is fire-and-forget; let the queued `emit` microtask settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function createMocks() {
  const collector: CollectorMock = {
    connect: vi.fn(async () => {}),
    launch: vi.fn(async () => ({
      action: 'launched',
      launchOptions: { headless: true, args: [], v8NativeSyntaxEnabled: false },
    })),
    close: vi.fn(async () => {}),
    createPage: vi.fn(async () => ({})),
    listPages: vi.fn(async () => [{ index: 0, url: 'about:blank', title: '' }]),
    selectPage: vi.fn(async () => {}),
    getStatus: vi.fn(async () => ({ connected: true })),
    getChromePid: vi.fn(() => 4321),
    getSelectedPageHandle: vi.fn(() => null),
  };

  const consoleMonitor = {
    disable: vi.fn(async () => {}),
    enable: vi.fn(async () => {}),
    markContextChanged: vi.fn(() => {}),
  };

  const tabRegistry = {
    reconcilePages: vi.fn(() => []),
    setCurrentByIndex: vi.fn((index: number) => ({ pageId: `page-${index}`, aliases: [] })),
    getTabByIndex: vi.fn((index: number) => ({ pageId: `page-${index}`, aliases: [] })),
    getContextMeta: vi.fn(() => ({ pageId: 'page-0', tabIndex: 0 })),
    upsertPage: vi.fn(() => 'page-0'),
    getCurrentPageId: vi.fn(() => 'page-0'),
    setCurrentPageId: vi.fn(() => {}),
  };

  const deps = {
    collector: collector as any,
    pageController: createPageMock() as any,
    consoleMonitor: consoleMonitor as any,
    getActiveDriver: () => 'chrome' as const,
    getCamoufoxManager: () => null,
    getCamoufoxPage: async () => null,
    getTabRegistry: () => tabRegistry as any,
    clearAttachedTargetContext: vi.fn(async () => ({
      detached: false,
      targetId: null,
      type: null,
    })),
    onBrowserAttachStateChanged: vi.fn(),
  };

  return { collector, consoleMonitor, tabRegistry, deps };
}

function makeBus() {
  const bus = createServerEventBus();
  const launched = vi.fn();
  const closed = vi.fn();
  bus.on('session:browser_launched', launched);
  bus.on('session:browser_closed', closed);
  return { bus, launched, closed };
}

describe('session:browser_launched — chrome launch path', () => {
  it('emits exactly once with the resolved mode "launch" when chrome launches', async () => {
    const { bus, launched } = makeBus();
    const m = createMocks();
    const handlers = new BrowserControlHandlers({ ...m.deps, eventBus: bus });

    const body = parseJson<any>(await handlers.handleBrowserLaunch({}));
    await flush();

    expect(body.success).toBe(true);
    expect(launched).toHaveBeenCalledTimes(1);
    expect(launched.mock.calls[0]![0].mode).toBe('launch');
    expect(typeof launched.mock.calls[0]![0].timestamp).toBe('string');
    expect(launched.mock.calls[0]![0].timestamp.length).toBeGreaterThan(0);
  });

  it('emits exactly once with mode "connect" when chrome connects', async () => {
    const { bus, launched } = makeBus();
    const m = createMocks();
    const handlers = new BrowserControlHandlers({ ...m.deps, eventBus: bus });

    await handlers.handleBrowserLaunch({ mode: 'connect', browserURL: 'http://127.0.0.1:9222' });
    await flush();

    expect(launched).toHaveBeenCalledTimes(1);
    expect(launched.mock.calls[0]![0].mode).toBe('connect');
  });

  it('does NOT emit when the launch is blocked by another owner (nothing launched)', async () => {
    const { bus, launched } = makeBus();
    const m = createMocks();
    const coordinator = new BrowserSessionCoordinator(() => m.collector as any);
    coordinator.claimBrowserLease('session-a');
    const handlers = new BrowserControlHandlers({
      ...m.deps,
      sessionCoordinator: coordinator,
      eventBus: bus,
    });

    let body: any;
    await coordinator.runExclusive('session-b', async () => {
      body = parseJson<any>(await handlers.handleBrowserLaunch({ mode: 'launch' }));
    });
    await flush();

    expect(body.success).toBe(false);
    expect(m.collector.launch).not.toHaveBeenCalled();
    expect(launched).not.toHaveBeenCalled();
  });

  it('does NOT emit when the driver is rejected (nothing launched)', async () => {
    const { bus, launched } = makeBus();
    const m = createMocks();
    const handlers = new BrowserControlHandlers({ ...m.deps, eventBus: bus });

    const body = parseJson<any>(await handlers.handleBrowserLaunch({ driver: 'firefox' }));
    await flush();

    expect(body.success).toBe(false);
    expect(launched).not.toHaveBeenCalled();
  });
});

describe('session:browser_launched — camoufox production launch flow', () => {
  beforeEach(() => {
    mockCamoufox.launch.mockResolvedValue(undefined);
    mockCamoufox.connectToServer.mockResolvedValue(undefined);
  });

  function makeContext(eventBus: EventBus<ServerEventMap>) {
    return {
      setCamoufoxManager: vi.fn(),
      setActiveDriver: vi.fn(),
      clearCamoufoxPage: vi.fn(),
      eventBus,
    };
  }

  it('emits exactly once with mode "launch"', async () => {
    const { bus, launched } = makeBus();
    const result = await handleCamoufoxLaunchFlow(makeContext(bus), {});
    await flush();

    expect(parseJson<any>(result).success).toBe(true);
    expect(launched).toHaveBeenCalledTimes(1);
    expect(launched.mock.calls[0]![0].mode).toBe('launch');
  });

  it('emits exactly once with mode "connect"', async () => {
    const { bus, launched } = makeBus();
    await handleCamoufoxLaunchFlow(makeContext(bus), {
      mode: 'connect',
      wsEndpoint: 'ws://localhost:1234',
    });
    await flush();

    expect(launched).toHaveBeenCalledTimes(1);
    expect(launched.mock.calls[0]![0].mode).toBe('connect');
  });

  it('does NOT emit when connect mode is missing its wsEndpoint', async () => {
    const { bus, launched } = makeBus();
    const result = await handleCamoufoxLaunchFlow(makeContext(bus), { mode: 'connect' });
    await flush();

    expect(parseJson<any>(result).success).toBe(false);
    expect(launched).not.toHaveBeenCalled();
  });
});

describe('session:browser_closed — close path', () => {
  function coordinatorReturning(remainingOwners: number) {
    return {
      getCurrentSessionId: () => 'session-1',
      releaseBrowserLease: vi.fn(() => ({ released: true, remainingOwners })),
      clearSessionContext: vi.fn(() => {}),
      clearBrowserLeases: vi.fn(() => {}),
      getBrowserLease: vi.fn(() => undefined),
    } as any;
  }

  it('emits exactly once with the real reason when the browser is actually closed', async () => {
    const { bus, closed } = makeBus();
    const m = createMocks();
    const handlers = new BrowserControlHandlers({
      ...m.deps,
      sessionCoordinator: coordinatorReturning(0),
      eventBus: bus,
    });

    const body = parseJson<any>(await handlers.handleBrowserClose({}));
    await flush();

    expect(m.collector.close).toHaveBeenCalledOnce();
    expect(body.browserClosed).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed.mock.calls[0]![0].reason).toBe('browser_close');
    expect(typeof closed.mock.calls[0]![0].timestamp).toBe('string');
  });

  it('does NOT emit when the browser stays open for other owners (nothing closed)', async () => {
    const { bus, closed } = makeBus();
    const m = createMocks();
    const handlers = new BrowserControlHandlers({
      ...m.deps,
      sessionCoordinator: coordinatorReturning(1),
      eventBus: bus,
    });

    const body = parseJson<any>(await handlers.handleBrowserClose({}));
    await flush();

    expect(body.browserClosed).toBe(false);
    expect(m.collector.close).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });
});
