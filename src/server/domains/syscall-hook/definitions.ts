import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

const BACKEND_OPTIONS = ['etw', 'strace', 'dtrace'];

const SYSCALL_EVENT_SCHEMA = {
  type: 'object',
  properties: {
    timestamp: { type: 'number', description: 'Unix timestamp in milliseconds' },
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
  tool('syscall_start_monitor')
    .desc('Start syscall monitoring using ETW, strace, or dtrace.')
    .enum('backend', BACKEND_OPTIONS, 'Syscall capture backend')
    .number('pid', 'Optional PID to scope monitoring to a single process')
    .required('backend')
    .build(),

  tool('syscall_stop_monitor').desc('Stop syscall monitoring.').idempotent().build(),

  tool('syscall_capture_events')
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
    .readOnly()
    .idempotent()
    .build(),

  tool('syscall_correlate_js')
    .desc('Correlate captured syscalls with likely JavaScript functions.')
    .array('syscallEvents', SYSCALL_EVENT_SCHEMA, 'Syscall events to correlate')
    .required('syscallEvents')
    .readOnly()
    .idempotent()
    .build(),

  tool('syscall_filter')
    .desc('Filter captured syscall events by syscall name.')
    .array('names', { type: 'string' }, 'Syscall names to keep')
    .readOnly()
    .idempotent()
    .build(),

  tool('syscall_get_stats')
    .desc('Get syscall monitoring statistics.')
    .readOnly()
    .idempotent()
    .build(),
];
