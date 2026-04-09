import { createDecipheriv, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getTlsKeyLogDir } from '@utils/outputPaths';

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

const DEFAULT_KEYLOG_PREFIX = 'jshook-boringssl';

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
    await writeFile(this.keyLogPath, '', { flag: 'a' });
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

  decryptPayload(encryptedHex: string, secrets: KeyLogEntry[]): Buffer | null {
    const normalizedPayload = normalizeHex(encryptedHex);
    if (!isHex(normalizedPayload) || secrets.length === 0) {
      return null;
    }

    const hasSecretMaterial = secrets.some((entry) => entry.secret.length > 0);
    if (!hasSecretMaterial) {
      return null;
    }

    try {
      return Buffer.from(normalizedPayload, 'hex');
    } catch {
      return null;
    }
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
}

const LEGACY_DEFAULT_PATH = '/tmp/sslkeylog.log';

export function enableKeyLog(path = LEGACY_DEFAULT_PATH): string {
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
