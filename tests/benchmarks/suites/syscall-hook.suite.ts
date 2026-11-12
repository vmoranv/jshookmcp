/**
 * syscall-hook domain benchmark — offline-pure handlers only.
 * All four cases are homemade fixtures with known ground truth: they invoke the
 * real SyscallHookHandlers Tool facade (the methods the registry manifest maps
 * the MCP tool names to) but only exercise the branches that are pure compute:
 *   - syscall_correlate_js: static SyscallToJSMapper heuristic table
 *   - syscall_trace_compare: pure set/frequency diff of two seeded snapshots
 *   - syscall_get_stats: a fresh, idle SyscallMonitor's stats shape
 *   - syscall_ebpf_trace: the deterministic bpftrace SCRIPT-GENERATION branch
 *
 * Monitor-dependent tools (trace_export / pattern_detect / origin_map /
 * stack_capture) are deliberately omitted: their handlers call
 * monitor.captureEvents() and are not honestly offline-testable. The
 * simulate:true ebpf branch (Math.random-based) is also omitted.
 */
import type { SyscallEvent } from '@modules/syscall-hook';
import { SyscallHookHandlers } from '@server/domains/syscall-hook/handlers.impl';
import { body, type BenchSuite } from '../harness';
import { syscallContractCases } from './syscall-hook.contracts';

// No monitor/mapper/eventBus deps supplied: the four pure handlers create their
// own idle SyscallMonitor() / SyscallToJSMapper() lazily via ensure*(), which is
// side-effect-free offline (no subprocess, no network, no random data).
const handlers = new SyscallHookHandlers();

const mkEvent = (
  syscall: string,
  args: string[],
  returnValue: number,
  timestamp: number,
): SyscallEvent => ({ timestamp, pid: 5555, syscall, args, returnValue });

// ── syscall_correlate_js ──────────────────────────────────────────────────────
// Three mappable syscalls plus one unmapped one. Ground truth comes directly
// from SyscallToJSMapper's CORRELATION_RULES + confidence bonuses:
//   openat  -> fs.open    (0.8 + 0.08 ".js" arg bonus = 0.88)
//   read    -> fs.readFile(0.78, no module-extension bonus)
//   connect -> fetch      (0.7 + 0.1 "443" endpoint bonus = 0.8)
//   getpid  -> unmatched  (no rule)
const CORRELATE_EVENTS: SyscallEvent[] = [
  mkEvent('openat', ['/app/index.js', 'O_RDONLY'], 3, 1000),
  mkEvent('read', ['fd=3', 'count=4096'], 256, 1001),
  mkEvent('connect', ['fd=9', '10.0.0.1:443'], 0, 1002),
  mkEvent('getpid', [], 5555, 1003),
];

// ── syscall_trace_compare ─────────────────────────────────────────────────────
// syscallsKey = "syscall|args.join('|')|returnValue". Baseline and target share
// exactly one key (read|fd=3|100); two keys are new in target, two are removed
// from baseline. Frequency deltas: write/openat -1, connect/mmap +1 (read 1->1
// is omitted). Added/removed counts and deltas are fully deterministic.
const BASELINE_EVENTS: SyscallEvent[] = [
  mkEvent('read', ['fd=3'], 100, 2000),
  mkEvent('write', ['fd=3'], 50, 2001),
  mkEvent('openat', ['/a'], 3, 2002),
];
const TARGET_EVENTS: SyscallEvent[] = [
  mkEvent('read', ['fd=3'], 100, 3000),
  mkEvent('connect', ['fd=9'], 0, 3001),
  mkEvent('mmap', ['/x'], 0, 3002),
];

// Expected bpftrace script generation inputs (script branch, NOT simulate).
const EBPF_PID = 1234;
const EBPF_DURATION_SEC = 15;
const EBPF_SYSCALLS = ['read', 'write', 'openat'];

const near = (value: unknown, expected: number): boolean =>
  typeof value === 'number' && Math.abs(value - expected) < 1e-6;

const namesOf = (events: unknown): string[] => {
  if (!Array.isArray(events)) return [];
  return (events as Array<Record<string, unknown>>)
    .map((e) => (typeof e.syscall === 'string' ? e.syscall : ''))
    .filter((name) => name.length > 0);
};

const sameNameSet = (actual: string[], expected: readonly string[]): boolean => {
  if (actual.length !== expected.length) return false;
  const set = new Set(actual);
  return expected.every((name) => set.has(name));
};

export const syscallHookSuite: BenchSuite = {
  name: 'syscall-hook',
  domain: 'syscall-hook',
  description:
    'Offline-pure syscall-hook handlers: JS-correlation heuristic mapping, trace snapshot diff, idle monitor stats, deterministic bpftrace script generation',
  cases: [
    {
      name: 'syscall_correlate_js/js-mapping-and-confidence',
      tool: 'syscall_correlate_js',
      origin: 'homemade',
      reference:
        'SyscallToJSMapper heuristic table: openat/.js->fs.open@0.88, read->fs.readFile@0.78, connect/:443->fetch@0.8; getpid has no rule -> unmatched; matched=3, unmatched=[getpid]',
      run: () => handlers.handleSyscallCorrelateJsTool({ syscallEvents: CORRELATE_EVENTS }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false || b.ok === false) {
          return `handler failed: ${JSON.stringify(b).slice(0, 200)}`;
        }
        if (b.matched !== 3) return `expected 3 matched correlations, got ${String(b.matched)}`;

        const unmatched = Array.isArray(b.unmatched)
          ? (b.unmatched as Array<Record<string, unknown>>)
          : [];
        if (unmatched.length !== 1 || unmatched[0]?.syscall !== 'getpid') {
          return `expected unmatched=[getpid], got ${JSON.stringify(unmatched).slice(0, 200)}`;
        }

        const correlations = Array.isArray(b.correlations)
          ? (b.correlations as Array<Record<string, unknown>>)
          : [];
        const byName = new Map<string, Record<string, unknown>>();
        for (const c of correlations) {
          const inner = c.syscall as Record<string, unknown> | undefined;
          if (inner && typeof inner.syscall === 'string') byName.set(inner.syscall, c);
        }
        if (byName.size !== 3) return `expected 3 distinct correlated syscalls, got ${byName.size}`;

        const openat = byName.get('openat');
        const read = byName.get('read');
        const connect = byName.get('connect');
        if (openat?.jsFunction !== 'fs.open' || !near(openat?.confidence, 0.88)) {
          return `openat mapping wrong: ${JSON.stringify(openat)}`;
        }
        if (read?.jsFunction !== 'fs.readFile' || !near(read?.confidence, 0.78)) {
          return `read mapping wrong: ${JSON.stringify(read)}`;
        }
        if (connect?.jsFunction !== 'fetch' || !near(connect?.confidence, 0.8)) {
          return `connect mapping wrong: ${JSON.stringify(connect)}`;
        }
        return true;
      },
    },
    {
      name: 'syscall_trace_compare/added-removed-counts',
      tool: 'syscall_trace_compare',
      origin: 'homemade',
      reference:
        'Set diff on syscall|args|returnValue keys: one shared key, 2 appeared (connect,mmap), 2 disappeared (write,openat), 4 freq deltas of +/-1; baselineCount=targetCount=3',
      run: () =>
        handlers.handleSyscallTraceCompareTool({
          baselineEvents: BASELINE_EVENTS,
          targetEvents: TARGET_EVENTS,
        }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `handler failed: ${JSON.stringify(b).slice(0, 200)}`;
        if (b.baselineCount !== 3 || b.targetCount !== 3) {
          return `expected baseline/target counts 3/3, got ${String(b.baselineCount)}/${String(b.targetCount)}`;
        }

        const appeared = Array.isArray(b.appeared) ? b.appeared : [];
        const disappeared = Array.isArray(b.disappeared) ? b.disappeared : [];
        if (appeared.length !== 2 || disappeared.length !== 2) {
          return `expected 2 appeared / 2 disappeared, got ${appeared.length}/${disappeared.length}`;
        }
        if (!sameNameSet(namesOf(appeared), ['connect', 'mmap'])) {
          return `appeared names wrong: ${JSON.stringify(namesOf(appeared))}`;
        }
        if (!sameNameSet(namesOf(disappeared), ['write', 'openat'])) {
          return `disappeared names wrong: ${JSON.stringify(namesOf(disappeared))}`;
        }

        const freqDeltas = Array.isArray(b.freqDeltas)
          ? (b.freqDeltas as Array<Record<string, unknown>>)
          : [];
        if (freqDeltas.length !== 4) return `expected 4 freq deltas, got ${freqDeltas.length}`;
        const deltaNames = freqDeltas
          .map((d) => (typeof d.name === 'string' ? d.name : ''))
          .filter((n) => n.length > 0);
        if (!sameNameSet(deltaNames, ['write', 'openat', 'connect', 'mmap'])) {
          return `freq delta names wrong: ${JSON.stringify(deltaNames)}`;
        }
        for (const d of freqDeltas) {
          const delta = typeof d.delta === 'number' ? d.delta : 0;
          if (delta !== 1 && delta !== -1) {
            return `expected every freq delta to be +/-1, got ${String(d.delta)} for ${String(d.name)}`;
          }
        }
        const summary = typeof b.summary === 'string' ? b.summary : '';
        if (
          !summary.includes('2 new syscalls appeared') ||
          !summary.includes('2 syscalls disappeared')
        ) {
          return `summary did not report added/removed counts: ${summary}`;
        }
        return true;
      },
    },
    {
      name: 'syscall_get_stats/idle-monitor-shape',
      tool: 'syscall_get_stats',
      origin: 'homemade',
      reference:
        'Fresh SyscallMonitor(): running=false, eventsCaptured/droppedEvents/uptime=0, subprocessActive=false; supportedBackends is an array; etwProviderCatalog is the 5-entry static catalog',
      run: () => handlers.handleSyscallGetStatsTool(),
      validate: (v) => {
        const b = body(v);
        if (b.success === false || b.ok === false) {
          return `handler failed: ${JSON.stringify(b).slice(0, 200)}`;
        }
        if (b.running !== false) return `expected idle running=false, got ${String(b.running)}`;
        if (b.eventsCaptured !== 0 || b.droppedEvents !== 0 || b.uptime !== 0) {
          return `expected zero idle counters, got ${JSON.stringify({
            eventsCaptured: b.eventsCaptured,
            droppedEvents: b.droppedEvents,
            uptime: b.uptime,
          })}`;
        }
        if (b.subprocessActive !== false) {
          return `expected subprocessActive=false, got ${String(b.subprocessActive)}`;
        }
        if (!Array.isArray(b.supportedBackends)) return 'supportedBackends is not an array';

        const catalog = Array.isArray(b.etwProviderCatalog) ? b.etwProviderCatalog : [];
        if (catalog.length !== 5) {
          return `expected 5 ETW provider catalog entries, got ${catalog.length}`;
        }
        for (const entry of catalog as Array<Record<string, unknown>>) {
          if (
            typeof entry.name !== 'string' ||
            typeof entry.guid !== 'string' ||
            typeof entry.description !== 'string'
          ) {
            return `catalog entry missing name/guid/description: ${JSON.stringify(entry)}`;
          }
        }
        const catalogNames = (catalog as Array<Record<string, unknown>>).map((e) => e.name);
        if (!catalogNames.includes('nt-kernel') || !catalogNames.includes('kernel-image')) {
          return `catalog missing expected entries: ${JSON.stringify(catalogNames)}`;
        }
        return true;
      },
    },
    {
      name: 'syscall_ebpf_trace/script-generation-probes',
      tool: 'syscall_ebpf_trace',
      origin: 'homemade',
      reference:
        'Deterministic script branch (simulate omitted -> false): mode=script, syscallCount=3, bpftrace script must embed enter/exit tracepoints for read/write/openat, pid filter, interval:s:15 + exit(), and args-> access; no simulated watermark',
      run: () =>
        handlers.handleSyscallEbpfTraceTool({
          pid: EBPF_PID,
          durationSec: EBPF_DURATION_SEC,
          syscalls: EBPF_SYSCALLS,
        }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false || b.ok === false) {
          return `handler failed: ${JSON.stringify(b).slice(0, 200)}`;
        }
        if (b.mode !== 'script' || b.backend !== 'ebpf') {
          return `expected script/ebpf mode, got ${String(b.mode)}/${String(b.backend)}`;
        }
        // Prove we did NOT take the Math.random simulate branch: neither
        // watermark key may be present on a script-branch response.
        const watermarkKeys = Object.keys(b).filter(
          (k) => k === 'simulated' || k.endsWith('simulated'),
        );
        if (watermarkKeys.length > 0) {
          return `response carries a simulated watermark (${watermarkKeys.join(', ')}) — script branch was not used`;
        }
        if (b.pid !== EBPF_PID || b.durationSec !== EBPF_DURATION_SEC || b.syscallCount !== 3) {
          return `unexpected echo: pid=${String(b.pid)} durationSec=${String(b.durationSec)} syscallCount=${String(b.syscallCount)}`;
        }
        const traced = Array.isArray(b.syscallsTraced) ? b.syscallsTraced : [];
        if (!sameNameSet(traced as string[], EBPF_SYSCALLS)) {
          return `syscallsTraced wrong: ${JSON.stringify(traced)}`;
        }
        const script = typeof b.script === 'string' ? b.script : '';
        const required = [
          '#!/usr/bin/env bpftrace',
          'sys_enter_read',
          'sys_enter_write',
          'sys_enter_openat',
          'sys_exit_read',
          'sys_exit_write',
          'sys_exit_openat',
          `pid == ${EBPF_PID}`,
          `interval:s:${EBPF_DURATION_SEC}`,
          'exit()',
          'args->fd',
          'args->count',
        ];
        for (const token of required) {
          if (!script.includes(token)) return `bpftrace script missing "${token}"`;
        }
        return true;
      },
    },

    // ── Coverage batch (2026-11-12 autoresearch): pure filter/analysis handlers ──
    {
      name: 'syscall_filter/rejects-non-array-names',
      tool: 'syscall_filter',
      origin: 'homemade',
      reference:
        'validation contract: a non-array `names` argument must be rejected with an explicit error, never coerced',
      run: () => handlers.handleSyscallFilterTool({ names: 'not-an-array' }),
      validate: (v) => {
        const b = body(v);
        if (b.ok !== false) return `expected ok=false, got ${JSON.stringify(b)}`;
        return /names must be an array/i.test(String(b.error))
          ? true
          : `unexpected error text: ${String(b.error)}`;
      },
    },
    {
      name: 'syscall_filter/idle-monitor-empty-result',
      tool: 'syscall_filter',
      origin: 'homemade',
      reference:
        'with an idle monitor the filter reports ok=true, zero events, and totalBeforeFilters=0 (no fabricated rows)',
      run: () => handlers.handleSyscallFilterTool({ errorOnly: true }),
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `expected ok=true, got ${JSON.stringify(b)}`;
        if (!Array.isArray(b.events) || b.events.length !== 0)
          return `expected empty events array, got ${JSON.stringify(b.events)}`;
        return b.count === 0 && b.totalBeforeFilters === 0
          ? true
          : `counters must be zero: ${JSON.stringify(b).slice(0, 160)}`;
      },
    },
    {
      name: 'syscall_pattern_detect/empty-event-stream',
      tool: 'syscall_pattern_detect',
      origin: 'homemade',
      reference:
        'an empty captured-event stream must yield zero detected patterns with eventsAnalyzed=0',
      run: () => handlers.handleSyscallPatternDetectTool({}),
      validate: (v) => {
        const b = body(v);
        if (b.eventsAnalyzed !== 0) return `expected eventsAnalyzed=0, got ${b.eventsAnalyzed}`;
        return Array.isArray(b.patterns) && b.patterns.length === 0
          ? true
          : `expected empty patterns, got ${JSON.stringify(b.patterns)}`;
      },
    },
    {
      name: 'syscall_origin_map/empty-event-stream',
      tool: 'syscall_origin_map',
      origin: 'homemade',
      reference: 'an empty captured-event stream must report zero mapped origins in heuristic mode',
      run: () => handlers.handleSyscallOriginMapTool({}),
      validate: (v) => {
        const b = body(v);
        if (b.eventsAnalyzed !== 0 || b.unmappedCount !== 0)
          return `expected zero counters, got ${JSON.stringify(b).slice(0, 160)}`;
        return Array.isArray(b.origins) && b.origins.length === 0
          ? true
          : `expected empty origins, got ${JSON.stringify(b.origins)}`;
      },
    },

    // ── Backend/monitor contract batch 2026-11-12 (autoresearch) ───────────
    // Backend validation, idle-monitor honesty and SSN/stub resolution
    // (tables live in syscall-hook.contracts.ts).
    ...syscallContractCases,
  ],
};
