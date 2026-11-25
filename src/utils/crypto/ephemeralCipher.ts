/**
 * Process-ephemeral AES-256-GCM envelope for artifacts that must not sit on
 * disk as plaintext (TLS keylogs, memory/heap dumps). The key never touches
 * disk and is never derived from a persisted secret: it is either generated
 * fresh per call or supplied by the caller from its own in-memory state. When
 * the process exits, an un-persisted key is gone — there is no "master key"
 * recovery path by design; this defends against post-hoc disk forensics
 * (pagefile/hibernation/TEMP scraping), not against a live-process attacker
 * who can read process memory.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, unlink, open } from 'node:fs/promises';
import { logger } from '@utils/logger';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

export interface EncryptedEnvelope {
  /** Hex-encoded IV, ciphertext, and GCM auth tag concatenated as iv:tag:data. */
  payload: string;
  algorithm: typeof ALGORITHM;
}

/** Generate a fresh 256-bit key. Caller owns the lifetime; never persisted here. */
export function generateEphemeralKey(): Buffer {
  return randomBytes(KEY_LENGTH);
}

export function encryptBuffer(plaintext: Buffer, key: Buffer): EncryptedEnvelope {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    payload: `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`,
    algorithm: ALGORITHM,
  };
}

export function decryptEnvelope(envelope: EncryptedEnvelope, key: Buffer): Buffer {
  // Never trust the algorithm from the envelope: a tampered/corrupt file must
  // not be able to select a different cipher than the one we wrote.
  if (envelope.algorithm !== ALGORITHM) {
    throw new Error(`Unsupported encrypted envelope algorithm: ${String(envelope.algorithm)}`);
  }
  if (typeof envelope.payload !== 'string') {
    throw new Error('Malformed encrypted envelope: payload must be a string');
  }

  const parts = envelope.payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted envelope: expected iv:tag:data');
  }
  const [ivHex, tagHex, dataHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  if (iv.length !== IV_LENGTH) {
    throw new Error(`Malformed encrypted envelope: IV must be ${IV_LENGTH} bytes`);
  }
  if (authTag.length !== 16) {
    throw new Error('Malformed encrypted envelope: auth tag must be 16 bytes');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/**
 * Read a plaintext file, encrypt its contents with `key` (generating one if
 * omitted), write the envelope to `cipherPath` as JSON, then securely wipe
 * the plaintext source. Returns the key used so the caller can hold it in
 * memory for later decryption; nothing is written that would let a disk
 * forensic pass recover the key on its own.
 */
export async function sealFileToPath(
  plainPath: string,
  cipherPath: string,
  key: Buffer = generateEphemeralKey(),
): Promise<{ key: Buffer; cipherPath: string }> {
  const plaintext = await readFile(plainPath);
  const envelope = encryptBuffer(plaintext, key);
  await writeFile(cipherPath, JSON.stringify(envelope), { mode: 0o600 });
  await secureWipe(plainPath);
  return { key, cipherPath };
}

export async function openSealedFile(cipherPath: string, key: Buffer): Promise<Buffer> {
  const raw = await readFile(cipherPath, 'utf8');
  let envelope: EncryptedEnvelope;
  try {
    envelope = JSON.parse(raw) as EncryptedEnvelope;
  } catch (error) {
    throw new Error(`Corrupt sealed file ${cipherPath}: not valid JSON`, { cause: error });
  }
  if (typeof envelope !== 'object' || envelope === null || typeof envelope.payload !== 'string') {
    throw new Error(`Corrupt sealed file ${cipherPath}: missing payload`);
  }
  return decryptEnvelope(envelope, key);
}

/**
 * Best-effort secure delete: overwrite the file's on-disk extent with random
 * bytes before unlinking. This defeats "undelete from the same disk" forensic
 * recovery (the file's original allocation no longer holds its content) but
 * cannot guarantee anything about copy-on-write filesystems, SSD wear
 * leveling remapping the physical cells elsewhere, or filesystem journals /
 * snapshots that retain their own copy — those require OS/filesystem-level
 * secure-erase support this function does not have access to. Missing files
 * are treated as already-wiped (idempotent).
 */
export async function secureWipe(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, 'r+');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  try {
    const stats = await handle.stat();
    if (stats.size > 0) {
      // Overwrite in fixed-size chunks: allocating randomBytes(stats.size) for a
      // multi-GB heap dump can OOM the process doing the wipe. Each chunk is
      // written in a loop because FileHandle.write may write fewer bytes than
      // requested; a short write must not silently leave plaintext behind.
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < stats.size; offset += chunkSize) {
        const length = Math.min(chunkSize, stats.size - offset);
        const chunk = randomBytes(length);
        let written = 0;
        while (written < length) {
          const { bytesWritten } = await handle.write(
            chunk,
            written,
            length - written,
            offset + written,
          );
          if (bytesWritten <= 0) {
            throw new Error(`short write while wiping ${path}`);
          }
          written += bytesWritten;
        }
      }
      await handle.sync();
    }
  } catch (error) {
    logger.warn(`secureWipe: overwrite failed for ${path}, unlinking anyway`, error);
  } finally {
    await handle.close();
  }

  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
}
