/**
 * SandboxHelpers — pure-JS hash/array helper regressions.
 *
 * The MD5 tail block used absolute string offsets as block-relative indices and
 * the SHA-256 length field used shifts >= 32 (which JS takes modulo 32); both
 * silently produced wrong digests for most inputs.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QuickJSSandbox } from '@server/sandbox/QuickJSSandbox';

const INPUTS = [
  '',
  'a',
  'abc',
  'message digest',
  'a'.repeat(55),
  'a'.repeat(56),
  'a'.repeat(63),
  'a'.repeat(64),
  'a'.repeat(65),
  'a'.repeat(100),
  'a'.repeat(127),
  'a'.repeat(128),
  'a'.repeat(200),
  'The quick brown fox jumps over the lazy dog',
];

function nodeDigest(algorithm: 'md5' | 'sha256', input: string): string {
  return createHash(algorithm).update(input, 'utf8').digest('hex');
}

describe('SandboxHelpers.hash', () => {
  const sandbox = new QuickJSSandbox();

  it('md5 matches Node crypto across block boundaries', async () => {
    const code = `JSON.stringify(${JSON.stringify(INPUTS)}.map(function (s) { return helpers.hash.md5(s); }))`;
    const result = await sandbox.execute(code);

    expect(result.ok).toBe(true);
    const digests = JSON.parse(result.output as string) as string[];
    expect(digests).toEqual(INPUTS.map((input) => nodeDigest('md5', input)));
  });

  it('sha256 matches Node crypto across block boundaries', async () => {
    const code = `JSON.stringify(${JSON.stringify(INPUTS)}.map(function (s) { return helpers.hash.sha256(s); }))`;
    const result = await sandbox.execute(code);

    expect(result.ok).toBe(true);
    const digests = JSON.parse(result.output as string) as string[];
    expect(digests).toEqual(INPUTS.map((input) => nodeDigest('sha256', input)));
  });
});

describe('SandboxHelpers.array.chunk', () => {
  const sandbox = new QuickJSSandbox();

  it('splits arrays and rejects non-positive sizes without hanging', async () => {
    const result = await sandbox.execute(`
      JSON.stringify({
        even: helpers.array.chunk([1, 2, 3, 4, 5], 2),
        zero: helpers.array.chunk([1, 2, 3], 0),
        negative: helpers.array.chunk([1, 2, 3], -2),
      })
    `);

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.output as string)).toEqual({
      even: [[1, 2], [3, 4], [5]],
      zero: [],
      negative: [],
    });
  });
});
