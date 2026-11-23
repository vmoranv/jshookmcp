#!/usr/bin/env node
/**
 * distill-workflows.mjs — P4 (WikiSkill-inspired) experience distillation.
 *
 * Reads tool-call traces (P2's .ccg/traces/*.jsonl, produced by
 * ToolCallTraceRecorder and flushed on server shutdown) and distills the
 * *successful* call sequences into reusable workflow drafts.
 *
 * Why this exists (WikiSkill, arXiv:2608.27454): agents accumulate raw
 * execution experience that is normally never replayed. WikiSkill's key
 * finding is that the knowledge base should live in the *development
 * pipeline*, not in the executing agent's context — feeding the wiki to the
 * executing agent actually HURT performance (-2.8 points). Translating that
 * to jshookmcp: traces are evidence, not runtime hints. The distilled
 * workflows are written to `.ccg/proposed-workflows/` as drafts — gitignored,
 * never auto-activated. A human reviews them, and only then do they become
 * real extension workflows (which must pass metadata:sync + openapi:generate,
 * because the tool-count gate is load-bearing).
 *
 * Output contract (each line a JSON object; drafts as YAML-ish text files):
 *   { kind: 'pattern', workflowId, displayName, toolSequence, frequency, sessions, confidence }
 *
 * Usage:
 *   node scripts/dev/distill-workflows.mjs [--traces .ccg/traces] [--out .ccg/proposed-workflows]
 *   node scripts/dev/distill-workflows.mjs --dry-run   (print patterns without writing)
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const DEFAULT_TRACES_DIR = '.ccg/traces';
const DEFAULT_OUT_DIR = '.ccg/proposed-workflows';
// A sequence must appear in at least this many sessions to be distillable.
const MIN_SESSIONS = 2;
// Max length of a distilled sequence (long sequences are analysis sessions,
// not reusable recipes).
const MAX_SEQUENCE_LEN = 6;
// Minimum share of successful sessions for a sequence to be a "pattern".
const MIN_SUCCESS_RATE = 0.6;

function parseArgs(argv) {
  const args = { tracesDir: DEFAULT_TRACES_DIR, outDir: DEFAULT_OUT_DIR, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--traces') args.tracesDir = argv[++i] ?? args.tracesDir;
    else if (a.startsWith('--traces=')) args.tracesDir = a.slice('--traces='.length);
    else if (a === '--out') args.outDir = argv[++i] ?? args.outDir;
    else if (a.startsWith('--out=')) args.outDir = a.slice('--out='.length);
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

/** Collect *.jsonl trace files under a directory (non-recursive — traces are flat). */
async function collectTraceFiles(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith('.jsonl')).map((n) => join(dir, n));
}

/**
 * Load all sessions from trace files. A file holds one session (recorder
 * emits per-session files), but be defensive: entries carry sessionId.
 */
async function loadSessions(files) {
  const sessionsByFile = new Map();
  for (const file of files) {
    const raw = await readFile(file, 'utf-8');
    const entries = [];
    let malformed = 0;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed.toolName === 'string') entries.push(parsed);
      } catch {
        malformed++;
      }
    }
    if (malformed > 0) {
      process.stderr.write(`[distill] ${basename(file)}: skipped ${malformed} malformed line(s)\n`);
    }
    if (entries.length > 0)
      sessionsByFile.set(file, {
        sessionId: entries[0].sessionId ?? basename(file, '.jsonl'),
        entries,
      });
  }
  return [...sessionsByFile.values()];
}

/**
 * Extract successful tool sequences per session.
 *
 * A sequence is a maximal run of `ok: true` calls with no repeated tool in a
 * row (a repeated call is a retry, and retries are noise for pattern mining).
 * Sequences are truncated to MAX_SEQUENCE_LEN and stripped of meta-tools.
 */
function extractSuccessSequences(session) {
  const META_PREFIXES = ['search_', 'activate_', 'list_', 'describe_', 'instrumentation_'];
  const isMeta = (name) => META_PREFIXES.some((p) => name.startsWith(p));
  const sequences = [];
  let current = [];
  for (const entry of session.entries) {
    if (entry.ok === true && !isMeta(entry.toolName)) {
      if (current.length === 0 || current[current.length - 1] !== entry.toolName) {
        current.push(entry.toolName);
      }
    } else {
      if (current.length >= 2 && current.length <= MAX_SEQUENCE_LEN) {
        sequences.push([...current]);
      }
      current = [];
    }
  }
  if (current.length >= 2 && current.length <= MAX_SEQUENCE_LEN) {
    sequences.push([...current]);
  }
  return sequences;
}

/** Mine frequent successful sequences across sessions (Apriori-lite on ordered sequences). */
function minePatterns(allSessions) {
  const freq = new Map(); // key -> { count, sessions:Set }
  for (const session of allSessions) {
    const seen = new Set();
    for (const seq of extractSuccessSequences(session)) {
      const key = seq.join(' → ');
      if (seen.has(key)) continue; // same session, same sequence once
      seen.add(key);
      const entry = freq.get(key) ?? { count: 0, sessions: new Set() };
      entry.count++;
      entry.sessions.add(session.sessionId);
      freq.set(key, entry);
    }
  }
  return [...freq.entries()]
    .map(([key, entry]) => ({
      sequence: key,
      toolSequence: key.split(' → '),
      sessions: [...entry.sessions],
      sessionCount: entry.sessions.size,
      frequency: entry.count,
    }))
    .filter((p) => p.sessionCount >= MIN_SESSIONS)
    .toSorted((a, b) => b.sessionCount - a.sessionCount || b.frequency - a.frequency);
}

/** Compute overall success rate per session set (for confidence). */
function sessionSuccessRate(sessions, patternSessions) {
  const target = sessions.filter((s) => patternSessions.includes(s.sessionId));
  if (target.length === 0) return 0;
  const ok = target.filter((s) => s.entries.filter((e) => e.ok === true).length > 0).length;
  return ok / target.length;
}

function toWorkflowDraft(pattern) {
  const id = pattern.toolSequence.join('_').toLowerCase().slice(0, 60);
  const steps = pattern.toolSequence.map((tool) => `    - tool: ${tool}\n      args: {}`);
  return [
    `# Proposed workflow draft (distilled from traces — HUMAN REVIEW REQUIRED)`,
    `# Source: ${pattern.sessions.length} session(s), frequency ${pattern.frequency}`,
    `id: ${id}`,
    `displayName: Distilled: ${pattern.toolSequence.join(' → ')}`,
    `tags: [distilled, harness]`,
    `steps:`,
    steps.join('\n'),
    '',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = await collectTraceFiles(args.tracesDir);
  if (files.length === 0) {
    console.log(
      `[distill] no trace files in ${args.tracesDir} (server has not flushed traces yet)`,
    );
    return;
  }
  const sessions = await loadSessions(files);
  const patterns = minePatterns(sessions);
  console.log(
    `[distill] ${files.length} file(s), ${sessions.length} session(s), ${patterns.length} pattern(s)`,
  );

  if (args.dryRun || patterns.length === 0) {
    for (const p of patterns) {
      console.log(`  ${p.sequence} (${p.sessionCount} sessions, freq ${p.frequency})`);
    }
    return;
  }

  await mkdir(args.outDir, { recursive: true });
  let written = 0;
  for (const pattern of patterns) {
    const confidence = sessionSuccessRate(sessions, pattern.sessions);
    if (confidence < MIN_SUCCESS_RATE) continue;
    const fileName = `${pattern.toolSequence.join('_').toLowerCase().slice(0, 60)}.yaml`;
    const draft = toWorkflowDraft(pattern);
    await writeFile(join(args.outDir, fileName), draft, 'utf-8');
    written++;
    console.log(
      `  wrote ${fileName} (${pattern.sessionCount} sessions, success ${(confidence * 100).toFixed(0)}%)`,
    );
  }
  console.log(
    `[distill] ${written} draft(s) written to ${args.outDir} (gitignored, human review required)`,
  );
}

main().catch((err) => {
  console.error('[distill] failed:', err);
  process.exit(1);
});
