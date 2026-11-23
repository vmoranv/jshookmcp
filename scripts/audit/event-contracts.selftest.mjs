#!/usr/bin/env node
// Self-test for scripts/audit/event-contracts.mjs.
//
// WHY THIS EXISTS
// ---------------
// A guard that never fails protects nothing, and a guard that fails for the
// wrong reason gets deleted. Both failure modes look identical from outside the
// audit: in the first it prints OK, in the second it prints a plausible list.
// The only way to know which one you have is to make it fail on purpose and
// check that it fails for the stated reason.
//
// Each case mutates exactly one file, runs the audit, asserts the exit code and
// the text it produced, then restores the file and re-hashes it. A restore that
// does not reproduce the original bytes aborts the whole run: a self-test that
// corrupts the tree is worse than no self-test at all.
//
// NOT part of `pnpm check`. It writes to src/ by design, and a CI job that
// mutates source is a hazard rather than a check. Run it by hand whenever the
// audit changes: `pnpm audit:events:selftest`.
//
// The cases are chosen to pin down the two structural signals that decide
// whether a call is a bus emission (see "ONE CHANNEL, NOT THREE" in the audit),
// because both were added only after a check failed — T1/T2/T3 fail if either
// signal is weakened, T4 fails if the scoping is dropped and non-bus channels
// are judged against ServerEventMap again.
//
// T12/T13/T14 exercise check 9 (declared -> emitted) from the RED side: a new
// declared-but-unemitted name, a baseline entry that gained a producer, and a
// baseline entry whose declaration was removed. A check whose self-test only
// proves the green path is worthless, so each of the three failure branches
// gets its own case.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const AUDIT = join(projectRoot, 'scripts', 'audit', 'event-contracts.mjs');

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const injected = (body) => `\n\n// ── injected by audit-event-contracts.selftest.mjs ──\n${body}\n`;

/**
 * T13/T14 act on a REAL baseline entry, so read the subject OUT of the audit
 * script instead of hardcoding a name.
 *
 * This is not hypothetical polish. T13 was originally pinned to
 * `network:dns_resolved`; when that event was actually wired up it left the
 * baseline, after which T13 injected a producer for a name the baseline no
 * longer contained — exit 0, "FAIL — expected 1", testing nothing. T14 was
 * subtler and worse: it kept passing, but only because deleting the declaration
 * tripped a DIFFERENT check (an emitted-but-undeclared failure), so it silently
 * stopped covering the branch its own label claims.
 *
 * Deriving the name makes both cases follow the baseline automatically. If the
 * extraction yields nothing we ABORT rather than run a vacuous test.
 */
const BASELINE_SUBJECTS = (() => {
  const source = readFileSync(AUDIT, 'utf8');
  const block = source.match(/const UNEMITTED_EVENT_BASELINE = \[([\s\S]*?)\n\];/);
  if (!block) return [];
  return [...block[1].matchAll(/name:\s*'([^']+)'/g)].map((match) => match[1]);
})();

if (BASELINE_SUBJECTS.length === 0) {
  console.error('[selftest] ABORT: read no names out of UNEMITTED_EVENT_BASELINE.');
  console.error('  T13/T14 would silently test nothing. Fix the extraction or the baseline shape.');
  process.exit(2);
}

const BASELINE_SUBJECT = BASELINE_SUBJECTS[0];

const BASELINE_DECLARATION = (() => {
  const source = readFileSync(join(projectRoot, 'src', 'server', 'EventBus.ts'), 'utf8');
  const escaped = BASELINE_SUBJECT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`^  '${escaped}':.*$`, 'm'));
  if (!match) {
    console.error(
      `[selftest] ABORT: baseline subject ${BASELINE_SUBJECT} has no declaration in EventBus.ts.`,
    );
    process.exit(2);
  }
  return match[0];
})();

const CASES = [
  {
    id: 'T1',
    what: 'catches a bus emission when the FILE names the bus contract (signal a)',
    file: 'src/server/domains/network/handlers/shared.ts',
    patch: (source) =>
      source +
      injected(
        'export function __probe(a: EventBus<ServerEventMap>): void {\n' +
          "  emitEvent(a, 'probe:filelevel', { timestamp: '' });\n" +
          '}',
      ),
    expectExit: 1,
    expectInOutput: ['probe:filelevel'],
  },
  {
    id: 'T2',
    what: 'catches a bus emission when only the RECEIVER names the bus (signal b)',
    file: 'src/server/macros/MacroRunner.ts',
    patch: (source) =>
      source +
      injected(
        'export function __probe(ctx: { eventBus: { emit(n: string, p: unknown): void } }): void {\n' +
          "  ctx.eventBus.emit('probe:receiver', { timestamp: '' });\n" +
          '}',
      ),
    expectExit: 1,
    expectInOutput: ['probe:receiver'],
  },
  {
    id: 'T3',
    what: 'catches a bus emission through an INHERITED helper (the extends hop)',
    file: 'src/server/domains/protocol-analysis/handlers/payload-handlers.ts',
    patch: (source) =>
      source +
      injected(
        'export function __probe(h: ProtocolAnalysisPayloadHandlers): void {\n' +
          "  h.emitEvent('probe:inherited', { timestamp: '' });\n" +
          '}',
      ),
    expectExit: 1,
    expectInOutput: ['probe:inherited'],
  },
  {
    id: 'T4',
    what: 'does NOT judge an off-channel emission against ServerEventMap (negative control)',
    file: 'src/server/macros/MacroRunner.ts',
    patch: (source) =>
      source +
      injected(
        'export function __probe(ctx: { emitSpan(n: string, a?: unknown): void }): void {\n' +
          "  ctx.emitSpan('probe:offchannel', {});\n" +
          '}',
      ),
    expectExit: 0,
    expectInOutput: ['probe:offchannel'],
    expectNotInOutput: ['FAIL: events are emitted on the bus'],
  },
  {
    id: 'T5',
    what: 'still fails a boost rule with no producer (the narrowed set feeds check 3)',
    file: 'src/server/activation/ActivationController.ts',
    patch: (source) =>
      source.replace("eventPattern: 'v8:heap_captured',", "eventPattern: 'probe:deadrule',"),
    expectExit: 1,
    expectInOutput: ['probe:deadrule'],
  },
  {
    id: 'T6',
    what: 'ABORTS instead of reporting when the scanner stops reading literals',
    file: 'scripts/audit/event-contracts.mjs',
    patch: (source) =>
      source.replace(
        'function staticString(argument) {',
        'function staticString(argument) {\n  return undefined; // broken on purpose by the self-test',
      ),
    expectExit: 2,
    expectInOutput: ['ABORT'],
  },
  {
    id: 'T7',
    what: 'fails a *Contract.ts module that nothing imports (check 7)',
    // The only case that materialises a file instead of patching one: an orphan
    // contract has to not exist for the check to be meaningful.
    create: 'src/server/__orphan_probe__/OrphanProbeContract.ts',
    content: "export const OrphanProbeNames = { probe: 'probe.orphan' } as const;\n",
    expectExit: 1,
    expectInOutput: ['src/server/__orphan_probe__/OrphanProbeContract.ts'],
  },
  {
    id: 'T8',
    what: 'fails an instrumentation name that is declared but never emitted (check 8)',
    // Declares a name nothing emits — the exact shape that kept
    // InstrumentationContract dead for six months. The audit must fail on the
    // new name, not merely report it.
    file: 'src/utils/instrumentation.ts',
    patch: (source) =>
      source.replace(
        "  captchaDetect: 'captcha.detect',",
        "  captchaDetect: 'captcha.detect',\n  probeUnwired: 'probe.unwired',",
      ),
    expectExit: 1,
    expectInOutput: ['SpanNames.probeUnwired'],
  },
  {
    id: 'T9',
    what: 'ABORTS when the instrumentation scan stops resolving member arguments',
    // A blind instrumentation scan would report every declared name as
    // unproduced — a wall of false failures that blames the contract for a
    // scanner bug. The canary gate must turn that into an abort instead.
    file: 'scripts/audit/event-contracts.mjs',
    patch: (source) =>
      source.replace(
        'function instrumentationMember(argument) {',
        'function instrumentationMember(argument) {\n  return undefined; // broken on purpose by the self-test',
      ),
    expectExit: 2,
    expectInOutput: ['instrumentation canary not found'],
  },
  {
    id: 'T10',
    what: 'fails an unproduced name in the SECOND well-known-name family (check 8)',
    // T8 covers the instrumentation family. This one proves the check is driven
    // by NAME_CONST_SOURCES rather than hardcoded to SpanNames/MetricNames — a
    // regression that only covered the first module would pass T8 and fail here.
    file: 'src/server/workflows/WorkflowContract.ts',
    patch: (source) =>
      source.replace(
        "  macroError: 'macro.error',",
        "  macroError: 'macro.error',\n  probeUnwiredWorkflowSpan: 'probe.unwired_workflow_span',",
      ),
    expectExit: 1,
    expectInOutput: ['WorkflowSpanNames.probeUnwiredWorkflowSpan'],
  },
  {
    id: 'T11',
    what: 'fails a well-known-name object that was emptied (check 8 vacuity guard)',
    // Empties the object while leaving the emit sites intact, so the canary still
    // resolves and the vacuity guard is what fires. Without that guard an emptied
    // object would report OK — the check would protect nothing and say nothing.
    file: 'src/server/workflows/WorkflowContract.ts',
    patch: (source) =>
      source.replace(
        /export const WorkflowSpanNames = \{[\s\S]*?\} as const;/,
        'export const WorkflowSpanNames = {} as const;',
      ),
    expectExit: 1,
    expectInOutput: ['a well-known-name object declares no names'],
  },
  {
    id: 'T12',
    what: 'fails a NEW declared-but-unemitted name (check 9, forward direction)',
    // Declares a name nothing emits. Without check 9 the map would grow dead
    // entries and the audit would stay green — the whole reason the reverse
    // direction exists. Inserted inside the interface, so a plain append (the
    // injected() helper) is not usable here.
    file: 'src/server/EventBus.ts',
    patch: (source) =>
      source.replace(
        "  'tool:activated': { toolName: string; domain: string; timestamp: string };",
        "  'tool:activated': { toolName: string; domain: string; timestamp: string };\n" +
          "  'probe:declared_unemitted': { timestamp: string };",
      ),
    expectExit: 1,
    expectInOutput: ['probe:declared_unemitted'],
  },
  {
    id: 'T13',
    what: 'fails a baseline entry that GAINED a producer (check 9, stale baseline)',
    // Gives the baselined event a real emission site, so its baseline entry is
    // stale and must be removed. Without this half of the ratchet the baseline
    // would silently exempt a wired-up emitter forever.
    file: 'src/server/domains/network/handlers/shared.ts',
    patch: (source) =>
      source +
      injected(
        'export function __probe(a: EventBus<ServerEventMap>): void {\n' +
          `  emitEvent(a, '${BASELINE_SUBJECT}', { timestamp: '' });\n` +
          '}',
      ),
    expectExit: 1,
    expectInOutput: [BASELINE_SUBJECT],
  },
  {
    id: 'T14',
    what: 'fails a baseline entry ServerEventMap no longer declares (check 9, stale baseline)',
    // Removes the declaration the baseline still records. Without this branch a
    // renamed or deleted event would leave an orphan baseline entry that protects
    // nothing and says nothing.
    file: 'src/server/EventBus.ts',
    patch: (source) => source.replace(BASELINE_DECLARATION, ''),
    expectExit: 1,
    expectInOutput: [BASELINE_SUBJECT],
  },
];

let failed = 0;
const restored = [];

// ── pre-flight: refuse to run on top of a previous run's residue ─────────────
//
// A run whose cleanup was blocked — a sandboxed filesystem, a read-only tree —
// leaves its probe artifacts behind. Left undetected that residue makes T7
// refuse to overwrite AND makes the negative control fail for an unrelated
// reason: two confusing failures that between them hide the real problem. Say
// what is actually wrong instead, and say how to fix it.
const leftovers = CASES.filter(
  (testCase) => testCase.create && existsSync(join(projectRoot, testCase.create)),
);
if (leftovers.length > 0) {
  console.error('[selftest] ABORT: a previous run left probe artifacts behind.');
  for (const testCase of leftovers) console.error(`  ${testCase.create}`);
  console.error(
    '\n  These are NOT cleaned up automatically. Remove them and re-run.\n' +
      '  Their presence means an earlier cleanup was blocked, so this run would\n' +
      '  report failures that belong to the previous one.',
  );
  process.exit(2);
}

/**
 * Apply a case's mutation and return the function that undoes it.
 *
 * A case either patches an existing file (restored byte-for-byte and re-hashed,
 * aborting the run if the bytes differ) or creates a new one (removed again,
 * with the directory it needed). Throwing here fails just that case.
 */
function applyCase(testCase) {
  if (testCase.create) {
    const target = join(projectRoot, testCase.create);
    if (existsSync(target)) {
      throw new Error(`${testCase.create} already exists — refusing to overwrite`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, testCase.content);
    return () => {
      try {
        rmSync(target, { force: true });
      } catch {
        // Swallowed on purpose: the existence check below reports it properly,
        // with the file name, instead of surfacing a raw fs error from a
        // sandbox wrapper.
      }
      if (existsSync(target)) {
        // Same discipline as the patch cases' hash check: a self-test that
        // leaves residue in src/ is worse than no self-test, so say so loudly
        // rather than continuing with a tree that no longer matches HEAD.
        console.error(`[selftest] FATAL: could not remove ${testCase.create}`);
        console.error('    the working tree now contains a file that is not in git');
        process.exit(2);
      }
      try {
        rmdirSync(dirname(target)); // only succeeds while the directory is empty
      } catch {
        /* directory was not ours to remove — leave it */
      }
    };
  }

  const target = join(projectRoot, testCase.file);
  const original = readFileSync(target, 'utf8');
  const before = sha256(original);
  const patched = testCase.patch(original);
  if (patched === original) {
    throw new Error(`patch changed nothing in ${testCase.file} (anchor moved?)`);
  }
  writeFileSync(target, patched);
  return () => {
    writeFileSync(target, original);
    const after = sha256(readFileSync(target, 'utf8'));
    if (after !== before) {
      console.error(`[selftest] FATAL: could not restore ${testCase.file}`);
      console.error(`    expected sha256 ${before}`);
      console.error(`    actual   sha256 ${after}`);
      process.exit(2);
    }
  };
}

for (const testCase of CASES) {
  let undo;
  try {
    undo = applyCase(testCase);
  } catch (error) {
    failed += 1;
    console.error(`[selftest] ${testCase.id} FAIL — ${error.message}`);
    continue;
  }

  let result;
  try {
    // No --quiet: T4 asserts on the off-channel note, which only prints without it.
    result = spawnSync(process.execPath, [AUDIT], {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } finally {
    undo();
  }

  restored.push(testCase.create ?? testCase.file);

  // Normalise separators: the audit reports paths via path.relative(), which is
  // backslash-separated on Windows, while the expectations below are written
  // with forward slashes. Comparing raw would make every path assertion
  // platform-dependent — which is how T7 first failed, with the guard working
  // correctly and only the assertion being wrong.
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replaceAll('\\', '/');
  const problems = [];
  if (result.status !== testCase.expectExit) {
    problems.push(`exit code ${result.status}, expected ${testCase.expectExit}`);
  }
  for (const needle of testCase.expectInOutput ?? []) {
    if (!output.includes(needle)) problems.push(`output never mentions "${needle}"`);
  }
  for (const needle of testCase.expectNotInOutput ?? []) {
    if (output.includes(needle)) problems.push(`output unexpectedly mentions "${needle}"`);
  }

  if (problems.length === 0) {
    console.log(`[selftest] ${testCase.id} PASS — ${testCase.what}`);
    continue;
  }

  failed += 1;
  console.error(`[selftest] ${testCase.id} FAIL — ${testCase.what}`);
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('    ── audit output ──');
  for (const line of output.split('\n')) console.error(`    ${line}`);
}

console.log(`\n[selftest] ${CASES.length - failed}/${CASES.length} cases passed.`);
console.log(`[selftest] restored: ${new Set(restored).size} path(s).`);
process.exit(failed === 0 ? 0 : 1);
