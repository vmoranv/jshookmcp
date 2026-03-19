import { resolve } from 'node:path';
import type { Phase } from '@tests/e2e/helpers/types';

const WASM_FIXTURE_PATH = resolve(process.cwd(), 'tests', 'e2e', 'fixtures', 'wasm', 'sample.wasm');

export const systemPhases: Phase[] = [
  {
    name: 'Antidebug',
    setup: [],
    tools: [
      'antidebug_detect_protections',
      'antidebug_bypass_all',
      'antidebug_bypass_debugger_statement',
      'antidebug_bypass_console_detect',
      'antidebug_bypass_stack_trace',
      'antidebug_bypass_timing',
    ],
  },
  {
    name: 'Sourcemap',
    concurrent: true,
    setup: [],
    tools: [
      'sourcemap_discover',
      'source_map_extract',
      'sourcemap_fetch_and_parse',
      'sourcemap_reconstruct_tree',
    ],
  },
  {
    name: 'Workflow',
    setup: [],
    tools: [
      'page_script_register',
      'page_script_run',
      'js_bundle_search',
      'webpack_enumerate',
      'web_api_capture_session',
      'api_probe_batch',
      'tab_workflow',
      'script_replace_persist',
    ],
  },
  {
    name: 'Process',
    group: 'compute',
    setup: async (call) => {
      // Find chrome/browser processes to get a real PID for process/memory tools
      await call('process_find', { pattern: 'chrome' });
      await new Promise((r) => setTimeout(r, 200));
    },
    tools: [
      'process_list',
      'process_get',
      'process_windows',
      'process_find',
      'process_find_chromium',
      'process_check_debug_port',
      'process_launch_debug',
    ],
  },
  {
    name: 'Module Enumeration',
    group: 'compute',
    setup: [],
    tools: [
      'check_debug_port',
      'module_list',
      'enumerate_modules',
    ],
  },
  {
    name: 'Memory (read-only)',
    concurrent: true,
    group: 'compute',
    setup: [],
    tools: [
      'memory_list_regions',
      'memory_dump_region',
      'memory_read',
      'memory_scan',
      'memory_scan_filtered',
      'memory_check_protection',
      'memory_audit_export',
    ],
  },
  {
    name: 'Memory (write)',
    concurrent: true,
    group: 'compute',
    setup: [],
    tools: [
      'memory_write',
      'memory_batch_write',
      'memory_protect',
    ],
  },
  {
    name: 'WASM',
    concurrent: true,
    group: 'compute',
    setup: async (call) => {
      // Use local WASM fixture for deterministic testing
      await call('wasm_inspect_sections', { inputPath: WASM_FIXTURE_PATH, sections: 'headers' }, 15_000);
    },
    tools: [
      'wasm_dump',
      'wasm_inspect_sections',
      'wasm_decompile',
      'wasm_disassemble',
      'wasm_optimize',
      'wasm_memory_inspect',
      'wasm_vmp_trace',
      'wasm_offline_run',
    ],
  },
  { name: 'Platform', concurrent: true, group: 'compute', setup: [], tools: ['asar_extract', 'electron_attach', 'electron_inspect_app'] },
  {
    name: 'Miniapp',
    concurrent: true,
    group: 'compute',
    setup: [],
    tools: ['miniapp_pkg_scan', 'miniapp_pkg_unpack', 'miniapp_pkg_analyze'],
  },
  {
    name: 'Injection',
    concurrent: true,
    group: 'compute',
    setup: [],
    tools: [
      'inject_dll',
      'module_inject_dll',
      'inject_shellcode',
      'module_inject_shellcode',
    ],
  },
  {
    name: 'External Bridges',
    concurrent: true,
    group: 'compute',
    setup: [],
    tools: ['frida_bridge', 'jadx_bridge'],
  },
  {
    name: 'Extension Workflows',
    concurrent: true,
    group: 'compute',
    setup: ['reload_extensions', 'list_extension_workflows'],
    tools: [
      'install_extension',
      'extension_execute_in_context',
      'batch_register',
      'list_extension_workflows',
      'run_extension_workflow',
      'register_account_flow',
    ],
  },
  {
    name: 'Process Kill (last)',
    group: 'cleanup',
    setup: [],
    tools: ['process_kill'],
  },
];
