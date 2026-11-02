import { createHash, randomBytes } from 'node:crypto';
import type { WebSocketFrame, WebSocketFrameType, WebSocketSession } from './types';

const WEBSOCKET_ACCEPT_SUFFIX = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function serializeWebSocketSessionState(session: WebSocketSession): {
  bufferedBytes: number;
  queuedFrames: number;
  remoteEnded: boolean;
  socketClosed: boolean;
  closeSent: boolean;
  closeReceived: boolean;
  error: string | null;
} {
  return {
    bufferedBytes: session.parserBuffer.length,
    queuedFrames: session.frames.length,
    remoteEnded: session.ended,
    socketClosed: session.closed,
    closeSent: session.closeSent,
    closeReceived: session.closeReceived,
    error: session.error,
  };
}

export function normalizeWebSocketPath(path: string | null | undefined): string {
  if (!path || path.trim().length === 0) {
    return '/';
  }
  return path.startsWith('/') ? path : `/${path}`;
}

function websocketOpcodeName(opcode: number): WebSocketFrameType | null {
  const opcodeNames: Record<number, WebSocketFrameType> = {
    0x1: 'text',
    0x2: 'binary',
    0x8: 'close',
    0x9: 'ping',
    0xa: 'pong',
  };
  return opcodeNames[opcode] ?? null;
}

export function computeWebSocketAccept(requestKey: string): string {
  return createHash('sha1')
    .update(`${requestKey}${WEBSOCKET_ACCEPT_SUFFIX}`, 'utf8')
    .digest('base64');
}

export function encodeWebSocketFrame(
  type: WebSocketFrameType,
  payload: Buffer,
  closeCode?: number | null,
  closeReason?: string | null,
): Buffer {
  const opcodeByType: Record<WebSocketFrameType, number> = {
    text: 0x1,
    binary: 0x2,
    close: 0x8,
    ping: 0x9,
    pong: 0xa,
  };

  let framePayload = payload;
  if (type === 'close') {
    if (closeCode !== undefined && closeCode !== null) {
      const reasonBuffer = closeReason ? Buffer.from(closeReason, 'utf8') : Buffer.alloc(0);
      framePayload = Buffer.alloc(2 + reasonBuffer.length);
      framePayload.writeUInt16BE(closeCode, 0);
      reasonBuffer.copy(framePayload, 2);
    } else if (closeReason) {
      framePayload = Buffer.from(closeReason, 'utf8');
    }
  }

  const maskKey = randomBytes(4);
  const payloadLength = framePayload.length;
  let header: Buffer;
  if (payloadLength < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | payloadLength;
  } else if (payloadLength <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
  }
  header[0] = 0x80 | opcodeByType[type];

  const maskedPayload = Buffer.alloc(payloadLength);
  for (let index = 0; index < payloadLength; index += 1) {
    maskedPayload[index] = framePayload[index]! ^ maskKey[index % 4]!;
  }

  return Buffer.concat([header, maskKey, maskedPayload]);
}

export function tryConsumeWebSocketFrame(buffer: Buffer): {
  frame: WebSocketFrame;
  bytesConsumed: number;
} | null {
  if (buffer.length < 2) {
    return null;
  }

  const first = buffer[0]!;
  const second = buffer[1]!;
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let payloadLength = second & 0x7f;
  let cursor = 2;

  if (payloadLength === 126) {
    if (buffer.length < cursor + 2) {
      return null;
    }
    payloadLength = buffer.readUInt16BE(cursor);
    cursor += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < cursor + 8) {
      return null;
    }
    const bigLength = buffer.readBigUInt64BE(cursor);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('WebSocket frame payload length exceeds supported limits');
    }
    payloadLength = Number(bigLength);
    cursor += 8;
  }

  const maskKey = masked ? buffer.subarray(cursor, cursor + 4) : null;
  if (masked) {
    if (buffer.length < cursor + 4) {
      return null;
    }
    cursor += 4;
  }

  if (buffer.length < cursor + payloadLength) {
    return null;
  }

  const payload = buffer.subarray(cursor, cursor + payloadLength);
  const data = Buffer.alloc(payload.length);
  if (masked && maskKey) {
    for (let index = 0; index < payload.length; index += 1) {
      data[index] = payload[index]! ^ maskKey[index % 4]!;
    }
  } else {
    payload.copy(data);
  }

  const type = websocketOpcodeName(opcode);
  if (!type) {
    throw new Error(`Unsupported WebSocket opcode 0x${opcode.toString(16)}`);
  }

  let closeCode: number | null = null;
  let closeReason: string | null = null;
  if (type === 'close' && data.length >= 2) {
    closeCode = data.readUInt16BE(0);
    closeReason = data.subarray(2).toString('utf8');
  }

  return {
    frame: {
      type,
      fin,
      opcode,
      masked,
      data,
      closeCode,
      closeReason,
      receivedAt: Date.now(),
    },
    bytesConsumed: cursor + payloadLength,
  };
}

export function wakeWebSocketWaiters(session: WebSocketSession): void {
  for (const waiter of session.waiters) {
    waiter();
  }
  session.waiters.clear();
}

export function waitForWebSocketActivity(
  session: WebSocketSession,
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
