#!/usr/bin/env node
/**
 * eval:trace — the MISSING THIRD HOP of the L0 pipeline.
 *
 *   pnpm eval:trace [--file <真实 trace 目录>]
 *
 * Production (ToolCallTraceRecorder) already flushes tool-call JSONL to
 * `.ccg/traces/` on closeServer(); `audit-tool-traces.mjs --json` already
 * computes the workspace-wide `combined` metrics. But `--json` only ever
 * printed to stdout and NOTHING wrote `artifacts/benchmarks/trace-audit.json`,
 * which is exactly what `generate-eval-cross-view.mjs` reads. This script
 * closes that gap: spawn the audit, validate, and persist with provenance.
 *
 * HONESTY:
 *  - `sourceKind` marks selftest fixture data as `fixture` (never `live`) so a
 *    reader cannot mistake `tool_alpha/tool_beta` for real agent traffic. The
 *    data is NOT silently dropped — hidden evidence is worse than labelled.
 *  - On any failure we do NOT write a half-product. Missing trace is "no
 *    evidence"; the downstream cross-view still degrades gracefully to "—".
 *  - `audit-tool-traces.mjs` default report semantics are NOT modified; this
 *    script only consumes `--json`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTraceDir } from './lib/trace-source.mjs';

const OUT = resolve(process.cwd(), 'artifacts/benchmarks');
const OUT_FILE = resolve(OUT, 'trace-audit.json');
const AUDIT_SCRIPT = resolve(process.cwd(), 'scripts/audit-tool-traces.mjs');

/** Fixture markers emitted by unit-test MCPServers (tests/server/MCPServer.test.ts). */
const FIXTURE_TOOLS = new Set(['tool_alpha', 'tool_beta']);

/**
 * Classify where the trace came from. Pure + exported for the selftest.
 *   fixture  -> selftest tools, or a lone anonymous 'default' session
 *   live     -> a concretely-named session with real tool names / domains
 *   unknown  -> no sessions (no evidence to classify)
 */
export function classifySource(audit) {
  const sessions = Array.isArray(audit?.sessions) ? audit.sessions : [];
  if (sessions.length === 0) return 'unknown';
  let looksFixture = false;
  for (const s of sessions) {
    const names = Array.isArray(s?.toolNames) ? s.toolNames : [];
    if (names.some((n) => FIXTURE_TOOLS.has(n))) looksFixture = true;
    if (s?.sessionId === 'default' && names.length <= 2) looksFixture = true;
  }
  return looksFixture ? 'fixture' : 'live';
}

/**
 * Build the persisted artifact. Validates the audit payload so a broken run
 * never yields a half-product. Pure + exported for the selftest.
 */
export function buildTraceArtifact(audit, sourceDir) {
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
    throw new Error('audit --json did not produce an object');
  }
  if (!audit.combined || typeof audit.combined !== 'object') {
    throw new Error('audit --json output has no `combined` object (no trace evidence)');
  }
  return {
    generatedAt: new Date().toISOString(),
    sourceDir,
    sourceKind: classifySource(audit),
    ...audit, // combined / sessions / findings / thresholds / files ...
  };
}

function runCli() {
  const args = process.argv.slice(2);
  let fileArg = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--file') fileArg = args[i + 1] ?? null;
    else if (args[i]?.startsWith('--file=')) fileArg = args[i].slice('--file='.length);
  }
  const sourceDir = fileArg
    ? resolve(fileArg)
    : (resolveTraceDir() ?? resolve(process.cwd(), '.ccg/traces'));

  if (!existsSync(AUDIT_SCRIPT)) {
    console.error(`[eval:trace] audit script missing: ${AUDIT_SCRIPT}`);
    process.exit(1);
  }
  const res = spawnSync(process.execPath, [AUDIT_SCRIPT, '--json', '--file', sourceDir], {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  if (res.status !== 0 || res.error) {
    console.error(`[eval:trace] audit failed: ${res.error?.message ?? res.stderr?.slice(0, 400)}`);
    process.exit(1);
  }
  let audit;
  try {
    audit = JSON.parse(res.stdout);
  } catch (err) {
    console.error(`[eval:trace] audit --json was not valid JSON: ${err.message}`);
    process.exit(1);
  }
  let artifact;
  try {
    artifact = buildTraceArtifact(audit, sourceDir);
  } catch (err) {
    console.error(`[eval:trace] refusing to write a half-product: ${err.message}`);
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(OUT_FILE, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `[eval:trace] wrote ${OUT_FILE} (sourceDir=${sourceDir}, sourceKind=${artifact.sourceKind}, calls=${artifact.combined.calls ?? 'n/a'})`,
  );
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) runCli();
