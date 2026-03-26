import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const coordinationTools: Tool[] = [
  tool('create_task_handoff')
    .desc('Create a sub-task handoff for specialist agent delegation. Auto-captures active page URL.')
    .string('description', 'What the specialist should accomplish')
    .array('constraints', { type: 'string' }, 'Constraints for the specialist')
    .string('targetDomain', 'Suggested domain for the specialist')
    .required('description')
    .build(),

  tool('complete_task_handoff')
    .desc('Complete a task handoff with results. Transitions status to completed.')
    .string('taskId', 'Task ID from create_task_handoff')
    .string('summary', 'Concise summary of what was accomplished')
    .array('keyFindings', { type: 'string' }, 'Key discoveries or results')
    .array('artifacts', { type: 'string' }, 'Paths to generated artifact files')
    .required('taskId', 'summary')
    .build(),

  tool('get_task_context')
    .desc('Read task handoff context. Without taskId returns all active handoffs + session insights.')
    .string('taskId', 'Specific task ID to retrieve')
    .readOnly()
    .idempotent()
    .build(),

  tool('append_session_insight')
    .desc('Append a discovery to the session-level knowledge accumulator shared across handoffs')
    .enum('category', ['auth', 'crypto', 'api', 'anti_debug', 'architecture', 'vulnerability', 'other'], 'Insight category')
    .string('content', 'The insight content')
    .prop('confidence', {
      type: 'number',
      description: 'Confidence level 0.0-1.0',
      minimum: 0,
      maximum: 1,
    })
    .required('category', 'content')
    .build(),

  // ── Page Snapshots ──

  tool('save_page_snapshot')
    .desc('Save current page state (URL, cookies, storage) for checkpoint/restore workflows')
    .string('label', 'Human-readable label for this snapshot')
    .readOnly()
    .build(),

  tool('restore_page_snapshot')
    .desc('Restore a saved page snapshot — navigates to URL and reinjects cookies and storage')
    .string('snapshotId', 'Snapshot ID from save_page_snapshot')
    .required('snapshotId')
    .idempotent()
    .build(),

  tool('list_page_snapshots')
    .desc('List all saved page snapshots in the current session')
    .readOnly()
    .idempotent()
    .build(),
];
