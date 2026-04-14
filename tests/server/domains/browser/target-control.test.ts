import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { TargetControlHandlers } from '@server/domains/browser/handlers/target-control';

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
    }) => Promise<Array<Record<string, unknown>>>
  >;
  attachCdpTarget: Mock<(targetId: string) => Promise<Record<string, unknown>>>;
  detachCdpTarget: Mock<() => Promise<boolean>>;
  getAttachedTargetInfo: Mock<() => { targetId: string; type?: string } | null>;
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
        url: 'https://example.com/frame',
        attached: true,
        openerId: 'page-1',
        canAccessOpener: true,
      },
    ]);
    collector.getAttachedTargetInfo.mockReturnValueOnce({ targetId: 'frame-1', type: 'iframe' });
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: 'https://example.com/frame', title: 'Frame' },
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
    expect(body.currentTab.url).toBe('https://example.com/frame');
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
    });
  });

  it('attaches a CDP target and marks monitoring context stale', async () => {
    collector.attachCdpTarget.mockResolvedValueOnce({
      targetId: 'frame-1',
      type: 'iframe',
      url: 'https://example.com/frame',
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
});
