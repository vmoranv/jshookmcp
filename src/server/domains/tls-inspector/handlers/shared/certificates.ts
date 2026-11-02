import { createHash, X509Certificate } from 'node:crypto';
import { normalizeHex } from './common';
import type { PeerCertificateSummary, ProbePeerCertificate } from './types';

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.keys(value).length > 0;
}

export function hasPeerCertificate(value: unknown): value is ProbePeerCertificate {
  return isNonEmptyObject(value);
}

function summarizePeerCertificate(
  cert: ProbePeerCertificate,
  depth: number,
): PeerCertificateSummary {
  const raw = Buffer.isBuffer(cert.raw) ? cert.raw : null;
  const x509 = raw ? new X509Certificate(raw) : null;
  const subject = x509?.subject ?? null;
  const issuer = x509?.issuer ?? null;

  return {
    depth,
    subject,
    issuer,
    subjectAltName: x509?.subjectAltName ?? cert.subjectaltname ?? null,
    serialNumber: x509?.serialNumber ?? cert.serialNumber ?? null,
    validFrom: x509?.validFrom ?? cert.valid_from ?? null,
    validTo: x509?.validTo ?? cert.valid_to ?? null,
    fingerprint256: x509?.fingerprint256 ?? cert.fingerprint256 ?? null,
    fingerprint512: x509?.fingerprint512 ?? cert.fingerprint512 ?? null,
    rawLength: raw?.length ?? null,
    isCA: x509?.ca ?? cert.ca ?? null,
    selfIssued: subject && issuer ? subject === issuer : null,
  };
}

export function buildPeerCertificateChain(
  peerCertificate: ProbePeerCertificate | null,
): PeerCertificateSummary[] {
  if (!peerCertificate) {
    return [];
  }

  const chain: PeerCertificateSummary[] = [];
  const seen = new Set<string>();
  let current: ProbePeerCertificate | null = peerCertificate;
  let depth = 0;

  while (current && hasPeerCertificate(current)) {
    const summary = summarizePeerCertificate(current, depth);
    const dedupeKey =
      summary.fingerprint256 ??
      `${summary.subject ?? 'unknown-subject'}:${summary.serialNumber ?? 'unknown-serial'}:${depth}`;
    if (seen.has(dedupeKey)) {
      break;
    }

    seen.add(dedupeKey);
    chain.push(summary);

    if (!('issuerCertificate' in current)) {
      break;
    }

    const issuerCertificate: ProbePeerCertificate | null = current.issuerCertificate;
    if (
      !issuerCertificate ||
      issuerCertificate === current ||
      !hasPeerCertificate(issuerCertificate)
    ) {
      break;
    }

    current = issuerCertificate;
    depth += 1;
  }

  return chain;
}

export interface ParsedCertificate {
  subject?: string;
  issuer?: string;
  serialNumber?: string;
  validFrom?: string;
  validTo?: string;
  sha256: string;
  fingerprint256?: string;
  subjectAltName?: string;
  publicKeyAlgorithm?: string;
  publicKeySpkiSha256?: string;
  publicKeyPinBase64?: string;
  keyUsage?: string[];
  basicConstraintsCA?: boolean | null;
  rawCertLength?: number;
  length: number;
}

function parseDerCertificate(der: Buffer): ParsedCertificate {
  const sha256 = createHash('sha256').update(der).digest('hex').toUpperCase();

  try {
    const cert = new X509Certificate(der);
    const info: ParsedCertificate = {
      subject: cert.subject || undefined,
      issuer: cert.issuer || undefined,
      serialNumber: cert.serialNumber || undefined,
      validFrom: cert.validFrom || undefined,
      validTo: cert.validTo || undefined,
      sha256,
      fingerprint256: cert.fingerprint256 || undefined,
      subjectAltName: cert.subjectAltName ?? undefined,
      keyUsage: cert.keyUsage ?? undefined,
      rawCertLength: cert.raw.length,
      length: der.length,
    };

    // basicConstraints: cert.ca is `boolean | ""` (empty string when the
    // extension is absent). Normalise to null so callers can distinguish.
    const caValue: boolean | string = cert.ca;
    info.basicConstraintsCA = typeof caValue === 'string' && caValue === '' ? null : caValue;

    // SPKI pin hash (Android Network Security Config + HPKP format): sha256 of
    // the DER-encoded SubjectPublicKeyInfo. cert.publicKey is a KeyObject that
    // re-exports as SPKI DER. Pin fields are skipped for key types that cannot
    // export as SPKI rather than failing the whole parse.
    if (cert.publicKey) {
      try {
        const spki = cert.publicKey.export({ format: 'der', type: 'spki' });
        const spkiHash = createHash('sha256').update(spki).digest();
        info.publicKeyAlgorithm = cert.publicKey.asymmetricKeyType ?? undefined;
        info.publicKeySpkiSha256 = spkiHash.toString('hex').toUpperCase();
        info.publicKeyPinBase64 = spkiHash.toString('base64');
      } catch {
        // fall through — pin fields stay undefined
      }
    }

    return info;
  } catch {
    return { sha256, length: der.length };
  }
}

export function parseCertificateChain(hexPayload: string): ParsedCertificate[] {
  const buffer = Buffer.from(normalizeHex(hexPayload), 'hex');
  const certs: ParsedCertificate[] = [];

  let cursor = 0;
  while (cursor < buffer.length - 4) {
    if (buffer[cursor] === 0x30) {
      const certData = buffer.subarray(cursor);
      const info = parseDerCertificate(certData);
      certs.push(info);
      // Advance by the real parsed certificate length so multi-cert chains
      // decode each entry; fall back to +1 when no length was recovered.
      const advance = info.rawCertLength ?? 0;
      cursor += advance > 0 ? advance : 1;
    } else {
      cursor += 1;
    }
  }

  if (certs.length === 0 && buffer.length > 0) {
    certs.push({
      sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
      length: buffer.length,
    });
  }

  return certs;
}
