# Tool Benchmarks

Quantifiable benchmark evaluation for the 736 MCP tools (36 domains).

- **[CATALOG.md](./CATALOG.md)** — every domain → external benchmark (RFC/spec/official vectors) or homemade suite, with integration status.
- **[existing-tests-coverage.suite.ts](./existing-tests-coverage.suite.ts)** — the audit/test-asset benchmark layer (breadth).
- **[tool-inventory.md](./tool-inventory.md)** — the full 736-tool inventory grouped by domain, generated from `src/server/registry/generated-tool-catalog.ts`.
- **[harness.ts](./harness.ts)** — case runner + scorecard renderer (per-case pass/fail/skip with references).
- **[suites/](./suites/)** — runnable suites (19 suites / 110 cases today, 109 passing + 1 env-gated skip).
- **existing-tests-coverage** — converts the existing handler-test + e2e asset into a per-tool coverage matrix (649/736 unit, 153/736 e2e).
- **per-tool-scorecard** — per-tool NATIVE metrics (correctness / throughput / handler-fn / e2e-tasks / retrieval) for every one of the 736 tools; no composite score, no letter grades.

## Commands

```bash
pnpm bench:tools        # run all suites → artifacts/benchmarks/scorecard.{md,json}
pnpm bench:coverage     # measure the unit layer: full vitest run + V8 fn-level coverage
pnpm bench:e2e          # measure the e2e layer: real-task runs → e2e-results.json
```

The per-tool scorecard reports NATIVE metrics in each metric's own unit — no composite
score, no letter grades:

| Column | Unit | Measurement |
|---|---|---|
| correctness | x/y vectors passed | vector-bench suites re-executed on every `pnpm bench:tools` |
| throughput | µs/call | measured wall time of those executions |
| handler-fn | % | V8 function-level coverage from a real `vitest --coverage` run |
| e2e-tasks | count | real-task e2e files (≥90% pass-rate) that exercise the tool |
| retrieval | MRR@10 / P@1 / … (%) | live evaluation over the 102-query search-quality set |

No layer falls back to a static guess: an unmeasured layer shows "—" / "not measured"
and the Missing column names exactly which command produces it.

The same suites run as a gate inside `pnpm test` (server project):
`tests/server/benchmarks/tools-benchmark.test.ts` — fails when a suite drops below its floor.

## Adding a suite

1. Pick a domain row in CATALOG.md marked 📋.
2. Write `suites/<domain>.suite.ts` exporting a `BenchSuite`: each case names the MCP tool,
   its `origin` (`external-vector` = RFC/spec/official ground truth, `homemade` = our fixture),
   the `reference` source, a `run()` calling the real domain handler, and a `validate()`.
3. Register it in `suites/index.ts` and set a floor in the gate test.
