import type { Phase } from '@tests/e2e/helpers/types';

export const coordinationPhases: Phase[] = [
  {
    name: 'Coordination Tasks',
    group: 'compute-browser',
    setup: async () => {},
    tools: [
      'create_task_handoff',
      'append_session_insight',
      'get_task_context',
      'complete_task_handoff',
      'save_page_snapshot',
      'list_page_snapshots',
      'restore_page_snapshot',
    ],
  },
];
