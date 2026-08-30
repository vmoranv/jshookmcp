import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';

/**
 * MCP 2.0 Tasks protocol — client-facing polling surface.
 *
 * Long-running tools (frida_memory_scan, pcapng_read, ...) accept `async: true`
 * and return a `taskId` immediately. Clients then poll the task lifecycle with
 * these tools instead of blocking the original tools/call until timeout.
 */
export const taskTools: Tool[] = [
  tool('tasks_get', (t) =>
    t
      .desc(
        'Get the current state of a background task (MCP 2.0 Tasks protocol). ' +
          'Returns status (working/completed/failed/cancelled), progress and message.',
      )
      .string('taskId', 'Task identifier returned by the originating long-running tool call')
      .required('taskId')
      .readOnly(),
  ),
  tool('tasks_result', (t) =>
    t
      .desc(
        'Fetch the payload/result of a background task (MCP 2.0 Tasks protocol). ' +
          'Optionally waits (polls) up to waitMs for the task to reach a terminal state.',
      )
      .string('taskId', 'Task identifier returned by the originating long-running tool call')
      .number(
        'waitMs',
        'Maximum time in milliseconds to wait for a terminal state before returning current status',
        { default: 5000, minimum: 0, maximum: 30000 },
      )
      .required('taskId')
      .readOnly(),
  ),
  tool('tasks_cancel', (t) =>
    t
      .desc(
        'Request cancellation of a background task (MCP 2.0 Tasks protocol). ' +
          'Only tasks in the working state can be cancelled; the tool-defined cancel handler runs if present.',
      )
      .string('taskId', 'Task identifier returned by the originating long-running tool call')
      .required('taskId')
      .destructive(),
  ),
  tool('tasks_list', (t) =>
    t
      .desc(
        'List recent background tasks tracked by the server (MCP 2.0 Tasks protocol). ' +
          'Expired tasks are pruned automatically based on their TTL.',
      )
      .string('status', 'Optional status filter: working, completed, failed or cancelled')
      .string('name', 'Optional exact-name filter (e.g. frida_memory_scan)')
      .number('limit', 'Maximum number of tasks to return (most recent first)', {
        default: 50,
        minimum: 1,
        maximum: 500,
      })
      .readOnly(),
  ),
];
