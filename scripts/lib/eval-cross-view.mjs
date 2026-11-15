/**
 * C-phase: L0 (runtime trace) × L2 (per-tool capability) cross-view renderer.
 *
 * DESIGN HONESTY (do not "improve" without re-reading audit-tool-traces.mjs:4-53):
 *  - The trace audit produces WORKSPACE-WIDE `combined` metrics, NOT per-tool
 *    numbers. We therefore show L0 as workspace-level context and L2 as
 *    per-tool rows; inventing a per-tool `orphan_failure` column would be a
 *    measurement fabricated from a proxy — exactly what L0's author forbids.
 *  - Every output is REPORT-ONLY: no gate, no debt mutation, no verdict.
 *  - "No trace" is "no evidence", never "bad evidence".
 *  - No composite score, no letter grade.
 *
 * Helpers are kept at module scope so `renderCrossView` stays under the
 * configured cyclomatic ceiling (fallow health maxCyclomatic: 40).
 */

const MISSING = '—';

function provenanceLines(traceAvailable, sourceKind, sourceDir) {
  if (!traceAvailable) return [];
  const lines = [`Trace source: \`${sourceKind}\`${sourceDir ? ` from \`${sourceDir}\`` : ''}.`];
  if (sourceKind === 'fixture') {
    lines.push(
      '**FIXTURE / selftest data — NOT real agent traffic. Do NOT use for threshold calibration.**',
    );
  }
  return lines;
}

function l0Context(traceAvailable, c) {
  if (!traceAvailable) return null;
  return {
    repeatedToolCallRate: c.repeatedToolCallRate,
    orphanFailureCount: c.orphanFailureCount,
    p99CallDurationMs: c.p99CallDurationMs,
    toolDiversity: c.toolDiversity,
  };
}

function buildSignals(traceAvailable, rep, orphan, stats) {
  const signals = [];
  if (traceAvailable && (orphan ?? 0) > 0 && (stats.semanticCovered ?? 0) < (stats.total ?? 0)) {
    const gap = (stats.total ?? 0) - (stats.semanticCovered ?? 0);
    signals.push(
      `Workspace has ${orphan} orphan failure(s) while ${gap} tools lack a semantic vector — consider a spike: add a semantic case for a tool whose real-traffic failure was never revisited.`,
    );
  }
  if (traceAvailable && (rep ?? 0) > 0.4) {
    signals.push(
      `repeated_tool_call_rate=${rep} is high (shape only; polling may be legitimate) — investigate before drawing conclusions.`,
    );
  }
  if (!traceAvailable) {
    signals.push(
      'No L0 trace available — collect one via audit-tool-traces.mjs before interpreting efficiency.',
    );
  }
  return signals;
}

function l0Row(rep, orphan, p99, diversity) {
  return `| ${rep ?? MISSING} | ${orphan ?? MISSING} | ${p99 ?? MISSING} | ${diversity ?? MISSING} |`;
}

function perToolRows(tools) {
  return tools.map(
    (t) =>
      `| ${t.tool} | ${t.domain} | ${t.semantic ?? MISSING} | ${t.contract ?? MISSING} | ${t.holdoutMrr ?? MISSING} |`,
  );
}

export function renderCrossView(l2, l0Combined, meta = {}) {
  const traceAvailable = Boolean(l0Combined && typeof l0Combined === 'object');
  const stats = l2?.stats ?? {};
  const tools = l2?.tools ?? [];
  const rep = traceAvailable ? l0Combined.repeatedToolCallRate : null;
  const orphan = traceAvailable ? l0Combined.orphanFailureCount : null;
  const p99 = traceAvailable ? l0Combined.p99CallDurationMs : null;
  const diversity = traceAvailable ? l0Combined.toolDiversity : null;
  const sourceKind = meta?.sourceKind ?? (traceAvailable ? 'unknown' : null);
  const sourceDir = meta?.sourceDir ?? null;
  const l0 = l0Context(traceAvailable, l0Combined ?? {});
  const signals = buildSignals(traceAvailable, rep, orphan, stats);

  const lines = [
    '# Cross-View — L2 capability × L0 traffic (TRACE-DERIVED, NOT A CORRECTNESS MEASUREMENT)',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Thresholds are uncalibrated on real traffic. Report-only; does not gate any build or mutate debt.',
    'No trace present ⇒ L0 cells are "—" (no evidence ≠ bad evidence).',
    ...provenanceLines(traceAvailable, sourceKind, sourceDir),
    '',
    '## L0 workspace context (from audit-tool-traces.mjs --json, combined)',
    '',
    '| repeated_tool_call_rate | orphan_failure_count | p99_call_duration_ms | tool_diversity |',
    '|---|---|---|---|',
    l0Row(rep, orphan, p99, diversity),
    '',
    '## L2 per-tool capability (native units, no composite score)',
    '',
    `Semantic covered: ${stats.semanticCovered ?? MISSING} · contract-only: ${stats.contractOnly ?? MISSING} · total tools: ${stats.total ?? MISSING}`,
    '',
    '| Tool | Domain | semantic | contract | holdout-MRR |',
    '|---|---|---|---|---|',
    ...perToolRows(tools),
    '',
    '## Signals (spike suggestions, NOT verdicts)',
    '',
    ...signals.map((s) => `- ${s}`),
    '',
  ];

  return {
    md: lines.join('\n'),
    json: {
      generatedAt: new Date().toISOString(),
      traceAvailable,
      sourceKind: traceAvailable ? sourceKind : null,
      sourceDir: traceAvailable ? sourceDir : null,
      l0,
      l2Stats: stats,
      signals,
      debtDelta: 0, // cross-view NEVER mutates debt
    },
  };
}
