import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestUrl } from '@tests/shared/test-urls';
const networkMonitorHarness = vi.hoisted(() => {
  const instances: any[] = [];

  class MockNetworkMonitor {
    public readonly session: unknown;
    public readonly options: {
      sessionId: string;
      targetId: string;
      targetType: string;
      requestIdPrefix: string;
    };
    enabled = false;
    enableCalls = 0;
    disableCalls = 0;
    clearRecordsCalls = 0;
    throwOnDisable = false;
    requests: any[] = [];
    responses: any[] = [];
    activities = new Map<string, any>();
    responseBodies = new Map<string, any>();
    jsResponses: any[] = [];
    clearBuffersResult = { xhrCleared: 0, fetchCleared: 0 };
    resetResult = { xhrReset: false, fetchReset: false };
    stats = {
      totalRequests: 0,
      totalResponses: 0,
      byMethod: {} as Record<string, number>,
      byStatus: {} as Record<string, number>,
      byType: {} as Record<string, number>,
    };
    xhrRequests: any[] = [];
    fetchRequests: any[] = [];
    listenerCount = 2;

    constructor(
      session: unknown,
      options: {
        sessionId: string;
        targetId: string;
        targetType: string;
        requestIdPrefix: string;
      },
    ) {
      this.session = session;
      this.options = options;
      instances.push(this);
    }

    async enable(): Promise<void> {
      this.enabled = true;
      this.enableCalls += 1;
    }

    async disable(): Promise<void> {
      this.disableCalls += 1;
      this.enabled = false;
      if (this.throwOnDisable) {
        throw new Error(`disable failed for ${this.options.targetId}`);
      }
    }

    getStatus() {
      return {
        enabled: this.enabled,
        requestCount: this.requests.length,
        responseCount: this.responses.length,
        listenerCount: this.listenerCount,
        cdpSessionActive: true,
      };
    }

    getRequests() {
      return this.requests;
    }

    getResponses() {
      return this.responses;
    }

    getActivity(requestId: string) {
      return this.activities.get(requestId) ?? {};
    }

    async getResponseBody(requestId: string) {
      return this.responseBodies.get(requestId) ?? null;
    }

    async getAllJavaScriptResponses() {
      return this.jsResponses;
    }

    clearRecords(): void {
      this.clearRecordsCalls += 1;
      this.requests = [];
      this.responses = [];
      this.activities.clear();
    }

    async clearInjectedBuffers() {
      return this.clearBuffersResult;
    }

    async resetInjectedInterceptors() {
      return this.resetResult;
    }

    getStats() {
      return this.stats;
    }

    async getXHRRequests() {
      return this.xhrRequests;
    }

    async getFetchRequests() {
      return this.fetchRequests;
    }
  }

  return { instances, MockNetworkMonitor };
});

vi.mock('@modules/monitor/NetworkMonitor', () => ({
  NetworkMonitor: networkMonitorHarness.MockNetworkMonitor,
}));

import { BrowserTargetSessionManager } from '@modules/browser/BrowserTargetSessionManager';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

class FakeAttachedSession {
  send = vi.fn(async (method: string) => {
    if (method === 'Runtime.evaluate') {
      return { result: { value: 'attached-result' } };
    }
    if (method === 'Page.addScriptToEvaluateOnNewDocument') {
      return { identifier: 'script-1' };
    }
    return {};
  });

  on() {
    return this;
  }

  off() {
    return this;
  }

  id = vi.fn(() => 'session-1');
  detach = vi.fn(async () => {});
}

class FakeManagedSession {
  private readonly sessionId: string;
  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  send = vi.fn(async (method: string) => {
    if (method === 'Page.addScriptToEvaluateOnNewDocument') {
      return { identifier: 'script-2' };
    }
    return {};
  });

  on() {
    return this;
  }

  off() {
    return this;
  }

  id = vi.fn(() => this.sessionId);
  detach = vi.fn(async () => {});
}

class FakeParentSession {
  private readonly attachedSession = new FakeAttachedSession();
  readonly childSession = new FakeManagedSession('session-2');
  readonly pageSession = new FakeManagedSession('session-page');
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  private childSessionMisses = 0;
  private readonly connectionState = {
    session: vi.fn((sessionId: string) => {
      if (sessionId === 'session-1') {
        return this.attachedSession;
      }
      if (sessionId === 'session-page') {
        return this.pageSession;
      }
      if (sessionId === 'session-2') {
        if (this.childSessionMisses > 0) {
          this.childSessionMisses -= 1;
          return null;
        }
        return this.childSession;
      }
      return null;
    }),
  };

  send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'Target.getTargets') {
      return {
        targetInfos: [
          {
            targetId: 'page-1',
            type: 'page',
            title: 'Main',
            url: TEST_URLS.root,
            attached: false,
          },
          {
            targetId: 'frame-1',
            type: 'iframe',
            title: 'Inner',
            url: withPath(TEST_URLS.root, 'frame'),
            attached: false,
          },
        ],
      };
    }

    if (method === 'Target.attachToTarget') {
      if (params?.targetId === 'page-1') {
        return { sessionId: 'session-page' };
      }
      return { sessionId: 'session-1' };
    }

    return {};
  });

  on(event: string, handler: (payload: unknown) => void) {
    const handlers = this.listeners.get(event) ?? new Set<(payload: unknown) => void>();
    handlers.add(handler);
    this.listeners.set(event, handlers);
    return this;
  }

  off(event: string, handler: (payload: unknown) => void) {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  detach = vi.fn(async () => {});

  connection = vi.fn(() => this.connectionState);

  setChildSessionLookupMisses(count: number): void {
    this.childSessionMisses = count;
  }

  emit(event: string, payload: unknown): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(payload);
    }
  }
}

describe('BrowserTargetSessionManager', () => {
  beforeEach(() => {
    networkMonitorHarness.instances.length = 0;
  });

  it('lists targets and supports filtering', async () => {
    const parentSession = new FakeParentSession();
    const browser = {
      target: () => ({
        createCDPSession: vi.fn(async () => parentSession),
      }),
    };
    const manager = new BrowserTargetSessionManager(() => browser as never);

    const allTargets = await manager.listTargets();
    const iframeTargets = await manager.listTargets({ type: 'iframe' });

    expect(allTargets).toHaveLength(2);
    expect(iframeTargets).toEqual([
      expect.objectContaining({
        targetId: 'frame-1',
        type: 'iframe',
      }),
    ]);
    expect(parentSession.send).toHaveBeenCalledWith('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    expect(parentSession.send).toHaveBeenCalledWith('Target.setDiscoverTargets', {
      discover: true,
    });
  });

  it('can skip OOPIF auto-discovery when explicitly disabled', async () => {
    const parentSession = new FakeParentSession();
    const browser = {
      target: () => ({
        createCDPSession: vi.fn(async () => parentSession),
      }),
    };
    const manager = new BrowserTargetSessionManager(() => browser as never);

    await manager.listTargets({ discoverOOPIF: false });

    expect(parentSession.send).not.toHaveBeenCalledWith('Target.setAutoAttach', expect.anything());
    expect(parentSession.send).not.toHaveBeenCalledWith(
      'Target.setDiscoverTargets',
      expect.anything(),
    );
  });

  it('attaches to a target and evaluates through the flattened session', async () => {
    const parentSession = new FakeParentSession();
    const browser = {
      target: () => ({
        createCDPSession: vi.fn(async () => parentSession),
      }),
    };
    const manager = new BrowserTargetSessionManager(() => browser as never);

    const target = await manager.attach('frame-1');
    const result = await manager.evaluate('1 + 1');
    await manager.addScriptToEvaluateOnNewDocument('window.__test = 1;');
    const detached = await manager.detach();

    expect(target).toEqual(
      expect.objectContaining({
        targetId: 'frame-1',
        type: 'iframe',
      }),
    );
    expect(result).toBe('attached-result');
    expect(detached).toBe(true);
    expect(parentSession.send).toHaveBeenCalledWith('Target.attachToTarget', {
      targetId: 'frame-1',
      flatten: true,
    });
    expect(parentSession.connection).toHaveBeenCalled();
    expect((parentSession as any).connectionState.session).toHaveBeenCalledWith('session-1');
    expect((parentSession as any).attachedSession.send).toHaveBeenCalledWith('Runtime.evaluate', {
      expression: '1 + 1',
      returnByValue: true,
      awaitPromise: true,
    });
    expect(parentSession.send).toHaveBeenCalledWith('Target.detachFromTarget', {
      sessionId: 'session-1',
    });
    expect((parentSession as any).attachedSession.detach).not.toHaveBeenCalled();
  });

  it('keeps attachment state when flat target detach fails', async () => {
    const parentSession = new FakeParentSession();
    const defaultSend = parentSession.send.getMockImplementation();
    parentSession.send.mockImplementation(async (method: string) => {
      if (method === 'Target.detachFromTarget') {
        throw new Error('detach failed');
      }
      return defaultSend ? await defaultSend(method) : {};
    });
    const browser = {
      target: () => ({
        createCDPSession: vi.fn(async () => parentSession),
      }),
    };
    const manager = new BrowserTargetSessionManager(() => browser as never);

    await manager.attach('frame-1');

    await expect(manager.detach()).rejects.toThrow('detach failed');
    expect(manager.getAttachedTargetInfo()).toEqual(
      expect.objectContaining({
        targetId: 'frame-1',
      }),
    );
    expect(manager.getAttachedTargetSession()).not.toBeNull();
  });

  it('replays persistent scripts to newly attached managed targets', async () => {
    const parentSession = new FakeParentSession();
    const browser = {
      target: () => ({
        createCDPSession: vi.fn(async () => parentSession),
      }),
    };
    const manager = new BrowserTargetSessionManager(() => browser as never);

    await manager.listTargets();
    await manager.registerPersistentScript('window.__aiHook = true;', {
      id: 'ai-hook:test',
      evaluateNow: true,
      targetTypes: ['iframe'],
    });

    parentSession.emit('Target.attachedToTarget', {
      sessionId: 'session-2',
      targetInfo: {
        targetId: 'frame-1',
        type: 'iframe',
        title: 'Inner',
        url: withPath(TEST_URLS.root, 'frame'),
        attached: true,
      },
    });

    await vi.waitFor(() => {
      expect(parentSession.childSession.send).toHaveBeenCalledWith(
        'Page.addScriptToEvaluateOnNewDocument',
        expect.objectContaining({
          source: 'window.__aiHook = true;',
        }),
      );
    });
  });

  it('bootstraps existing page targets before registering persistent scripts', async () => {
    const parentSession = new FakeParentSession();
    const browser = {
      target: () => ({
        createCDPSession: vi.fn(async () => parentSession),
      }),
    };
    const manager = new BrowserTargetSessionManager(() => browser as never);

    const result = await manager.registerPersistentScript('window.__pageHook = true;', {
      id: 'page-hook:test',
      evaluateNow: true,
      targetTypes: ['page'],
    });

    expect(result.appliedTargets).toBeGreaterThanOrEqual(1);
    expect(parentSession.send).toHaveBeenCalledWith('Target.attachToTarget', {
      targetId: 'page-1',
      flatten: true,
    });
    expect(parentSession.pageSession.send).toHaveBeenCalledWith(
      'Page.addScriptToEvaluateOnNewDocument',
      expect.objectContaining({
        source: 'window.__pageHook = true;',
      }),
    );
  });

  it('retries child session lookup before dropping auto-attached targets', async () => {
    const parentSession = new FakeParentSession();
    parentSession.setChildSessionLookupMisses(2);
    const browser = {
      target: () => ({
        createCDPSession: vi.fn(async () => parentSession),
      }),
    };
    const manager = new BrowserTargetSessionManager(() => browser as never);

    await manager.listTargets();
    await manager.registerPersistentScript('window.__aiHook = true;', {
      id: 'ai-hook:test-retry',
      evaluateNow: true,
      targetTypes: ['iframe'],
    });

    parentSession.emit('Target.attachedToTarget', {
      sessionId: 'session-2',
      targetInfo: {
        targetId: 'frame-1',
        type: 'iframe',
        title: 'Inner',
        url: withPath(TEST_URLS.root, 'frame'),
        attached: true,
      },
    });

    await vi.waitFor(() => {
      expect(parentSession.childSession.send).toHaveBeenCalledWith(
        'Page.addScriptToEvaluateOnNewDocument',
        expect.objectContaining({
          source: 'window.__aiHook = true;',
        }),
      );
    });
  });

  it('does not re-register the same persistent script source on managed targets', async () => {
    const parentSession = new FakeParentSession();
    const browser = {
      target: () => ({
        createCDPSession: vi.fn(async () => parentSession),
      }),
    };
    const manager = new BrowserTargetSessionManager(() => browser as never);

    await manager.registerPersistentScript('window.__aiHook = true;', {
      id: 'ai-hook:dedupe',
      evaluateNow: true,
      targetTypes: ['page'],
    });
    await manager.registerPersistentScript('window.__aiHook = true;', {
      id: 'ai-hook:dedupe',
      evaluateNow: true,
      targetTypes: ['page'],
    });

    const addScriptCalls = parentSession.pageSession.send.mock.calls.filter(
      ([method]) => method === 'Page.addScriptToEvaluateOnNewDocument',
    );
    expect(addScriptCalls).toHaveLength(1);
  });

  it('borrows an existing managed session when attaching to an already managed target', async () => {
    const parentSession = new FakeParentSession();
    const browser = {
      target: () => ({
        createCDPSession: vi.fn(async () => parentSession),
      }),
    };
    const manager = new BrowserTargetSessionManager(() => browser as never);

    await manager.registerPersistentScript('window.__pageHook = true;', {
      id: 'page-hook:test',
      evaluateNow: false,
      targetTypes: ['page'],
    });

    const target = await manager.attach('page-1');

    expect(target.targetId).toBe('page-1');
    expect(manager.getAttachedTargetSession()).toBe(parentSession.pageSession);
    expect(manager.getAttachedTargetInfo()).toEqual(
      expect.objectContaining({ targetId: 'page-1' }),
    );
    expect(
      parentSession.send.mock.calls.some(
        ([method, params]) => method === 'Target.attachToTarget' && params?.targetId === 'page-1',
      ),
    ).toBe(true);

    const detached = await manager.detach();
    expect(detached).toBe(true);
    expect(parentSession.send).not.toHaveBeenCalledWith('Target.detachFromTarget', {
      sessionId: 'session-page',
    });
  });

  it('aggregates network monitor state across managed sessions', async () => {
    const parentSession = new FakeParentSession();
    const browser = {
      target: () => ({
        createCDPSession: vi.fn(async () => parentSession),
      }),
    };
    const manager = new BrowserTargetSessionManager(() => browser as never);

    await manager.enable();

    expect(networkMonitorHarness.instances).toHaveLength(2);
    const [pageMonitor, frameMonitor] = networkMonitorHarness.instances;
    pageMonitor.requests = [
      {
        requestId: 'page-req',
        url: withPath(TEST_URLS.root, 'api/page'),
        method: 'GET',
        timestamp: 1,
      },
    ];
    pageMonitor.responses = [
      {
        requestId: 'page-req',
        url: withPath(TEST_URLS.root, 'api/page'),
        status: 200,
        timestamp: 2,
      },
    ];
    pageMonitor.activities.set('page-req', {
      request: pageMonitor.requests[0],
      response: pageMonitor.responses[0],
    });
    pageMonitor.responseBodies.set('page-req', { body: 'page-body', base64Encoded: false });
    pageMonitor.jsResponses = [
      {
        url: withPath(TEST_URLS.root, 'app.js'),
        content: 'console.log(1)',
        size: 14,
        requestId: 'page-req',
      },
    ];
    pageMonitor.clearBuffersResult = { xhrCleared: 1, fetchCleared: 2 };
    pageMonitor.resetResult = { xhrReset: true, fetchReset: false };
    pageMonitor.stats = {
      totalRequests: 1,
      totalResponses: 1,
      byMethod: { GET: 1 },
      byStatus: { '200': 1 },
      byType: { XHR: 1 },
    };
    pageMonitor.xhrRequests = [{ requestId: 'xhr-page', url: withPath(TEST_URLS.root, 'xhr') }];

    frameMonitor.requests = [
      {
        requestId: 'frame-req',
        url: withPath(TEST_URLS.root, 'api/frame'),
        method: 'POST',
        timestamp: 3,
      },
    ];
    frameMonitor.responses = [
      {
        requestId: 'frame-req',
        url: withPath(TEST_URLS.root, 'api/frame'),
        status: 201,
        timestamp: 4,
      },
    ];
    frameMonitor.activities.set('frame-req', {
      request: frameMonitor.requests[0],
      response: frameMonitor.responses[0],
    });
    frameMonitor.responseBodies.set('frame-req', { body: 'frame-body', base64Encoded: true });
    frameMonitor.jsResponses = [
      {
        url: withPath(TEST_URLS.root, 'frame.js'),
        content: 'console.log(2)',
        size: 14,
        requestId: 'frame-req',
      },
    ];
    frameMonitor.clearBuffersResult = { xhrCleared: 3, fetchCleared: 4 };
    frameMonitor.resetResult = { xhrReset: false, fetchReset: true };
    frameMonitor.stats = {
      totalRequests: 2,
      totalResponses: 2,
      byMethod: { POST: 2 },
      byStatus: { '201': 2 },
      byType: { Fetch: 2 },
    };
    frameMonitor.fetchRequests = [{ url: withPath(TEST_URLS.root, 'fetch') }];

    expect(manager.isEnabled()).toBe(true);
    expect(manager.persistsAcrossContextSwitches()).toBe(true);
    expect(manager.getStatus()).toEqual({
      enabled: true,
      requestCount: 2,
      responseCount: 2,
      listenerCount: 7,
      cdpSessionActive: true,
    });
    expect(manager.getRequests()).toHaveLength(2);
    expect(manager.getRequests({ url: '/api/frame', method: 'POST', limit: 1 })).toEqual([
      expect.objectContaining({ requestId: 'frame-req' }),
    ]);
    expect(manager.getResponses({ status: 201, limit: 1 })).toEqual([
      expect.objectContaining({ requestId: 'frame-req' }),
    ]);
    expect(manager.getActivity('frame-req')).toEqual({
      request: frameMonitor.requests[0],
      response: frameMonitor.responses[0],
    });
    await expect(manager.getResponseBody('page-req')).resolves.toEqual({
      body: 'page-body',
      base64Encoded: false,
    });
    await expect(manager.getResponseBody('missing')).resolves.toBeNull();
    await expect(manager.getAllJavaScriptResponses()).resolves.toHaveLength(2);
    expect(manager.getStats()).toEqual({
      totalRequests: 3,
      totalResponses: 3,
      byMethod: { GET: 1, POST: 2 },
      byStatus: { '200': 1, '201': 2 },
      byType: { XHR: 1, Fetch: 2 },
    });
    await expect(manager.clearInjectedBuffers()).resolves.toEqual({
      xhrCleared: 4,
      fetchCleared: 6,
    });
    await expect(manager.resetInjectedInterceptors()).resolves.toEqual({
      xhrReset: true,
      fetchReset: true,
    });
    await expect(manager.getXHRRequests()).resolves.toEqual([
      expect.objectContaining({
        requestId: 'xhr-page',
        targetId: 'page-1',
        targetType: 'page',
      }),
    ]);
    await expect(manager.getFetchRequests()).resolves.toEqual([
      expect.objectContaining({
        requestId: 'frame-1:fetch-injected-0',
        targetId: 'frame-1',
        targetType: 'iframe',
      }),
    ]);

    manager.clearRecords();
    expect(pageMonitor.clearRecordsCalls).toBe(1);
    expect(frameMonitor.clearRecordsCalls).toBe(1);

    await manager.disable();
    expect(pageMonitor.disableCalls).toBe(1);
    expect(frameMonitor.disableCalls).toBe(1);
    expect(manager.isEnabled()).toBe(false);
    expect(manager.persistsAcrossContextSwitches()).toBe(false);
  });

  it('keeps running when managed target evaluation or interceptor reset paths fail', async () => {
    const parentSession = new FakeParentSession();
    parentSession.pageSession.send.mockImplementation(async (method: string) => {
      if (method === 'Runtime.evaluate') {
        throw new Error('page evaluate failed');
      }
      if (method === 'Page.addScriptToEvaluateOnNewDocument') {
        return { identifier: 'script-page' };
      }
      return {};
    });
    parentSession.childSession.send.mockImplementation(async (method: string) => {
      if (method === 'Page.addScriptToEvaluateOnNewDocument') {
        throw new Error('iframe preload failed');
      }
      return {};
    });
    const browser = {
      target: () => ({
        createCDPSession: vi.fn(async () => parentSession),
      }),
    };
    const manager = new BrowserTargetSessionManager(() => browser as never);

    await manager.enable();

    const [pageMonitor, frameMonitor] = networkMonitorHarness.instances;
    frameMonitor.throwOnDisable = true;

    await expect(
      manager.registerPersistentScript('window.__resilient = true;', {
        id: 'resilient-script',
        evaluateNow: true,
        targetTypes: ['page', 'iframe'],
      }),
    ).resolves.toEqual({
      identifier: 'resilient-script',
      appliedTargets: 2,
    });
    await expect(
      manager.evaluateInManagedTargets('window.__resilient = true;', { targetTypes: ['page'] }),
    ).resolves.toBe(1);

    await manager.dispose();

    expect(pageMonitor.disableCalls).toBeGreaterThanOrEqual(1);
    expect(frameMonitor.disableCalls).toBeGreaterThanOrEqual(1);
    expect(manager.getAttachedTargetSession()).toBeNull();
    expect(manager.getAttachedTargetInfo()).toBeNull();
  });

  it('updates and clears borrowed attached target state on managed target lifecycle events', async () => {
    const parentSession = new FakeParentSession();
    const browser = {
      target: () => ({
        createCDPSession: vi.fn(async () => parentSession),
      }),
    };
    const manager = new BrowserTargetSessionManager(() => browser as never);

    await manager.registerPersistentScript('window.__pageHook = true;', {
      id: 'page-hook:test',
      evaluateNow: false,
      targetTypes: ['page'],
    });
    await manager.attach('page-1');

    parentSession.emit('Target.targetInfoChanged', {
      targetInfo: {
        targetId: 'page-1',
        type: 'page',
        title: 'Renamed',
        url: withPath(TEST_URLS.root, 'renamed'),
        attached: true,
      },
    });
    await vi.waitFor(() => {
      expect(manager.getAttachedTargetInfo()).toEqual(
        expect.objectContaining({
          title: 'Renamed',
          url: withPath(TEST_URLS.root, 'renamed'),
        }),
      );
    });

    parentSession.emit('Target.detachedFromTarget', {
      sessionId: 'session-page',
    });
    await vi.waitFor(() => {
      expect(manager.getAttachedTargetSession()).toBeNull();
      expect(manager.getAttachedTargetInfo()).toBeNull();
    });
  });
});

describe('BrowserTargetSessionManager lifecycle hardening', () => {
  beforeEach(() => {
    networkMonitorHarness.instances.length = 0;
  });

  function createManager(parentSession: unknown) {
    const browser = {
      target: () => ({
        createCDPSession: vi.fn(async () => parentSession),
      }),
    };
    return new BrowserTargetSessionManager(() => browser as never);
  }

  it('shares one browser CDP session between concurrent callers', async () => {
    const parentSession = new FakeParentSession();
    const createCDPSession = vi.fn(async () => parentSession);
    const browser = {
      target: () => ({ createCDPSession }),
    };
    const manager = new BrowserTargetSessionManager(() => browser as never);
    const privateManager = manager as unknown as {
      ensureBrowserSession: () => Promise<unknown>;
    };

    const [first, second] = await Promise.all([
      privateManager.ensureBrowserSession(),
      privateManager.ensureBrowserSession(),
    ]);

    expect(first).toBe(second);
    expect(createCDPSession).toHaveBeenCalledTimes(1);
  });

  it('disables per-entry network monitors even when detach throws during dispose', async () => {
    const parentSession = new FakeParentSession();
    const manager = createManager(parentSession);

    await manager.enable();
    const monitors = networkMonitorHarness.instances;
    expect(monitors.length).toBeGreaterThan(0);

    (manager as unknown as { detach: () => Promise<boolean> }).detach = vi.fn(async () => {
      throw new Error('detach failed');
    });

    await expect(manager.dispose()).resolves.toBeUndefined();

    for (const monitor of monitors) {
      expect(monitor.disableCalls).toBeGreaterThanOrEqual(1);
    }
  });

  it('applies registered persistent scripts to bootstrapped managed targets', async () => {
    const parentSession = new FakeParentSession();
    const manager = createManager(parentSession);

    const withScripts = manager as unknown as {
      persistentScripts: Map<string, { id: string; source: string; targetTypes?: string[] }>;
      bootstrapManagedTargets: () => Promise<void>;
    };
    withScripts.persistentScripts.set('preload', {
      id: 'preload',
      source: 'window.__preload = true;',
      targetTypes: ['page', 'iframe'],
    });

    await withScripts.bootstrapManagedTargets();

    expect(parentSession.pageSession.send).toHaveBeenCalledWith(
      'Page.addScriptToEvaluateOnNewDocument',
      { source: 'window.__preload = true;' },
    );
    const registry = manager as unknown as {
      registry: { all: () => IterableIterator<{ appliedPersistentScripts: Map<string, string> }> };
    };
    const applied = [...registry.registry.all()].filter(
      (entry) => entry.appliedPersistentScripts.get('preload') === 'window.__preload = true;',
    );
    // Both bootstrapped targets (page + iframe) receive the preload script.
    expect(applied).toHaveLength(2);
  });

  it('detaches the temporary worker session when Debugger.enable throws', async () => {
    const tempSession = {
      send: vi.fn(async (method: string) => {
        if (method === 'Debugger.enable') {
          throw new Error('enable failed');
        }
        return {};
      }),
      on: vi.fn(),
      off: vi.fn(),
      id: () => 'temp-session',
    };
    const parentSession = {
      send: vi.fn(async (method: string) => {
        if (method === 'Target.getTargets') {
          return {
            targetInfos: [
              {
                targetId: 'worker-1',
                type: 'worker',
                title: 'worker',
                url: buildTestUrl('artifact', { path: '/w.js' }),
                attached: false,
              },
            ],
          };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: 'temp-session' };
        }
        return {};
      }),
      on: vi.fn(),
      off: vi.fn(),
      connection: () => ({
        session: (id: string) => (id === 'temp-session' ? tempSession : null),
      }),
    };
    const manager = createManager(parentSession);

    await expect(manager.dumpTargetScripts('worker-1')).rejects.toThrow('enable failed');

    expect(parentSession.send).toHaveBeenCalledWith('Target.detachFromTarget', {
      sessionId: 'temp-session',
    });
  });
});
