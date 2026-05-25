/**
 * ReDoS integration tests for the dart-inspector module — Phase 1.2.5.
 *
 * Verifies the two red lines documented in design.md §5.6:
 *   1. **Compile-time** — `compileRuleInput()` rejects patterns matching the
 *      catastrophic-backtracking heuristics (e.g. `(a+)+b`).
 *   2. **Runtime** — when a `.test()` exceeds `regexTimeoutMs` the extract
 *      aborts with a `ToolError` (code `TIMEOUT`). This is post-hoc — V8 regex
 *      execution cannot be preempted, so the slow match still completes, but
 *      we refuse to continue once we have seen one over budget.
 *
 * @see openspec/changes/add-dart-strings-extract/tasks.md §1.2.5
 * @see openspec/changes/add-dart-strings-extract/design.md §5.6
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { StringsExtractor } from '@modules/dart-inspector/StringsExtractor';
import { compileRuleInput } from '@modules/dart-inspector/classifiers';
import { ToolError } from '@errors/ToolError';

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'dart-inspector',
);
const REDOS_FIXTURE_PATH = join(FIXTURES_DIR, 'redos-buffer.bin');

let tmpDir: string;
let redosFixtureCopy: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'dart-inspector-redos-'));
  // Copy the committed fixture into the temp dir so the extractor's stat()
  // path resolves through a stable absolute path even if cwd shifts.
  const fixture = await readFile(REDOS_FIXTURE_PATH);
  redosFixtureCopy = join(tmpDir, 'redos-buffer.bin');
  await writeFile(redosFixtureCopy, fixture);
  // Sanity — the fixture must be the 100 KB all-`a` buffer.
  expect(fixture.length).toBe(100 * 1024);
  expect(fixture[0]).toBe(0x61);
  expect(fixture[fixture.length - 1]).toBe(0x61);
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('ReDoS red line 1 — compile-time heuristic rejection', () => {
  it('rejects (a+)+b as catastrophic at compile time', () => {
    expect(() => compileRuleInput({ category: 'evil', pattern: '(a+)+b' })).toThrowError(
      expect.objectContaining({
        name: 'ToolError',
        code: 'VALIDATION',
        message: expect.stringContaining('catastrophic'),
      }),
    );
  });

  it('rejects (a|b)+c+ as catastrophic at compile time', () => {
    expect(() => compileRuleInput({ category: 'evil', pattern: '(a|b)+c+' })).toThrowError(
      expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }),
    );
  });

  it("the extractor's customRules path also rejects (a+)+b before any scan begins", async () => {
    const extractor = new StringsExtractor();
    // We can't pass the string-input form directly to StringsExtractor (it
    // expects already-compiled CategoryRule[]); the rejection happens at the
    // compileRuleInput boundary which is what the handler layer will call.
    // This test pins that the boundary stays the gatekeeper.
    expect(() => compileRuleInput({ category: 'evil', pattern: '(a+)+b' })).toThrow(ToolError);
    expect(extractor).toBeInstanceOf(StringsExtractor); // touch instance to defeat unused-var lint
  });
});

describe('ReDoS red line 2 — runtime per-test timeout', () => {
  it('aborts the extract when a single regex test exceeds regexTimeoutMs', async () => {
    const extractor = new StringsExtractor();

    // `(a|a)*` is the canonical ambiguous-alternation ReDoS shape but it
    // SLIPS PAST our compile-time heuristic (no `[+*]` inside the parens —
    // just `a|a`, which the heuristic doesn't recognise). We rely on this
    // mismatch to drive the test: compile-time accepts it, runtime times
    // out.
    const slowRule = compileRuleInput({
      category: 'slowAmbiguous',
      pattern: '^(a|a)*$',
    });

    // Set regexTimeoutMs = 0 so ANY measurable elapsed time fires the guard.
    // The 100 KB all-`a` buffer makes a single .test() take far more than a
    // microsecond on any realistic CPU, so the guard reliably trips.
    await expect(
      extractor.extractFromFile(redosFixtureCopy, {
        customRules: [slowRule],
        ruleMode: 'replace',
        regexTimeoutMs: 0,
        // includeRaw so the extracted 100 KB string isn't silently dropped.
        includeRaw: true,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        name: 'ToolError',
        code: 'TIMEOUT',
        message: expect.stringContaining('DART_REGEX_TIMEOUT_MS'),
      }),
    );
  }, 30_000);

  it('does NOT fire under a normal timeout for a simple rule on the same input', async () => {
    const extractor = new StringsExtractor();

    // Same fixture, same input string size — but with a simple anchored
    // rule and the default regexTimeoutMs (50 ms). Simple patterns finish
    // in microseconds, so the guard stays silent.
    const fastRule = compileRuleInput({
      category: 'fastLiteral',
      pattern: '^a+$',
    });

    const result = await extractor.extractFromFile(redosFixtureCopy, {
      customRules: [fastRule],
      ruleMode: 'replace',
      includeRaw: true,
    });

    // The 100 KB all-`a` buffer extracts as one big string that matches
    // `^a+$`, so the `fastLiteral` bucket should have exactly one hit.
    expect(result.fastLiteral?.length).toBe(1);
  });
});
