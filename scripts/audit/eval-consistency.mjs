#!/usr/bin/env node
/**
 * D-phase: evaluation-number consistency drift guard.
 *
 *   node scripts/audit/eval-consistency.mjs --check
 *
 * Goal: a reader can always tell WHICH run a number came from, and a rendered
 * report never contradicts its own stats. This does NOT invent a second
 * "authoritative number" — the single source of truth remains the run's
 * artifacts/benchmarks/*.json with their generatedAt.
 *
 * HONESTY EXEMPTIONS (do not "clean up"):
 *   - `measured:false` bootstrap placeholders, explicit `not measured`, `—`,
 *     and skip counts are FEATURES, not dirty data.
 *   - Missing artifacts are "no evidence", not a failure. The guard checks
 *     only for CONTRADICTION and STALE REFERENCES among what exists.
 *
 * Separate runs are expected: e2e / retrieval / registry-retrieval artifacts
 * are produced by different commands (see tests/benchmarks/README.md). The
 * guard only requires the two artifacts written by the SAME gate run
 * (scorecard.json + per-tool-scorecard.json) to be from the same run.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const A = resolve(process.cwd(), 'artifacts/benchmarks');

/** Same-run tolerance for the two gate-written artifacts (60s). */
const SAME_RUN_TOLERANCE_MS = 60_000;

function readJson(file) {
  const p = resolve(A, file);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readText(file) {
  const p = resolve(A, file);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/** Extract a labelled integer from a report header line (no dynamic RegExp). */
function headerNumber(md, label) {
  if (!md) return null;
  // Header shape: "<label>: **<int>**". Use indexOf + char scanning instead of
  // building a RegExp from the label (Codacy: RegExp constructor with non-literal).
  const at = md.indexOf(label);
  if (at < 0) return null;
  const tail = md.slice(at + label.length);
  const open = tail.indexOf('**');
  if (open < 0) return null;
  let i = open + 2;
  let digits = '';
  while (i < tail.length && tail[i] >= '0' && tail[i] <= '9') {
    digits += tail[i];
    i += 1;
  }
  return digits.length > 0 && tail.slice(i, i + 2) === '**' ? Number(digits) : null;
}

/**
 * Pure consistency check (exported for the selftest). `input` mirrors the
 * artifacts; missing fields stand for missing artifacts.
 */
export function checkConsistency(input) {
  const violations = [];
  const scorecard = input.scorecard ?? null;
  const perToolJson = input.perToolJson ?? null;
  const perToolMd = input.perToolMd ?? null;

  // (1) The two gate-written artifacts must be from the SAME run.
  if (scorecard?.generatedAt && perToolJson?.generatedAt) {
    const a = Date.parse(scorecard.generatedAt);
    const b = Date.parse(perToolJson.generatedAt);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > SAME_RUN_TOLERANCE_MS) {
      violations.push(
        `scorecard.json and per-tool-scorecard.json are from different runs (timestamp delta ${Math.abs(a - b)}ms > ${SAME_RUN_TOLERANCE_MS}ms) — regenerate both via pnpm bench:tools`,
      );
    }
  }

  // (2) A rendered header must not contradict its own stats.
  // Honest placeholders: a bootstrap `measured:false` stub with all-zero stats
  // and a zero header is CORRECT (0 === 0), so no special case is needed.
  if (perToolJson?.stats && perToolMd) {
    const stats = perToolJson.stats;
    if (typeof stats.withCoverage === 'number') {
      const h = headerNumber(perToolMd, 'handler coverage measured');
      if (h !== null && h !== stats.withCoverage) {
        violations.push(
          `per-tool-scorecard.md header says "handler coverage measured: ${h}" but its stats.withCoverage is ${stats.withCoverage} — header contradicts its own stats`,
        );
      }
    }
    if (typeof stats.total === 'number') {
      const m = /native metrics \((\d+) tools\)/.exec(perToolMd);
      if (m && Number(m[1]) !== stats.total) {
        violations.push(
          `per-tool-scorecard.md header says "${m[1]} tools" but stats.total is ${stats.total} — contradictory tool total`,
        );
      }
    }
    if (typeof stats.semanticCovered === 'number') {
      const h = headerNumber(perToolMd, 'Semantic covered');
      if (h !== null && h !== stats.semanticCovered) {
        violations.push(
          `per-tool-scorecard.md header says "Semantic covered: ${h}" but stats.semanticCovered is ${stats.semanticCovered} — header contradicts its own stats`,
        );
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * CI order assertion: e2e + retrieval artifacts must be produced at or before
 * the coverage run (the coverage run contains the gate). Returns violations.
 * A missing coverage mtime means there is no order to assert yet.
 */
export function checkCiOrder(input) {
  const violations = [];
  const cov = input.coverageMtimeMs ?? null;
  const e2e = input.e2eGeneratedAt ?? null;
  const retr = input.retrievalGeneratedAt ?? null;
  if (cov === null) return { ok: true, violations };
  for (const [name, ts] of [
    ['e2e-results.json', e2e],
    ['retrieval-metrics.json', retr],
  ]) {
    if (typeof ts === 'number' && Number.isFinite(ts) && ts > cov) {
      violations.push(
        `${name} was generated AFTER coverage-final.json — CI must produce e2e/retrieval before test:coverage`,
      );
    }
  }
  return { ok: violations.length === 0, violations };
}

function runCli() {
  const scorecard = readJson('scorecard.json');
  const perToolJson = readJson('per-tool-scorecard.json');
  const perToolMd = readText('per-tool-scorecard.md');
  const covPath = resolve(process.cwd(), 'coverage/coverage-final.json');
  const coverageMtimeMs = existsSync(covPath) ? statSync(covPath).mtimeMs : null;
  const e2e = readJson('e2e-results.json');
  const retr = readJson('retrieval-metrics.json');

  // (1) is enforced only when the scorecard claims to be from the SAME run as
  // the per-tool scorecard (bench:tools writes both). `pnpm test` /
  // `test:coverage` legitimately rewrites ONLY per-tool-scorecard.json, so a
  // stale/absent scorecard.json is not a contradiction — skip check (1) then.
  const scoreTs = scorecard?.generatedAt ? Date.parse(scorecard.generatedAt) : NaN;
  const perToolTs = perToolJson?.generatedAt ? Date.parse(perToolJson.generatedAt) : NaN;
  const sameRunPair =
    Number.isFinite(scoreTs) &&
    Number.isFinite(perToolTs) &&
    scoreTs >= perToolTs - SAME_RUN_TOLERANCE_MS;

  const main = checkConsistency({
    scorecard: sameRunPair ? scorecard : null,
    perToolJson,
    perToolMd,
    coverageMtimeMs,
  });
  // CI-order is NOT auto-enforced. The existing `per-tool/layers-actually-measured`
  // gate already hard-fails in CI when e2e/retrieval artifacts are missing, so
  // the workflow's step order is guarded by presence, not by a timestamp race.
  // Comparing a JSON `generatedAt` against a filesystem `mtime` is brittle
  // (clock/tz skew, any local `pnpm test` regenerating retrieval without
  // coverage). Keep `checkCiOrder` as a pure, unit-tested helper that can be
  // invoked explicitly with CHECK_CI_ORDER=1, never by default.
  const enforceCiOrder = /^(1|true)$/i.test(String(process.env.CHECK_CI_ORDER ?? ''));
  const ciOrder = enforceCiOrder
    ? checkCiOrder({
        coverageMtimeMs,
        e2eGeneratedAt: e2e?.generatedAt ? Date.parse(e2e.generatedAt) : null,
        retrievalGeneratedAt: retr?.generatedAt ? Date.parse(retr.generatedAt) : null,
      })
    : { ok: true, violations: [] };
  const violations = [...main.violations, ...ciOrder.violations];
  if (violations.length > 0) {
    for (const v of violations) console.error(`[audit:eval] ${v}`);
    process.exit(1);
  }
  console.log(
    `[audit:eval] consistency OK (scorecard generatedAt=${scorecard?.generatedAt ?? 'n/a'}, per-tool generatedAt=${perToolJson?.generatedAt ?? 'n/a'})`,
  );
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) runCli();
