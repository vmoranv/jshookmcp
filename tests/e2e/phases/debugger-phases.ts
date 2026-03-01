import type { Phase } from '../helpers/types.js';

export const debuggerPhases: Phase[] = [
  { name: 'Debugger Enable', setup: ['debugger_enable'], tools: [] },
  {
    name: 'Scripts & Source',
    setup: [],
    tools: ['get_all_scripts', 'get_script_source', 'get_detailed_data', 'collect_code', 'search_in_scripts'],
  },
  {
    name: 'Breakpoints',
    setup: [],
    tools: ['breakpoint_set_on_exception', 'breakpoint_set', 'breakpoint_list', 'breakpoint_remove'],
  },
  {
    name: 'XHR & Event Breakpoints',
    setup: [],
    tools: [
      'xhr_breakpoint_set', 'xhr_breakpoint_list', 'xhr_breakpoint_remove',
      'event_breakpoint_set', 'event_breakpoint_set_category',
      'event_breakpoint_list', 'event_breakpoint_remove',
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
    setup: [],
    tools: [
      'debugger_evaluate_global', 'debugger_pause', 'debugger_wait_for_paused',
      'debugger_get_paused_state', 'debugger_evaluate',
      'get_call_stack', 'get_scope_variables_enhanced', 'get_object_properties',
      'debugger_step_over', 'debugger_step_into', 'debugger_step_out',
      'debugger_resume',
    ],
  },
  {
    name: 'Debugger Session',
    setup: [],
    tools: ['debugger_save_session', 'debugger_list_sessions', 'debugger_export_session'],
  },
];
