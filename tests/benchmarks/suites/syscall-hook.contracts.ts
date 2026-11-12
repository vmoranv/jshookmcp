/**
 * syscall-hook contract cases — the 8 monitoring/backend tools that need an
 * ETW/strace/dtrace back end or a direct-syscall target.
 *
 * Ground truth on any machine:
 *  - an unsupported backend is refused by name with the allowed list
 *  - stop/export/stats on an idle monitor report zero counters, never
 *    synthesized events
 *  - a backend available on the platform produces a runnable script or a
 *    real SSN/stub — anything else must fail explicitly
 */
import { SyscallHookHandlers } from '@server/domains/syscall-hook/handlers';
import { body } from '../harness';

const handlers = new SyscallHookHandlers();
const text = (v: unknown): Record<string, unknown> => body(v) as Record<string, unknown>;

const zeroEventStream = (b: Record<string, unknown>, label: string): true | string => {
  const events = b['events'];
  if (!Array.isArray(events))
    return `${label}: events must be an array: ${JSON.stringify(b).slice(0, 160)}`;
  if (events.length !== 0) return `${label}: must not emit events from an idle monitor`;
  if (typeof b['eventCount'] === 'number' && b['eventCount'] !== 0)
    return `${label}: eventCount ${String(b['eventCount'])} should be 0`;
  if (typeof b['count'] === 'number' && b['count'] !== 0)
    return `${label}: count ${String(b['count'])} should be 0`;
  return true;
};

export const syscallContractCases = [
  {
    name: 'syscall_start_monitor/rejects-unknown-backend',
    tool: 'syscall_start_monitor',
    origin: 'homemade' as const,
    reference:
      'argument contract: the backend must be one of etw/strace/dtrace; anything else is refused with the allowed list',
    run: async () =>
      JSON.stringify(text(await handlers.handleSyscallStartMonitorTool({ backend: 'nope' }))),
    validate: (v: unknown) => {
      const s = String(v);
      return /etw, strace, dtrace/.test(s) ? true : `expected the backend list: ${s.slice(0, 200)}`;
    },
  },
  {
    name: 'syscall_start_monitor/reports-platform-capability',
    tool: 'syscall_start_monitor',
    origin: 'homemade' as const,
    reference:
      'capability contract: a backend unavailable on this platform is refused by naming it AND the supported set — never reported as started',
    run: async () =>
      JSON.stringify(text(await handlers.handleSyscallStartMonitorTool({ backend: 'strace' }))),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Record<string, unknown>;
      if (b['ok'] === true) return true; // strace host: actually started
      if (!/not available on platform/i.test(String(b['error'] ?? '')))
        return `unexpected refusal: ${String(b['error'])}`;
      if (
        !Array.isArray(b['supportedBackends']) ||
        (b['supportedBackends'] as unknown[]).length === 0
      )
        return `must report the supported backend set`;
      return true;
    },
  },
  {
    name: 'syscall_stop_monitor/idle-stats-are-zero',
    tool: 'syscall_stop_monitor',
    origin: 'homemade' as const,
    reference:
      'monitor contract: stopping an idle monitor reports stopped=true with zero captured/dropped events',
    run: async () => JSON.stringify(text(await handlers.handleSyscallStopMonitorTool({}))),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Record<string, unknown>;
      if (b['success'] === false) return `stop failed: ${String(v).slice(0, 160)}`;
      const stats = b['stats'] as Record<string, unknown> | undefined;
      if (!stats) return `stats missing: ${String(v).slice(0, 160)}`;
      if (stats['eventsCaptured'] !== 0) return `eventsCaptured should be 0 on an idle monitor`;
      if (typeof stats['backend'] !== 'string') return `backend should be reported`;
      return true;
    },
  },
  {
    name: 'syscall_capture_events/idle-stream-is-empty',
    tool: 'syscall_capture_events',
    origin: 'homemade' as const,
    reference:
      'capture contract: with nothing captured the event stream is empty and every counter is zero — no placeholder rows',
    run: async () => JSON.stringify(text(await handlers.handleSyscallCaptureEventsTool({}))),
    validate: (v: unknown) =>
      zeroEventStream(JSON.parse(String(v)) as Record<string, unknown>, 'capture'),
  },
  {
    name: 'syscall_stack_capture/idle-stream-is-empty',
    tool: 'syscall_stack_capture',
    origin: 'homemade' as const,
    reference:
      'stack contract: an idle capture reports zero events and zero stacks, with the mode it used',
    run: async () => JSON.stringify(text(await handlers.handleSyscallStackCaptureTool({}))),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Record<string, unknown>;
      const result = zeroEventStream(b, 'stack');
      if (result !== true) return result;
      if (b['withStacks'] !== 0 || b['withHeuristicsOnly'] !== 0)
        return `stack counters should be 0: ${JSON.stringify(b).slice(0, 160)}`;
      return typeof b['mode'] === 'string' ? true : `mode missing`;
    },
  },
  {
    name: 'syscall_trace_export/idle-export-is-empty',
    tool: 'syscall_trace_export',
    origin: 'homemade' as const,
    reference:
      'export contract: exporting an idle trace reports zero events and echoes the active filters',
    run: async () => JSON.stringify(text(await handlers.handleSyscallTraceExportTool({}))),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Record<string, unknown>;
      const result = zeroEventStream(b, 'export');
      if (result !== true) return result;
      if (b['totalCaptured'] !== 0) return `totalCaptured should be 0`;
      return b['filters'] && typeof b['filters'] === 'object' ? true : `filters missing`;
    },
  },
  {
    name: 'syscall_ebpf_attach/emits-runnable-script',
    tool: 'syscall_ebpf_attach',
    origin: 'homemade' as const,
    reference:
      'eBPF contract: attach returns a script that traces a concrete syscall set, with the syscall list echoed — never an empty program',
    run: async () => JSON.stringify(text(await handlers.handleSyscallEbpfAttachTool({}))),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Record<string, unknown>;
      if (b['success'] === false) {
        return /eBPF|bpftrace|not available/i.test(String(b['error'] ?? ''))
          ? true
          : `unexpected failure: ${String(b['error']).slice(0, 160)}`;
      }
      const syscalls = b['syscallsTraced'];
      if (!Array.isArray(syscalls) || syscalls.length === 0)
        return `syscallsTraced must be non-empty`;
      const script = String(b['script'] ?? '');
      if (!/bpftrace|tracepoint|sys_enter/.test(script))
        return `script does not look like a tracer: ${script.slice(0, 120)}`;
      return true;
    },
  },
  {
    name: 'syscall_resolve_ssn/reports-ntdll-entries',
    tool: 'syscall_resolve_ssn',
    origin: 'homemade' as const,
    reference:
      'SSN contract: on win32 the resolver reads the real ntdll export table and reports named Zw* entries with their SSNs — a non-win32 host must say so instead',
    run: async () => JSON.stringify(text(await handlers.handleSyscallResolveSsnTool({}))),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Record<string, unknown>;
      if (b['success'] === false)
        return String(b['error'] ?? '').length > 0 ? true : `no reason given`;
      if (b['platform'] !== 'win32') return `expected platform win32 or an explicit refusal`;
      const syscalls = b['syscalls'];
      if (!Array.isArray(syscalls) || syscalls.length === 0) return `expected resolved syscalls`;
      for (const entry of syscalls as Array<Record<string, unknown>>) {
        if (!String(entry['name'] ?? '').startsWith('Zw')) return `entry should be a Zw* name`;
        if (typeof entry['ssn'] !== 'number') return `entry should carry a numeric SSN`;
      }
      return true;
    },
  },
  {
    name: 'syscall_direct_invoke/requires-functionName',
    tool: 'syscall_direct_invoke',
    origin: 'homemade' as const,
    reference:
      'argument contract: direct invocation needs the ntdll function name and names it when absent',
    run: async () => JSON.stringify(text(await handlers.handleSyscallDirectInvokeTool({}))),
    validate: (v: unknown) => {
      const s = String(v);
      return /functionName/.test(s) ? true : `expected a functionName error: ${s.slice(0, 160)}`;
    },
  },
  {
    name: 'syscall_direct_invoke/resolves-ssn-and-stub',
    tool: 'syscall_direct_invoke',
    origin: 'homemade' as const,
    reference:
      'stub contract: a known ntdll function resolves to a numeric SSN and a usage description, or the host refuses by naming syscall resolution',
    run: async () =>
      JSON.stringify(
        text(await handlers.handleSyscallDirectInvokeTool({ functionName: 'ZwClose' })),
      ),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Record<string, unknown>;
      if (b['success'] === false) {
        return /ntdll|syscall|not supported|win32/i.test(String(b['error'] ?? ''))
          ? true
          : `unexpected failure: ${String(b['error']).slice(0, 160)}`;
      }
      if (typeof b['ssn'] !== 'number' && typeof b['ssn'] !== 'string')
        return `expected an SSN: ${JSON.stringify(b).slice(0, 200)}`;
      return String(b['usage'] ?? b['stub'] ?? '').length > 0
        ? true
        : `expected usage/stub guidance`;
    },
  },
];
