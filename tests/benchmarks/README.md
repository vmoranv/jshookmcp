# Tool Benchmarks

Quantifiable benchmark evaluation for the 739 MCP tools (36 domains).

- **[CATALOG.md](./CATALOG.md)** — every domain → external benchmark (RFC/spec/official vectors) or homemade suite, with integration status.
- **[existing-tests-coverage.suite.ts](./existing-tests-coverage.suite.ts)** — the audit/test-asset benchmark layer (breadth).
- **[tool-inventory.md](./tool-inventory.md)** — the full 739-tool inventory grouped by domain, generated from `src/server/registry/generated-tool-catalog.ts`.
- **[harness.ts](./harness.ts)** — case runner + scorecard renderer (per-case pass/fail/skip with references).
- **[suites/](./suites/)** — runnable suites; live case/pass/skip counts are in `artifacts/benchmarks/scorecard.json` (`generatedAt`), never hand-copied here.
- **existing-tests-coverage** — converts the existing handler-test + e2e asset into a per-tool breadth matrix; live counts are in `artifacts/benchmarks/existing-test-coverage.json`.
- **per-tool-scorecard** — per-tool NATIVE metrics for every one of the 739 tools; no composite score, no letter grades. A-phase splits correctness into `semantic` / `contract` / `adv` columns plus `holdout-MRR` (E-phase); `correctness` remains a backward-compat JSON field only.

## Commands

```bash
pnpm bench:tools        # run all suites → artifacts/benchmarks/scorecard.{md,json}
pnpm bench:bootstrap    # ensure the 2 gitignored measurement files exist (honest placeholders, never fabricate numbers)
pnpm bench:coverage     # measure the unit layer: full vitest run + V8 fn-level coverage
pnpm bench:e2e          # measure the e2e layer: real-task runs → e2e-results.json
pnpm bench:e2e:local    # deterministic self-hosted e2e (fixture server + 3-round pass^k)
pnpm eval:trace         # L0 third hop: audit-tool-traces --json → artifacts/benchmarks/trace-audit.json
pnpm eval:cross-view    # L0 × L2 cross-view (report-only; trace 缺席时优雅降级为 "—")
pnpm trace:calibrate    # 观察值 vs 阈值(只读,不 gate,不回填)

The per-tool scorecard reports NATIVE metrics in each metric's own unit — no composite
score, no letter grades:

| Column | Unit | Measurement |
|---|---|---|
| semantic | x/y cases passed | real semantic vectors (RFC/spec computation), aggregated from the same gate run (`pnpm bench:tools`); no suite re-execution |
| contract | x/y cases passed | admission/refusal/argument-validation cases (e.g. no-browser PREREQUISITE) — measured, but NOT semantic proof |
| adv | x/y cases passed | adversarial/negative inputs; reported separately by the layered gate |
| holdout-MRR | % | E-phase blind-paraphrase generalization (`artifacts/benchmarks/registry-holdout-per-tool.json`) |
| throughput | µs/call | measured wall time of those executions |
| handler-fn | % | V8 function-level coverage from a real `vitest --coverage` run |
| e2e-tasks | count | real-task e2e files (≥90% pass-rate) that exercise the tool |
| retrieval | MRR@10 / P@1 / … (%) | live evaluation over the search-quality set |

No layer falls back to a static guess: an unmeasured layer shows "—" / "not measured"
and the Missing column names exactly which command produces it.

The same suites run as a gate inside `pnpm test` (server project):
`tests/server/benchmarks/tools-benchmark.test.ts` — fails when a suite drops below its floor.

## Coverage is intentionally partial (read this before quoting numbers)

The scorecard is a renderer over external measurement artefacts, not a live
tracer. A tool gets a correctness/throughput number **iff** at least one bench
case names it. The A-phase (2026-11-15) split `correctness` into semantic /
contract / adversarial buckets and redefined `debt` to penalize ONLY missing
semantic coverage — so "99.3% measured" is no longer a quality conclusion.
For CURRENT numbers read `artifacts/benchmarks/per-tool-scorecard.json`
(`stats.semanticCovered`, `stats.contractOnly`, `generatedAt`); the historical
2026-11-05 snapshot (171/736 correctness, 162/736 latency, 164/736 fully
measured) is a campaign artifact, NOT the current state. The remaining tools
are honestly `"—"` / `"not measured"` — never a static guess.

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
| `process_find` | 186.4ms | 189µs | single shared all-processes PowerShell snapshot (one `Get-Process` per TTL) + JS-side case-insensitive name filter, instead of one `Get-Process -Name "*pattern*"` spawn per distinct pattern |

The 92µs / 189µs figures are steady-state (the gate runs every suite once, in one
process); a **cold first call** is still ~80ms for crypto (inherent WASM compile),
~50ms for platform (inherent first `probeAll` subprocess batch), and one cold
PowerShell spawn for `process_find`. Repeated calls — including **different**
patterns for `process_find` — hit the shared snapshot and drop to ~µs. A focused
test proves 5 distinct `findProcesses` patterns cause exactly 1 spawn (was 5).
These are real wins, not measurement tricks.

**Deliberately not changed** (honest findings, not defects): `tasks_list` (~62ms)
is four harness-side `gap(6)` sleeps used for distinct timestamps; `net_raw_*_listen`
(~50-60ms) is a 50ms bind-wait sleep in `tls-inspector-full.suite.ts` — its production
handlers are already event-driven (~1ms real). `process_find` was the last real
cold-spawn win and is now fixed by the shared-snapshot refactor above (removed
the dead per-pattern `lastDelta`/`computeProcessDiff` machinery along the way).
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
(`scripts/bench/serve-e2e-fixture.mjs`, `http://127.0.0.1:4173/`) instead of a public
site: it serves a real document on `/` plus a catch-all for any path (so
`<target>/level/3` resolves), sub-resources for network capture, HEAD/OPTIONS,
and the `.VPNav`/`.VPHero`/`.VPFeatures` + `#e2e_*` selectors the real-task e2e
files assert. The wrapper (`scripts/bench/e2e-local.mjs`) starts the server,
waits for readiness, runs `bench:e2e`, and always stops it — CI and local use
the same single entry point. No external network, no third-party deploy.
`PUPPETEER_HEADLESS=true` is set.

The step stays `continue-on-error` because headless Chromium is the one remaining
flaky dependency; `bench-e2e.mjs` always writes `e2e-results.json` (an empty
`measuredFiles: []` result when zero files pass all 3 rounds), so the measurement
is real even then — never a guessed value. The fully-measured scorecard + all
three raw measurements are uploaded as the `benchmark-scorecard` artifact.

## L0 trace pipeline (C 段续接, change `eval-trace-capture`)

The cross-view joins **L2** (per-tool capability, above) with **L0** (runtime
tool-call traffic). Production already records every call via
`ToolCallTraceRecorder` → `closeServer()` flush → `<MCP_TRACE_DIR>/*.jsonl`;
`audit-tool-traces.mjs --json` computes workspace-wide `combined` metrics.
The missing third hop is now wired:

```bash
pnpm eval:trace --file <真实 trace 目录>   # --json -> trace-audit.json (+ sourceKind/sourceDir)
pnpm eval:cross-view                        # cross-view.{md,json}, traceAvailable=true
pnpm trace:calibrate                        # 观察值 vs 阈值(只读)
```

- **When L0 should show `—`**: no trace was collected (fresh checkout, or
  `MCP_TRACE_DISABLE=1` in unit tests). "No trace" is *no evidence*, never bad
  evidence — the cross-view still renders L2 and stays report-only.
- **Provenance is mandatory**: `sourceKind` is `live` / `fixture` / `unknown`.
  Selftest data (`tool_alpha`/`tool_beta` from `MCPServer.test.ts`) is labelled
  `fixture` and the report says **NOT real agent traffic, do not use for
  calibration**. It is shown, never silently dropped.
- **No gate, no fabrication**: L0 is workspace-wide `combined` only — there are
  NO per-tool trace columns (that would be a proxy dressed as a measurement).
  `--fail-on-severity` remains opt-in; `trace:calibrate` never writes thresholds.
- **Isolation**: `MCP_TRACE_DIR` (default `.ccg/traces`) + `MCP_TRACE_DISABLE`
  keep unit-test traces out of a real agent's directory. Full workflow:
  [`docs/operations/trace-capture-and-calibration.md`](../../docs/operations/trace-capture-and-calibration.md).

## Adding a suite

1. Pick a domain row in CATALOG.md marked 📋.
2. Write `suites/<domain>.suite.ts` exporting a `BenchSuite`: each case names the MCP tool,
   its `origin` (`external-vector` = RFC/spec/official ground truth, `homemade` = our fixture),
   the `reference` source, a `run()` calling the real domain handler, and a `validate()`.
3. Register it in `suites/index.ts` and set a floor in the gate test.
