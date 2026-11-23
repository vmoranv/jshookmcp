#!/usr/bin/env node
/**
 * trace:calibrate — REPORT-ONLY threshold-calibration helper.
 *
 *   pnpm trace:calibrate
 *
 * Reads artifacts/benchmarks/trace-audit.json (produced by `pnpm eval:trace`)
 * and prints, side by side: observed value | current DEFAULT_THRESHOLDS | delta.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO (see audit-tool-traces.mjs:45-53):
 *   - it does NOT write thresholds back; the numbers in DEFAULT_THRESHOLDS are
 *     guesses until a HUMAN looks at real traffic and decides. Auto-tuning them
 *     from the current trace would make the gate a self-fulfilling prophecy.
 *   - it does NOT gate: exit code is ALWAYS 0, even when an observation exceeds
 *     a threshold. `--fail-on-severity` remains an explicit opt-in on the audit.
 *   - it does NOT treat fixture/selftest traces as calibration evidence.
 *
 * The snapshot below is a READ-ONLY mirror of the literal in
 * scripts/audit/tool-traces.mjs (DEFAULT_THRESHOLDS). If that literal changes,
 * update this snapshot in the SAME auditable commit — it is intentionally NOT
 * auto-parsed so the human decision stays visible.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TRACE_AUDIT = resolve(process.cwd(), 'artifacts/benchmarks/trace-audit.json');

/** Read-only mirror of audit-tool-traces.mjs DEFAULT_THRESHOLDS (keep in sync). */
export const DEFAULT_THRESHOLDS_SNAPSHOT = Object.freeze({
  repeated_tool_call_rate: 0.4,
  orphan_failure_count: 10,
  tool_diversity: 0.15,
  p99_call_duration_ms: 30_000,
});

/** combined uses camelCase; DEFAULT_THRESHOLDS uses snake_case. */
const OBSERVED_KEY = {
  repeated_tool_call_rate: 'repeatedToolCallRate',
  orphan_failure_count: 'orphanFailureCount',
  tool_diversity: 'toolDiversity',
  p99_call_duration_ms: 'p99CallDurationMs',
};

export const CALIBRATION_DISCLAIMER =
  'OBSERVATIONS ONLY — these are NOT compliance limits. A HUMAN must judge and edit ' +
  'DEFAULT_THRESHOLDS in scripts/audit/tool-traces.mjs before --fail-on-severity is considered.';

/** Report header: always carries the disclaimer; fixture data gets an extra warning. */
export function calibrationHeader(sourceKind = 'unknown') {
  const lines = ['# Trace threshold calibration (report-only)', '', CALIBRATION_DISCLAIMER];
  if (sourceKind === 'fixture') {
    lines.push(
      '',
      '**sourceKind=fixture — selftest data. NOT real agent traffic. Do NOT use these observations to calibrate thresholds.**',
    );
  } else if (sourceKind !== 'live') {
    lines.push(
      '',
      `sourceKind=${sourceKind} — provenance unknown; treat observations as provisional.`,
    );
  } else {
    lines.push(
      '',
      'sourceKind=live — real agent traffic. Observations are still only inputs to a HUMAN decision.',
    );
  }
  return lines.join('\n');
}

/** Pure: build observation rows. Never mutates inputs or thresholds. */
export function buildCalibrationRows(combined) {
  const c = combined ?? {};
  return Object.entries(DEFAULT_THRESHOLDS_SNAPSHOT).map(([metric, threshold]) => {
    const key = OBSERVED_KEY[metric] ?? metric;
    const observed = typeof c[key] === 'number' ? c[key] : null;
    return { metric, observed, threshold, delta: observed === null ? null : observed - threshold };
  });
}

function runCli() {
  if (!existsSync(TRACE_AUDIT)) {
    console.log(calibrationHeader('unknown'));
    console.log(
      '',
      'No trace-audit.json found. Run `pnpm eval:trace --file <real-dir>` first.',
      '',
      CALIBRATION_DISCLAIMER,
    );
    return;
  }
  let art;
  try {
    art = JSON.parse(readFileSync(TRACE_AUDIT, 'utf8'));
  } catch (err) {
    console.log(calibrationHeader('unknown'));
    console.log(
      '',
      `trace-audit.json is not valid JSON: ${err.message}`,
      '',
      CALIBRATION_DISCLAIMER,
    );
    return;
  }
  const sourceKind = art.sourceKind ?? 'unknown';
  const rows = buildCalibrationRows(art.combined);
  console.log(calibrationHeader(sourceKind));
  console.log('', `Source: ${art.sourceDir ?? 'n/a'} (${sourceKind})`, '');
  console.log('| metric | observed | current threshold | delta |');
  console.log('|---|---:|---:|---:|');
  for (const r of rows) {
    console.log(`| ${r.metric} | ${r.observed ?? '—'} | ${r.threshold} | ${r.delta ?? '—'} |`);
  }
  console.log('', CALIBRATION_DISCLAIMER);
  // Exit code stays 0. This script NEVER gates and NEVER writes thresholds.
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) runCli();
