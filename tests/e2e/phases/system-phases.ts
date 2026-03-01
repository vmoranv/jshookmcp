import type { Phase } from '../helpers/types.js';

export const systemPhases: Phase[] = [
  {
    name: 'Antidebug',
    setup: [],
    tools: [
      'antidebug_detect_protections', 'antidebug_bypass_all',
      'antidebug_bypass_debugger_statement', 'antidebug_bypass_console_detect',
      'antidebug_bypass_stack_trace', 'antidebug_bypass_timing',
    ],
  },
  {
    name: 'Sourcemap',
    setup: [],
    tools: ['sourcemap_discover', 'source_map_extract', 'sourcemap_fetch_and_parse', 'sourcemap_reconstruct_tree'],
  },
  {
    name: 'Workflow',
    setup: [],
    tools: [
      'page_script_register', 'page_script_run',
      'js_bundle_search', 'webpack_enumerate',
      'web_api_capture_session', 'api_probe_batch',
      'tab_workflow', 'script_replace_persist',
    ],
  },
  {
    name: 'Process',
    setup: [],
    tools: ['process_list', 'process_get', 'process_windows', 'process_find', 'process_find_chromium', 'process_check_debug_port', 'process_launch_debug'],
  },
  {
    name: 'Memory (read-only)',
    setup: [],
    tools: ['memory_list_regions', 'memory_dump_region', 'memory_read', 'memory_scan', 'memory_scan_filtered', 'memory_check_protection', 'enumerate_modules'],
  },
  {
    name: 'WASM',
    setup: [],
    tools: ['wasm_dump', 'wasm_inspect_sections', 'wasm_decompile', 'wasm_disassemble', 'wasm_optimize', 'wasm_memory_inspect', 'wasm_vmp_trace'],
  },
  { name: 'Platform', setup: [], tools: ['asar_extract'] },
];
