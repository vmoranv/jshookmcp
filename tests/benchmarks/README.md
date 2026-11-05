# Tool Benchmarks

Quantifiable benchmark evaluation for the 736 MCP tools (36 domains).

- **[CATALOG.md](./CATALOG.md)** — every domain → external benchmark (RFC/spec/official vectors) or homemade suite, with integration status.
- **[existing-tests-coverage.suite.ts](./existing-tests-coverage.suite.ts)** — the audit/test-asset benchmark layer (breadth).
- **[tool-inventory.md](./tool-inventory.md)** — the full 736-tool inventory grouped by domain, generated from `src/server/registry/generated-tool-catalog.ts`.
- **[harness.ts](./harness.ts)** — case runner + scorecard renderer (per-case pass/fail/skip with references).
- **[suites/](./suites/)** — runnable suites (38 suites / 252 cases today, 243 passing + 9 env-gated/placeholder skips).
- **existing-tests-coverage** — converts the existing handler-test + e2e asset into a per-tool coverage matrix (649/736 unit, 153/736 e2e).
- **per-tool-scorecard** — per-tool NATIVE metrics (correctness / throughput / handler-fn / e2e-tasks / retrieval) for every one of the 736 tools; no composite score, no letter grades.

## Commands

```bash
pnpm bench:tools        # run all suites → artifacts/benchmarks/scorecard.{md,json}
pnpm bench:bootstrap    # ensure the 2 gitignored measurement files exist (honest placeholders, never fabricate numbers)
pnpm bench:coverage     # measure the unit layer: full vitest run + V8 fn-level coverage
pnpm bench:e2e          # measure the e2e layer: real-task runs → e2e-results.json
pnpm bench:e2e:local    # deterministic self-hosted e2e (fixture server + 3-round pass^k)

The per-tool scorecard reports NATIVE metrics in each metric's own unit — no composite
score, no letter grades:

| Column | Unit | Measurement |
|---|---|---|
| correctness | x/y vectors passed | vector-bench suites re-executed on every `pnpm bench:tools` |
| throughput | µs/call | measured wall time of those executions |
| handler-fn | % | V8 function-level coverage from a real `vitest --coverage` run |
| e2e-tasks | count | real-task e2e files (≥90% pass-rate) that exercise the tool |
| retrieval | MRR@10 / P@1 / … (%) | live evaluation over the 109-query search-quality set |

No layer falls back to a static guess: an unmeasured layer shows "—" / "not measured"
and the Missing column names exactly which command produces it.

The same suites run as a gate inside `pnpm test` (server project):
`tests/server/benchmarks/tools-benchmark.test.ts` — fails when a suite drops below its floor.

## Coverage is intentionally partial (read this before quoting numbers)

The scorecard is a renderer over external measurement artefacts, not a live
tracer. A tool gets a correctness/throughput number **iff** at least one bench
case names it. As of 2026-11-05: **171/736** tools have a correctness vector,
**162/736** have a measured latency, and **164/736** are fully measured. The
remaining tools are honestly `"—"` / `"not measured"` — never a static guess.

Low coverage is a conscious tradeoff, not an accident: ~11 domains need a live
browser / native FFI / device / root / GPU and cannot be measured offline
(a skipped case is NOT a measurement). `pnpm bench:bootstrap` creates honest
`measured:false` placeholder files on a fresh checkout so the gate can render
`"not measured"` instead of crashing; real runs overwrite them. To raise
coverage, add an offline-pure `suites/<domain>.suite.ts` (see CATALOG 📋 rows).

## Measured cold-call optimizations (2026-11-05 P2 wave)

The performance audit's genuine production wins were landed and A/B measured
with `pnpm bench:tools` (µs/call, same harness, before → after):

| Tool | Before | After | Fix |
|---|---:|---:|---|
| `crypto_test_harness` | 60.8ms | 2.8ms | eager QuickJS-WASM preload in the worker bootstrap + keep the warmed worker pooled (removed the per-call `drainIdle()` that destroyed the WASM cache) |
| `crypto_compare` | 70.1ms | 2.1ms | same |
| `platform_capabilities` | 118.6ms | 92µs | memoize `probeView8Availability` (2 Python spawns/call → 1/process) + overlap `probeAll`/view8 probes via `Promise.all` |
| `tasks_result` | 110.4ms | 69.0ms | poll interval 100→10ms (`handlers.ts` + `TaskStoreAdapter.ts`) |

The 92µs figure is steady-state (the scorecard re-executes suites in one
process); a **cold first call** is still ~80ms for crypto (inherent WASM compile)
and ~50ms for platform (inherent first `probeAll` subprocess batch). Repeated
calls drop to ~2.5ms. These are real wins, not measurement tricks.

**Deliberately not changed** (honest findings, not defects): `tasks_list` (~62ms)
is four harness-side `gap(6)` sleeps used for distinct timestamps; `net_raw_*_listen`
(~50-60ms) is a 50ms bind-wait sleep in `tls-inspector-full.suite.ts` — its production
handlers are already event-driven (~1ms real). `process_find` (~174ms) is a genuine
cold PowerShell spawn, but warming it is off-target (per-pattern cache key) and
breaks exact call-count tests; a proper fix is an all-processes snapshot refactor.
`wasm_offline_run` (~51ms) is dominated by the shared cold `probeAll` batch.

## CI integration (`.github/workflows/ci.yml`, `linux-full` job)

The scorecard's three non-vector layers come from separate commands. Under `CI=true`
the `per-tool/layers-actually-measured` gate does **not** skip — it runs inside the
`server` vitest project (`test:coverage` and `bench:tools` both execute it) and hard-fails
if any measurement file is missing. So CI produces them in this order:

| Step | Produces | Consumed as |
|---|---|---|
| `pnpm run bench:bootstrap` (fresh checkout) | honest `measured:false` placeholders, only when absent | keeps the gate renderable; real runs overwrite |
| `pnpm run bench:e2e:local` (starts fixture + 3-round pass^k) | `artifacts/benchmarks/e2e-results.json` | e2e-tasks column |
| standalone `retrieval-metrics.test.ts` | `artifacts/benchmarks/retrieval-metrics.json` | retrieval column |
| `pnpm run test:coverage` | `coverage/coverage-final.json` | handler-fn column |
| `pnpm run bench:tools` | `scorecard.{md,json}` + `per-tool-scorecard.{md,json}` | fully-measured report |

Order matters: e2e + retrieval must exist **before** `test:coverage`, because that run
contains the gate. `coverage-final.json` is the one exception — the gate exempts an
in-progress `COVERAGE_FULL=true` run, since that same run writes the file.

`bench:e2e:local` is served by a deterministic, dependency-free local fixture
(`scripts/serve-e2e-fixture.mjs`, `http://127.0.0.1:4173/`) instead of a public
site: it serves a real document on `/` plus a catch-all for any path (so
`<target>/level/3` resolves), sub-resources for network capture, HEAD/OPTIONS,
and the `.VPNav`/`.VPHero`/`.VPFeatures` + `#e2e_*` selectors the real-task e2e
files assert. The wrapper (`scripts/bench-e2e-local.mjs`) starts the server,
waits for readiness, runs `bench:e2e`, and always stops it — CI and local use
the same single entry point. No external network, no third-party deploy.
`PUPPETEER_HEADLESS=true` is set.

The step stays `continue-on-error` because headless Chromium is the one remaining
flaky dependency; `bench-e2e.mjs` always writes `e2e-results.json` (an empty
`measuredFiles: []` result when zero files pass all 3 rounds), so the measurement
is real even then — never a guessed value. The fully-measured scorecard + all
three raw measurements are uploaded as the `benchmark-scorecard` artifact.

## Adding a suite

1. Pick a domain row in CATALOG.md marked 📋.
2. Write `suites/<domain>.suite.ts` exporting a `BenchSuite`: each case names the MCP tool,
   its `origin` (`external-vector` = RFC/spec/official ground truth, `homemade` = our fixture),
   the `reference` source, a `run()` calling the real domain handler, and a `validate()`.
3. Register it in `suites/index.ts` and set a floor in the gate test.
