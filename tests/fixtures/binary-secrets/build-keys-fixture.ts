/**
 * Build a deterministic test binary containing planted candidate
 * material for the binary-secrets tests.
 *
 * Layout (offsets approximate; exact values exported as constants):
 *
 *   [0x000–0x100)  : zero padding (low-entropy noise)
 *   [0x100–0x110)  : 16-byte high-entropy "AES key" (planted raw)
 *   [0x110–0x180)  : ASCII filler (low entropy)
 *   [0x180–0x1B0)  : 64 hex chars (planted hex key, decodes to 32 bytes)
 *   [0x1B0–0x200)  : repeated ASCII (low entropy)
 *   [0x200–0x224)  : 36-char Base64 string (decodes to 24 bytes; planted)
 *   [0x224–0x300)  : zero padding
 *   [0x300–0x320)  : another 32-byte high-entropy raw window
 *
 * The fixture is deterministic — no Math.random() — so tests can assert
 * exact offsets.
 */

import { writeFile } from 'node:fs/promises';

/** Absolute offset of the 16-byte planted AES-128 candidate. */
export const FIXTURE_AES128_OFFSET = 0x100;
/** Absolute offset of the planted hex string (64 chars → 32 bytes). */
export const FIXTURE_HEX_OFFSET = 0x180;
/** Absolute offset of the planted Base64 string (36 chars → 24 bytes). */
export const FIXTURE_BASE64_OFFSET = 0x200;
/** Absolute offset of the second high-entropy raw window (32 bytes). */
export const FIXTURE_AES256_OFFSET = 0x300;
/** Final file size. */
export const FIXTURE_TOTAL_SIZE = 0x400;

/** Build the fixture in-memory and return the buffer. */
export function buildFixture(): Buffer {
  const buf = Buffer.alloc(FIXTURE_TOTAL_SIZE, 0);

  // [0x100, 0x110): 16 bytes of high-entropy bytes (planted AES-128 key).
  // Using a deterministic pseudo-random sequence (LCG) keyed off a small
  // seed so the test can recompute the expected value without randomness.
  const aes128 = lcg16(0x1234abcd, 16);
  aes128.copy(buf, FIXTURE_AES128_OFFSET);

  // [0x110, 0x180): printable ASCII filler (low-entropy noise so we don't
  // catch raw-window candidates inside the filler).
  buf.write('Hello, this is some plain ASCII filler text...', 0x110, 'ascii');

  // [0x180, 0x1C0): 64 lowercase hex chars (64 chars = 32 bytes decoded).
  // We avoid the all-same-character case so the diversity gate is exercised.
  const hex64 = 'deadbeef00112233445566778899aabbccddeeff01234567890fedcba9876543';
  buf.write(hex64, FIXTURE_HEX_OFFSET, 'ascii');

  // [0x1C0, 0x200): repeated ASCII filler.
  buf.write('---SEPARATOR---SEPARATOR---SEPARATOR---', 0x1c0, 'ascii');

  // [0x200, 0x224): 36-char Base64 (decodes to 27 bytes; we use 32 chars
  // for a 24-byte key match). Make it 32 chars to decode to exactly 24 bytes.
  const base64 = 'SGVsbG8sIFdvcmxkIVNlY3JldEtleVMxMjM=';
  // SGVsbG8sIFdvcmxkIVNlY3JldEtleVMxMjM= = "Hello, World!SecretKeyS123" length=26
  // -> 36 chars including '=' padding, decodes to 26 bytes. Adjust target length:
  // We want decoded length to land in DEFAULT_KEY_LENGTHS (16, 24, 32, 64).
  // 26 bytes is not in the list, so use a 32-char base64 → decoded length 24.
  const base64Final = 'SGVsbG8sIFdvcmxkIVNlY3JldEtleQ==';
  // 'SGVsbG8sIFdvcmxkIVNlY3JldEtleQ==' = "Hello, World!SecretKey" decoded length 22.
  // We need to construct one whose decoded length is exactly 24:
  // base64 chars without padding: ceil(24/3)*4 = 32 chars, padding = 0
  const planted24 = makeBase64ForLength(24, 0x5a5a);
  buf.write(planted24, FIXTURE_BASE64_OFFSET, 'ascii');
  // Reference the unused locals to keep TS happy (they document the design).
  void base64;
  void base64Final;

  // [0x224, 0x300): zero padding.

  // [0x300, 0x320): 32 bytes of high-entropy bytes (planted AES-256 key).
  const aes256 = lcg16(0xfeedface, 32);
  aes256.copy(buf, FIXTURE_AES256_OFFSET);

  return buf;
}

/**
 * Build a Base64 string whose decoded byte count equals `decodedLength`.
 * The bytes are a deterministic LCG sequence keyed by `seed` so tests can
 * recompute them.
 */
function makeBase64ForLength(decodedLength: number, seed: number): string {
  const bytes = lcg16(seed, decodedLength);
  return bytes.toString('base64');
}

/** Linear congruential generator producing `n` bytes from `seed`. */
function lcg16(seed: number, n: number): Buffer {
  const out = Buffer.alloc(n);
  let state = seed >>> 0;
  for (let i = 0; i < n; i++) {
    // Numerical Recipes constants for a 32-bit LCG.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = (state >>> 24) & 0xff;
  }
  return out;
}

/** Write the fixture to disk. */
export async function writeFixture(filePath: string): Promise<void> {
  await writeFile(filePath, buildFixture());
}
