import { createDecipheriv, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getEphemeralKeylogDir, getTlsKeyLogDir } from '@utils/outputPaths';
import { TLS_KEYLOG_PATH } from '@src/constants';
import { generateEphemeralKey, sealFileToPath } from '@utils/crypto/ephemeralCipher';

export interface KeyLogEntry {
  label: string;
  clientRandom: string;
  secret: string;
  timestamp?: string;
}

export interface KeyLogSummary {
  totalEntries: number;
  entriesByLabel: Record<string, number>;
  firstSeen?: string;
  lastSeen?: string;
}

export interface SealedKeyLogResult {
  /** Path of the encrypted envelope written to disk. */
  cipherPath: string;
  /**
   * Hex-encoded ephemeral key, held only for the caller to keep in memory
   * (e.g. attach to the in-process session state). Never written to disk by
   * this function — the caller decides whether/where to hold it.
   */
  keyHex: string;
  /** Number of keylog entries that were present in the plaintext before sealing. */
  entryCount: number;
}

const DEFAULT_KEYLOG_PREFIX = 'jshook-tls';

function normalizeHex(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9A-F]+$/i.test(value);
}

function parseOptionalTimestamp(token: string | undefined): string | undefined {
  if (!token) {
    return undefined;
  }

  const parsed = new Date(token);
  if (Number.isNaN(parsed.valueOf())) {
    return undefined;
  }

  return parsed.toISOString();
}

function defaultKeyLogPath(): string {
  return resolve(getTlsKeyLogDir(), `${DEFAULT_KEYLOG_PREFIX}-${randomUUID()}.log`);
}

function parseEntriesFromContent(content: string): KeyLogEntry[] {
  const entries: KeyLogEntry[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const parts = line.split(/\s+/);
    const label = parts[0];
    const clientRandom = parts[1];
    const secret = parts[2];
    const timestamp = parseOptionalTimestamp(parts[3]);

    if (!label || !clientRandom || !secret) {
      continue;
    }

    const normalizedClientRandom = normalizeHex(clientRandom);
    const normalizedSecret = normalizeHex(secret);
    if (!isHex(normalizedClientRandom) || !isHex(normalizedSecret)) {
      continue;
    }

    const entry: KeyLogEntry = {
      label,
      clientRandom: normalizedClientRandom,
      secret: normalizedSecret,
    };

    if (timestamp) {
      entry.timestamp = timestamp;
    }

    entries.push(entry);
  }

  return entries;
}

export class TLSKeyLogExtractor {
  private readonly keyLogPath: string;
  private cachedEntries: KeyLogEntry[] = [];
  private readonly secretByClientRandom = new Map<string, string>();

  constructor(keyLogPath?: string) {
    this.keyLogPath = resolve(keyLogPath ?? defaultKeyLogPath());
  }

  async enableKeyLog(): Promise<string> {
    await mkdir(dirname(this.keyLogPath), { recursive: true });
    // 0o600: this file receives BoringSSL/Node's plaintext TLS master
    // secrets/traffic keys the moment TLS handshakes occur — restrict it to
    // the owning user from creation, not just at sealKeyLog() time.
    await writeFile(this.keyLogPath, '', { flag: 'a', mode: 0o600 });
    process.env.SSLKEYLOGFILE = this.keyLogPath;
    return this.keyLogPath;
  }

  async disableKeyLog(): Promise<void> {
    if (process.env.SSLKEYLOGFILE === this.keyLogPath) {
      delete process.env.SSLKEYLOGFILE;
      return;
    }

    delete process.env.SSLKEYLOGFILE;
  }

  getKeyLogFilePath(): string {
    return this.keyLogPath;
  }

  parseKeyLog(path?: string): KeyLogEntry[] {
    const targetPath = resolve(path ?? this.keyLogPath);
    if (!existsSync(targetPath)) {
      this.cachedEntries = [];
      this.secretByClientRandom.clear();
      return [];
    }

    const content = readFileSync(targetPath, 'utf8');
    const entries = parseEntriesFromContent(content);

    this.cachedEntries = entries;
    this.secretByClientRandom.clear();
    for (const entry of entries) {
      this.secretByClientRandom.set(entry.clientRandom, entry.secret);
    }

    return entries;
  }

  summarizeKeyLog(path?: string): KeyLogSummary {
    const entries = this.parseKeyLog(path);
    const entriesByLabel: Record<string, number> = {};
    const timestamps: string[] = [];

    for (const entry of entries) {
      entriesByLabel[entry.label] = (entriesByLabel[entry.label] ?? 0) + 1;
      if (entry.timestamp) {
        timestamps.push(entry.timestamp);
      }
    }

    timestamps.sort((left, right) => left.localeCompare(right));

    const summary: KeyLogSummary = {
      totalEntries: entries.length,
      entriesByLabel,
    };

    if (timestamps.length > 0) {
      const firstSeen = timestamps[0];
      const lastSeen = timestamps[timestamps.length - 1];
      if (firstSeen) {
        summary.firstSeen = firstSeen;
      }
      if (lastSeen) {
        summary.lastSeen = lastSeen;
      }
    }

    return summary;
  }

  lookupSecret(clientRandom: string): string | null {
    const normalizedClientRandom = normalizeHex(clientRandom);
    const cached = this.secretByClientRandom.get(normalizedClientRandom);
    if (cached) {
      return cached;
    }

    for (const entry of this.cachedEntries.length > 0 ? this.cachedEntries : this.parseKeyLog()) {
      if (entry.clientRandom === normalizedClientRandom) {
        return entry.secret;
      }
    }

    return null;
  }

  /**
   * Read the plaintext keylog file, encrypt its contents with a fresh
   * ephemeral key, write the ciphertext to a sealed-directory envelope, and
   * securely wipe the plaintext source. Call after parseKeyLog()/
   * summarizeKeyLog() have already extracted whatever structured data the
   * caller needs — this is the disk-forensics mitigation (pagefile/
   * hibernation/TEMP scraping), not a substitute for parsing.
   *
   * The BoringSSL/Node TLS stack itself writes plaintext into keyLogPath (see
   * enableKeyLog(); that write path is outside this process's control), so
   * this cannot prevent the plaintext from existing on disk at all — it only
   * shortens the exposure window between the write and the seal.
   *
   * Returns null if the plaintext file does not exist (nothing to seal).
   */
  async sealKeyLog(): Promise<SealedKeyLogResult | null> {
    if (!existsSync(this.keyLogPath)) {
      return null;
    }

    const entries = this.parseKeyLog();
    const cipherDir = getEphemeralKeylogDir();
    await mkdir(cipherDir, { recursive: true });
    const cipherPath = resolve(cipherDir, `${DEFAULT_KEYLOG_PREFIX}-${randomUUID()}.sealed.json`);

    const key = generateEphemeralKey();
    await sealFileToPath(this.keyLogPath, cipherPath, key);

    return { cipherPath, keyHex: key.toString('hex'), entryCount: entries.length };
  }
}

export function enableKeyLog(path = TLS_KEYLOG_PATH): string {
  process.env.SSLKEYLOGFILE = path;
  return path;
}

export function disableKeyLog(): void {
  delete process.env.SSLKEYLOGFILE;
}

export function getKeyLogFilePath(): string | null {
  const configured = process.env.SSLKEYLOGFILE;
  if (!configured || configured.trim().length === 0) {
    return null;
  }

  return configured;
}

export function parseKeyLog(contentOrPath: string): KeyLogEntry[] {
  if (contentOrPath.length === 0) {
    return [];
  }

  const looksLikeInlineContent =
    contentOrPath.includes('\n') ||
    contentOrPath.includes('\r') ||
    contentOrPath.includes('CLIENT_') ||
    contentOrPath.trim().startsWith('#');

  if (looksLikeInlineContent) {
    return parseEntriesFromContent(contentOrPath);
  }

  return new TLSKeyLogExtractor(contentOrPath).parseKeyLog();
}

export function summarizeKeyLog(entries: KeyLogEntry[]): {
  totalEntries: number;
  uniqueClients: number;
  hasClientRandom: boolean;
  hasTrafficSecrets: boolean;
  labels: string[];
} {
  const labels = [...new Set(entries.map((entry) => entry.label))];
  const uniqueClients = new Set(entries.map((entry) => entry.clientRandom)).size;
  const hasTrafficSecrets = entries.some((entry) => entry.label.includes('TRAFFIC_SECRET'));

  return {
    totalEntries: entries.length,
    uniqueClients,
    hasClientRandom: labels.includes('CLIENT_RANDOM'),
    hasTrafficSecrets,
    labels,
  };
}

export type KeyLogSecretKind =
  | 'tls12-master-secret'
  | 'tls13-handshake-traffic'
  | 'tls13-app-traffic'
  | 'tls13-early-data'
  | 'tls13-exporter'
  | 'other';

export interface KeyLogSecretType {
  label: string;
  count: number;
  kind: KeyLogSecretKind;
}

export interface KeyLogClassification {
  totalEntries: number;
  uniqueClientRandom: number;
  entriesByLabel: Record<string, number>;
  secretTypes: KeyLogSecretType[];
  tlsVersionInference: 'TLS1.2' | 'TLS1.3' | 'mixed' | 'unknown';
  hasClientRandom: boolean;
  hasTrafficSecrets: boolean;
}

/**
 * Map an NSS keylog label to a structural secret kind. The label taxonomy is a
 * fixed part of the SSLKEYLOGFILE format (not a feature library): TLS 1.2 writes
 * a single CLIENT_RANDOM line per session, while TLS 1.3 writes one of six
 * typed traffic-secret labels derived from the HKDF key schedule.
 */
export function classifySecretLabel(label: string): KeyLogSecretKind {
  if (label === 'CLIENT_RANDOM') return 'tls12-master-secret';
  if (label === 'CLIENT_HANDSHAKE_TRAFFIC_SECRET' || label === 'SERVER_HANDSHAKE_TRAFFIC_SECRET') {
    return 'tls13-handshake-traffic';
  }
  if (label === 'CLIENT_TRAFFIC_SECRET_0' || label === 'SERVER_TRAFFIC_SECRET_0') {
    return 'tls13-app-traffic';
  }
  if (label === 'EARLY_TRAFFIC_SECRET') return 'tls13-early-data';
  if (label === 'EXPORTER_SECRET') return 'tls13-exporter';
  return 'other';
}

/**
 * Classify a parsed keylog's secrets: per-label counts grouped by secret kind,
 * unique client_random count (= number of independent sessions), and a
 * best-effort TLS version inference derived from which labels are present.
 *
 * Inference rules (from label taxonomy, not traffic inspection):
 * - CLIENT_RANDOM present only → TLS 1.2 (or below) master-secret export.
 * - Any TLS 1.3 *_TRAFFIC_SECRET present only → TLS 1.3.
 * - Both present → mixed (a single TLS 1.3 session may also emit a CLIENT_RANDOM
 *   compatibility line; or the log spans multiple sessions of both versions).
 * - Neither → unknown (empty or unrecognised labels).
 */
export function classifyKeyLogSecrets(entries: KeyLogEntry[]): KeyLogClassification {
  const entriesByLabel: Record<string, number> = {};
  const clients = new Set<string>();
  const labelToKind = new Map<string, KeyLogSecretKind>();
  const labelCounts = new Map<string, number>();
  let hasClientRandom = false;
  let hasTls13 = false;

  for (const entry of entries) {
    entriesByLabel[entry.label] = (entriesByLabel[entry.label] ?? 0) + 1;
    clients.add(entry.clientRandom);
    labelCounts.set(entry.label, (labelCounts.get(entry.label) ?? 0) + 1);

    const kind = classifySecretLabel(entry.label);
    if (!labelToKind.has(entry.label)) {
      labelToKind.set(entry.label, kind);
    }
    if (kind === 'tls12-master-secret') hasClientRandom = true;
    if (kind.startsWith('tls13-')) hasTls13 = true;
  }

  const secretTypes: KeyLogSecretType[] = [];
  for (const [label, count] of labelCounts) {
    secretTypes.push({ label, count, kind: labelToKind.get(label) ?? 'other' });
  }
  secretTypes.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  let tlsVersionInference: KeyLogClassification['tlsVersionInference'];
  if (entries.length === 0) {
    tlsVersionInference = 'unknown';
  } else if (hasClientRandom && hasTls13) {
    tlsVersionInference = 'mixed';
  } else if (hasTls13) {
    tlsVersionInference = 'TLS1.3';
  } else if (hasClientRandom) {
    tlsVersionInference = 'TLS1.2';
  } else {
    tlsVersionInference = 'unknown';
  }

  return {
    totalEntries: entries.length,
    uniqueClientRandom: clients.size,
    entriesByLabel,
    secretTypes,
    tlsVersionInference,
    hasClientRandom,
    hasTrafficSecrets: hasTls13,
  };
}

export function lookupSecret(
  entries: KeyLogEntry[],
  clientRandom: string,
  label?: string,
): string | null {
  const normalizedClientRandom = normalizeHex(clientRandom);
  const normalizedLabel = label?.trim();

  for (const entry of entries) {
    if (entry.clientRandom !== normalizedClientRandom) {
      continue;
    }
    if (normalizedLabel && entry.label !== normalizedLabel) {
      continue;
    }
    return entry.secret;
  }

  return null;
}

export function decryptPayload(
  encryptedHex: string,
  keyHex: string,
  nonceHex: string,
  algorithm = 'aes-256-gcm',
  authTagHex?: string,
): string {
  try {
    const encrypted = Buffer.from(normalizeHex(encryptedHex), 'hex');
    const key = Buffer.from(normalizeHex(keyHex), 'hex');
    const nonce = Buffer.from(normalizeHex(nonceHex), 'hex');
    const decipher = createDecipheriv(algorithm, key, nonce);

    if (authTagHex) {
      const maybeSetAuthTag = Reflect.get(decipher, 'setAuthTag');
      if (typeof maybeSetAuthTag === 'function') {
        maybeSetAuthTag.call(decipher, Buffer.from(normalizeHex(authTagHex), 'hex'));
      }
    }

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return `DECRYPTION_FAILED:${algorithm}`;
  }
}
