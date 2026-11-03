import { checkServerIdentity } from 'node:tls';
import type { TLSSocket } from 'node:tls';
import type { TlsPolicySummary, TlsSession, TlsTargetSummary } from './shared';
import {
  buildPeerCertificateChain,
  hasPeerCertificate,
  normalizeAlpnProtocol,
  normalizeSocketServername,
} from './shared';

export function buildTlsSessionMetadata(params: {
  socket: TLSSocket;
  target: TlsTargetSummary;
  policy: TlsPolicySummary;
  skipHostnameCheck: boolean;
  allowInvalidCertificates: boolean;
}): TlsSession['metadata'] {
  const { socket, target, policy, skipHostnameCheck, allowInvalidCertificates } = params;
  const peerCertificate = socket.getPeerCertificate(true);
  const hasLeafCertificate = hasPeerCertificate(peerCertificate);
  const certificateChain = hasLeafCertificate ? buildPeerCertificateChain(peerCertificate) : [];
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
  return {
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
}
