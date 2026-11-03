/**
 * TlsInspectorSessionHandlers — stateful TCP and TLS session handlers.
 */

import { isIP, Socket as NetSocket } from 'node:net';
import { connect as createTlsConnection } from 'node:tls';
import {
  argBool,
  argEnum,
  argNumber,
  argString,
  argStringArray,
} from '@server/domains/shared/parse-args';
import type {
  ProbeTlsVersion,
  TcpSession,
  TlsPolicySummary,
  TlsSession,
  TlsTargetSummary,
} from './shared';
import {
  applyTlsValidationPolicy,
  attachBufferedSession,
  errorMessage,
  loadProbeCaBundle,
  makeSessionId,
  serializeSessionState,
  serializeSocketAddresses,
  TLS_VERSION_SET,
  validateNetworkTarget,
} from './shared';
import { buildTlsSessionMetadata } from './tls-metadata-helper';
import { TlsInspectorTlsProbeHandlers } from './tls-probe-handlers';

const TLS_VERSION_ORDER: ProbeTlsVersion[] = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];

export class TlsInspectorSessionHandlers extends TlsInspectorTlsProbeHandlers {
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

    if (
      minVersion &&
      maxVersion &&
      TLS_VERSION_ORDER.indexOf(minVersion) > TLS_VERSION_ORDER.indexOf(maxVersion)
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
      const socket = createTlsConnection(
        applyTlsValidationPolicy(
          {
            host,
            port,
            servername: target.requestedServername ?? undefined,
            ...(minVersion ? { minVersion } : {}),
            ...(maxVersion ? { maxVersion } : {}),
            ...(alpnProtocols.length > 0 ? { ALPNProtocols: alpnProtocols } : {}),
            ...(caBundle.ca ? { ca: caBundle.ca } : {}),
          },
          allowInvalidCertificates,
        ),
      );

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
        const metadata = buildTlsSessionMetadata({
          socket,
          target,
          policy,
          skipHostnameCheck,
          allowInvalidCertificates,
        });

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
}
