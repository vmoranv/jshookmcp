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
      {
        tool: 'breakpoint',
        name: 'breakpoint_set_on_exception',
        argsKey: 'breakpoint_set_on_exception',
      },
      { tool: 'breakpoint', name: 'breakpoint_set', argsKey: 'breakpoint_set' },
      { tool: 'breakpoint', name: 'breakpoint_list', argsKey: 'breakpoint_list' },
      { tool: 'breakpoint', name: 'breakpoint_remove', argsKey: 'breakpoint_remove' },
    ],
  },
  {
    name: 'XHR & Event Breakpoints',
    setup: [],
    tools: [
      { tool: 'breakpoint', name: 'xhr_breakpoint_set', argsKey: 'xhr_breakpoint_set' },
      { tool: 'breakpoint', name: 'xhr_breakpoint_list', argsKey: 'xhr_breakpoint_list' },
      { tool: 'breakpoint', name: 'xhr_breakpoint_remove', argsKey: 'xhr_breakpoint_remove' },
      { tool: 'breakpoint', name: 'event_breakpoint_set', argsKey: 'event_breakpoint_set' },
      {
        tool: 'breakpoint',
        name: 'event_breakpoint_set_category',
        argsKey: 'event_breakpoint_set_category',
      },
      { tool: 'breakpoint', name: 'event_breakpoint_list', argsKey: 'event_breakpoint_list' },
      { tool: 'breakpoint', name: 'event_breakpoint_remove', argsKey: 'event_breakpoint_remove' },
    ],
  },
  {
    name: 'Watch Expressions',
    setup: [],
    tools: [
      { tool: 'watch', name: 'watch_add', argsKey: 'watch_add' },
      { tool: 'watch', name: 'watch_list', argsKey: 'watch_list' },
      { tool: 'watch', name: 'watch_evaluate_all', argsKey: 'watch_evaluate_all' },
      { tool: 'watch', name: 'watch_remove', argsKey: 'watch_remove' },
      { tool: 'watch', name: 'watch_clear_all', argsKey: 'watch_clear_all' },
    ],
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
