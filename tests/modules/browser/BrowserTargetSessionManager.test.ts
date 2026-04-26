import { describe, expect, it, vi } from 'vitest';
import { BrowserTargetSessionManager } from '@modules/browser/BrowserTargetSessionManager';

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

  detach = vi.fn(async () => {});
}

class FakeParentSession {
  private readonly attachedSession = new FakeAttachedSession();
  private readonly connectionState = {
    session: vi.fn((sessionId: string) =>
      sessionId === 'session-1' ? this.attachedSession : null,
    ),
  };

  send = vi.fn(async (method: string) => {
    if (method === 'Target.getTargets') {
      return {
        targetInfos: [
          {
            targetId: 'page-1',
            type: 'page',
            title: 'Main',
            url: 'https://example.com',
            attached: false,
          },
          {
            targetId: 'frame-1',
            type: 'iframe',
            title: 'Inner',
            url: 'https://example.com/frame',
            attached: false,
          },
        ],
      };
    }

    if (method === 'Target.attachToTarget') {
      return { sessionId: 'session-1' };
    }

    return {};
  });

  on() {
    return this;
  }

  off() {
    return this;
  }

  detach = vi.fn(async () => {});

  connection = vi.fn(() => this.connectionState);
}

describe('BrowserTargetSessionManager', () => {
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
    expect((parentSession as any).attachedSession.detach).toHaveBeenCalledOnce();
  });
});
