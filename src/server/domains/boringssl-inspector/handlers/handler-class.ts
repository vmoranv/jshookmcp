/**
 * BoringsslInspectorHandlers — handler methods using shared utilities from ./shared.ts.
 */

import { createServer as createNetServer, isIP, Socket as NetSocket } from 'node:net';
import { createSocket as createUdpSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { checkServerIdentity, connect as createTlsConnection, type TLSSocket } from 'node:tls';
import {
  TLSKeyLogExtractor,
  enableKeyLog,
  disableKeyLog,
  getKeyLogFilePath,
  parseKeyLog as parseKeyLogEntries,
  summarizeKeyLog as summarizeKeyLogEntries,
  lookupSecret as lookupSecretEntry,
  decryptPayload as decryptPayloadFunc,
} from '@modules/boringssl-inspector';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolResponse } from '@server/types';
import {
  argBool,
  argEnum,
  argNumber,
  argString,
  argStringArray,
} from '@server/domains/shared/parse-args';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import type {
  BufferedSession,
  TcpSession,
  TlsSession,
  WebSocketSession,
  SessionSocket,
  SessionKind,
  WebSocketEventName,
  WebSocketFrameType,
  WebSocketScheme,
  ProbeTlsVersion,
  TlsTargetSummary,
  TlsPolicySummary,
  WebSocketTargetSummary,
} from './shared';
import {
  TLS_VERSION_SET,
  validateNetworkTarget,
  makeSessionId,
  loadProbeCaBundle,
  serializeSocketAddresses,
  serializeSessionState,
  serializeWebSocketSessionState,
  normalizeWebSocketPath,
  computeWebSocketAccept,
  encodeWebSocketFrame,
  tryConsumeWebSocketFrame,
  attachBufferedSession,
  waitForSessionActivity,
  wakeWebSocketWaiters,
  waitForWebSocketActivity,
  consumeSessionBuffer,
  normalizeHex,
  isHex,
  tlsVersionName,
  contentTypeName,
  parseClientHello,
  parseCertificateChain,
  errorMessage,
  normalizeSocketServername,
  normalizeAlpnProtocol,
  buildPeerCertificateChain,
  hasPeerCertificate,
} from './shared';

export class BoringsslInspectorHandlers {
  private extensionInvoke?: (...args: unknown[]) => Promise<unknown>;
  private eventBus?: EventBus<ServerEventMap>;
  private readonly tcpSessions = new Map<string, TcpSession>();
  private readonly tlsSessions = new Map<string, TlsSession>();
  private readonly websocketSessions = new Map<string, WebSocketSession>();

  constructor(private keyLogExtractor: TLSKeyLogExtractor = new TLSKeyLogExtractor()) {}

  setExtensionInvoke(invoke: (...args: unknown[]) => Promise<unknown>): void {
    this.extensionInvoke = invoke;
  }

  setEventBus(eventBus: EventBus<ServerEventMap>): void {
    this.eventBus = eventBus;
  }

  private getTcpSession(sessionId: string): TcpSession | null {
    return this.tcpSessions.get(sessionId) ?? null;
  }

  private getTlsSession(sessionId: string): TlsSession | null {
    return this.tlsSessions.get(sessionId) ?? null;
  }

  private getWebSocketSession(sessionId: string): WebSocketSession | null {
    return this.websocketSessions.get(sessionId) ?? null;
  }

  private emitWebSocketEvent<K extends WebSocketEventName>(
    event: K,
    payload: ServerEventMap[K],
  ): void {
    void this.eventBus?.emit(event, payload);
  }

  private parseWritePayload(
    args: Record<string, unknown>,
  ): { ok: true; data: Buffer; inputEncoding: 'hex' | 'utf8' } | { ok: false; error: string } {
    const dataHex = argString(args, 'dataHex');
    const dataText = argString(args, 'dataText');

    if (!dataHex && !dataText) {
      return { ok: false, error: 'dataHex or dataText is required' };
    }
    if (dataHex && dataText) {
      return { ok: false, error: 'dataHex and dataText are mutually exclusive' };
    }

    if (dataHex) {
      const normalized = normalizeHex(dataHex);
      if (!isHex(normalized)) {
        return { ok: false, error: 'dataHex must be valid even-length hexadecimal data' };
      }
      return {
        ok: true,
        data: Buffer.from(normalized, 'hex'),
        inputEncoding: 'hex',
      };
    }

    return {
      ok: true,
      data: Buffer.from(dataText ?? '', 'utf8'),
      inputEncoding: 'utf8',
    };
  }

  private async writeBufferedSession(
    session: BufferedSession,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (session.socket.destroyed || session.closed) {
      return {
        ok: false,
        error: `Session "${session.id}" is already closed`,
        sessionId: session.id,
        kind: session.kind,
        state: serializeSessionState(session),
      };
    }

    const payload = this.parseWritePayload(args);
    if (!payload.ok) {
      return { ok: false, error: payload.error, sessionId: session.id, kind: session.kind };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    return new Promise<unknown>((resolve) => {
      let settled = false;
      const finish = (result: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        session.socket.off('error', onError);
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({
          ok: false,
          error: 'write timed out',
          sessionId: session.id,
          kind: session.kind,
          state: serializeSessionState(session),
        });
      }, timeoutMs);

      const onError = (error: Error): void => {
        finish({
          ok: false,
          error: error.message,
          sessionId: session.id,
          kind: session.kind,
          state: serializeSessionState(session),
        });
      };

      session.socket.once('error', onError);
      session.socket.write(payload.data, () => {
        if (session.kind === 'tcp') {
          void this.eventBus?.emit('tcp:session_written', {
            sessionId: session.id,
            byteLength: payload.data.length,
            timestamp: new Date().toISOString(),
          });
        } else {
          void this.eventBus?.emit('tls:session_written', {
            sessionId: session.id,
            byteLength: payload.data.length,
            timestamp: new Date().toISOString(),
          });
        }
        finish({
          ok: true,
          sessionId: session.id,
          kind: session.kind,
          inputEncoding: payload.inputEncoding,
          bytesWritten: payload.data.length,
          transport: serializeSocketAddresses(session.socket),
          state: serializeSessionState(session),
        });
      });
    });
  }

  private async readBufferedSessionUntil(
    session: BufferedSession,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const delimiterHex = argString(args, 'delimiterHex');
    const delimiterText = argString(args, 'delimiterText');
    if (delimiterHex && delimiterText) {
      return { ok: false, error: 'delimiterHex and delimiterText are mutually exclusive' };
    }

    let delimiter: Buffer | null = null;
    if (delimiterHex) {
      const normalized = normalizeHex(delimiterHex);
      if (!isHex(normalized)) {
        return { ok: false, error: 'delimiterHex must be valid even-length hexadecimal data' };
      }
      delimiter = Buffer.from(normalized, 'hex');
    } else if (delimiterText !== undefined) {
      delimiter = Buffer.from(delimiterText, 'utf8');
    }

    if (delimiter && delimiter.length === 0) {
      return { ok: false, error: 'delimiter must not be empty' };
    }

    const includeDelimiter = argBool(args, 'includeDelimiter') ?? true;
    const rawMaxBytes = argNumber(args, 'maxBytes');
    const maxBytes = rawMaxBytes === undefined ? undefined : Math.trunc(rawMaxBytes);
    if (maxBytes !== undefined && (!Number.isFinite(maxBytes) || maxBytes <= 0)) {
      return { ok: false, error: 'maxBytes must be a positive integer when provided' };
    }
    if (!delimiter && maxBytes === undefined) {
      return { ok: false, error: 'delimiterHex, delimiterText, or maxBytes is required' };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    if (session.activeRead) {
      return {
        ok: false,
        error: `Session "${session.id}" already has a pending read`,
        sessionId: session.id,
        kind: session.kind,
        state: serializeSessionState(session),
      };
    }

    session.activeRead = true;
    const startedAt = Date.now();

    try {
      while (true) {
        const consumed = consumeSessionBuffer(session, delimiter, includeDelimiter, maxBytes);
        if (consumed) {
          if (session.kind === 'tcp') {
            void this.eventBus?.emit('tcp:session_read', {
              sessionId: session.id,
              byteLength: consumed.data.length,
              matched: consumed.matchedDelimiter,
              timestamp: new Date().toISOString(),
            });
          } else {
            void this.eventBus?.emit('tls:session_read', {
              sessionId: session.id,
              byteLength: consumed.data.length,
              matched: consumed.matchedDelimiter,
              timestamp: new Date().toISOString(),
            });
          }
          return {
            ok: true,
            sessionId: session.id,
            kind: session.kind,
            bytesRead: consumed.data.length,
            matchedDelimiter: consumed.matchedDelimiter,
            stopReason: consumed.stopReason,
            delimiterHex: consumed.delimiterHex,
            dataHex: consumed.data.toString('hex').toUpperCase(),
            dataText: consumed.data.toString('utf8'),
            elapsedMs: Date.now() - startedAt,
            state: serializeSessionState(session),
          };
        }

        if (session.error) {
          return {
            ok: false,
            error: session.error,
            sessionId: session.id,
            kind: session.kind,
            state: serializeSessionState(session),
          };
        }

        if (session.ended || session.closed) {
          return {
            ok: false,
            error: 'socket closed before the requested read condition was satisfied',
            sessionId: session.id,
            kind: session.kind,
            state: serializeSessionState(session),
          };
        }

        const remainingMs = timeoutMs - (Date.now() - startedAt);
        if (remainingMs <= 0) {
          return {
            ok: false,
            error: 'read timed out',
            sessionId: session.id,
            kind: session.kind,
            state: serializeSessionState(session),
          };
        }

        const hadActivity = await waitForSessionActivity(session, remainingMs);
        if (!hadActivity) {
          return {
            ok: false,
            error: 'read timed out',
            sessionId: session.id,
            kind: session.kind,
            state: serializeSessionState(session),
          };
        }
      }
    } finally {
      session.activeRead = false;
    }
  }

  private attachWebSocketSession(session: WebSocketSession): void {
    const parseBufferedFrames = (): void => {
      while (session.parserBuffer.length > 0) {
        let consumed: ReturnType<typeof tryConsumeWebSocketFrame>;
        try {
          consumed = tryConsumeWebSocketFrame(session.parserBuffer);
        } catch (error) {
          session.error = errorMessage(error);
          session.socket.destroy();
          break;
        }

        if (!consumed) {
          break;
        }

        session.parserBuffer = session.parserBuffer.subarray(consumed.bytesConsumed);
        const frame = consumed.frame;
        session.frames.push(frame);

        if (frame.type === 'ping' && !session.closeSent && !session.socket.destroyed) {
          const pongFrame = encodeWebSocketFrame('pong', frame.data);
          session.socket.write(pongFrame);
          this.emitWebSocketEvent('websocket:session_written', {
            sessionId: session.id,
            frameType: 'pong',
            byteLength: frame.data.length,
            automatic: true,
            timestamp: new Date().toISOString(),
          });
        }

        if (frame.type === 'close') {
          session.closeReceived = true;
          if (!session.closeSent && !session.socket.destroyed) {
            session.closeSent = true;
            session.socket.write(
              encodeWebSocketFrame('close', frame.data, frame.closeCode, frame.closeReason),
            );
            this.emitWebSocketEvent('websocket:session_written', {
              sessionId: session.id,
              frameType: 'close',
              byteLength: frame.data.length,
              automatic: true,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      wakeWebSocketWaiters(session);
    };

    session.socket.on('data', (chunk: Buffer) => {
      session.parserBuffer = Buffer.concat([session.parserBuffer, chunk]);
      parseBufferedFrames();
    });

    session.socket.on('end', () => {
      session.ended = true;
      wakeWebSocketWaiters(session);
    });

    session.socket.on('close', () => {
      session.closed = true;
      wakeWebSocketWaiters(session);
    });

    session.socket.on('error', (error: Error) => {
      session.error = error.message;
      wakeWebSocketWaiters(session);
    });

    parseBufferedFrames();
  }

  private async readWebSocketFrame(
    session: WebSocketSession,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    if (session.activeRead) {
      return {
        ok: false,
        error: `Session "${session.id}" already has a pending read`,
        sessionId: session.id,
        kind: session.kind,
        state: serializeWebSocketSessionState(session),
      };
    }

    session.activeRead = true;
    const startedAt = Date.now();

    try {
      while (true) {
        const frame = session.frames.shift();
        if (frame) {
          this.emitWebSocketEvent('websocket:frame_read', {
            sessionId: session.id,
            frameType: frame.type,
            byteLength: frame.data.length,
            timestamp: new Date().toISOString(),
          });
          return {
            ok: true,
            sessionId: session.id,
            kind: session.kind,
            scheme: session.scheme,
            frameType: frame.type,
            fin: frame.fin,
            opcode: frame.opcode,
            masked: frame.masked,
            byteLength: frame.data.length,
            dataHex: frame.data.toString('hex').toUpperCase(),
            dataText: frame.type === 'binary' ? null : frame.data.toString('utf8'),
            closeCode: frame.closeCode,
            closeReason: frame.closeReason,
            elapsedMs: Date.now() - startedAt,
            state: serializeWebSocketSessionState(session),
          };
        }

        if (session.error) {
          return {
            ok: false,
            error: session.error,
            sessionId: session.id,
            kind: session.kind,
            state: serializeWebSocketSessionState(session),
          };
        }

        if (session.closed || session.ended) {
          return {
            ok: false,
            error: 'socket closed before a WebSocket frame was available',
            sessionId: session.id,
            kind: session.kind,
            state: serializeWebSocketSessionState(session),
          };
        }

        const remainingMs = timeoutMs - (Date.now() - startedAt);
        if (remainingMs <= 0) {
          return {
            ok: false,
            error: 'read timed out',
            sessionId: session.id,
            kind: session.kind,
            state: serializeWebSocketSessionState(session),
          };
        }

        const hadActivity = await waitForWebSocketActivity(session, remainingMs);
        if (!hadActivity) {
          return {
            ok: false,
            error: 'read timed out',
            sessionId: session.id,
            kind: session.kind,
            state: serializeWebSocketSessionState(session),
          };
        }
      }
    } finally {
      session.activeRead = false;
    }
  }

  private async sendWebSocketFrame(
    session: WebSocketSession,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (session.closed || session.socket.destroyed) {
      return {
        ok: false,
        error: `Session "${session.id}" is already closed`,
        sessionId: session.id,
        kind: session.kind,
        state: serializeWebSocketSessionState(session),
      };
    }

    const frameType = argEnum(
      args,
      'frameType',
      new Set<WebSocketFrameType>(['text', 'binary', 'ping', 'pong', 'close']),
    );
    if (!frameType) {
      return { ok: false, error: 'frameType is required' };
    }
    const dataHex = argString(args, 'dataHex');
    const dataText = argString(args, 'dataText');
    if (dataHex && dataText) {
      return { ok: false, error: 'dataHex and dataText are mutually exclusive' };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    let payload = Buffer.alloc(0);
    if (dataHex) {
      const normalized = normalizeHex(dataHex);
      if (!isHex(normalized)) {
        return { ok: false, error: 'dataHex must be valid even-length hexadecimal data' };
      }
      payload = Buffer.from(normalized, 'hex');
    } else if (dataText !== undefined) {
      payload = Buffer.from(dataText, 'utf8');
    }

    let closeCode: number | null = null;
    let closeReason: string | null = null;
    if (frameType === 'close') {
      const rawCloseCode = argNumber(args, 'closeCode');
      if (rawCloseCode !== undefined) {
        if (!Number.isInteger(rawCloseCode) || rawCloseCode < 1000 || rawCloseCode > 4999) {
          return { ok: false, error: 'closeCode must be an integer between 1000 and 4999' };
        }
        closeCode = rawCloseCode;
      }
      closeReason = argString(args, 'closeReason') ?? null;
      if (dataHex || dataText) {
        return {
          ok: false,
          error: 'close frames use closeCode/closeReason instead of dataHex/dataText',
        };
      }
      session.closeSent = true;
    }

    if (frameType === 'text' && dataHex) {
      return { ok: false, error: 'text frames require UTF-8 dataText instead of dataHex' };
    }

    const frameBuffer = encodeWebSocketFrame(frameType, payload, closeCode, closeReason);
    return new Promise<unknown>((resolve) => {
      let settled = false;
      const finish = (result: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        session.socket.off('error', onError);
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({
          ok: false,
          error: 'write timed out',
          sessionId: session.id,
          kind: session.kind,
          state: serializeWebSocketSessionState(session),
        });
      }, timeoutMs);

      const onError = (error: Error): void => {
        finish({
          ok: false,
          error: error.message,
          sessionId: session.id,
          kind: session.kind,
          state: serializeWebSocketSessionState(session),
        });
      };

      session.socket.once('error', onError);
      session.socket.write(frameBuffer, () => {
        this.emitWebSocketEvent('websocket:session_written', {
          sessionId: session.id,
          frameType,
          byteLength:
            frameType === 'close'
              ? closeReason
                ? Buffer.byteLength(closeReason) + 2
                : closeCode
                  ? 2
                  : 0
              : payload.length,
          automatic: false,
          timestamp: new Date().toISOString(),
        });
        finish({
          ok: true,
          sessionId: session.id,
          kind: session.kind,
          scheme: session.scheme,
          frameType,
          bytesWritten: frameBuffer.length,
          payloadBytes:
            frameType === 'close'
              ? closeReason
                ? Buffer.byteLength(closeReason) + 2
                : closeCode
                  ? 2
                  : 0
              : payload.length,
          state: serializeWebSocketSessionState(session),
        });
      });
    });
  }

  private async closeWebSocketSession(
    sessionId: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const session = this.websocketSessions.get(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown websocket sessionId "${sessionId}"` };
    }

    const force = argBool(args, 'force') ?? false;
    const timeoutMs = argNumber(args, 'timeoutMs') ?? 1000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const queuedFramesDiscarded = session.frames.length;
    if (session.closed || session.socket.destroyed) {
      this.websocketSessions.delete(sessionId);
      return {
        ok: true,
        sessionId,
        kind: session.kind,
        force,
        closed: true,
        queuedFramesDiscarded,
        state: serializeWebSocketSessionState(session),
      };
    }

    let closeCode: number | null = null;
    const rawCloseCode = argNumber(args, 'closeCode');
    if (rawCloseCode !== undefined) {
      if (!Number.isInteger(rawCloseCode) || rawCloseCode < 1000 || rawCloseCode > 4999) {
        return { ok: false, error: 'closeCode must be an integer between 1000 and 4999' };
      }
      closeCode = rawCloseCode;
    }
    const closeReason = argString(args, 'closeReason') ?? null;

    return new Promise<unknown>((resolve) => {
      let settled = false;
      const finish = (closed: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        session.socket.off('close', onClose);
        session.socket.off('error', onError);
        this.websocketSessions.delete(sessionId);
        this.emitWebSocketEvent('websocket:session_closed', {
          sessionId,
          reason: session.error,
          timestamp: new Date().toISOString(),
        });
        resolve({
          ok: true,
          sessionId,
          kind: session.kind,
          force,
          closed,
          queuedFramesDiscarded,
          state: serializeWebSocketSessionState(session),
        });
      };

      const onClose = (): void => finish(true);
      const onError = (): void => finish(session.socket.destroyed || session.closed);
      const timer = setTimeout(() => {
        session.socket.destroy();
        finish(session.socket.destroyed || session.closed);
      }, timeoutMs);

      session.socket.once('close', onClose);
      session.socket.once('error', onError);

      if (force) {
        session.socket.destroy();
        return;
      }

      if (!session.closeSent) {
        session.closeSent = true;
        session.socket.write(
          encodeWebSocketFrame('close', Buffer.alloc(0), closeCode, closeReason),
        );
        this.emitWebSocketEvent('websocket:session_written', {
          sessionId,
          frameType: 'close',
          byteLength: closeReason ? Buffer.byteLength(closeReason) + 2 : closeCode ? 2 : 0,
          automatic: false,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  private async closeBufferedSession<TSocket extends SessionSocket>(
    sessionId: string,
    sessions: Map<string, BufferedSession<TSocket>>,
    kind: SessionKind,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const session = sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown ${kind} sessionId "${sessionId}"` };
    }

    const force = argBool(args, 'force') ?? false;
    const timeoutMs = argNumber(args, 'timeoutMs') ?? 1000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const bufferedBytesDiscarded = session.buffer.length;
    if (session.closed || session.socket.destroyed) {
      sessions.delete(sessionId);
      return {
        ok: true,
        sessionId,
        kind,
        force,
        closed: true,
        bufferedBytesDiscarded,
        state: serializeSessionState(session),
      };
    }

    return new Promise<unknown>((resolve) => {
      let settled = false;
      const finish = (closed: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        session.socket.off('close', onClose);
        session.socket.off('error', onError);
        sessions.delete(sessionId);
        if (kind === 'tcp') {
          void this.eventBus?.emit('tcp:session_closed', {
            sessionId,
            reason: session.error,
            timestamp: new Date().toISOString(),
          });
        } else {
          void this.eventBus?.emit('tls:session_closed', {
            sessionId,
            reason: session.error,
            timestamp: new Date().toISOString(),
          });
        }
        resolve({
          ok: true,
          sessionId,
          kind,
          force,
          closed,
          bufferedBytesDiscarded,
          state: serializeSessionState(session),
        });
      };

      const onClose = (): void => finish(true);
      const onError = (): void => finish(session.socket.destroyed || session.closed);

      const timer = setTimeout(() => {
        session.socket.destroy();
        finish(session.socket.destroyed || session.closed);
      }, timeoutMs);

      session.socket.once('close', onClose);
      session.socket.once('error', onError);

      if (force) {
        session.socket.destroy();
        return;
      }

      session.socket.end();
    });
  }

  async handleTlsKeylogEnable(_args: Record<string, unknown>): Promise<unknown> {
    const keyLogPath = await this.keyLogExtractor.enableKeyLog();
    return {
      enabled: true,
      keyLogPath,
      environmentVariable: 'SSLKEYLOGFILE',
    };
  }

  async handleTlsKeylogDisable(args: Record<string, unknown>): Promise<unknown> {
    const path = argString(args, 'path') ?? null;
    if (path) {
      await this.keyLogExtractor.disableKeyLog();
    } else {
      disableKeyLog();
    }
    return {
      disabled: true,
      previousPath: path ?? getKeyLogFilePath(),
    };
  }

  async handleTlsKeylogParse(args: Record<string, unknown>): Promise<unknown> {
    const path = argString(args, 'path') ?? null;
    const entries = this.keyLogExtractor.parseKeyLog(path ?? undefined);
    const summary = this.keyLogExtractor.summarizeKeyLog(path ?? undefined);

    return {
      path: path ?? this.keyLogExtractor.getKeyLogFilePath(),
      entries,
      summary,
    };
  }

  async handleTlsDecryptPayload(args: Record<string, unknown>): Promise<unknown> {
    const encryptedHex = argString(args, 'encryptedHex') ?? null;
    const keyHex = argString(args, 'keyHex') ?? null;
    const nonceHex = argString(args, 'nonceHex') ?? null;
    const algorithm = argString(args, 'algorithm') ?? 'aes-256-gcm';
    const authTagHex = argString(args, 'authTagHex') ?? null;

    if (!encryptedHex || !keyHex || !nonceHex) {
      return { ok: false, error: 'encryptedHex, keyHex, and nonceHex are required' };
    }

    const decrypted = decryptPayloadFunc(
      encryptedHex,
      keyHex,
      nonceHex,
      algorithm,
      authTagHex ?? undefined,
    );
    return {
      ok: true,
      algorithm,
      decrypted,
      isFailed: decrypted.startsWith('DECRYPTION_FAILED:'),
    };
  }

  async handleTlsKeylogSummarize(args: Record<string, unknown>): Promise<unknown> {
    const content = argString(args, 'content') ?? null;
    if (content) {
      const entries = parseKeyLogEntries(content);
      return summarizeKeyLogEntries(entries);
    }

    this.keyLogExtractor.parseKeyLog();
    return this.keyLogExtractor.summarizeKeyLog();
  }

  async handleTlsKeylogLookupSecret(args: Record<string, unknown>): Promise<unknown> {
    const clientRandom = argString(args, 'clientRandom') ?? null;
    const label = argString(args, 'label') ?? undefined;

    if (!clientRandom) {
      return { ok: false, error: 'clientRandom is required' };
    }

    // Try the instance-level cache first
    const cached = this.keyLogExtractor.lookupSecret(clientRandom);
    if (cached) {
      return { ok: true, clientRandom: normalizeHex(clientRandom), secret: cached };
    }

    // Fall back to parsing the current keylog file
    const secret = lookupSecretEntry(this.keyLogExtractor.parseKeyLog(), clientRandom, label);
    return {
      ok: secret !== null,
      clientRandom: normalizeHex(clientRandom),
      secret: secret ?? null,
    };
  }

  async handleTlsCertPinBypass(args: Record<string, unknown>): Promise<unknown> {
    const target = argString(args, 'target') ?? null;
    if (target !== 'android' && target !== 'ios' && target !== 'desktop') {
      return {
        error: 'target must be one of android, ios, or desktop',
      };
    }

    const strategyByTarget: Record<'android' | 'ios' | 'desktop', string> = {
      android: 'hook-trust-manager',
      ios: 'replace-sec-trust-evaluation',
      desktop: 'patch-custom-verifier',
    };

    const instructionsByTarget: Record<'android' | 'ios' | 'desktop', string[]> = {
      android: [
        'Inject a Frida script that overrides X509TrustManager checks.',
        'Re-run the target flow after SSLKEYLOGFILE capture is enabled.',
      ],
      ios: [
        'Hook SecTrustEvaluateWithError and return success for the target session.',
        'Collect TLS keys after the app resumes the failing request.',
      ],
      desktop: [
        'Patch the custom verifier callback or disable pin comparison in the client.',
        'Capture a fresh handshake after the patched build starts.',
      ],
    };

    return {
      bypassStrategy: strategyByTarget[target],
      affectedDomains: ['*'],
      instructions: instructionsByTarget[target],
    };
  }

  async handleParseHandshake(args: Record<string, unknown>): Promise<ToolResponse> {
    const rawHex = argString(args, 'rawHex') ?? null;
    const decrypt = args.decrypt === true;
    if (!rawHex) {
      return asJsonResponse({
        success: false,
        error: 'rawHex is required',
      });
    }

    const normalizedHex = normalizeHex(rawHex);
    if (!isHex(normalizedHex)) {
      return asJsonResponse({
        success: false,
        error: 'Invalid hex payload',
      });
    }

    const record = Buffer.from(normalizedHex, 'hex');
    if (record.length < 5) {
      return asJsonResponse({
        success: false,
        error: 'TLS record is too short',
      });
    }

    const contentType = record[0] ?? 0;
    const versionMajor = record[1] ?? 0;
    const versionMinor = record[2] ?? 0;
    const declaredLength = record.readUInt16BE(3);
    const payload = record.subarray(5);

    const clientHello =
      contentType === 0x16 && payload.length > 0 && payload[0] === 1
        ? parseClientHello(payload)
        : undefined;

    const decryptedPreviewHex = decrypt
      ? (() => {
          const decrypted = this.keyLogExtractor.decryptPayload(
            normalizedHex,
            this.keyLogExtractor.parseKeyLog(),
          );
          return decrypted ? decrypted.subarray(0, 16).toString('hex').toUpperCase() : null;
        })()
      : undefined;

    return asJsonResponse({
      success: true,
      record: {
        contentType,
        contentTypeName: contentTypeName(contentType),
        version: tlsVersionName(versionMajor, versionMinor),
        declaredLength,
        actualLength: payload.length,
      },
      handshake: {
        version: tlsVersionName(versionMajor, versionMinor),
        contentType: contentTypeName(contentType),
        ...(clientHello
          ? {
              type: 'client_hello',
              serverName: clientHello.serverName,
              cipherSuites: clientHello.cipherSuites,
              extensions: clientHello.extensions,
            }
          : {
              cipherSuite: [],
              extensions: [],
            }),
      },
      sni: clientHello?.serverName ? { serverName: clientHello.serverName } : undefined,
      ...(decryptedPreviewHex !== undefined ? { decryptedPreviewHex } : {}),
    });
  }

  async handleKeyLogEnable(args: Record<string, unknown>): Promise<ToolResponse> {
    const filePath = argString(args, 'filePath') ?? '/tmp/sslkeylog.log';
    enableKeyLog(filePath);
    void this.eventBus?.emit('tls:keylog_started', {
      filePath,
      timestamp: new Date().toISOString(),
    });
    return asJsonResponse({
      success: true,
      filePath,
      currentFilePath: getKeyLogFilePath(),
    });
  }

  async handleCipherSuites(args: Record<string, unknown>): Promise<ToolResponse> {
    const filter = argString(args, 'filter') ?? null;
    const allSuites = [
      'TLS_AES_128_GCM_SHA256',
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_AES_128_CCM_SHA256',
      'TLS_AES_128_CCM_8_SHA256',
      'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
      'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
      'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
      'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
      'TLS_RSA_WITH_AES_128_GCM_SHA256',
      'TLS_RSA_WITH_AES_256_GCM_SHA384',
    ];
    const filteredSuites = filter ? allSuites.filter((suite) => suite.includes(filter)) : allSuites;
    return asJsonResponse({
      success: true,
      filter,
      total: filteredSuites.length,
      suites: filteredSuites,
    });
  }

  async handleParseCertificate(args: Record<string, unknown>): Promise<ToolResponse> {
    const rawHex = argString(args, 'rawHex') ?? null;
    if (!rawHex) {
      return asJsonResponse({
        success: false,
        error: 'rawHex is required',
      });
    }

    const certs = parseCertificateChain(rawHex);
    return asJsonResponse({
      success: true,
      certificateCount: certs.length,
      fingerprints: certs.map((c) => ({
        sha256: c.sha256,
        length: c.length,
      })),
    });
  }

  async handleTlsProbeEndpoint(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host')?.trim() ?? null;
    if (!host) {
      return { ok: false, error: 'host is required' };
    }

    const port = argNumber(args, 'port') ?? 443;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be an integer between 1 and 65535' };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const allowInvalidCertificates = argBool(args, 'allowInvalidCertificates') ?? false;
    const skipHostnameCheck = argBool(args, 'skipHostnameCheck') ?? false;
    const servernameArg = argString(args, 'servername')?.trim() ?? null;
    const alpnProtocols = [
      ...new Set(argStringArray(args, 'alpnProtocols').map((v) => v.trim())),
    ].filter((v) => v.length > 0);

    let minVersion: ProbeTlsVersion | undefined;
    let maxVersion: ProbeTlsVersion | undefined;
    try {
      minVersion = argEnum(args, 'minVersion', TLS_VERSION_SET);
      maxVersion = argEnum(args, 'maxVersion', TLS_VERSION_SET);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }

    const versionOrder: ProbeTlsVersion[] = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];
    if (
      minVersion &&
      maxVersion &&
      versionOrder.indexOf(minVersion) > versionOrder.indexOf(maxVersion)
    ) {
      return { ok: false, error: 'minVersion must not be greater than maxVersion' };
    }

    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) {
      return ssrfCheck;
    }

    const caBundle = await loadProbeCaBundle(args);
    if (!caBundle.ok) {
      return { ok: false, error: caBundle.error };
    }

    const validationTarget = servernameArg ?? host;
    const requestedServername = servernameArg ?? (isIP(host) === 0 ? host : undefined);
    const startedAt = Date.now();

    return new Promise<unknown>((resolve) => {
      let settled = false;
      const socket = createTlsConnection({
        host,
        port,
        servername: requestedServername,
        rejectUnauthorized: false,
        ...(minVersion ? { minVersion } : {}),
        ...(maxVersion ? { maxVersion } : {}),
        ...(alpnProtocols.length > 0 ? { ALPNProtocols: alpnProtocols } : {}),
        ...(caBundle.ca ? { ca: caBundle.ca } : {}),
      });

      const finish = (payload: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.destroy();
        resolve(payload);
      };

      const timer = setTimeout(() => {
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: false,
          timestamp: new Date().toISOString(),
        });
        finish({
          ok: false,
          error: 'TLS probe timed out',
          target: {
            host,
            port,
            requestedServername: requestedServername ?? null,
            validationTarget,
          },
          policy: {
            allowInvalidCertificates,
            skipHostnameCheck,
            timeoutMs,
            minVersion: minVersion ?? null,
            maxVersion: maxVersion ?? null,
            alpnProtocols,
            customCa: {
              source: caBundle.source,
              path: caBundle.path,
              bytes: caBundle.bytes,
            },
          },
        });
      }, timeoutMs);

      socket.once('error', (error: NodeJS.ErrnoException) => {
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: false,
          timestamp: new Date().toISOString(),
        });
        finish({
          ok: false,
          error: error.message,
          errorCode: error.code ?? null,
          target: {
            host,
            port,
            requestedServername: requestedServername ?? null,
            validationTarget,
          },
          policy: {
            allowInvalidCertificates,
            skipHostnameCheck,
            timeoutMs,
            minVersion: minVersion ?? null,
            maxVersion: maxVersion ?? null,
            alpnProtocols,
            customCa: {
              source: caBundle.source,
              path: caBundle.path,
              bytes: caBundle.bytes,
            },
          },
        });
      });

      socket.once('secureConnect', () => {
        const handshakeMs = Date.now() - startedAt;
        const peerCertificate = socket.getPeerCertificate(true);
        const hasLeafCertificate = hasPeerCertificate(peerCertificate);
        const certificateChain = hasLeafCertificate
          ? buildPeerCertificateChain(peerCertificate)
          : [];
        const leafCertificate = certificateChain[0] ?? null;
        const hostnameError =
          skipHostnameCheck || !hasLeafCertificate
            ? undefined
            : checkServerIdentity(validationTarget, peerCertificate);
        const hostnameValidation = {
          checked: !skipHostnameCheck,
          target: skipHostnameCheck ? null : validationTarget,
          matched: skipHostnameCheck ? null : hostnameError === undefined,
          error:
            !skipHostnameCheck && !hasLeafCertificate
              ? 'Peer certificate was not presented by the server'
              : (hostnameError?.message ?? null),
        };

        const authorizationReasons = [
          socket.authorized
            ? 'Certificate chain validated against the active trust store.'
            : `Certificate chain validation failed: ${socket.authorizationError ?? 'unknown_authority'}`,
          skipHostnameCheck
            ? 'Hostname validation was skipped by request.'
            : hostnameValidation.matched
              ? 'Hostname validation passed.'
              : `Hostname validation failed: ${hostnameValidation.error ?? 'unknown_error'}`,
          !socket.authorized && allowInvalidCertificates
            ? 'Policy allowed the probe to continue despite certificate trust failure.'
            : null,
        ].filter((reason): reason is string => Boolean(reason));

        const cipher = socket.getCipher();
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: true,
          timestamp: new Date().toISOString(),
        });

        finish({
          ok: true,
          target: {
            host,
            port,
            requestedServername: requestedServername ?? null,
            validationTarget,
          },
          policy: {
            allowInvalidCertificates,
            skipHostnameCheck,
            timeoutMs,
            minVersion: minVersion ?? null,
            maxVersion: maxVersion ?? null,
            alpnProtocols,
            customCa: {
              source: caBundle.source,
              path: caBundle.path,
              bytes: caBundle.bytes,
            },
          },
          transport: {
            protocol: socket.getProtocol() ?? null,
            alpnProtocol: normalizeAlpnProtocol(socket.alpnProtocol),
            cipher: {
              name: cipher.name,
              standardName: cipher.standardName,
              version: cipher.version,
            },
            localAddress: socket.localAddress ?? null,
            localPort: socket.localPort ?? null,
            remoteAddress: socket.remoteAddress ?? null,
            remotePort: socket.remotePort ?? null,
            servernameSent: normalizeSocketServername(socket.servername),
            sessionReused: socket.isSessionReused(),
          },
          authorization: {
            socketAuthorized: socket.authorized,
            authorizationError:
              typeof socket.authorizationError === 'string'
                ? socket.authorizationError
                : (socket.authorizationError?.message ?? null),
            hostnameValidation,
            policyAllowed:
              (socket.authorized || allowInvalidCertificates) &&
              (skipHostnameCheck || hostnameValidation.matched === true),
            reasons: authorizationReasons,
          },
          certificates: {
            leaf: leafCertificate,
            chain: certificateChain,
          },
          timing: {
            handshakeMs,
          },
        });
      });
    });
  }

  async handleTcpOpen(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host') ?? '127.0.0.1';
    const port = argNumber(args, 'port');
    if (port === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be an integer between 1 and 65535' };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const noDelay = argBool(args, 'noDelay') ?? true;
    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) {
      return ssrfCheck;
    }

    return new Promise<unknown>((resolve) => {
      let settled = false;
      const socket = new NetSocket();

      const finish = (payload: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('error', onError);
        resolve(payload);
      };

      const timer = setTimeout(() => {
        socket.destroy();
        finish({ ok: false, error: 'TCP connect timed out', target: { host, port } });
      }, timeoutMs);

      const onError = (error: Error): void => {
        finish({ ok: false, error: error.message, target: { host, port } });
      };

      const onConnect = (): void => {
        socket.setNoDelay(noDelay);
        const sessionId = makeSessionId('tcp');
        const session: TcpSession = {
          id: sessionId,
          kind: 'tcp',
          socket,
          host,
          port,
          createdAt: Date.now(),
          buffer: Buffer.alloc(0),
          ended: false,
          closed: false,
          error: null,
          waiters: new Set(),
          activeRead: false,
        };
        attachBufferedSession(session);
        this.tcpSessions.set(sessionId, session);
        void this.eventBus?.emit('tcp:session_opened', {
          sessionId,
          host,
          port,
          timestamp: new Date().toISOString(),
        });

        finish({
          ok: true,
          sessionId,
          kind: 'tcp',
          target: { host, port },
          createdAt: new Date(session.createdAt).toISOString(),
          transport: serializeSocketAddresses(socket),
          state: serializeSessionState(session),
        });
      };

      socket.once('connect', onConnect);
      socket.once('error', onError);
      socket.connect(port, host);
    });
  }

  async handleTcpWrite(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }

    const session = this.getTcpSession(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown tcp sessionId "${sessionId}"` };
    }

    return this.writeBufferedSession(session, args);
  }

  async handleTcpReadUntil(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }

    const session = this.getTcpSession(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown tcp sessionId "${sessionId}"` };
    }

    return this.readBufferedSessionUntil(session, args);
  }

  async handleTcpClose(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }

    return this.closeBufferedSession(sessionId, this.tcpSessions, 'tcp', args);
  }

  async handleTlsOpen(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host')?.trim() ?? null;
    if (!host) {
      return { ok: false, error: 'host is required' };
    }

    const port = argNumber(args, 'port') ?? 443;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be an integer between 1 and 65535' };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const allowInvalidCertificates = argBool(args, 'allowInvalidCertificates') ?? false;
    const skipHostnameCheck = argBool(args, 'skipHostnameCheck') ?? false;
    const servernameArg = argString(args, 'servername')?.trim() ?? null;
    const alpnProtocols = [
      ...new Set(argStringArray(args, 'alpnProtocols').map((value) => value.trim())),
    ].filter((value) => value.length > 0);

    let minVersion: ProbeTlsVersion | undefined;
    let maxVersion: ProbeTlsVersion | undefined;
    try {
      minVersion = argEnum(args, 'minVersion', TLS_VERSION_SET);
      maxVersion = argEnum(args, 'maxVersion', TLS_VERSION_SET);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }

    const versionOrder: ProbeTlsVersion[] = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];
    if (
      minVersion &&
      maxVersion &&
      versionOrder.indexOf(minVersion) > versionOrder.indexOf(maxVersion)
    ) {
      return { ok: false, error: 'minVersion must not be greater than maxVersion' };
    }

    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) {
      return ssrfCheck;
    }

    const caBundle = await loadProbeCaBundle(args);
    if (!caBundle.ok) {
      return { ok: false, error: caBundle.error };
    }

    const target: TlsTargetSummary = {
      host,
      port,
      requestedServername: servernameArg ?? (isIP(host) === 0 ? host : undefined) ?? null,
      validationTarget: servernameArg ?? host,
    };
    const policy: TlsPolicySummary = {
      allowInvalidCertificates,
      skipHostnameCheck,
      timeoutMs,
      minVersion: minVersion ?? null,
      maxVersion: maxVersion ?? null,
      alpnProtocols,
      customCa: {
        source: caBundle.source,
        path: caBundle.path,
        bytes: caBundle.bytes,
      },
    };
    const startedAt = Date.now();

    return new Promise<unknown>((resolve) => {
      let settled = false;
      const socket = createTlsConnection({
        host,
        port,
        servername: target.requestedServername ?? undefined,
        rejectUnauthorized: false,
        ...(minVersion ? { minVersion } : {}),
        ...(maxVersion ? { maxVersion } : {}),
        ...(alpnProtocols.length > 0 ? { ALPNProtocols: alpnProtocols } : {}),
        ...(caBundle.ca ? { ca: caBundle.ca } : {}),
      });

      const finish = (payload: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.off('error', onError);
        socket.off('secureConnect', onSecureConnect);
        resolve(payload);
      };

      const timer = setTimeout(() => {
        socket.destroy();
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: false,
          timestamp: new Date().toISOString(),
        });
        finish({
          ok: false,
          error: 'TLS open timed out',
          target,
          policy,
        });
      }, timeoutMs);

      const onError = (error: NodeJS.ErrnoException): void => {
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: false,
          timestamp: new Date().toISOString(),
        });
        finish({
          ok: false,
          error: error.message,
          errorCode: error.code ?? null,
          target,
          policy,
        });
      };

      const onSecureConnect = (): void => {
        const handshakeMs = Date.now() - startedAt;
        const peerCertificate = socket.getPeerCertificate(true);
        const hasLeafCertificate = hasPeerCertificate(peerCertificate);
        const certificateChain = hasLeafCertificate
          ? buildPeerCertificateChain(peerCertificate)
          : [];
        const leafCertificate = certificateChain[0] ?? null;
        const hostnameError =
          skipHostnameCheck || !hasLeafCertificate
            ? undefined
            : checkServerIdentity(target.validationTarget, peerCertificate);
        const hostnameValidation = {
          checked: !skipHostnameCheck,
          target: skipHostnameCheck ? null : target.validationTarget,
          matched: skipHostnameCheck ? null : hostnameError === undefined,
          error:
            !skipHostnameCheck && !hasLeafCertificate
              ? 'Peer certificate was not presented by the server'
              : (hostnameError?.message ?? null),
        };

        const authorizationReasons = [
          socket.authorized
            ? 'Certificate chain validated against the active trust store.'
            : `Certificate chain validation failed: ${socket.authorizationError ?? 'unknown_authority'}`,
          skipHostnameCheck
            ? 'Hostname validation was skipped by request.'
            : hostnameValidation.matched
              ? 'Hostname validation passed.'
              : `Hostname validation failed: ${hostnameValidation.error ?? 'unknown_error'}`,
          !socket.authorized && allowInvalidCertificates
            ? 'Policy allowed the session to continue despite certificate trust failure.'
            : null,
        ].filter((reason): reason is string => Boolean(reason));

        const cipher = socket.getCipher();
        const metadata: TlsSession['metadata'] = {
          target,
          policy,
          transport: {
            protocol: socket.getProtocol() ?? null,
            alpnProtocol: normalizeAlpnProtocol(socket.alpnProtocol),
            cipher: {
              name: cipher.name,
              standardName: cipher.standardName,
              version: cipher.version,
            },
            localAddress: socket.localAddress ?? null,
            localPort: socket.localPort ?? null,
            remoteAddress: socket.remoteAddress ?? null,
            remotePort: socket.remotePort ?? null,
            servernameSent: normalizeSocketServername(socket.servername),
            sessionReused: socket.isSessionReused(),
          },
          authorization: {
            socketAuthorized: socket.authorized,
            authorizationError:
              typeof socket.authorizationError === 'string'
                ? socket.authorizationError
                : (socket.authorizationError?.message ?? null),
            hostnameValidation,
            policyAllowed:
              (socket.authorized || allowInvalidCertificates) &&
              (skipHostnameCheck || hostnameValidation.matched === true),
            reasons: authorizationReasons,
          },
          certificates: {
            leaf: leafCertificate,
            chain: certificateChain,
          },
        };

        if (!metadata.authorization.policyAllowed) {
          socket.destroy();
          void this.eventBus?.emit('tls:probe_completed', {
            host,
            port,
            success: false,
            timestamp: new Date().toISOString(),
          });
          finish({
            ok: false,
            error: 'TLS session authorization failed',
            ...metadata,
            timing: {
              handshakeMs,
            },
          });
          return;
        }

        const sessionId = makeSessionId('tls');
        const session: TlsSession = {
          id: sessionId,
          kind: 'tls',
          socket,
          host,
          port,
          createdAt: Date.now(),
          buffer: Buffer.alloc(0),
          ended: false,
          closed: false,
          error: null,
          waiters: new Set(),
          activeRead: false,
          metadata,
        };
        attachBufferedSession(session);
        this.tlsSessions.set(sessionId, session);
        void this.eventBus?.emit('tls:session_opened', {
          sessionId,
          host,
          port,
          timestamp: new Date().toISOString(),
        });
        void this.eventBus?.emit('tls:probe_completed', {
          host,
          port,
          success: true,
          timestamp: new Date().toISOString(),
        });

        finish({
          ok: true,
          sessionId,
          kind: 'tls',
          ...metadata,
          timing: {
            handshakeMs,
          },
          state: serializeSessionState(session),
        });
      };

      socket.once('error', onError);
      socket.once('secureConnect', onSecureConnect);
    });
  }

  async handleTlsWrite(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }

    const session = this.getTlsSession(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown tls sessionId "${sessionId}"` };
    }

    return this.writeBufferedSession(session, args);
  }

  async handleTlsReadUntil(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }

    const session = this.getTlsSession(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown tls sessionId "${sessionId}"` };
    }

    return this.readBufferedSessionUntil(session, args);
  }

  async handleTlsClose(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }

    return this.closeBufferedSession(sessionId, this.tlsSessions, 'tls', args);
  }

  async handleWebSocketOpen(args: Record<string, unknown>): Promise<unknown> {
    const rawUrl = argString(args, 'url')?.trim() ?? null;
    const rawHost = argString(args, 'host')?.trim() ?? null;
    const rawPath = argString(args, 'path')?.trim() ?? null;
    const rawPort = argNumber(args, 'port');
    const rawScheme = argString(args, 'scheme')?.trim() ?? null;
    if (rawUrl && (rawHost || rawPath || rawPort !== undefined || rawScheme)) {
      return {
        ok: false,
        error: 'url is mutually exclusive with explicit scheme/host/port/path inputs',
      };
    }

    let scheme: WebSocketScheme = 'ws';
    let host = rawHost;
    let port = rawPort ?? undefined;
    let path = normalizeWebSocketPath(rawPath);
    let url: string;

    if (rawUrl) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawUrl);
      } catch (error) {
        return { ok: false, error: `Invalid url: ${errorMessage(error)}` };
      }
      if (parsedUrl.protocol !== 'ws:' && parsedUrl.protocol !== 'wss:') {
        return { ok: false, error: 'url must use ws:// or wss:// protocol' };
      }
      scheme = parsedUrl.protocol === 'wss:' ? 'wss' : 'ws';
      host = parsedUrl.hostname;
      port = parsedUrl.port.length > 0 ? Number(parsedUrl.port) : scheme === 'wss' ? 443 : 80;
      path = normalizeWebSocketPath(`${parsedUrl.pathname}${parsedUrl.search}`);
      url = `${scheme}://${parsedUrl.host}${path}`;
    } else {
      if (!host) {
        return { ok: false, error: 'host or url is required' };
      }
      if (rawScheme) {
        if (rawScheme !== 'ws' && rawScheme !== 'wss') {
          return { ok: false, error: 'scheme must be ws or wss' };
        }
        scheme = rawScheme;
      }
      port ??= scheme === 'wss' ? 443 : 80;
      const authority = port === (scheme === 'wss' ? 443 : 80) ? host : `${host}:${String(port)}`;
      url = `${scheme}://${authority}${path}`;
    }

    if (!host || !port || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be an integer between 1 and 65535' };
    }

    const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, error: 'timeoutMs must be a positive number' };
    }

    const subprotocols = [
      ...new Set(argStringArray(args, 'subprotocols').map((value) => value.trim())),
    ].filter((value) => value.length > 0);

    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) {
      return ssrfCheck;
    }

    const allowInvalidCertificates = argBool(args, 'allowInvalidCertificates') ?? false;
    const skipHostnameCheck = argBool(args, 'skipHostnameCheck') ?? false;
    const servernameArg = argString(args, 'servername')?.trim() ?? null;
    const alpnProtocols = [
      ...new Set(argStringArray(args, 'alpnProtocols').map((value) => value.trim())),
    ].filter((value) => value.length > 0);

    let minVersion: ProbeTlsVersion | undefined;
    let maxVersion: ProbeTlsVersion | undefined;
    try {
      minVersion = argEnum(args, 'minVersion', TLS_VERSION_SET);
      maxVersion = argEnum(args, 'maxVersion', TLS_VERSION_SET);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }

    const versionOrder: ProbeTlsVersion[] = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];
    if (
      minVersion &&
      maxVersion &&
      versionOrder.indexOf(minVersion) > versionOrder.indexOf(maxVersion)
    ) {
      return { ok: false, error: 'minVersion must not be greater than maxVersion' };
    }

    const caBundle =
      scheme === 'wss'
        ? await loadProbeCaBundle(args)
        : { ok: true as const, ca: undefined, source: null, path: null, bytes: null };
    if (!caBundle.ok) {
      return { ok: false, error: caBundle.error };
    }

    const target: WebSocketTargetSummary = {
      scheme,
      url,
      host,
      port,
      path,
      requestedServername:
        scheme === 'wss' ? (servernameArg ?? (isIP(host) === 0 ? host : undefined) ?? null) : null,
      validationTarget: scheme === 'wss' ? (servernameArg ?? host) : null,
    };
    const requestKey = randomBytes(16).toString('base64');
    const acceptKey = computeWebSocketAccept(requestKey);
    const startedAt = Date.now();

    return new Promise<unknown>((resolve) => {
      let settled = false;
      let handshakeBuffer = Buffer.alloc(0);
      let transport: WebSocketSession['metadata']['transport'] | null = null;
      let authorization: WebSocketSession['metadata']['authorization'] = null;
      let certificates: WebSocketSession['metadata']['certificates'] = null;
      const socket: SessionSocket =
        scheme === 'wss'
          ? createTlsConnection({
              host,
              port,
              servername: target.requestedServername ?? undefined,
              rejectUnauthorized: false,
              ...(minVersion ? { minVersion } : {}),
              ...(maxVersion ? { maxVersion } : {}),
              ...(alpnProtocols.length > 0 ? { ALPNProtocols: alpnProtocols } : {}),
              ...(caBundle.ca ? { ca: caBundle.ca } : {}),
            })
          : new NetSocket();

      const finish = (payload: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.off('error', onError);
        socket.off('connect', onConnect);
        socket.off('secureConnect', onSecureConnect);
        socket.off('data', onHandshakeData);
        resolve(payload);
      };

      const buildHandshakeRequest = (): Buffer => {
        const defaultPort = scheme === 'wss' ? 443 : 80;
        const hostHeader = port === defaultPort ? host : `${host}:${String(port)}`;
        const lines = [
          `GET ${path} HTTP/1.1`,
          `Host: ${hostHeader}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${requestKey}`,
          'Sec-WebSocket-Version: 13',
        ];
        if (subprotocols.length > 0) {
          lines.push(`Sec-WebSocket-Protocol: ${subprotocols.join(', ')}`);
        }
        lines.push('', '');
        return Buffer.from(lines.join('\r\n'), 'utf8');
      };

      const timer = setTimeout(() => {
        socket.destroy();
        finish({
          ok: false,
          error: 'WebSocket open timed out',
          target,
        });
      }, timeoutMs);

      const onError = (error: NodeJS.ErrnoException): void => {
        finish({
          ok: false,
          error: error.message,
          errorCode: error.code ?? null,
          target,
        });
      };

      const sendHandshake = (): void => {
        socket.write(buildHandshakeRequest());
      };

      const onConnect = (): void => {
        if (socket instanceof NetSocket) {
          socket.setNoDelay(true);
        }
        transport = {
          ...serializeSocketAddresses(socket),
          protocol: null,
          alpnProtocol: null,
          servernameSent: null,
          sessionReused: null,
        };
        sendHandshake();
      };

      const onSecureConnect = (): void => {
        if (!(socket instanceof Object) || !('getPeerCertificate' in socket)) {
          finish({ ok: false, error: 'Expected a TLS socket for wss session', target });
          return;
        }
        const tlsSocket = socket as TLSSocket;
        const peerCertificate = tlsSocket.getPeerCertificate(true);
        const hasLeafCertificate = hasPeerCertificate(peerCertificate);
        const certificateChain = hasLeafCertificate
          ? buildPeerCertificateChain(peerCertificate)
          : [];
        const leafCertificate = certificateChain[0] ?? null;
        const hostnameError =
          skipHostnameCheck || !hasLeafCertificate || !target.validationTarget
            ? undefined
            : checkServerIdentity(target.validationTarget, peerCertificate);
        const hostnameValidation = {
          checked: !skipHostnameCheck,
          target: skipHostnameCheck ? null : target.validationTarget,
          matched: skipHostnameCheck ? null : hostnameError === undefined,
          error:
            !skipHostnameCheck && !hasLeafCertificate
              ? 'Peer certificate was not presented by the server'
              : (hostnameError?.message ?? null),
        };
        const authorizationReasons = [
          tlsSocket.authorized
            ? 'Certificate chain validated against the active trust store.'
            : `Certificate chain validation failed: ${tlsSocket.authorizationError ?? 'unknown_authority'}`,
          skipHostnameCheck
            ? 'Hostname validation was skipped by request.'
            : hostnameValidation.matched
              ? 'Hostname validation passed.'
              : `Hostname validation failed: ${hostnameValidation.error ?? 'unknown_error'}`,
          !tlsSocket.authorized && allowInvalidCertificates
            ? 'Policy allowed the session to continue despite certificate trust failure.'
            : null,
        ].filter((reason): reason is string => Boolean(reason));

        authorization = {
          socketAuthorized: tlsSocket.authorized,
          authorizationError:
            typeof tlsSocket.authorizationError === 'string'
              ? tlsSocket.authorizationError
              : (tlsSocket.authorizationError?.message ?? null),
          hostnameValidation,
          policyAllowed:
            (tlsSocket.authorized || allowInvalidCertificates) &&
            (skipHostnameCheck || hostnameValidation.matched === true),
          reasons: authorizationReasons,
        };
        certificates = {
          leaf: leafCertificate,
          chain: certificateChain,
        };
        transport = {
          ...serializeSocketAddresses(tlsSocket),
          protocol: tlsSocket.getProtocol() ?? null,
          alpnProtocol: normalizeAlpnProtocol(tlsSocket.alpnProtocol),
          servernameSent: normalizeSocketServername(tlsSocket.servername),
          sessionReused: tlsSocket.isSessionReused(),
        };

        if (!authorization.policyAllowed) {
          tlsSocket.destroy();
          finish({
            ok: false,
            error: 'WebSocket TLS authorization failed',
            target,
            authorization,
            certificates,
          });
          return;
        }

        sendHandshake();
      };

      const onHandshakeData = (chunk: Buffer): void => {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
        const headerEnd = handshakeBuffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) {
          return;
        }

        const headerText = handshakeBuffer.subarray(0, headerEnd).toString('utf8');
        const lines = headerText.split('\r\n');
        const statusLine = lines.shift() ?? '';
        if (!/^HTTP\/1\.1 101\b/.test(statusLine)) {
          socket.destroy();
          finish({
            ok: false,
            error: `Unexpected WebSocket upgrade response: ${statusLine}`,
            target,
          });
          return;
        }

        const headers = new Map<string, string>();
        for (const line of lines) {
          const separator = line.indexOf(':');
          if (separator <= 0) {
            continue;
          }
          const name = line.slice(0, separator).trim().toLowerCase();
          const value = line.slice(separator + 1).trim();
          headers.set(name, value);
        }

        const upgrade = headers.get('upgrade')?.toLowerCase() ?? '';
        const connection = headers.get('connection')?.toLowerCase() ?? '';
        const responseAcceptKey = headers.get('sec-websocket-accept') ?? null;
        if (upgrade !== 'websocket') {
          socket.destroy();
          finish({ ok: false, error: 'Upgrade header did not confirm websocket', target });
          return;
        }
        if (
          !connection
            .split(',')
            .map((part) => part.trim())
            .includes('upgrade')
        ) {
          socket.destroy();
          finish({ ok: false, error: 'Connection header did not confirm upgrade', target });
          return;
        }
        if (responseAcceptKey !== acceptKey) {
          socket.destroy();
          finish({ ok: false, error: 'sec-websocket-accept did not match the client key', target });
          return;
        }

        const negotiatedSubprotocol = headers.get('sec-websocket-protocol') ?? null;
        if (negotiatedSubprotocol && !subprotocols.includes(negotiatedSubprotocol)) {
          socket.destroy();
          finish({
            ok: false,
            error: `Server selected unexpected subprotocol "${negotiatedSubprotocol}"`,
            target,
          });
          return;
        }

        const sessionId = makeSessionId('websocket');
        const session: WebSocketSession = {
          id: sessionId,
          kind: 'websocket',
          scheme,
          socket,
          host,
          port,
          path,
          createdAt: Date.now(),
          parserBuffer: handshakeBuffer.subarray(headerEnd + 4),
          frames: [],
          ended: false,
          closed: false,
          error: null,
          waiters: new Set(),
          activeRead: false,
          closeSent: false,
          closeReceived: false,
          metadata: {
            target,
            handshake: {
              requestKey,
              acceptKey,
              responseAcceptKey,
              subprotocol: negotiatedSubprotocol,
            },
            transport:
              transport ??
              ({
                ...serializeSocketAddresses(socket),
                protocol: null,
                alpnProtocol: null,
                servernameSent: null,
                sessionReused: null,
              } satisfies WebSocketSession['metadata']['transport']),
            authorization,
            certificates,
          },
        };
        this.attachWebSocketSession(session);
        this.websocketSessions.set(sessionId, session);
        this.emitWebSocketEvent('websocket:session_opened', {
          sessionId,
          scheme,
          host,
          port,
          path,
          timestamp: new Date().toISOString(),
        });

        finish({
          ok: true,
          sessionId,
          kind: session.kind,
          scheme,
          target,
          handshake: session.metadata.handshake,
          transport: session.metadata.transport,
          authorization: session.metadata.authorization,
          certificates: session.metadata.certificates,
          timing: {
            handshakeMs: Date.now() - startedAt,
          },
          state: serializeWebSocketSessionState(session),
        });
      };

      socket.once('error', onError);
      socket.on('data', onHandshakeData);
      if (scheme === 'wss') {
        socket.once('secureConnect', onSecureConnect);
      } else {
        socket.once('connect', onConnect);
        (socket as NetSocket).connect(port, host);
      }
    });
  }

  async handleWebSocketSendFrame(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }
    const session = this.getWebSocketSession(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown websocket sessionId "${sessionId}"` };
    }
    return this.sendWebSocketFrame(session, args);
  }

  async handleWebSocketReadFrame(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }
    const session = this.getWebSocketSession(sessionId);
    if (!session) {
      return { ok: false, error: `Unknown websocket sessionId "${sessionId}"` };
    }
    return this.readWebSocketFrame(session, args);
  }

  async handleWebSocketClose(args: Record<string, unknown>): Promise<unknown> {
    const sessionId = argString(args, 'sessionId')?.trim() ?? null;
    if (!sessionId) {
      return { ok: false, error: 'sessionId is required' };
    }
    return this.closeWebSocketSession(sessionId, args);
  }

  async handleBypassCertPinning(args: Record<string, unknown>): Promise<ToolResponse> {
    if (this.extensionInvoke) {
      try {
        const result = await this.extensionInvoke(args);
        if (result) {
          return asJsonResponse({
            success: true,
            strategy: 'frida-injection',
            result,
          });
        }
      } catch {
        // Extension invoke failed, fall through to instructions
      }
    }

    return asJsonResponse({
      success: true,
      strategy: 'manual-bypass',
      instructions: {
        android: [
          'Use Frida to hook X509TrustManager.checkServerTrusted and return without throwing.',
          'Alternatively, use OkHttp CertificatePinner.Builder().add() with the target cert.',
        ],
        ios: [
          'Hook SecTrustEvaluateWithError to always return true.',
          'Or use SSLSetSessionOption to disable certificate validation.',
        ],
        desktop: [
          'Set NODE_TLS_REJECT_UNAUTHORIZED=0 for Node.js targets.',
          'Or patch the certificate comparison function in the HTTP client.',
        ],
      },
      args,
    });
  }

  // Raw TCP/UDP Socket Handlers

  async handleRawTcpSend(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host') ?? '127.0.0.1';
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    // SECURITY: SSRF protection
    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) return ssrfCheck;

    const dataHex = argString(args, 'dataHex');
    const dataText = argString(args, 'dataText');
    if (!dataHex && !dataText) {
      return { ok: false, error: 'dataHex or dataText is required' };
    }

    const data = dataHex
      ? Buffer.from(normalizeHex(dataHex), 'hex')
      : Buffer.from(dataText ?? '', 'utf8');
    const timeout = argNumber(args, 'timeout') ?? 5000;

    return new Promise<unknown>((resolve) => {
      const socket = new NetSocket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ ok: false, error: 'Connection timed out' });
      }, timeout);

      socket.on('connect', () => {
        socket.write(data, () => {
          socket.end();
        });
      });

      socket.on('data', (chunk: Buffer) => {
        clearTimeout(timer);
        resolve({
          ok: true,
          host,
          port,
          sentBytes: data.length,
          responseHex: chunk.toString('hex').toUpperCase(),
          responseText: chunk.toString('utf8'),
        });
        socket.destroy();
      });

      socket.on('error', (error: Error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: error.message });
      });

      socket.connect(port, host);
    });
  }

  async handleRawTcpListen(args: Record<string, unknown>): Promise<unknown> {
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    const timeout = argNumber(args, 'timeout') ?? 10000;

    return new Promise<unknown>((resolve) => {
      const server = createNetServer();
      const timer = setTimeout(() => {
        server.close();
        resolve({ ok: false, error: 'Listen timed out — no connection received' });
      }, timeout);

      server.on('connection', (socket: NetSocket) => {
        clearTimeout(timer);
        const chunks: Buffer[] = [];

        socket.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        socket.on('end', () => {
          const data = Buffer.concat(chunks);
          server.close();
          resolve({
            ok: true,
            port,
            receivedBytes: data.length,
            dataHex: data.toString('hex').toUpperCase(),
            dataText: data.toString('utf8'),
          });
        });

        socket.on('error', (error: Error) => {
          clearTimeout(timer);
          server.close();
          resolve({ ok: false, error: error.message });
        });
      });

      server.on('error', (error: Error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: error.message });
      });

      server.listen(port, '127.0.0.1');
    });
  }

  async handleRawUdpSend(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host') ?? '127.0.0.1';
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    // SECURITY: SSRF protection
    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) return ssrfCheck;

    const dataHex = argString(args, 'dataHex');
    const dataText = argString(args, 'dataText');
    if (!dataHex && !dataText) {
      return { ok: false, error: 'dataHex or dataText is required' };
    }

    const data = dataHex
      ? Buffer.from(normalizeHex(dataHex), 'hex')
      : Buffer.from(dataText ?? '', 'utf8');
    const timeout = argNumber(args, 'timeout') ?? 5000;

    return new Promise<unknown>((resolve) => {
      const socket = createUdpSocket('udp4');
      const timer = setTimeout(() => {
        socket.close();
        resolve({ ok: false, error: 'UDP response timed out' });
      }, timeout);

      socket.on('message', (msg: Buffer) => {
        clearTimeout(timer);
        socket.close();
        resolve({
          ok: true,
          host,
          port,
          sentBytes: data.length,
          responseHex: msg.toString('hex').toUpperCase(),
          responseText: msg.toString('utf8'),
        });
      });

      socket.on('error', (error: Error) => {
        clearTimeout(timer);
        socket.close();
        resolve({ ok: false, error: error.message });
      });

      socket.send(data, 0, data.length, port, host);
    });
  }

  async handleRawUdpListen(args: Record<string, unknown>): Promise<unknown> {
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    const timeout = argNumber(args, 'timeout') ?? 10000;

    return new Promise<unknown>((resolve) => {
      const socket = createUdpSocket('udp4');
      const timer = setTimeout(() => {
        socket.close();
        resolve({ ok: false, error: 'UDP listen timed out' });
      }, timeout);

      socket.on('message', (msg: Buffer, rinfo: { address: string; port: number }) => {
        clearTimeout(timer);
        socket.close();
        resolve({
          ok: true,
          localPort: port,
          receivedBytes: msg.length,
          from: rinfo,
          dataHex: msg.toString('hex').toUpperCase(),
          dataText: msg.toString('utf8'),
        });
      });

      socket.on('error', (error: Error) => {
        clearTimeout(timer);
        socket.close();
        resolve({ ok: false, error: error.message });
      });

      socket.bind(port, '127.0.0.1');
    });
  }

  async handleRawTcpScan(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host') ?? '127.0.0.1';
    const startPort = argNumber(args, 'startPort') ?? 1;
    const endPort = argNumber(args, 'endPort') ?? 1024;

    if (startPort < 1 || endPort > 65535 || startPort > endPort) {
      return { ok: false, error: 'Invalid port range' };
    }

    if (endPort - startPort > 1000) {
      return { ok: false, error: 'Port range too large (max 1000 ports)' };
    }

    const timeout = argNumber(args, 'timeout') ?? 1000;
    const openPorts: number[] = [];
    const scanPromises: Promise<void>[] = [];

    for (let p = startPort; p <= endPort; p++) {
      scanPromises.push(
        new Promise<void>((resolve) => {
          const socket = new NetSocket();
          const timer = setTimeout(() => {
            socket.destroy();
            resolve();
          }, timeout);

          socket.on('connect', () => {
            clearTimeout(timer);
            openPorts.push(p);
            socket.destroy();
            resolve();
          });

          socket.on('error', () => {
            clearTimeout(timer);
            resolve();
          });

          socket.connect(p, host);
        }),
      );
    }

    await Promise.all(scanPromises);

    return {
      ok: true,
      host,
      portRange: { start: startPort, end: endPort },
      openPorts: openPorts.toSorted((a, b) => a - b),
      openCount: openPorts.length,
      scannedCount: endPort - startPort + 1,
    };
  }
}
