/**
 * TlsInspectorWebSocketHandlers — WebSocket upgrade/open handlers and bypass helpers.
 */

import { randomBytes } from 'node:crypto';
import { isIP, Socket as NetSocket } from 'node:net';
import { checkServerIdentity, connect as createTlsConnection, type TLSSocket } from 'node:tls';
import {
  argBool,
  argEnum,
  argNumber,
  argString,
  argStringArray,
} from '@server/domains/shared/parse-args';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolResponse } from '@server/types';
import type {
  ProbeTlsVersion,
  SessionSocket,
  WebSocketScheme,
  WebSocketSession,
  WebSocketTargetSummary,
} from './shared';
import {
  applyTlsValidationPolicy,
  buildPeerCertificateChain,
  computeWebSocketAccept,
  errorMessage,
  hasPeerCertificate,
  loadProbeCaBundle,
  makeSessionId,
  normalizeAlpnProtocol,
  normalizeSocketServername,
  normalizeWebSocketPath,
  serializeSocketAddresses,
  serializeWebSocketSessionState,
  TLS_VERSION_SET,
  validateNetworkTarget,
} from './shared';
import { TlsInspectorWebSocketFrameHandlers } from './websocket-frame-handlers';

const TLS_VERSION_ORDER: ProbeTlsVersion[] = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];

export class TlsInspectorWebSocketHandlers extends TlsInspectorWebSocketFrameHandlers {
  async handleWebSocketOpen(args: Record<string, unknown>): Promise<unknown> {
    const targetOrError = resolveWebSocketTargetArgs(args);
    if ('error' in targetOrError) return { ok: false, error: targetOrError.error };
    const { scheme, host, port, path, url } = targetOrError;

    const optsOrError = await parseWebSocketOpenOptions(args, scheme, host);
    if ('error' in optsOrError) return { ok: false, error: optsOrError.error };
    const {
      timeoutMs,
      subprotocols,
      allowInvalidCertificates,
      skipHostnameCheck,
      servernameArg,
      alpnProtocols,
      minVersion,
      maxVersion,
      caBundle,
    } = optsOrError;

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
          ? createTlsConnection(
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
            )
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
}

type WsArgsResult<T> = T | { error: string };

/** Phase 1: resolve the ws/wss target from either a URL or explicit parts.
 * Returns `{ error }` on invalid input. */
function resolveWebSocketTargetArgs(args: Record<string, unknown>):
  | WsArgsResult<{
      scheme: WebSocketScheme;
      host: string;
      port: number;
      path: string;
      url: string;
    }>
  | { error: string } {
  const rawUrl = argString(args, 'url')?.trim() ?? null;
  const rawHost = argString(args, 'host')?.trim() ?? null;
  const rawPath = argString(args, 'path')?.trim() ?? null;
  const rawPort = argNumber(args, 'port');
  const rawScheme = argString(args, 'scheme')?.trim() ?? null;
  if (rawUrl && (rawHost || rawPath || rawPort !== undefined || rawScheme)) {
    return {
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
      return { error: `Invalid url: ${errorMessage(error)}` };
    }
    if (parsedUrl.protocol !== 'ws:' && parsedUrl.protocol !== 'wss:') {
      return { error: 'url must use ws:// or wss:// protocol' };
    }
    scheme = parsedUrl.protocol === 'wss:' ? 'wss' : 'ws';
    host = parsedUrl.hostname;
    port = parsedUrl.port.length > 0 ? Number(parsedUrl.port) : scheme === 'wss' ? 443 : 80;
    path = normalizeWebSocketPath(`${parsedUrl.pathname}${parsedUrl.search}`);
    url = `${scheme}://${parsedUrl.host}${path}`;
  } else {
    if (!host) {
      return { error: 'host or url is required' };
    }
    if (rawScheme) {
      if (rawScheme !== 'ws' && rawScheme !== 'wss') {
        return { error: 'scheme must be ws or wss' };
      }
      scheme = rawScheme;
    }
    port ??= scheme === 'wss' ? 443 : 80;
    const authority = port === (scheme === 'wss' ? 443 : 80) ? host : `${host}:${String(port)}`;
    url = `${scheme}://${authority}${path}`;
  }

  if (!host || !port || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: 'port must be an integer between 1 and 65535' };
  }
  return { scheme, host, port, path, url };
}

/** Phase 2: timeout/TLS/handshake options + SSRF gate + CA bundle load. */
async function parseWebSocketOpenOptions(
  args: Record<string, unknown>,
  scheme: WebSocketScheme,
  host: string,
): Promise<
  | WsArgsResult<{
      timeoutMs: number;
      subprotocols: string[];
      allowInvalidCertificates: boolean;
      skipHostnameCheck: boolean;
      servernameArg: string | null;
      alpnProtocols: string[];
      minVersion: ProbeTlsVersion | undefined;
      maxVersion: ProbeTlsVersion | undefined;
      caBundle: { ok: true; ca: Buffer | undefined; source: null; path: null; bytes: null };
    }>
  | { error: string }
> {
  const timeoutMs = argNumber(args, 'timeoutMs') ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { error: 'timeoutMs must be a positive number' };
  }

  const subprotocols = [
    ...new Set(argStringArray(args, 'subprotocols').map((value) => value.trim())),
  ].filter((value) => value.length > 0);

  const ssrfCheck = validateNetworkTarget(host);
  if (ssrfCheck) return { error: ssrfCheck.error };

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
    return { error: errorMessage(error) };
  }

  if (
    minVersion &&
    maxVersion &&
    TLS_VERSION_ORDER.indexOf(minVersion) > TLS_VERSION_ORDER.indexOf(maxVersion)
  ) {
    return { error: 'minVersion must not be greater than maxVersion' };
  }

  const caBundle =
    scheme === 'wss'
      ? await loadProbeCaBundle(args)
      : { ok: true as const, ca: undefined, source: null, path: null, bytes: null };
  if (!caBundle.ok) {
    return { error: caBundle.error };
  }
  return {
    timeoutMs,
    subprotocols,
    allowInvalidCertificates,
    skipHostnameCheck,
    servernameArg,
    alpnProtocols,
    minVersion,
    maxVersion,
    caBundle: caBundle as {
      ok: true;
      ca: Buffer | undefined;
      source: null;
      path: null;
      bytes: null;
    },
  };
}
