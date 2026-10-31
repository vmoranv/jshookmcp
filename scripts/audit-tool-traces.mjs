#!/usr/bin/env node
// Tool-call trace audit.
//
// WHY THIS EXISTS
// ---------------
// `ToolCallTraceRecorder` (src/server/observability/ToolCallTraceRecorder.ts)
// emits a JSONL trace of the action layer: tool name, domain, timing, outcome,
// payload sizes, and repetition. This script turns that trace into the rule
// metrics A²E (arXiv:2608.07346) calls `tool` / `plan` / `efficiency`.
//
// WHAT IS DELIBERATELY NOT HERE
// -----------------------------
// A²E also scores `correct`, `safety`, and reasoning/plan quality. Those are
// LLM-as-judge dimensions computed over the agent's chain of thought. A TOOL
// SERVER does not have the chain of thought — it sees requests and responses,
// never the reasoning that chose them. Scoring them here would mean emitting a
// number produced by inference from a proxy, labelled as if it were a
// measurement. This script therefore computes ONLY metrics that are decidable
// from the recorded fields, and each one's definition is stated in the report so
// a reader can disagree with the definition rather than with a black box.
//
// WHAT THE METRICS CAN AND CANNOT SAY
// -----------------------------------
//   repeated_tool_call_rate  shape only — high means the agent retried a tool
//                            back-to-back. It does NOT say the retries were
//                            wasteful: polling a page is legitimately repeated.
//   tool_diversity           distinct tools / calls. Low means a narrow grind,
//                            which is a symptom, not a verdict.
//   plan_depth               domain-switch phases. An APPROXIMATION: a real plan
//                            has intent, and intent is not in the trace. Two
//                            agents with the same phase count can have wildly
//                            different plans.
//   failure_transparency     whether a failure was followed by a DIFFERENT call
//                            (same tool + different args also counts as
//                            different, because changing the argument is the
//                            documented remedy the gate suggests). A tool-only
//                            comparison would call an argument change a
//                            non-response.
//   orphan_failure_count     failures with no later call to the same domain.
//                            The A²E "verification gap" analogue: the agent
//                            never went back to see whether the failure mattered.
//   avg / p99 duration       efficiency. Wall-clock, so it includes the target
//                            site's latency, not just this server's.
//
// WHY IT DOES NOT FAIL THE BUILD BY DEFAULT
// -----------------------------------------
// The thresholds below are calibrated on NO real traffic yet. A gate wired to
// invented numbers either blocks honest work or gets `|| true`-ed away within a
// week; both outcomes leave the repo with no gate and a false belief that it has
// one. So the default run REPORTS, and `--fail-on-severity` is the explicit opt
// in that turns the same numbers into an exit code once someone has looked at
// what they actually are. A trace directory that does not exist is likewise not
// a failure — no trace means no evidence, which is not the same as bad evidence.
//
// Usage:
//   node scripts/audit-tool-traces.mjs
//   node scripts/audit-tool-traces.mjs --file .ccg/traces/
//   node scripts/audit-tool-traces.mjs --json
//   node scripts/audit-tool-traces.mjs --threshold 30 --fail-on-severity
//   node scripts/audit-tool-traces.mjs --selftest
//
// Exit codes:
//   0  reported (default, regardless of findings)
//   1  --fail-on-severity and at least one severity finding
//   2  the audit could not produce a trustworthy report (bad input, no records)

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirUrl = new URL('.', import.meta.url);
const projectRoot = fileURLToPath(new URL('../', scriptDirUrl));

/** Total distinct tool domains in the repo — the denominator for domain_coverage. */
const TOTAL_DOMAINS = 36;

const ERROR_KINDS = ['timeout', 'validation', 'gate', 'handler', 'unknown'];

/**
 * Default "look at this" thresholds, in the metric's own units.
 *
 * These are observation triggers, not compliance limits — see "WHY IT DOES NOT
 * FAIL THE BUILD BY DEFAULT" above. Each is a guess until real traces exist, and
 * the report prints the observed value next to the threshold so a reader can see
 * how far the guess was off rather than having to trust it.
 */
const DEFAULT_THRESHOLDS = {
  repeated_tool_call_rate: 0.4,
  orphan_failure_count: 10,
  tool_diversity: 0.15,
  p99_call_duration_ms: 30_000,
};

const SEVERITY_ORDER = { info: 0, warn: 1, severe: 2 };

// ── argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = {
    file: join(projectRoot, '.ccg', 'traces'),
    json: false,
    selftest: false,
    failOnSeverity: false,
    threshold: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--selftest') options.selftest = true;
    else if (arg === '--fail-on-severity') options.failOnSeverity = true;
    else if (arg === '--file') options.file = argv[i + 1] ?? options.file;
    else if (arg.startsWith('--file=')) options.file = arg.slice('--file='.length);
    else if (arg === '--threshold') options.threshold = Number(argv[i + 1]);
    else if (arg.startsWith('--threshold='))
      options.threshold = Number(arg.slice('--threshold='.length));
  }
  options.file =
    options.file.startsWith('/') || /^[A-Za-z]:/.test(options.file)
      ? options.file
      : join(projectRoot, options.file);
  return options;
}

// ── loading ──────────────────────────────────────────────────────────────────

/** Recursively collect `*.jsonl` / `*.ndjson` under a file or directory. */
function collectTraceFiles(target, out = []) {
  if (!existsSync(target)) return out;
  const stats = statSync(target);
  if (stats.isFile()) {
    out.push(target);
    return out;
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const full = join(target, entry.name);
    if (entry.isDirectory()) collectTraceFiles(full, out);
    else if (/\.(jsonl|ndjson)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Parse trace files into records.
 *
 * A malformed line is SKIPPED AND COUNTED, never fatal. A trace file written by
 * a process that was killed mid-line ends in a partial record; refusing to read
 * the whole file because of it would discard every good line in front of it.
 * The count is reported so a reader knows the metrics are computed over a
 * slightly smaller denominator instead of assuming they cover everything.
 *
 * A record with no usable `toolName` is not a tool call and is counted as
 * malformed rather than admitted with a placeholder name — a placeholder would
 * silently enter the diversity and repetition counts as if it were a real tool.
 */
/**
 * Parse one JSONL line into a trace record. Returns `null` for malformed lines
 * (unparseable JSON, non-object payloads, or a missing/empty `toolName`).
 */
function parseTraceLine(trimmed) {
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (typeof parsed.toolName !== 'string' || parsed.toolName.length === 0) return null;
  return parsed;
}

/** Map an already-validated parsed line to the normalized record shape. */
function toTraceRecord(parsed, sessionId) {
  return {
    sessionId,
    seq: typeof parsed.seq === 'number' ? parsed.seq : null,
    toolName: parsed.toolName,
    domain: typeof parsed.domain === 'string' ? parsed.domain : null,
    startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : null,
    durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : 0,
    ok: parsed.ok !== false,
    errorKind: ERROR_KINDS.includes(parsed.errorKind) ? parsed.errorKind : null,
    argsSizeBytes: typeof parsed.argsSizeBytes === 'number' ? parsed.argsSizeBytes : null,
    resultSizeBytes: typeof parsed.resultSizeBytes === 'number' ? parsed.resultSizeBytes : null,
    repeated: parsed.repeated === true,
  };
}

function loadRecords(files) {
  const records = [];
  let malformed = 0;
  const mismatchedSessions = [];

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const parsed = parseTraceLine(trimmed);
      if (parsed === null) {
        malformed += 1;
        continue;
      }
      // The line's own sessionId wins over the file name: a file may hold
      // several sessions (one block per session), and grouping by file name
      // would merge two agents into one trace.
      const sessionId =
        typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0
          ? parsed.sessionId
          : basename(file);
      if (typeof parsed.sessionId === 'string' && parsed.sessionId !== basename(file, '.jsonl')) {
        mismatchedSessions.push({ file: basename(file), sessionId: parsed.sessionId });
      }
      records.push(toTraceRecord(parsed, sessionId));
    }
  }
  return { records, malformed, mismatchedSessions };
}

// ── metrics ──────────────────────────────────────────────────────────────────

/** Nearest-rank percentile. No interpolation: with small n, an interpolated p99
 * lands between two real observations and reads as a duration that never
 * happened. */
function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return 0;
  const rank = Math.ceil(fraction * sortedValues.length);
  const index = Math.min(Math.max(rank, 1), sortedValues.length) - 1;
  return sortedValues[index];
}

/**
 * Phase count within one call sequence.
 *
 * A phase boundary is a DOMAIN switch — `page_*` calls then `network_*` calls is
 * two phases. Meta tools (domain `null`) do not start a phase: `search_tools` /
 * `activate_tools` are bookkeeping the agent does alongside its work, and
 * counting each as its own phase would inflate plan_depth with the harness's own
 * traffic rather than the agent's plan. A meta call is skipped, leaving the
 * current phase open.
 */
function countPhases(entries) {
  let phases = 0;
  let currentDomain = null;
  for (const entry of entries) {
    if (entry.domain === null) continue;
    if (entry.domain !== currentDomain) {
      phases += 1;
      currentDomain = entry.domain;
    }
  }
  return phases;
}

/** Same domain, different domain, or unresolvable (no domain on either side). */
function distinctFromFailure(failure, candidate) {
  if (candidate.toolName !== failure.toolName) return true;
  // Same tool: an argument change is the remedy the doom-loop gate itself
  // suggests, so it counts as a response. Without args we cannot tell a retry
  // from a new attempt — `repeated` is the recorder's own same-tool flag, and a
  // `false` there means the agent changed SOMETHING at the tool level.
  if (candidate.repeated === false) return true;
  return false;
}

function analyzeSession(sessionId, entries) {
  const calls = entries.length;
  const durations = entries.map((entry) => entry.durationMs).toSorted((a, b) => a - b);
  const sortedDurations = durations[0] === undefined ? [] : durations;

  const repeatedCalls = entries.filter((entry) => entry.repeated).length;
  const distinctTools = new Set(entries.map((entry) => entry.toolName));
  const domains = new Set(entries.map((entry) => entry.domain).filter((d) => d !== null));

  const failures = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry.ok) failures.push({ index: i, entry });
  }

  // A failure is "transparent" when the very next call in the session is
  // something other than the same tool with (indistinguishably) the same args.
  // The check is on the immediately following call, not on any later one: an
  // agent that retries twice and THEN changes approach still spent two calls
  // not acknowledging anything.
  let transparentFailures = 0;
  let orphanFailures = 0;
  for (const failure of failures) {
    const next = entries[failure.index + 1];
    if (next !== undefined && distinctFromFailure(failure.entry, next)) transparentFailures += 1;
    const laterRemedy = entries
      .slice(failure.index + 1)
      .some((entry) => entry.domain !== null && entry.domain === failure.entry.domain);
    if (!laterRemedy) orphanFailures += 1;
  }

  const errorKinds = {};
  for (const entry of entries) {
    if (entry.ok || entry.errorKind === null) continue;
    errorKinds[entry.errorKind] = (errorKinds[entry.errorKind] ?? 0) + 1;
  }

  const durationSum = entries.reduce((sum, entry) => sum + entry.durationMs, 0);

  return {
    sessionId,
    calls,
    distinctTools: distinctTools.size,
    /** Distinct tool names — carried so aggregation can union instead of max. */
    toolNames: [...distinctTools].toSorted(),
    domains: [...domains].toSorted(),
    failures: failures.length,
    errorKinds,
    repeatedCalls,
    repeatedToolCallRate: calls === 0 ? 0 : repeatedCalls / calls,
    toolDiversity: calls === 0 ? 0 : distinctTools.size / calls,
    planDepth: countPhases(entries),
    failureTransparency: failures.length === 0 ? null : transparentFailures / failures.length,
    orphanFailureCount: orphanFailures,
    avgCallDurationMs: calls === 0 ? 0 : Number((durationSum / calls).toFixed(2)),
    p99CallDurationMs: Number(percentile(sortedDurations, 0.99).toFixed(2)),
  };
}

/**
 * Cross-session totals.
 *
 * Repetition and diversity are aggregated by SUMMING the per-session numerators
 * and denominators rather than averaging the per-session rates: a session with 3
 * calls would otherwise weigh as much as one with 300, and a single short
 * session can swing the headline number.
 *
 * `plan_depth` is deliberately per-session ONLY. Phases do not concatenate
 * across agents — the boundary between one agent's last domain and another's
 * first is not a phase change in anyone's plan — so a combined figure would be
 * an artifact of how sessions were batched into files.
 */
function aggregate(sessions, malformed, mismatchedSessions, thresholds) {
  const calls = sessions.reduce((sum, session) => sum + session.calls, 0);
  const repeatedCalls = sessions.reduce((sum, session) => sum + session.repeatedCalls, 0);
  const failures = sessions.reduce((sum, session) => sum + session.failures, 0);
  const allTools = new Set();
  const allDomains = new Set();
  // Distinct TOOLS are unioned across sessions, not maxed: `distinctTools` is a
  // per-session set size, so the largest single session's count is the wrong
  // numerator for a workspace-wide rate — it would understate diversity whenever
  // two sessions used different tools.
  for (const session of sessions) {
    for (const domain of session.domains) allDomains.add(domain);
    for (const tool of session.toolNames) allTools.add(tool);
  }
  const diversity = calls === 0 ? 0 : Number((allTools.size / calls).toFixed(4));

  const orphanFailureCount = sessions.reduce((sum, s) => sum + s.orphanFailureCount, 0);
  const transparent = sessions.filter((s) => s.failureTransparency !== null);
  const failureTransparency =
    transparent.length === 0
      ? null
      : Number(
          (
            transparent.reduce((sum, s) => sum + s.failureTransparency * s.failures, 0) /
            transparent.reduce((sum, s) => sum + s.failures, 0)
          ).toFixed(4),
        );

  const totalDuration = sessions.reduce(
    (sum, session) => sum + session.avgCallDurationMs * session.calls,
    0,
  );

  const combined = {
    sessions: sessions.length,
    calls,
    malformedLines: malformed,
    failures,
    repeatedToolCallRate: calls === 0 ? 0 : Number((repeatedCalls / calls).toFixed(4)),
    toolDiversity: diversity,
    failureTransparency,
    orphanFailureCount,
    avgCallDurationMs: calls === 0 ? 0 : Number((totalDuration / calls).toFixed(2)),
    p99CallDurationMs: thresholdInput(sessions).p99,
    domainCoverage: {
      touched: allDomains.size,
      total: TOTAL_DOMAINS,
      ratio: Number((allDomains.size / TOTAL_DOMAINS).toFixed(4)),
    },
    planDepth: {
      perSession: sessions.map((s) => ({ sessionId: s.sessionId, phases: s.planDepth })),
      max: thresholdInput(sessions).maxPlanDepth,
    },
  };

  return { combined, findings: buildFindings(combined, thresholds, mismatchedSessions) };
}

/** Duration/plan extremes, pulled out so `combined` stays a plain object. */
function thresholdInput(sessions) {
  const p99 = sessions.reduce((max, session) => Math.max(max, session.p99CallDurationMs), 0);
  const maxPlanDepth = sessions.reduce((max, session) => Math.max(max, session.planDepth), 0);
  return { p99, maxPlanDepth };
}

function buildFindings(combined, thresholds, mismatchedSessions) {
  const findings = [];
  const add = (severity, metric, value, threshold, message) =>
    findings.push({ severity, metric, value, threshold, message });

  if (combined.calls === 0) {
    add(
      'info',
      'tool_call_count',
      0,
      null,
      'no tool calls in the trace — nothing to analyze (this is not a finding about the agent)',
    );
    return findings;
  }

  if (combined.repeatedToolCallRate > thresholds.repeated_tool_call_rate) {
    add(
      'warn',
      'repeated_tool_call_rate',
      combined.repeatedToolCallRate,
      thresholds.repeated_tool_call_rate,
      'a large share of calls repeat the previous tool back-to-back — worth checking whether ' +
        'the arguments changed, or whether the agent is retrying the same failing call',
    );
  }
  if (combined.toolDiversity < thresholds.tool_diversity) {
    add(
      'warn',
      'tool_diversity',
      combined.toolDiversity,
      thresholds.tool_diversity,
      'calls concentrate on very few tools — the agent may be grinding one strategy',
    );
  }
  if (combined.orphanFailureCount > thresholds.orphan_failure_count) {
    add(
      'severe',
      'orphan_failure_count',
      combined.orphanFailureCount,
      thresholds.orphan_failure_count,
      `${combined.orphanFailureCount} failures were never followed by another call to the same ` +
        'domain — the agent moved on without checking whether the failure mattered',
    );
  }
  if (combined.p99CallDurationMs > thresholds.p99_call_duration_ms) {
    add(
      'warn',
      'p99_call_duration_ms',
      combined.p99CallDurationMs,
      thresholds.p99_call_duration_ms,
      'the slowest calls dominate wall-clock — inspect which tools, and whether the timeout ' +
        'watchdog is near',
    );
  }
  if (combined.failureTransparency !== null && combined.failureTransparency < 0.5) {
    add(
      'warn',
      'failure_transparency',
      combined.failureTransparency,
      0.5,
      'most failures were followed by the same tool with the same arguments — the trace does ' +
        'not show the agent responding to the failure',
    );
  }
  if (combined.domainCoverage.touched === 1) {
    add(
      'info',
      'domain_coverage',
      combined.domainCoverage.ratio,
      null,
      'only one domain was touched — expected for a focused task, notable for a broad one',
    );
  }
  if (mismatchedSessions.length > 0) {
    add(
      'info',
      'session_id_mismatch',
      mismatchedSessions.length,
      null,
      'some lines carry a sessionId that differs from their file name — grouped by the line ' +
        'value, which is correct, but the file naming is worth checking',
    );
  }
  return findings;
}

// ── selftest ─────────────────────────────────────────────────────────────────

/**
 * Drive the audit over a GENERATED trace and assert the numbers.
 *
 * A metric script whose only proven behaviour is "it printed something" is the
 * same defect as a test that reads the thing under test back to itself. So the
 * cases below construct a trace with a KNOWN shape (one orphan failure, one
 * repeated pair, two phases, known durations) and assert the exact values.
 *
 * Two cases are chosen to fail if a specific definition is wrong rather than to
 * fail if the code is broken:
 *   - C3 pins the phase rule: a meta call between two calls of the SAME domain
 *     must NOT add a phase.
 *   - C4 pins the transparency rule: a failure followed by the same tool with a
 *     DIFFERENT attempt (repeated: false) must count as a response.
 * A third (C5) re-runs the pure metrics with the thresholds forced to zero, to
 * prove the findings path can actually fire — a report-only script whose finding
 * branches are unreachable protects nothing.
 */
function selftestLine(overrides) {
  return JSON.stringify({
    sessionId: 's1',
    seq: 0,
    toolName: 'page_evaluate',
    domain: 'page',
    startedAt: 1_700_000_000_000,
    durationMs: 10,
    ok: true,
    repeated: false,
    ...overrides,
  });
}

function selftest() {
  const dir = join(tmpdir(), `jshookmcp-tool-traces-selftest-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const failures = [];
  const check = (name, actual, expected) => {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    failures.push({ name, actual, expected, same });
    console.log(`${same ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
    if (!same) console.log(`     expected: ${JSON.stringify(expected)}`);
  };

  // C1: repetition. Three page_* calls with the last two repeating, then a
  // network call. repeated_tool_call_rate = 2/4, diversity = 2/4, phases = 2.
  const c1 = join(dir, 'c1.jsonl');
  writeFileSync(
    c1,
    [
      selftestLine({ seq: 1, durationMs: 10 }),
      selftestLine({ seq: 2, toolName: 'page_evaluate', durationMs: 20, repeated: true }),
      selftestLine({ seq: 3, durationMs: 30 }),
      selftestLine({ seq: 4, durationMs: 40, repeated: true }),
      selftestLine({ seq: 5, toolName: 'network_get_requests', domain: 'network', durationMs: 50 }),
    ].join('\n') + '\n',
  );
  const c1Report = reportFor(c1, DEFAULT_THRESHOLDS);
  check('C1 calls', c1Report.combined.calls, 5);
  check('C1 repeated_tool_call_rate', c1Report.combined.repeatedToolCallRate, 0.4);
  // 2 distinct tools (page_evaluate, network_get_requests) over 5 calls.
  check('C1 tool_diversity', c1Report.combined.toolDiversity, 0.4);
  check('C1 plan_depth', c1Report.combined.planDepth.max, 2);
  check('C1 domain_coverage.touched', c1Report.combined.domainCoverage.touched, 2);
  check(
    'C1 p99 falls on the real max, not between values',
    c1Report.combined.p99CallDurationMs,
    50,
  );

  // C2: an orphan failure — the only page_* call fails and nothing page_* follows.
  // The network call afterwards is a different domain, so it is not a remedy.
  const c2 = join(dir, 'c2.jsonl');
  writeFileSync(
    c2,
    [
      selftestLine({ seq: 1, ok: false, errorKind: 'timeout', durationMs: 100 }),
      selftestLine({ seq: 2, toolName: 'network_get_requests', domain: 'network', durationMs: 5 }),
    ].join('\n') + '\n',
  );
  const c2Report = reportFor(c2, DEFAULT_THRESHOLDS);
  check('C2 orphan_failure_count', c2Report.combined.orphanFailureCount, 1);
  check('C2 failure_transparency', c2Report.combined.failureTransparency, 1);
  check('C2 error kind recorded', c2Report.sessions[0].errorKinds, { timeout: 1 });

  // C3: a meta call (domain null) between two SAME-domain calls must not open a
  // phase. Without the skip this reads 3 phases; the honest answer is 1.
  const c3 = join(dir, 'c3.jsonl');
  writeFileSync(
    c3,
    [
      selftestLine({ seq: 1, toolName: 'page_evaluate', domain: 'page' }),
      selftestLine({ seq: 2, toolName: 'search_tools', domain: null }),
      selftestLine({ seq: 3, toolName: 'page_screenshot', domain: 'page' }),
    ].join('\n') + '\n',
  );
  const c3Report = reportFor(c3, DEFAULT_THRESHOLDS);
  check('C3 meta call does not add a phase', c3Report.combined.planDepth.max, 1);

  // C4: same tool retried with different arguments (repeated: false) after a
  // failure counts as a response; an exact retry (repeated: true) does not.
  const c4 = join(dir, 'c4.jsonl');
  writeFileSync(
    c4,
    [
      selftestLine({ seq: 1, ok: false, errorKind: 'handler' }),
      selftestLine({ seq: 2, ok: true, repeated: false }),
    ].join('\n') + '\n',
  );
  const c5 = join(dir, 'c5.jsonl');
  writeFileSync(
    c5,
    [
      selftestLine({ seq: 1, ok: false, errorKind: 'handler' }),
      selftestLine({ seq: 2, toolName: 'page_evaluate', domain: 'page', ok: true, repeated: true }),
    ].join('\n') + '\n',
  );
  check(
    'C4 argument change counts as transparency',
    reportFor(c4, DEFAULT_THRESHOLDS).combined.failureTransparency,
    1,
  );
  check(
    'C4 exact retry does not',
    reportFor(c5, DEFAULT_THRESHOLDS).combined.failureTransparency,
    0,
  );

  // C5: the findings path fires when thresholds are tighter than the data.
  // `orphan_failure_count` is forced to 0 so its check runs with a "> 0"
  // comparison — the strict-threshold case for the SEVERE severity, which
  // `repeated_tool_call_rate: 0` alone does not exercise (that only ever yields
  // a warn). Both branches are asserted so a finding that silently downgrades
  // to `info` fails here instead of quietly disappearing.
  const strict = { ...DEFAULT_THRESHOLDS, repeated_tool_call_rate: 0, orphan_failure_count: 0 };
  const c6 = reportFor(c1, strict);
  const strictMetrics = c6.findings.map((finding) => finding.metric);
  check(
    'C5 findings fire under strict thresholds',
    strictMetrics.includes('repeated_tool_call_rate'),
    true,
  );
  check(
    'C5 warn severity present',
    c6.findings.some((f) => f.severity === 'warn'),
    true,
  );
  const c8 = reportFor(c2, strict);
  check(
    'C5 severe finding is severe',
    c8.findings.some((f) => f.severity === 'severe' && f.metric === 'orphan_failure_count'),
    true,
  );

  // C6: a truncated final line must be skipped and counted, not fatal.
  const c7 = join(dir, 'c7.jsonl');
  writeFileSync(c7, `${selftestLine({ seq: 1 })}\n{"sessionId":"s1","toolName":"page_ev`);
  const c7Load = loadRecords([c7]);
  check('C6 truncated line skipped', c7Load.records.length, 1);
  check('C6 truncated line counted', c7Load.malformed, 1);

  rmSync(dir, { recursive: true, force: true });

  const failed = failures.filter((entry) => !entry.same);
  if (failed.length > 0 || !existsSync(join(projectRoot, 'src'))) {
    console.error(`\n[audit-tool-traces] selftest FAILED (${failed.length} assertion(s))`);
    process.exit(1);
  }
  console.log(`\n[audit-tool-traces] selftest OK (${failures.length} assertions)`);
  process.exit(0);
}

/** Compute the report for one file without printing it. Used by the selftest. */
function reportFor(file, thresholds) {
  const { records, malformed, mismatchedSessions } = loadRecords([file]);
  const sessions = groupSessions(records);
  return { sessions, ...aggregate(sessions, malformed, mismatchedSessions, thresholds) };
}

/**
 * Group records by session, ordering each session by `seq` when present.
 *
 * `seq` is the recorder's own monotonic counter, so it is the authoritative
 * order. Falling back to `startedAt` mixes two clocks: `seq` comes from the
 * recording process and `startedAt` from `Date.now()` at call entry, which are
 * consistent here but would not be if a trace were merged from several
 * processes. Where `seq` is absent (a hand-written or foreign trace) the file
 * order is kept, which is the order the lines were written.
 */
function groupSessions(records) {
  const bySesion = new Map();
  for (const record of records) {
    if (!bySesion.has(record.sessionId)) bySesion.set(record.sessionId, []);
    bySesion.get(record.sessionId).push(record);
  }
  const sessions = [];
  for (const [sessionId, entries] of bySesion) {
    const ordered = entries.every((entry) => entry.seq !== null)
      ? entries.toSorted((a, b) => a.seq - b.seq)
      : entries;
    sessions.push(analyzeSession(sessionId, ordered));
  }
  return sessions;
}

// ── reporting ────────────────────────────────────────────────────────────────

const pct = (value) => `${(value * 100).toFixed(1)}%`;

function printReport(report, options, thresholds, files) {
  const { sessions, combined, findings } = report;
  console.log(
    `[audit-tool-traces] files: ${files.length}; sessions: ${sessions.length}; ` +
      `calls: ${combined.calls}; failures: ${combined.failures}` +
      (combined.malformedLines > 0 ? `; malformed lines skipped: ${combined.malformedLines}` : ''),
  );
  if (files.length === 0) {
    console.log(
      `[audit-tool-traces] no .jsonl trace files under ${options.file}. ` +
        'Nothing to report — run with --selftest to check the analyzer itself.',
    );
    return;
  }
  console.log('');
  console.log('  repeated_tool_call_rate  ' + pct(combined.repeatedToolCallRate));
  console.log('  tool_diversity           ' + pct(combined.toolDiversity));
  console.log('  plan_depth (max/session) ' + combined.planDepth.max);
  console.log(
    '  failure_transparency     ' +
      (combined.failureTransparency === null
        ? 'n/a (no failures)'
        : pct(combined.failureTransparency)),
  );
  console.log('  avg_call_duration_ms     ' + combined.avgCallDurationMs);
  console.log('  p99_call_duration_ms     ' + combined.p99CallDurationMs);
  console.log(
    '  domain_coverage          ' +
      `${combined.domainCoverage.touched}/${combined.domainCoverage.total} ` +
      `(${pct(combined.domainCoverage.ratio)})`,
  );
  console.log('  orphan_failure_count     ' + combined.orphanFailureCount);
  console.log('');
  console.log('  per-session:');
  for (const session of sessions) {
    console.log(
      `    ${session.sessionId}  calls=${session.calls} tools=${session.distinctTools} ` +
        `phases=${session.planDepth} failures=${session.failures} ` +
        `orphan=${session.orphanFailureCount} avg=${session.avgCallDurationMs}ms`,
    );
  }

  if (findings.length === 0) {
    console.log('\n[audit-tool-traces] no findings above the observation thresholds.');
  } else {
    console.log('');
    for (const finding of findings) {
      const threshold = finding.threshold === null ? '' : ` (threshold ${finding.threshold})`;
      console.log(`  [${finding.severity}] ${finding.metric} = ${finding.value}${threshold}`);
      console.log(`    ${finding.message}`);
    }
  }
  if (!options.failOnSeverity) {
    console.log(
      '\n[audit-tool-traces] report-only: findings do not affect the exit code. ' +
        'Pass --fail-on-severity to gate on them once the thresholds are calibrated.',
    );
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

const options = parseArgs(process.argv.slice(2));

if (options.selftest) {
  selftest();
} else {
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(Number.isFinite(options.threshold) ? { orphan_failure_count: options.threshold } : {}),
  };
  const files = collectTraceFiles(options.file);
  const { records, malformed, mismatchedSessions } = loadRecords(files);
  const sessions = groupSessions(records);
  const report = { sessions, ...aggregate(sessions, malformed, mismatchedSessions, thresholds) };

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          file: options.file,
          files: files.map((file) => basename(file)),
          thresholds,
          ...report,
        },
        null,
        2,
      ),
    );
  } else {
    printReport(report, options, thresholds, files);
  }

  if (options.failOnSeverity) {
    const severe = report.findings.filter(
      (finding) => SEVERITY_ORDER[finding.severity] >= SEVERITY_ORDER.severe,
    );
    if (severe.length > 0) {
      console.error(`\n[audit-tool-traces] FAIL: ${severe.length} severe finding(s).`);
      for (const finding of severe) {
        console.error(`  ${finding.metric} = ${finding.value} (threshold ${finding.threshold})`);
      }
      process.exit(1);
    }
  }
  process.exit(0);
}
