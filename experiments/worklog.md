# Worklog — per-tool quality debt

## Session setup (2026-11-10)

- Goal: close measurable per-tool quality gaps scored by `pnpm bench:tools` +
  retrieval-metrics eval.
- Baseline audit: 565/736 tools unmeasured, 51/114 low-MRR (<0.6, 5 at 0.0),
  gate vector_fail = 0, per_tool_shortfall = 12 (9 env-gated skips + 3 partial
  re-execution failures).
- Harness: `./autoresearch.sh` = retrieval test (~2s) + bench:tools (~12s) +
  metric extraction. Primary `debt = unmeasured + low_mrr + vector_fail`.
- Branch: `autoresearch/per-tool-quality-20261110`.

### Run 1: baseline — debt=616 (KEEP)
- Timestamp: 2026-11-10
- What changed: nothing (reference measurement, seed 42; seeds 1-3 identical → noise floor 0)
- Result: debt=616 = unmeasured 565 + low_mrr 51 + vector_fail 0; secondaries logged
- Insight: slowest_ms jittered 5847→68.3 across runs (process_find cold PowerShell spawn) — throughput stays secondary-only; correctness/coverage/MRR components fully deterministic
- Next: draft experiments across 3 axes — (a) zero-MRR tool descriptions, (b) offline-pure coverage suite for an offline-capable domain, (c) per_tool_shortfall partials investigation
