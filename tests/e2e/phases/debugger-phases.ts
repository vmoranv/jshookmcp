import type { Phase } from '@tests/e2e/helpers/types';

export const debuggerPhases: Phase[] = [
  { name: 'Debugger Enable', setup: [], tools: ['debugger_lifecycle'] },
  {
    name: 'Scripts & Source',
    setup: [],
    tools: [
      'get_all_scripts',
      'get_script_source',
      'get_detailed_data',
      'collect_code',
      'search_in_scripts',
      'extract_function_tree',
    ],
  },
  {
    name: 'Breakpoints',
    setup: [],
    tools: [
      'breakpoint_set_on_exception',
      'breakpoint_set',
      'breakpoint_list',
      'breakpoint_remove',
    ],
  },
  {
    name: 'XHR & Event Breakpoints',
    setup: [],
    tools: [
      'xhr_breakpoint_set',
      'xhr_breakpoint_list',
      'xhr_breakpoint_remove',
      'event_breakpoint_set',
      'event_breakpoint_set_category',
      'event_breakpoint_list',
      'event_breakpoint_remove',
    ],
  },
  {
    name: 'Watch Expressions',
    setup: [],
    tools: ['watch_add', 'watch_list', 'watch_evaluate_all', 'watch_remove', 'watch_clear_all'],
  },
  { name: 'Blackbox', setup: [], tools: ['blackbox_add', 'blackbox_add_common', 'blackbox_list'] },
  {
    name: 'Debugger Execution (pause/eval/resume)',
    setup: async (call) => {
      // Use debugger_pause directly for deterministic pause
      const pauseResult = await call('debugger_pause', {});
      const pauseFailed =
        typeof pauseResult === 'object' &&
        pauseResult !== null &&
        (pauseResult as { success?: unknown }).success === false;

      if (pauseFailed) {
        return;
      }

      await call('debugger_wait_for_paused', { timeout: 5000 });
    },
    tools: [
      'debugger_pause',
      'debugger_wait_for_paused',
      'debugger_get_paused_state',
      'get_call_stack',
      'debugger_evaluate',
      'get_scope_variables_enhanced',
      'get_object_properties',
      'debugger_step',
      'debugger_resume',
    ],
  },
  {
    name: 'Debugger Session',
    concurrent: true,
    setup: [],
    tools: ['debugger_session'],
  },
];
