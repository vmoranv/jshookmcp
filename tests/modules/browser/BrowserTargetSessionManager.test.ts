import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { BrowserTargetSessionManager } from '@modules/browser/BrowserTargetSessionManager';

class FakeParentSession {
  private readonly emitter = new EventEmitter();

  send = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
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

    if (method === 'Target.sendMessageToTarget') {
      const message = JSON.parse(String(params.message));
      queueMicrotask(() => {
        this.emitter.emit('Target.receivedMessageFromTarget', {
          sessionId: params.sessionId,
          message: JSON.stringify({
            id: message.id,
            result:
              message.method === 'Runtime.evaluate'
                ? { result: { value: 'attached-result' } }
                : { identifier: 'script-1' },
          }),
        });
      });
      return {};
    }

    if (method === 'Target.detachFromTarget') {
      queueMicrotask(() => {
        this.emitter.emit('Target.detachedFromTarget', {
          sessionId: params.sessionId,
        });
      });
      return {};
    }

    return {};
  });

  on(event: string, listener: (payload: unknown) => void) {
    this.emitter.on(event, listener);
    return this;
  }

  off(event: string, listener: (payload: unknown) => void) {
    this.emitter.off(event, listener);
    return this;
  }

  detach = vi.fn(async () => {});
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
    expect(parentSession.send).toHaveBeenCalledWith(
      'Target.sendMessageToTarget',
      expect.objectContaining({
        sessionId: 'session-1',
      }),
    );
  });
});
