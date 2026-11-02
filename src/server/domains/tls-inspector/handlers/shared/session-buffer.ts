import { randomUUID } from 'node:crypto';
import type { BufferedSession, ConsumedSessionBuffer, SessionKind, SessionSocket } from './types';

export function makeSessionId(kind: SessionKind | 'websocket'): string {
  return `${kind}_${randomUUID()}`;
}

export function serializeSocketAddresses(socket: SessionSocket): {
  localAddress: string | null;
  localPort: number | null;
  remoteAddress: string | null;
  remotePort: number | null;
} {
  return {
    localAddress: socket.localAddress ?? null,
    localPort: socket.localPort ?? null,
    remoteAddress: socket.remoteAddress ?? null,
    remotePort: socket.remotePort ?? null,
  };
}

export function serializeSessionState(session: BufferedSession): {
  bufferedBytes: number;
  remoteEnded: boolean;
  socketClosed: boolean;
  error: string | null;
} {
  return {
    bufferedBytes: session.buffer.length,
    remoteEnded: session.ended,
    socketClosed: session.closed,
    error: session.error,
  };
}

function wakeSessionWaiters(session: BufferedSession): void {
  for (const waiter of session.waiters) {
    waiter();
  }
  session.waiters.clear();
}

export function attachBufferedSession(session: BufferedSession): void {
  session.socket.on('data', (chunk: Buffer) => {
    session.buffer = Buffer.concat([session.buffer, chunk]);
    wakeSessionWaiters(session);
  });

  session.socket.on('end', () => {
    session.ended = true;
    wakeSessionWaiters(session);
  });

  session.socket.on('close', () => {
    session.closed = true;
    wakeSessionWaiters(session);
  });

  session.socket.on('error', (error: Error) => {
    session.error = error.message;
    wakeSessionWaiters(session);
  });
}

export function waitForSessionActivity(
  session: BufferedSession,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const onActivity = (): void => {
      clearTimeout(timer);
      session.waiters.delete(onActivity);
      resolve(true);
    };

    const timer = setTimeout(() => {
      session.waiters.delete(onActivity);
      resolve(false);
    }, timeoutMs);

    session.waiters.add(onActivity);
  });
}

export function consumeSessionBuffer(
  session: BufferedSession,
  delimiter: Buffer | null,
  includeDelimiter: boolean,
  maxBytes: number | undefined,
): ConsumedSessionBuffer | null {
  const delimiterHex = delimiter ? delimiter.toString('hex').toUpperCase() : null;

  if (delimiter) {
    const matchIndex = session.buffer.indexOf(delimiter);
    if (matchIndex >= 0) {
      const consumedBytes = matchIndex + delimiter.length;
      const data = includeDelimiter
        ? session.buffer.subarray(0, consumedBytes)
        : session.buffer.subarray(0, matchIndex);
      session.buffer = session.buffer.subarray(consumedBytes);
      return {
        data,
        matchedDelimiter: true,
        stopReason: 'delimiter',
        delimiterHex,
      };
    }
  }

  if (typeof maxBytes === 'number' && session.buffer.length >= maxBytes) {
    const data = session.buffer.subarray(0, maxBytes);
    session.buffer = session.buffer.subarray(maxBytes);
    return {
      data,
      matchedDelimiter: false,
      stopReason: 'maxBytes',
      delimiterHex,
    };
  }

  if ((session.error || session.ended || session.closed) && session.buffer.length > 0) {
    const data = session.buffer;
    session.buffer = Buffer.alloc(0);
    return {
      data,
      matchedDelimiter: false,
      stopReason: session.error ? 'error' : 'closed',
      delimiterHex,
    };
  }

  return null;
}
