import { describe, expect, it, vi } from 'vitest';
import {
  attachToFlatTarget,
  type FlatSessionParentLike,
} from '@modules/browser/flat-target-session';

describe('attachToFlatTarget rollback on unregistered session', () => {
  it('detaches the target when the attached session was not registered', async () => {
    const send = vi.fn(async (method: string) => {
      if (method === 'Target.attachToTarget') {
        return { sessionId: 'sess-1' };
      }
      if (method === 'Target.detachFromTarget') {
        return {};
      }
      return {};
    });
    const parentSession = {
      send,
      connection: () => ({
        session: () => null, // flat session not registered yet
      }),
    } as unknown as FlatSessionParentLike;

    await expect(attachToFlatTarget(parentSession, 'target-1')).rejects.toThrow(
      'was not registered',
    );

    // The successful attachment must be rolled back so the CDP target is not
    // left in a half-attached state.
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('Target.detachFromTarget', { sessionId: 'sess-1' });
  });

  it('returns the registered session on success', async () => {
    const attachedSession = { id: () => 'sess-1' };
    const send = vi.fn(async (method: string) =>
      method === 'Target.attachToTarget' ? { sessionId: 'sess-1' } : {},
    );
    const parentSession = {
      send,
      connection: () => ({
        session: (id: string) => (id === 'sess-1' ? attachedSession : null),
      }),
    } as unknown as FlatSessionParentLike;

    await expect(attachToFlatTarget(parentSession, 'target-1')).resolves.toBe(attachedSession);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('attachToFlatTarget rollback on unavailable connection', () => {
  it('detaches the target when the parent connection cannot be inspected', async () => {
    const send = vi.fn(async (method: string) =>
      method === 'Target.attachToTarget' ? { sessionId: 'sess-9' } : {},
    );
    const parentSession = {
      send,
      connection: () => undefined,
    } as unknown as FlatSessionParentLike;

    await expect(attachToFlatTarget(parentSession, 'target-9')).rejects.toThrow(
      'connection lookup unavailable',
    );

    // The server-side attach already succeeded: it must be reverted before the
    // error leaves this function.
    expect(send).toHaveBeenLastCalledWith('Target.detachFromTarget', { sessionId: 'sess-9' });
  });
});
