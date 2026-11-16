#!/usr/bin/env node
/**
 * LOCKED METRIC EXTRACTOR — autoresearch harness component. DO NOT EDIT the
 * debt DEFINITION without recording it (A-phase, 2026-11-15: debt now
 * penalizes semantic coverage only).
 *
 * Reads the artifacts written by `pnpm bench:tools` + retrieval-metrics test and prints
 * `METRIC name=number` lines. The primary metric is:
 *
 *   debt = semanticUnmeasured + low_mrr + vector_fail     (lower is better)
 *
 *   semanticUnmeasured = TOTAL_TOOLS − tools with ≥1 SEMANTIC case
 *                        (per-tool-scorecard.json stats.semanticCovered)
 *   low_mrr            = tools with retrieval evidence, MRR < 0.6 (retrieval-per-tool.json)
 *   vector_fail        = Σ(suite.failed + suite.errored)  (scorecard.json, gate execution)
 *
 * A-PHASE CHANGE: previously `unmeasured = 736 − tools with ≥1 vector case`,
 * so adding a cheap refusal/contract case lowered debt without proving the
 * tool's computation. debt now only drops when a SEMANTIC case lands. Contract
 * coverage is reported as `contract_only` (monitoring), never counted in debt.
 * The historical `616 → 29` series is NOT directly comparable to new values.
 *
 * Secondary metrics (monitoring only):
 *   vectors_total   = tools with ≥1 vector case (compat)
 *   semantic_covered= tools with ≥1 semantic case
 *   contract_only   = tools with contract votes but no semantic vote
 *   per_tool_shortfall = Σ(total−passed) in the per-tool view
 *   slowest_ms      = worst measured throughput
 *   p1_pct, mrr10_pct = engine-wide retrieval aggregates
 *   rejection_pct   = out-of-domain rejection accuracy (must not regress)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Resolve an argv script path to a comparable absolute file path. */
function resolvePath(p) {
  return resolve(p);
}

const A = 'artifacts/benchmarks';
const j = (p) => JSON.parse(readFileSync(`${A}/${p}`, 'utf8'));
/** Round a ratio to one decimal percentage (pure, no captured scope). */
function pct(x) {
  return Math.round(x * 1000) / 10;
}

/**
 * Pure debt computation (exported for the selftest). Takes parsed artifacts so
 * the test can construct fixtures without touching the filesystem.
 */
export function computeDebt(art) {
  const perTool = art.perTool;
  const suites = art.suites;
  const retrPerTool = art.retrPerTool;
  const retrAgg = art.retrAgg;
  const rejection = art.rejection;

  // TOTAL_TOOLS is derived from the generated scorecard, never hardcoded twice.
  const TOTAL_TOOLS = perTool.stats.total ?? 736;
  const withVectors = perTool.stats.withVectors ?? 0;
  const semanticCovered = perTool.stats.semanticCovered ?? withVectors;
  const contractOnly = perTool.stats.contractOnly ?? 0;
  const unmeasured = TOTAL_TOOLS - semanticCovered; // semantic-only

  const lowMrr = Object.values(retrPerTool).filter((e) => e && e.mrr < 0.6).length;

  let vectorFail = 0;
  for (const r of suites.results ?? []) vectorFail += (r.failed ?? 0) + (r.errored ?? 0);

  let shortfall = 0;
  let slowestMs = 0;
  for (const t of perTool.tools ?? []) {
    const cm = /^(\d+)\/(\d+) vectors$/.exec(t.correctness ?? '—');
    if (cm) shortfall += Number(cm[2]) - Number(cm[1]);
    const tm = /^([\d.]+)(ms|µs|us)\/call$/.exec(t.throughput ?? '—');
    if (tm) {
      const v = Number(tm[1]);
      const ms = tm[2] === 'ms' ? v : v / 1000;
      if (ms > slowestMs) slowestMs = ms;
    }
  }

  return {
    debt: unmeasured + lowMrr + vectorFail,
    unmeasured,
    low_mrr: lowMrr,
    vector_fail: vectorFail,
    vectors_total: withVectors,
    semantic_covered: semanticCovered,
    contract_only: contractOnly,
    per_tool_shortfall: shortfall,
    slowest_ms: Math.round(slowestMs * 100) / 100,
    p1_pct: pct(retrAgg.pAt1 ?? 0),
    mrr10_pct: pct(retrAgg.mrrAt10 ?? 0),
    rejection_pct: pct(rejection.rejectionAccuracy ?? 0),
  };
}

function runCli() {
  const art = {
    perTool: j('per-tool-scorecard.json'),
    suites: j('scorecard.json'),
    retrPerTool: j('retrieval-per-tool.json'),
    retrAgg: j('retrieval-metrics.json'),
    rejection: j('retrieval-rejection.json'),
  };
  const m = computeDebt(art);
  for (const [k, v] of Object.entries(m)) console.log(`METRIC ${k}=${v}`);
}

// Standalone CLI (autoresearch.sh), not when imported by the selftest.
const invokedPath = process.argv[1] ? resolvePath(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) runCli();
