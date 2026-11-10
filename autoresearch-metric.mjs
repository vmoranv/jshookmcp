#!/usr/bin/env node
/**
 * LOCKED METRIC EXTRACTOR — autoresearch harness component. DO NOT EDIT during the loop.
 *
 * Reads the artifacts written by `pnpm bench:tools` + retrieval-metrics test and prints
 * `METRIC name=number` lines. The primary metric is:
 *
 *   debt = unmeasured + low_mrr + vector_fail     (lower is better)
 *
 *   unmeasured  = 736 − tools with ≥1 vector case          (per-tool-scorecard.json)
 *   low_mrr     = tools with retrieval evidence, MRR < 0.6  (retrieval-per-tool.json)
 *   vector_fail = Σ(suite.failed + suite.errored)           (scorecard.json, gate execution)
 *
 * Secondary metrics (monitoring only):
 *   vectors_total   = tools with ≥1 vector case
 *   per_tool_shortfall = Σ(total−passed) in the per-tool re-execution view
 *                        (includes env-gated skips counted as unmeasured by the
 *                        per-tool scorecard — a measurement-coverage artifact, NOT
 *                        correctness, hence excluded from the primary metric)
 *   slowest_ms      = worst measured throughput
 *   p1_pct, mrr10_pct = engine-wide retrieval aggregates
 *   rejection_pct   = out-of-domain rejection accuracy (must not regress)
 */
import { readFileSync } from 'node:fs';

const A = 'artifacts/benchmarks';
const j = (p) => JSON.parse(readFileSync(`${A}/${p}`, 'utf8'));

const perTool = j('per-tool-scorecard.json');
const suites = j('scorecard.json');
const retrPerTool = j('retrieval-per-tool.json');
const retrAgg = j('retrieval-metrics.json');
const rejection = j('retrieval-rejection.json');

const TOTAL_TOOLS = 736;
const withVectors = perTool.stats.withVectors ?? 0;
const unmeasured = TOTAL_TOOLS - withVectors;

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

const pct = (x) => Math.round(x * 1000) / 10;

console.log(`METRIC debt=${unmeasured + lowMrr + vectorFail}`);
console.log(`METRIC unmeasured=${unmeasured}`);
console.log(`METRIC low_mrr=${lowMrr}`);
console.log(`METRIC vector_fail=${vectorFail}`);
console.log(`METRIC vectors_total=${withVectors}`);
console.log(`METRIC per_tool_shortfall=${shortfall}`);
console.log(`METRIC slowest_ms=${Math.round(slowestMs * 100) / 100}`);
console.log(`METRIC p1_pct=${pct(retrAgg.pAt1 ?? 0)}`);
console.log(`METRIC mrr10_pct=${pct(retrAgg.mrrAt10 ?? 0)}`);
console.log(`METRIC rejection_pct=${pct(rejection.rejectionAccuracy ?? 0)}`);
