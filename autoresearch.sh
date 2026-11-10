#!/usr/bin/env bash
# LOCKED EVAL HARNESS — autoresearch loop. DO NOT EDIT during the loop.
#
# Usage: ./autoresearch.sh [SEED]
# The harness itself is deterministic (BM25 + pure-TS handlers, fixed fixtures);
# SEED is accepted for protocol compliance and recorded in the log only.
#
# Refresh order matters: the retrieval-metrics test rewrites the retrieval
# evidence artifacts (~2s), then bench:tools re-executes every vector suite
# and regenerates scorecard + per-tool scorecard (~12s). Metric extraction
# reads the artifacts afterwards.
set -euo pipefail
cd "$(dirname "$0")"

SEED="${1:-0}"
OUT="${AR_OUT:-/tmp/ar-bench-$$.txt}"
export AR_SEED="$SEED"

timeout 300 corepack pnpm exec vitest run --project server \
  tests/server/benchmarks/retrieval-metrics.test.ts >>"$OUT" 2>&1
timeout 300 corepack pnpm bench:tools >>"$OUT" 2>&1

node autoresearch-metric.mjs
