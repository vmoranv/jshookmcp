import { describe, expect, it } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
import { deflateSync, gzipSync } from 'node:zlib';

import { BINARY_MAGIC_HINTS } from '@src/config/binary-magic';
import { runTransformWorkbench } from '@modules/transform/workbench';

describe('transform workbench', () => {
  it('detects generic binary magic through the config table', () => {
    const labels = BINARY_MAGIC_HINTS.map((hint) => hint.label);

    expect(labels.toSorted()).toEqual(['cdex', 'dex', 'elf', 'gzip', 'zip']);
    const elfPrefix = BINARY_MAGIC_HINTS.find((hint) => hint.label === 'elf')?.prefix;
    expect(elfPrefix).toBeDefined();

    const result = runTransformWorkbench({
      inputBase64: Buffer.from([...(elfPrefix ?? []), 0x02, 0x01]).toString('base64'),
      steps: [{ op: 'entropy' }],
      includeOutputBase64: false,
    });

    expect(result.output.magicHints).toContain('elf');
  });

  it('omits full output bytes by default', () => {
    const result = runTransformWorkbench({
      inputBase64: Buffer.from('hello').toString('base64'),
      steps: [{ op: 'entropy' }],
    });

    expect(result.output.base64).toBeUndefined();
    expect(result.output.base64Omitted).toBe(true);
  });

  it('rejects oversized input, too many steps, and oversized inflate output', () => {
    expect(() =>
      runTransformWorkbench({
        inputBase64: Buffer.from('hello').toString('base64'),
        steps: [{ op: 'entropy' }],
        maxInputBytes: 4,
      }),
    ).toThrow(/input.*too large/i);

    expect(() =>
      runTransformWorkbench({
        inputBase64: Buffer.from('hello').toString('base64'),
        steps: [{ op: 'entropy' }, { op: 'entropy' }],
        maxSteps: 1,
      }),
    ).toThrow(/too many transform steps/i);

    expect(() =>
      runTransformWorkbench({
        inputBase64: deflateSync(Buffer.from('hello')).toString('base64'),
        steps: [{ op: 'zlib_inflate' }],
        maxOutputBytes: 4,
      }),
    ).toThrow(/output.*too large/i);
  });

  it('hex_encode / hex_decode round-trip arbitrary bytes', () => {
    const original = Buffer.from('AB\x00\xff binary', 'latin1');
    const encoded = runTransformWorkbench({
      inputBase64: original.toString('base64'),
      steps: [{ op: 'hex_encode' }],
      includeOutputBase64: true,
    });
    const decoded = runTransformWorkbench({
      inputBase64: encoded.output.base64!,
      steps: [{ op: 'hex_decode' }],
      includeOutputBase64: true,
    });
    expect(Buffer.from(decoded.output.base64!, 'base64')).toEqual(original);
  });

  it('aes_cbc_decrypt reverses AES-128-CBC encryption (keyHex + ivHex)', () => {
    const key = randomBytes(16);
    const iv = randomBytes(16);
    const plaintext = Buffer.from('secret payload!!', 'utf8');
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const result = runTransformWorkbench({
      inputBase64: ciphertext.toString('base64'),
      steps: [{ op: 'aes_cbc_decrypt', keyHex: key.toString('hex'), ivHex: iv.toString('hex') }],
      includeOutputBase64: true,
    });
    expect(Buffer.from(result.output.base64!, 'base64')).toEqual(plaintext);
  });

  it('aes_ecb_decrypt reverses AES-256-ECB encryption', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('0123456789abcdef', 'utf8');
    const cipher = createCipheriv('aes-256-ecb', key, null);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const result = runTransformWorkbench({
      inputBase64: ciphertext.toString('base64'),
      steps: [{ op: 'aes_ecb_decrypt', keyHex: key.toString('hex') }],
      includeOutputBase64: true,
    });
    expect(Buffer.from(result.output.base64!, 'base64')).toEqual(plaintext);
  });

  it('gzip_inflate reverses gzip compression', () => {
    const original = Buffer.from('a'.repeat(500), 'utf8');
    const gz = gzipSync(original);
    const result = runTransformWorkbench({
      inputBase64: gz.toString('base64'),
      steps: [{ op: 'gzip_inflate' }],
      includeOutputBase64: true,
    });
    expect(Buffer.from(result.output.base64!, 'base64')).toEqual(original);
  });

  it('rejects bad AES key length, missing CBC iv, and non-hex hex_decode input', () => {
    expect(() =>
      runTransformWorkbench({
        inputBase64: Buffer.from('data').toString('base64'),
        steps: [{ op: 'aes_cbc_decrypt', key: 'short', ivHex: randomBytes(16).toString('hex') }],
      }),
    ).toThrow(/AES key must be 16, 24, or 32 bytes/);

    expect(() =>
      runTransformWorkbench({
        inputBase64: Buffer.from('data').toString('base64'),
        steps: [{ op: 'aes_cbc_decrypt', keyHex: randomBytes(16).toString('hex') }],
      }),
    ).toThrow(/requires iv or ivHex/);

    expect(() =>
      runTransformWorkbench({
        inputBase64: Buffer.from('xyz', 'utf8').toString('base64'),
        steps: [{ op: 'hex_decode' }],
      }),
    ).toThrow(/even number of hex digits/);
  });

  it('chains hex_encode -> hex_decode in a multi-step pipeline', () => {
    const result = runTransformWorkbench({
      inputBase64: Buffer.from('ABC', 'utf8').toString('base64'),
      steps: [{ op: 'hex_encode' }, { op: 'hex_decode' }],
      includeOutputBase64: true,
    });
    expect(Buffer.from(result.output.base64!, 'base64').toString('utf8')).toBe('ABC');
  });
});
