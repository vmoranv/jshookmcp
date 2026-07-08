import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

const BACKEND_OPTIONS = ['etw', 'strace', 'dtrace'];

const SYSCALL_EVENT_SCHEMA = {
  type: 'object',
  properties: {
    timestamp: {
      type: 'number',
      description: 'Relative elapsed time in milliseconds since bpftrace start',
    },
    pid: { type: 'number', description: 'Process identifier' },
    syscall: { type: 'string', description: 'Observed syscall name' },
    args: {
      type: 'array',
      description: 'Stringified syscall arguments',
      items: { type: 'string' },
    },
    returnValue: { type: 'number', description: 'Numeric syscall return value if available' },
    duration: { type: 'number', description: 'Execution duration in milliseconds if available' },
  },
  required: ['timestamp', 'pid', 'syscall', 'args'],
};

export const syscallHookToolDefinitions: Tool[] = [
  tool('syscall_start_monitor', (t) =>
    t
      .desc('Start syscall monitoring.')
      .enum('backend', BACKEND_OPTIONS, 'Syscall capture backend')
      .number('pid', 'Optional PID to scope monitoring to a single process')
      .boolean('simulate', 'Use synthetic events instead of a real system tracer', {
        default: false,
      })
      .array(
        'etwProviders',
        { type: 'string' },
        'ETW (Windows) named providers to enable beyond the legacy NT Kernel Logger: nt-kernel | kernel-process | kernel-network | kernel-file | kernel-image. Ignored on non-Windows backends.',
      )
      .required('backend'),
  ),
  tool('syscall_stop_monitor', (t) =>
    t.desc('Stop syscall interception and release all captured events.').idempotent(),
  ),
  tool('syscall_capture_events', (t) =>
    t
      .desc('Capture syscall events from the active or last monitoring session.')
      .prop('filter', {
        type: 'object',
        description: 'Optional event filter',
        properties: {
          name: {
            type: 'array',
            description: 'Restrict events to specific syscall names',
            items: { type: 'string' },
          },
          pid: {
            type: 'number',
            description: 'Restrict events to a specific process ID',
          },
        },
      })
      .number('minTimestamp', 'Return only events with timestamp >= this value')
      .number('maxTimestamp', 'Return only events with timestamp <= this value')
      .number('limit', 'Maximum number of most recent events to return after filters', {
        minimum: 1,
      })
      .boolean('includeSummary', 'Include aggregate counts by syscall and PID', {
        default: true,
      })
      .query(),
  ),
  tool('syscall_correlate_js', (t) =>
    t
      .desc('Correlate captured syscalls with likely JavaScript functions.')
      .array('syscallEvents', SYSCALL_EVENT_SCHEMA, 'Syscall events to correlate')
      .required('syscallEvents')
      .query(),
  ),
  tool('syscall_filter', (t) =>
    t
      .desc('Filter captured syscall events by name, PID, or return value.')
      .array('names', { type: 'string' }, 'Syscall names to keep')
      .number('pid', 'Restrict events to a specific process ID')
      .number('returnValueMin', 'Keep events whose returnValue >= this value')
      .number('returnValueMax', 'Keep events whose returnValue <= this value')
      .boolean(
        'errorOnly',
        'Keep only events with returnValue < 0 (syscalls returning an error code)',
        {
          default: false,
        },
      )
      .query(),
  ),
  tool('syscall_get_stats', (t) => t.desc('Get syscall monitoring statistics.').query()),
  tool('syscall_ebpf_trace', (t) =>
    t
      .desc('Trace syscalls on Linux with eBPF. Requires root or CAP_BPF.')
      .number('pid', 'Process ID to trace. 0 = trace all.', { default: 0 })
      .array('syscalls', { type: 'string' }, 'Specific syscall names to trace (empty = all)')
      .number('durationSec', 'Trace duration in seconds', { default: 10, minimum: 1, maximum: 300 })
      .boolean('simulate', 'Use synthetic events when bpftrace is unavailable', { default: false })
      .query(),
  ),
  tool('syscall_resolve_ssn', (t) =>
    t
      .desc(
        'Resolve NT syscall service numbers (SSN) from on-disk ntdll.dll. ' +
          'Parses the export table to extract Zw* → SSN mappings and locates a ' +
          'syscall;ret gadget for direct invocation stubs. Win32 only.',
      )
      .string('ntdllPath', 'Optional custom path to ntdll.dll for offline analysis')
      .query(),
  ),
  tool('syscall_direct_invoke', (t) =>
    t
      .desc(
        'Direct NT syscall invocation guidance. ' +
          'Resolves SSN for a given NT function and returns a stub template ' +
          'with usage instructions for in-process direct syscall invocation. ' +
          'Bypasses user-mode hooks on ntdll.dll. Win32 only.',
      )
      .string('functionName', 'NT function name (e.g. NtOpenProcess, NtAllocateVirtualMemory)')
      .required('functionName'),
  ),
  tool('syscall_stack_capture', (t) =>
    t
      .desc(
        'Correlate captured syscall events with real JS call stacks via debugger integration. ' +
          'Goes beyond static heuristics by querying live CDP call stacks for syscall→JS mapping. ' +
          'Falls back to heuristic-only mode when no debugger is attached.',
      )
      .number('maxEvents', 'Maximum number of recent syscall events to correlate (default: 20)', {
        default: 20,
        minimum: 1,
        maximum: 200,
      })
      .boolean('useDebugger', 'Attempt CDP call stack capture (default: true)', { default: true })
      .query(),
  ),
  tool('syscall_trace_compare', (t) =>
    t
      .desc(
        'Diff two syscall trace snapshots to find appeared/disappeared syscalls and ' +
          'frequency changes. Useful for understanding what OS calls a JS operation triggers. ' +
          'Capture baseline events → perform the operation → capture target events → pass both ' +
          'arrays here. Use syscall_capture_events (or syscall_trace_export) to obtain each snapshot.',
      )
      .array(
        'baselineEvents',
        SYSCALL_EVENT_SCHEMA,
        'Baseline syscall events (before the operation)',
      )
      .array('targetEvents', SYSCALL_EVENT_SCHEMA, 'Target syscall events (after the operation)')
      .number('maxDeltas', 'Maximum frequency delta entries to return (default: 30)', {
        default: 30,
      })
      .required('baselineEvents', 'targetEvents')
      .query(),
  ),
  tool('syscall_trace_export', (t) =>
    t
      .desc(
        'Export captured syscall events to portable NDJSON with optional time-range ' +
          'filtering and deduplication. Returns both structured array and NDJSON string.',
      )
      .number('minTimestamp', 'Filter events with timestamp >= this value')
      .number('maxTimestamp', 'Filter events with timestamp <= this value')
      .boolean('deduplicate', 'Remove duplicate events within a time window', { default: false })
      .number('dedupWindowMs', 'Deduplication time window in ms (default: 100)', { default: 100 })
      .boolean('includeNdjson', 'Include NDJSON string in output (default: true)', {
        default: true,
      })
      .query(),
  ),
  tool('syscall_ebpf_attach', (t) =>
    t
      .desc(
        'Live eBPF syscall attach — spawns a bpftrace process, captures syscall events ' +
          'as structured JSON in real time, and returns them directly. Unlike ' +
          'syscall_ebpf_trace (script-generator), this tool actually runs bpftrace ' +
          'and captures output. Falls back to script mode on non-Linux or when bpftrace ' +
          'is unavailable. Requires bpftrace + CAP_BPF or root on Linux.',
      )
      .number('pid', 'Process ID to trace. 0 = trace all.', { default: 0 })
      .array('syscalls', { type: 'string' }, 'Specific syscall names to trace (empty = all)')
      .number('durationSec', 'Trace duration in seconds', { default: 10, minimum: 1, maximum: 300 })
      .boolean('output', 'Return all captured JSON lines in the raw output', { default: false })
      .boolean('simulate', 'Use synthetic events when bpftrace is unavailable', { default: false })
      .query(),
  ),
  tool('syscall_origin_map', (t) =>
    t
      .desc(
        'Build a unified syscall→JS origin map by integrating live CDP call stacks ' +
          '(syscall_stack_capture) with static timing heuristics (syscall_correlate_js). ' +
          'Aggregates recent syscall events by JavaScript function so callers can see ' +
          'which JS function triggered which syscalls and how often. Debugger stacks ' +
          'are preferred when available; heuristics fill the gaps.',
      )
      .number('maxEvents', 'Maximum number of recent syscall events to analyze (default: 50)', {
        default: 50,
        minimum: 1,
        maximum: 500,
      })
      .boolean('useDebugger', 'Attempt CDP call stack capture (default: true)', { default: true })
      .query(),
  ),
  tool('syscall_pattern_detect', (t) =>
    t
      .desc(
        'Scan captured syscall events for behavioral patterns relevant to reverse ' +
          'engineering: anti-debug probes (ptrace / IsDebuggerPresent), system ' +
          'fingerprinting (uname / getuid), filesystem enumeration (openat + getdents), ' +
          'network beaconing (connect / sendto), process spawning (clone / execve), ' +
          'and Windows registry probing. Returns classified patterns with evidence.',
      )
      .number('maxEvents', 'Maximum number of recent syscall events to scan (default: 200)', {
        default: 200,
        minimum: 1,
        maximum: 2000,
      })
      .query(),
  ),
];
