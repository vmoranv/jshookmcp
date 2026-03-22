import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Coordination domain tools — enable Planner/Specialist Agent handoff.
 *
 * Provides structured task delegation, context passing, and session-level
 * insight accumulation across multi-agent workflows operating on the same
 * jshookmcp server instance.
 */

export const coordinationTools: Tool[] = [
  {
    name: 'create_task_handoff',
    description:
      'Create a sub-task handoff for specialist agent delegation.\n\n' +
      'Use this as a Planner Agent to delegate work to a Specialist. ' +
      'Automatically captures the current page URL (if any) and injects it into the task context.\n\n' +
      'Returns:\n' +
      '- taskId: unique identifier to track this handoff\n' +
      '- status: "pending"\n' +
      '- pageUrl: auto-captured active page URL\n\n' +
      'Example:\n' +
      '  create_task_handoff({ description: "Analyze API surface of current page", targetDomain: "network" })',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Clear description of what the specialist should accomplish',
        },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional constraints for the specialist (e.g. "do not navigate away", "read-only analysis")',
        },
        targetDomain: {
          type: 'string',
          description:
            'Suggested domain for the specialist (e.g. "network", "debugger", "browser"). Advisory only.',
        },
      },
      required: ['description'],
    },
    annotations: {
      title: 'Create Task Handoff',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'complete_task_handoff',
    description:
      'Complete a previously created task handoff with results.\n\n' +
      'Use this as a Specialist Agent to report execution results back to the Planner. ' +
      'Once completed, the handoff status transitions to "completed" and cannot be modified.\n\n' +
      'Example:\n' +
      '  complete_task_handoff({\n' +
      '    taskId: "abc-123",\n' +
      '    summary: "Found 5 API endpoints with Bearer auth",\n' +
      '    keyFindings: ["POST /api/v1/login uses JWT", "X-Signature header is HMAC-SHA256"]\n' +
      '  })',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID from create_task_handoff',
        },
        summary: {
          type: 'string',
          description: 'Concise summary of what was accomplished',
        },
        keyFindings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key discoveries or results from the task',
        },
        artifacts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths to generated artifact files (HAR exports, reports, etc.)',
        },
      },
      required: ['taskId', 'summary'],
    },
    annotations: {
      title: 'Complete Task Handoff',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'get_task_context',
    description:
      'Read the context of a task handoff.\n\n' +
      'Returns the full handoff record including description, constraints, status, ' +
      'page URL, and any completion data. If no taskId is provided, returns all active handoffs.\n\n' +
      'Also returns accumulated session insights when no taskId is specified.\n\n' +
      'Example:\n' +
      '  get_task_context()                  // list all handoffs + session insights\n' +
      '  get_task_context({ taskId: "abc" }) // specific handoff details',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Specific task ID to retrieve (omit for all active handoffs)',
        },
      },
    },
    annotations: {
      title: 'Get Task Context',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  {
    name: 'append_session_insight',
    description:
      'Append a discovery to the session-level knowledge accumulator.\n\n' +
      'Session insights persist for the lifetime of the MCP session and are shared ' +
      'across all handoffs. Use this to record cross-cutting findings that any agent ' +
      'in the session should know about.\n\n' +
      'Categories: "auth", "crypto", "api", "anti_debug", "architecture", "vulnerability", "other"\n\n' +
      'Example:\n' +
      '  append_session_insight({\n' +
      '    category: "auth",\n' +
      '    content: "JWT stored in localStorage under key \'access_token\'",\n' +
      '    confidence: 0.95\n' +
      '  })',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['auth', 'crypto', 'api', 'anti_debug', 'architecture', 'vulnerability', 'other'],
          description: 'Category of the insight',
        },
        content: {
          type: 'string',
          description: 'The insight content',
        },
        confidence: {
          type: 'number',
          description: 'Confidence level 0.0-1.0 (default: 1.0)',
          minimum: 0,
          maximum: 1,
        },
      },
      required: ['category', 'content'],
    },
    annotations: {
      title: 'Append Session Insight',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  // ── Page Snapshot tools ──

  {
    name: 'save_page_snapshot',
    description:
      'Save a snapshot of the current page state (URL, cookies, localStorage, sessionStorage).\n\n' +
      'Useful for checkpoint/restore workflows during reverse engineering — ' +
      'save state before invasive operations, restore if needed.\n\n' +
      'Example:\n' +
      '  save_page_snapshot()\n' +
      '  save_page_snapshot({ label: "before-login" })',
    inputSchema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'Optional human-readable label for this snapshot',
        },
      },
    },
    annotations: {
      title: 'Save Page Snapshot',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'restore_page_snapshot',
    description:
      'Restore a previously saved page snapshot.\n\n' +
      'Navigates to the saved URL and reinjects cookies, localStorage, and sessionStorage.\n\n' +
      'Example:\n' +
      '  restore_page_snapshot({ snapshotId: "a1b2c3d4" })',
    inputSchema: {
      type: 'object',
      properties: {
        snapshotId: {
          type: 'string',
          description: 'Snapshot ID from save_page_snapshot',
        },
      },
      required: ['snapshotId'],
    },
    annotations: {
      title: 'Restore Page Snapshot',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  {
    name: 'list_page_snapshots',
    description:
      'List all saved page snapshots in the current session.\n\n' +
      'Returns snapshot IDs, URLs, labels, and state counts.\n\n' +
      'Example:\n' +
      '  list_page_snapshots()',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      title: 'List Page Snapshots',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];
