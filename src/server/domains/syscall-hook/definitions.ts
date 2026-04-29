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
      .desc('Start syscall monitoring using ETW, strace, or dtrace.')
      .enum('backend', BACKEND_OPTIONS, 'Syscall capture backend')
      .number('pid', 'Optional PID to scope monitoring to a single process')
      .boolean('simulate', 'Use synthetic events instead of a real system tracer', {
        default: false,
      })
      .required('backend'),
  ),
  tool('syscall_stop_monitor', (t) => t.desc('Stop syscall monitoring.').idempotent()),
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
      .desc('Filter captured syscall events by syscall name.')
      .array('names', { type: 'string' }, 'Syscall names to keep')
      .query(),
  ),
  tool('syscall_get_stats', (t) => t.desc('Get syscall monitoring statistics.').query()),
  tool('syscall_ebpf_trace', (t) =>
    t
      .desc('Trace syscalls via Linux eBPF/bpftrace. Requires root or CAP_BPF.')
      .number('pid', 'Process ID to trace. 0 = trace all.', { default: 0 })
      .array('syscalls', { type: 'string' }, 'Specific syscall names to trace (empty = all)')
      .number('durationSec', 'Trace duration in seconds', { default: 10, minimum: 1, maximum: 300 })
      .boolean('simulate', 'Use synthetic events when bpftrace is unavailable', { default: false })
      .query(),
  ),
];
