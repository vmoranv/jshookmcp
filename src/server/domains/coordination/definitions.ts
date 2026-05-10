import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const coordinationTools: Tool[] = [
  tool('create_task_handoff', (t) =>
    t
      .desc('Create an in-session task handoff.')
      .string('description', 'Task description')
      .array('constraints', { type: 'string' }, 'Constraints for the specialist')
      .string('targetDomain', 'Suggested domain for the specialist')
      .string('decision', 'Key design decision made in this phase')
      .array('risks', { type: 'string' }, 'Identified risks for the specialist')
      .array('nextSteps', { type: 'string' }, 'Concrete next actions for the specialist')
      .required('description'),
  ),
  tool('complete_task_handoff', (t) =>
    t
      .desc('Mark a task handoff as completed.')
      .string('taskId', 'Task ID from create_task_handoff')
      .string('summary', 'Concise summary of what was accomplished')
      .array('keyFindings', { type: 'string' }, 'Key discoveries or results')
      .array('artifacts', { type: 'string' }, 'Paths to generated artifact files')
      .required('taskId', 'summary'),
  ),
  tool('get_task_context', (t) =>
    t
      .desc('Read task handoff context.')
      .string('taskId', 'Optional task ID to read a single handoff')
      .query(),
  ),
  tool('append_session_insight', (t) =>
    t
      .desc('Record an insight for the current session.')
      .string('category', 'Insight category')
      .string('content', 'The insight content')
      .number('confidence', 'Confidence level 0.0-1.0', { minimum: 0, maximum: 1, default: 1 })
      .required('category', 'content'),
  ),

  // ── Page Snapshots ──
  tool('save_page_snapshot', (t) =>
    t
      .desc('Save current page state.')
      .string('label', 'Human-readable label for this snapshot')
      .readOnly(),
  ),
  tool('restore_page_snapshot', (t) =>
    t
      .desc('Restore a saved page snapshot.')
      .string('snapshotId', 'Snapshot ID from save_page_snapshot')
      .required('snapshotId')
      .idempotent(),
  ),
  tool('list_page_snapshots', (t) => t.desc('List saved page snapshots.').query()),
];
