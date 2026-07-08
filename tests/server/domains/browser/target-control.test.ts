import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { TargetControlHandlers } from '@server/domains/browser/handlers/target-control';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

interface CollectorMock {
  listPages: Mock<() => Promise<Array<{ index: number; url: string; title: string }>>>;
  listCdpTargets: Mock<
    (filters?: {
      type?: string;
      types?: string[];
      targetId?: string;
      urlPattern?: string;
      titlePattern?: string;
      attachedOnly?: boolean;
      discoverOOPIF?: boolean;
    }) => Promise<Array<Record<string, unknown>>>
  >;
  attachCdpTarget: Mock<(targetId: string) => Promise<Record<string, unknown>>>;
  detachCdpTarget: Mock<() => Promise<boolean>>;
  getAttachedTargetInfo: Mock<() => { targetId: string; type?: string } | null>;
  dumpTargetScripts: Mock<
    (
      targetId: string,
      options?: { includeSource?: boolean; maxScripts?: number },
    ) => Promise<Record<string, unknown>>
  >;
}

interface ConsoleMonitorMock {
  markContextChanged: Mock<() => void>;
}

interface TabRegistryMock {
  getContextMeta: Mock<() => { pageId: string; tabIndex: number }>;
}

function createDeps() {
  const collector: CollectorMock = {
    listPages: vi.fn(async () => []),
    listCdpTargets: vi.fn(async () => []),
    attachCdpTarget: vi.fn(async (targetId: string) => ({ targetId, type: 'iframe' })),
    detachCdpTarget: vi.fn(async () => false),
    getAttachedTargetInfo: vi.fn(() => null),
    dumpTargetScripts: vi.fn(async () => ({})),
  };

  const consoleMonitor: ConsoleMonitorMock = {
    markContextChanged: vi.fn(),
  };

  const tabRegistry: TabRegistryMock = {
    getContextMeta: vi.fn(() => ({ pageId: 'page-0', tabIndex: 0 })),
  };

  return {
    collector,
    consoleMonitor,
    tabRegistry,
    deps: {
      collector: collector as any,
      consoleMonitor: consoleMonitor as any,
      getTabRegistry: () => tabRegistry as any,
    },
  };
}

describe('TargetControlHandlers', () => {
  let collector: CollectorMock;
  let consoleMonitor: ConsoleMonitorMock;
  let handlers: TargetControlHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = createDeps();
    collector = ctx.collector;
    consoleMonitor = ctx.consoleMonitor;
    handlers = new TargetControlHandlers(ctx.deps);
  });

  it('lists low-level CDP targets and returns relation hints', async () => {
    collector.listCdpTargets.mockResolvedValueOnce([
      {
        targetId: 'frame-1',
        type: 'iframe',
        title: 'Frame',
        url: withPath(TEST_URLS.root, 'frame'),
        attached: true,
        openerId: 'page-1',
        canAccessOpener: true,
      },
    ]);
    collector.getAttachedTargetInfo.mockReturnValueOnce({ targetId: 'frame-1', type: 'iframe' });
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: withPath(TEST_URLS.root, 'frame'), title: 'Frame' },
    ]);

    const body = parseJson<any>(
      await handlers.handleBrowserListCdpTargets({
        type: 'iframe',
        types: ['iframe', 'page'],
        attachedOnly: true,
      }),
    );

    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.activeTarget.targetId).toBe('frame-1');
    expect(body.currentTab.url).toBe(withPath(TEST_URLS.root, 'frame'));
    expect(body.targets[0].isActiveTarget).toBe(true);
    expect(body.targets[0].matchesCurrentTabUrl).toBe(true);
    expect(body.targets[0].relationHints).toContain('active_target');
    expect(collector.listCdpTargets).toHaveBeenCalledWith({
      type: 'iframe',
      types: ['iframe', 'page'],
      targetId: undefined,
      urlPattern: undefined,
      titlePattern: undefined,
      attachedOnly: true,
      discoverOOPIF: true,
    });
  });

  it('attaches a CDP target and marks monitoring context stale', async () => {
    collector.attachCdpTarget.mockResolvedValueOnce({
      targetId: 'frame-1',
      type: 'iframe',
      url: withPath(TEST_URLS.root, 'frame'),
    });

    const body = parseJson<any>(
      await handlers.handleBrowserAttachCdpTarget({
        targetId: 'frame-1',
      }),
    );

    expect(body.success).toBe(true);
    expect(body.attached).toBe(true);
    expect(body.target.targetId).toBe('frame-1');
    expect(collector.attachCdpTarget).toHaveBeenCalledWith('frame-1');
    expect(consoleMonitor.markContextChanged).toHaveBeenCalledOnce();
  });

  it('detaches a CDP target and returns detached target id', async () => {
    collector.getAttachedTargetInfo.mockReturnValueOnce({ targetId: 'frame-1', type: 'iframe' });
    collector.detachCdpTarget.mockResolvedValueOnce(true);

    const body = parseJson<any>(await handlers.handleBrowserDetachCdpTarget({}));

    expect(body.success).toBe(true);
    expect(body.detached).toBe(true);
    expect(body.targetId).toBe('frame-1');
    expect(consoleMonitor.markContextChanged).toHaveBeenCalledOnce();
  });

  it('clears attached target context for page/tab switching', async () => {
    collector.getAttachedTargetInfo.mockReturnValueOnce({ targetId: 'frame-1', type: 'iframe' });
    collector.detachCdpTarget.mockResolvedValueOnce(true);

    const result = await handlers.clearAttachedTargetContext('browser_select_tab');

    expect(result).toEqual({
      detached: true,
      targetId: 'frame-1',
      type: 'iframe',
    });
  });

  // ── Worker inspection (browser_list_workers / browser_worker_scripts) ──

  it('lists service/shared/dedicated workers and classifies their category', async () => {
    collector.listCdpTargets.mockResolvedValueOnce([
      {
        targetId: 'sw-1',
        type: 'service_worker',
        title: 'SW',
        url: 'https://x/sw.js',
        attached: false,
      },
      {
        targetId: 'sh-1',
        type: 'shared_worker',
        title: 'SH',
        url: 'https://x/sh.js',
        attached: true,
      },
      { targetId: 'w-1', type: 'worker', title: 'W', url: 'https://x/w.js', attached: false },
    ]);

    const body = parseJson<any>(await handlers.handleBrowserListWorkers({}));

    expect(body.success).toBe(true);
    expect(body.count).toBe(3);
    expect(body.filters).toMatchObject({
      includeServiceWorkers: true,
      includeDedicatedWorkers: true,
      includeSharedWorkers: true,
    });
    const byId = Object.fromEntries(body.workers.map((w: any) => [w.targetId, w]));
    expect(byId['sw-1'].category).toBe('service_worker');
    expect(byId['sw-1'].isServiceWorker).toBe(true);
    expect(byId['sh-1'].category).toBe('shared_worker');
    expect(byId['w-1'].category).toBe('dedicated_worker');
    expect(body._nextStepHint).toContain('browser_worker_scripts');
    // Only worker target types should be requested.
    expect(collector.listCdpTargets).toHaveBeenCalledWith({
      types: ['service_worker', 'shared_worker', 'worker'],
      urlPattern: undefined,
      discoverOOPIF: true,
    });
  });

  it('honors include flags and urlPattern filter when listing workers', async () => {
    collector.listCdpTargets.mockResolvedValueOnce([
      {
        targetId: 'sw-1',
        type: 'service_worker',
        title: 'SW',
        url: 'https://app/sw.js',
        attached: false,
      },
    ]);

    const body = parseJson<any>(
      await handlers.handleBrowserListWorkers({
        urlPattern: 'app',
        includeDedicatedWorkers: false,
        includeSharedWorkers: false,
      }),
    );

    expect(body.count).toBe(1);
    expect(body.filters.urlPattern).toBe('app');
    expect(collector.listCdpTargets).toHaveBeenCalledWith({
      types: ['service_worker'],
      urlPattern: 'app',
      discoverOOPIF: true,
    });
  });

  it('rejects worker listing when every include flag is disabled', async () => {
    const body = parseJson<any>(
      await handlers.handleBrowserListWorkers({
        includeServiceWorkers: false,
        includeDedicatedWorkers: false,
        includeSharedWorkers: false,
      }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/at least one/i);
    expect(collector.listCdpTargets).not.toHaveBeenCalled();
  });

  it('requires targetId when dumping worker scripts', async () => {
    const body = parseJson<any>(await handlers.handleBrowserWorkerScripts({}));

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/targetId is required/i);
    expect(collector.dumpTargetScripts).not.toHaveBeenCalled();
  });

  it('dumps worker scripts and forwards includeSource / maxScripts options', async () => {
    collector.dumpTargetScripts.mockResolvedValueOnce({
      targetId: 'sw-1',
      targetType: 'service_worker',
      borrowedManagedSession: false,
      totalScripts: 3,
      returnedScripts: 2,
      truncated: true,
      scripts: [
        { scriptId: '1', url: 'https://x/sw.js' },
        { scriptId: '2', url: 'https://x/a.js' },
      ],
    });

    const body = parseJson<any>(
      await handlers.handleBrowserWorkerScripts({
        targetId: 'sw-1',
        includeSource: true,
        maxScripts: 50,
      }),
    );

    expect(body.success).toBe(true);
    expect(body.targetId).toBe('sw-1');
    expect(body.targetType).toBe('service_worker');
    expect(body.truncated).toBe(true);
    expect(body.returnedScripts).toBe(2);
    expect(body.scripts).toHaveLength(2);
    expect(collector.dumpTargetScripts).toHaveBeenCalledWith('sw-1', {
      includeSource: true,
      maxScripts: 50,
    });
    expect(body._nextStepHint).toContain('Scripts include source');
  });
});
