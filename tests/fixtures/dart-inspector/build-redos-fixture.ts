#!/usr/bin/env tsx
/**
 * Build the ReDoS stress fixture used by dart-inspector ReDoS integration tests.
 *
 * Outputs:
 *   tests/fixtures/dart-inspector/redos-buffer.bin    (100 KB of 'a')
 *
 * Regenerate with:
 *   pnpm tsx tests/fixtures/dart-inspector/build-redos-fixture.ts
 *
 * The buffer is deliberately uniform so a catastrophic-backtracking pattern
 * like `(a+)+b` will, if it ever reached the regex engine, take exponential
 * time. We use it to verify that the StringsExtractor stack rejects such
 * patterns either at compile time (heuristic) or at runtime (DART_REGEX_TIMEOUT_MS).
 */

import { writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(FIXTURE_DIR, 'redos-buffer.bin');

const SIZE = 100 * 1024;

async function main(): Promise<void> {
  const buf = Buffer.alloc(SIZE, 0x61); // ASCII 'a'
  await writeFile(OUT_PATH, buf);

  // eslint-disable-next-line no-console
  console.log(`wrote ${OUT_PATH} (${SIZE} bytes, all 0x61)`);
}

await main();
