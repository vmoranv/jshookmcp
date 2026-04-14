import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { TargetEvaluationHandlers } from '@server/domains/browser/handlers/target-evaluation';

interface PageControllerMock {
  getAttachedTargetInfo: Mock<() => { targetId: string; type: string; url?: string } | null>;
  evaluateAttachedTarget: Mock<
    (
      expression: string,
      options?: { returnByValue?: boolean; awaitPromise?: boolean },
    ) => Promise<unknown>
  >;
}

interface DetailedDataManagerMock {
  smartHandle: Mock<(value: unknown, maxSize: number) => unknown>;
}

function createDeps() {
  const pageController: PageControllerMock = {
    getAttachedTargetInfo: vi.fn(() => ({
      targetId: 'frame-1',
      type: 'iframe',
      url: 'https://example.com/frame',
    })),
    evaluateAttachedTarget: vi.fn<
      (
        expression: string,
        options?: { returnByValue?: boolean; awaitPromise?: boolean },
      ) => Promise<unknown>
    >(async () => ({ ok: true })),
  };

  const detailedDataManager: DetailedDataManagerMock = {
    smartHandle: vi.fn((value) => value),
  };

  return {
    pageController,
    detailedDataManager,
  };
}

describe('TargetEvaluationHandlers', () => {
  let pageController: PageControllerMock;
  let detailedDataManager: DetailedDataManagerMock;
  let handlers: TargetEvaluationHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    const deps = createDeps();
    pageController = deps.pageController;
    detailedDataManager = deps.detailedDataManager;
    handlers = new TargetEvaluationHandlers({
      pageController: pageController as never,
      detailedDataManager: detailedDataManager as never,
    });
  });

  it('evaluates in the active attached target', async () => {
    pageController.evaluateAttachedTarget.mockResolvedValueOnce({
      title: 'iframe',
      secret: 'hidden',
    });

    const body = parseJson<any>(
      await handlers.handleBrowserEvaluateCdpTarget({
        code: 'document.title',
        fieldFilter: ['secret'],
        autoSummarize: false,
      }),
    );

    expect(body.success).toBe(true);
    expect(body.target.targetId).toBe('frame-1');
    expect(body.result).toEqual({ title: 'iframe' });
    expect(pageController.evaluateAttachedTarget).toHaveBeenCalledWith('document.title', {
      returnByValue: true,
      awaitPromise: true,
    });
  });

  it('supports script alias and summarization options', async () => {
    pageController.evaluateAttachedTarget.mockResolvedValueOnce('x'.repeat(10));

    await handlers.handleBrowserEvaluateCdpTarget({
      script: 'globalThis.location.href',
      maxSize: 1024,
    });

    expect(detailedDataManager.smartHandle).toHaveBeenCalledWith('x'.repeat(10), 1024);
  });

  it('throws when no target is attached', async () => {
    pageController.getAttachedTargetInfo.mockReturnValueOnce(null);

    await expect(
      handlers.handleBrowserEvaluateCdpTarget({
        code: '1+1',
      }),
    ).rejects.toThrow('No CDP target is currently attached');
  });
});
