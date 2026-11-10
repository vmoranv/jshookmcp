# Autoresearch: per-tool quality debt (jshookmcp benchmark + retrieval)

> The metric is the sole arbiter. "This looks better" never drives a keep/discard —
> only a measured improvement that clears the noise floor does.

## Objective

Close the measurable per-tool quality gaps of the 736-tool MCP server, as scored by
the project's own eval suite (`pnpm bench:tools` + retrieval-metrics test). Baseline
audit (2026-11-10, artifacts/benchmarks/per-tool-scorecard.json):

- **565/736 tools have zero vector cases** (correctness never measured offline).
  Biggest holes: browser 79/85 · memory 72/75 · native-emulator 54/57 ·
  binary-instrument 41/46 · network 30/38 · process 26/29 · debugger 21/21 (live) ·
  core 19/25 · adb-bridge 21/26 (parsers are offline-pure!) · streaming 12/17 ·
  graphql 7/7 · mojo-ipc 7/8 · trace 8/10 · protocol-analysis 9/20.
  The README sanctions the lever: "To raise coverage, add an offline-pure
  `suites/<domain>.suite.ts`".
- **51/114 tools with retrieval evidence score MRR < 0.6; 5 score 0.0**
  (browser_attach, get_call_stack, detect_obfuscation, syscall_get_stats,
  dart_object_pool_dump). Lever: enrich tool descriptions/keywords in
  `src/server/domains/*/definitions.ts` with TRUE synonyms — never query-specific
  keyword stuffing. Engine params are OFF LIMITS (they are tuned by search:tune on
  the same fixture family — tuning here would be eval overfitting).
- **vector_fail = 0** (all 243 evaluated gate cases pass). Two per-tool partials
  (session_progress_record 2/3, tls_keylog_seal 1/2) exist only in the per-tool
  re-execution view — suspected re-execution state pollution, tracked in
  `per_tool_shortfall` (12), NOT in the primary metric.

Mechanism notes learned while studying the harness:
- `measureVectorBenches()` re-executes ALL suites inside per-tool-scorecard and
  counts a skipped case as a non-passed vector → env-gated misc-residual cases
  (9) inflate `per_tool_shortfall` on this Windows box. Honest: skip ≠ measurement.
- Gate (`tools-benchmark.test.ts`) runs suites once; per-tool view runs them
  AGAIN in the same process → non-idempotent cases (state-writing handlers) can
  pass the gate yet fail the per-tool view.
- bench:tools does NOT refresh retrieval artifacts — autoresearch.sh runs the
  retrieval test first, then bench:tools.

## Metrics

- **Primary**: `debt` = `unmeasured + low_mrr + vector_fail` (count, lower is better)
- **Secondary**: `vectors_total`, `low_mrr`, `vector_fail`, `per_tool_shortfall`,
  `slowest_ms`, `p1_pct`, `mrr10_pct`, `rejection_pct`
  — once tracked, include in every subsequent result.
- **Noise floor**: measured over 3 identical baseline runs (see config header).
  All three primary components are deterministic (pure handlers + BM25 over fixed
  fixtures), so the floor should be 0; any nonzero value means harness
  nondeterminism and must be investigated before trusting keeps.
- Guardrails inside `debt`: `rejection_pct` must stay 100 (it lives in the
  rejection fixture, refreshed each run; a description edit that lets
  out-of-domain queries match would also show up as retrieval churn — treat
  rejection_pct regression as checks_failed-level, discard even if debt falls).

## Budget

- maxRuns: 200 | maxSeconds: none | targetMetric: none
- Per-experiment wall-clock cap: 5 min (autoresearch.sh wraps each stage in
  `timeout 300`; typical run ≈ 15s).

## How to Run

`./autoresearch.sh [SEED]` — prints `METRIC name=number` lines. Exit non-zero =
crash (gate floor breach counts as crash). `./checks.sh` must then pass (exit 0).

## Files in Scope

- `tests/benchmarks/suites/*.suite.ts` + `suites/index.ts` — new offline-pure
  vector suites / cases (raises `vectors_total`, may surface real handler bugs).
- `tests/server/benchmarks/tools-benchmark.test.ts` — ONLY to append a
  `SUITE_THRESHOLDS` entry for a newly added suite (floor ≥ 85, matching sibling
  suites). Never lower an existing floor.
- `tests/benchmarks/CATALOG.md` — bookkeeping row for a new/extended suite
  (honest docs, required by the maintenance policy in that file).
- `src/server/domains/*/definitions.ts` (+ `handlers.impl.ts` / `src/modules/**`
  when a new vector exposes a REAL handler bug) — retrieval description work and
  bug fixes. Description edits MUST be followed by `pnpm metadata:sync` +
  `pnpm openapi:generate` (checks.sh enforces no drift).
- `artifacts/**` is gitignored regenerated output — never hand-edit.

## Off Limits

- `autoresearch.sh`, `autoresearch-metric.mjs`, `checks.sh` — **the eval harness
  is locked.** Never edit to change what/how the metric is measured.
- `tests/benchmarks/harness.ts`, `tests/benchmarks/per-tool-scorecard.suite.ts`,
  `tests/server/benchmarks/retrieval-metrics.test.ts` — measurement machinery.
- `tests/server/search/fixtures/**` (search-quality + search-rejection fixtures),
  `scripts/search-tune/**`, `src/server/search/**` engine constants — the eval
  data and the engine's tuned parameters. Improving retrieval happens ONLY on
  the tool-description side.
- Existing `SUITE_THRESHOLDS` values (may only ADD an entry for a new suite).
- No new runtime dependencies; no live browser/device/network in new cases.

## Constraints

- Every new vector case must be **offline-pure** and deterministic (see
  `DOMAIN_ENVIRONMENT` gate in per-tool-scorecard.suite.ts for each domain's
  offline capability; follow the encoding.suite.ts case shape: `run` calls the
  bound handler, `validate` asserts on `body()` output, cite external spec in
  `reference` when applicable).
- Zero built-in feature library (repo rule): vectors assert algorithm/spec
  behavior of code under test, never "known-bad payload" tables.
- `pnpm metadata:check`, `openapi:check`, `lint` must stay green (checks.sh).
- Description edits add only TRUE synonyms/capabilities that a real user query
  could legitimately use — no per-query keyword stuffing.
- Git: work happens on branch `autoresearch/per-tool-quality-20261110`; NEVER
  commit master; push/merge only after user confirmation (repo ⛔ rule).

## What's Been Tried

(no experiments yet — baseline being measured)
