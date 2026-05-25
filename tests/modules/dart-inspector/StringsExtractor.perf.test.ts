/**
 * Performance test for StringsExtractor — Phase 1.2.4.
 *
 * Generates a 32 MB pseudo-random binary that straddles the default
 * `DART_MAX_CHUNK_BYTES` boundary (16 MB) so the streaming + overlap path is
 * actually exercised, and asserts that extraction completes within 10 s.
 *
 * Why pseudo-random with a fixed seed: real `crypto.randomBytes` would yield
 * almost no printable runs (so the scanner short-circuits instantly and we
 * measure nothing useful). A deterministic LCG seeded the same way every run
 * gives ~3% printable density on average — enough to keep the scanner busy
 * and give the categorizer something to chew on, but bounded enough that the
 * test stays well under its budget.
 *
 * @see openspec/changes/add-dart-strings-extract/tasks.md §1.2.4
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

import { StringsExtractor } from '@modules/dart-inspector/StringsExtractor';

const FIXTURE_BYTES = 32 * 1024 * 1024;
const BUDGET_MS = 10_000;
const SEED = 0xc0ffee;

let tmpDir: string;
let fixturePath: string;

function buildPseudoRandomBuffer(size: number, seed: number): Buffer {
  // xorshift32 — period 2^32 - 1, uniform byte distribution.
  // A Lehmer LCG with modulus 2^32 would have a 256-cycle low byte; we need
  // the full 0x00..0xFF range so printable runs occur naturally.
  const buf = Buffer.allocUnsafe(size);
  let state = (seed | 0) === 0 ? 1 : seed | 0;
  for (let i = 0; i < size; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    buf[i] = state & 0xff;
  }
  return buf;
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'dart-inspector-perf-'));
  fixturePath = join(tmpDir, 'random-32mb.bin');
  const buf = buildPseudoRandomBuffer(FIXTURE_BYTES, SEED);
  await writeFile(fixturePath, buf);
}, 30_000);

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('StringsExtractor performance', () => {
  it(`extracts a ${FIXTURE_BYTES / (1024 * 1024)} MB binary in under ${BUDGET_MS} ms`, async () => {
    const extractor = new StringsExtractor();
    const started = Date.now();
    const result = await extractor.extractFromFile(fixturePath, {
      // includeRaw so unclassified runs (the bulk of hits in pseudo-random
      // input) count toward the sanity assertion below.
      includeRaw: true,
      // Cap offsets so a freak high-frequency token does not blow up memory
      // and skew the measurement away from CPU.
      maxOffsetsPerString: 32,
    });
    const elapsed = Date.now() - started;

    // Sanity: the scanner must produce SOMETHING — if the result is empty we
    // are measuring an early exit, not the real scan cost.
    const totalHits = Object.values(result).reduce((sum, bucket) => sum + (bucket?.length ?? 0), 0);
    expect(totalHits).toBeGreaterThan(0);

    // eslint-disable-next-line no-console
    console.log(
      `[perf] StringsExtractor 32 MB → ${totalHits} hits in ${elapsed} ms (budget ${BUDGET_MS} ms)`,
    );
    expect(elapsed).toBeLessThan(BUDGET_MS);
  }, 15_000);
});
