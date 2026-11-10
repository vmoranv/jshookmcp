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
