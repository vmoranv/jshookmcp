#!/usr/bin/env bash
# Correctness gate — runs AFTER a passing benchmark. Exit non-zero → checks_failed.
# Guards invariants the primary metric does not capture: tool-surface metadata
# must not drift (description edits require metadata:sync + openapi:generate),
# and lint must stay clean. Suite floors are separately enforced by
# `pnpm bench:tools` (exit 1 on breach → the experiment is a crash).
set -euo pipefail
cd "$(dirname "$0")"

corepack pnpm metadata:check --silent
corepack pnpm openapi:check --silent
corepack pnpm lint --silent
