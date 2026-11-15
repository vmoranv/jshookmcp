#!/usr/bin/env node
/**
 * C-phase CLI: generate the L0 × L2 cross-view (report-only).
 *
 *   pnpm eval:cross-view
 *
 * Reads:
 *   artifacts/benchmarks/per-tool-scorecard.json   (L2, required)
 *   artifacts/benchmarks/trace-audit.json          (L0, OPTIONAL — produced by
 *     `node scripts/audit-tool-traces.mjs --json > …/trace-audit.json`)
 * Writes:
 *   artifacts/benchmarks/cross-view.{md,json}
 *
 * This script does NOT import or modify audit-tool-traces.mjs or the per-tool
 * scorecard runtime. A missing L0 file renders "—" (no evidence), never fails.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderCrossView } from './lib/eval-cross-view.mjs';

const OUT = resolve(process.cwd(), 'artifacts/benchmarks');
const L2_FILE = resolve(OUT, 'per-tool-scorecard.json');
const L0_FILE = resolve(OUT, 'trace-audit.json');

if (!existsSync(L2_FILE)) {
  console.error(`[eval:cross-view] L2 artifact missing: ${L2_FILE} (run pnpm bench:tools)`);
  process.exit(1);
}

let l2;
try {
  l2 = JSON.parse(readFileSync(L2_FILE, 'utf8'));
} catch (err) {
  console.error(`[eval:cross-view] cannot parse L2 artifact: ${err.message ?? err}`);
  process.exit(1);
}

let l0Combined = null;
let l0Meta = {};
if (existsSync(L0_FILE)) {
  try {
    const parsed = JSON.parse(readFileSync(L0_FILE, 'utf8'));
    // audit-tool-traces.mjs --json emits { combined, findings, ... };
    // eval:trace adds generatedAt/sourceDir/sourceKind provenance on top.
    l0Combined = parsed.combined ?? parsed;
    l0Meta = {
      sourceKind: parsed.sourceKind ?? 'unknown',
      sourceDir: parsed.sourceDir ?? null,
    };
  } catch {
    // A malformed trace is "no evidence", not a crash. Stay report-only.
    l0Combined = null;
    l0Meta = {};
  }
}

const { md, json } = renderCrossView(l2, l0Combined, l0Meta);
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'cross-view.md'), `${md}\n`);
writeFileSync(resolve(OUT, 'cross-view.json'), `${JSON.stringify(json, null, 2)}\n`);
console.log(
  `[eval:cross-view] wrote cross-view.{md,json} (trace=${json.traceAvailable ? 'present' : 'absent'}, signals=${json.signals.length})`,
);
