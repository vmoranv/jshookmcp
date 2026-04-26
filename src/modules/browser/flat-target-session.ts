import type { CDPSessionLike } from '@modules/browser/CDPSessionLike';

interface TargetAttachResponse {
  sessionId?: unknown;
}

interface FlatSessionConnectionLike {
  session(sessionId: string): CDPSessionLike | null;
}

export interface FlatSessionParentLike extends CDPSessionLike {
  connection?(): FlatSessionConnectionLike | undefined;
}

function readSessionId(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) {
    return null;
  }
  const sessionId = (response as TargetAttachResponse).sessionId;
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
}

function readAttachedSessionId(session: CDPSessionLike): string | null {
  const sessionId = session.id?.();
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
}

export async function attachToFlatTarget(
  parentSession: FlatSessionParentLike,
  targetId: string,
): Promise<CDPSessionLike> {
  const response = await parentSession.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  const sessionId = readSessionId(response);

  if (!sessionId) {
    throw new Error(`Target.attachToTarget did not return sessionId for ${targetId}`);
  }

  const connection = parentSession.connection?.();
  if (!connection || typeof connection.session !== 'function') {
    throw new Error(`CDP connection lookup unavailable for attached target ${targetId}`);
  }

  const attachedSession = connection.session(sessionId);
  if (!attachedSession) {
    throw new Error(`CDP attached target session ${sessionId} was not registered for ${targetId}`);
  }

  return attachedSession;
}

export async function detachFromFlatTarget(
  parentSession: CDPSessionLike,
  attachedSession: CDPSessionLike,
): Promise<void> {
  const sessionId = readAttachedSessionId(attachedSession);
  if (!sessionId) {
    throw new Error('CDP attached target session id unavailable for detach');
  }

  await parentSession.send('Target.detachFromTarget', {
    sessionId,
  });
}
