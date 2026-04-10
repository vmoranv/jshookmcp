/**
 * Full E2E sequence with detailed timing - find exact hanging test
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TARGET = 'https://vmoranv.github.io/jshookmcp/';

// All 210 E2E tools in order
const TOOLS = [
  // Maintenance phase (indices 0-9)
  ['get_token_budget_stats', {}],
  ['manual_token_cleanup', {}],
  ['reset_token_budget', {}],
  ['get_cache_stats', {}],
  ['smart_cache_cleanup', {}],
  ['cleanup_artifacts', {}],
  ['doctor_environment', {}],
  ['list_extensions', {}],
  ['reload_extensions', {}],
  ['browse_extension_registry', {}],
  // Browser Launch & Navigation (10-50)
  ['browser_launch', { headless: false }],
  ['page_navigate', { url: TARGET, waitUntil: 'load', timeout: 15000 }],
  ['browser_status', {}],
  ['browser_list_tabs', {}],
  ['browser_select_tab', { index: 0 }],
  ['page_get_performance', {}],
  ['dom_query_selector', { selector: 'body' }],
  ['dom_query_all', { selector: 'div' }],
  ['dom_get_structure', { selector: 'body', depth: 2 }],
  ['dom_find_clickable', {}],
  ['dom_find_by_text', { text: 'test' }],
  ['dom_get_xpath', { selector: 'body' }],
  ['dom_is_in_viewport', { selector: 'body' }],
  ['dom_get_computed_style', { selector: 'body' }],
  ['page_click', { selector: 'body' }],
  ['page_type', { selector: 'body', text: 'e2e' }],
  ['page_hover', { selector: 'body' }],
  ['page_scroll', { direction: 'down', amount: 100 }],
  ['page_back', {}],
  ['page_forward', {}],
  ['page_reload', {}],
  ['page_press_key', { key: 'Escape' }],
  ['page_wait_for_selector', { selector: 'body', timeout: 3000 }],
  ['page_evaluate', { code: 'document.title' }],
  ['page_inject_script', { script: 'window.__e2e_injected = true;' }],
  ['page_get_all_links', {}],
  ['page_screenshot', { selector: ['.VPNav', '.VPHero', '.VPFeatures'] }],
  ['page_set_viewport', { width: 1280, height: 720 }],
  ['page_emulate_device', { device: 'iPhone 14' }],
  ['page_get_cookies', {}],
  ['page_set_cookies', { cookies: [{ name: 'e2e', value: '1', domain: '.vmoranv.github.io' }] }],
  ['page_clear_cookies', {}],
  ['page_get_local_storage', {}],
  ['page_set_local_storage', { key: 'e2e_test', value: 'hello' }],
  ['indexeddb_dump', {}],
  ['page_select', { selector: '#test_select_e2e', values: ['b'] }],
  ['stealth_inject', {}],
  [
    'stealth_set_user_agent',
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Browser/120.0.0.0' },
  ],
  ['captcha_detect', {}],
  ['captcha_config', { provider: '2captcha', apiKey: 'test' }],
  ['camoufox_server_status', {}],
  ['human_mouse', { selector: 'body' }],
  ['human_scroll', { direction: 'down', amount: 200 }],
  ['human_typing', { selector: 'body', text: 'e2e' }],
  // Debugger phase (55-94)
  ['debugger_enable', {}],
  ['get_all_scripts', {}],
  ['get_script_source', { url: TARGET }],
  ['get_detailed_data', { detailId: '__placeholder__' }],
  ['collect_code', { url: TARGET, returnSummaryOnly: true }],
  ['search_in_scripts', { keyword: 'fetch' }],
  ['breakpoint_set_on_exception', { state: 'all' }],
  ['breakpoint_set', { url: TARGET, lineNumber: 1 }],
  ['breakpoint_list', {}],
  ['breakpoint_remove', { breakpointId: '__placeholder__' }],
  ['xhr_breakpoint_set', { urlPattern: '/api/' }],
  ['xhr_breakpoint_list', {}],
  ['xhr_breakpoint_remove', { id: '0' }],
  ['event_breakpoint_set', { eventName: 'click' }],
  ['event_breakpoint_set_category', { category: 'mouse' }],
  ['event_breakpoint_list', {}],
  ['event_breakpoint_remove', { id: '0' }],
  ['watch_add', { expression: 'window.location.href' }],
  ['watch_list', {}],
  ['watch_evaluate_all', {}],
  ['watch_remove', { id: '0' }],
  ['blackbox_add', { urlPattern: '/node_modules/' }],
  ['blackbox_add_common', {}],
  ['blackbox_list', {}],
  ['debugger_evaluate_global', { expression: '1+1' }],
  ['debugger_pause', {}],
  ['debugger_wait_for_paused', { timeout: 5000 }],
  ['debugger_get_paused_state', {}],
  ['debugger_evaluate', { expression: '1' }],
  ['get_call_stack', {}],
  ['get_scope_variables_enhanced', {}],
  ['get_object_properties', { objectId: '0' }],
  ['debugger_step_over', {}],
  ['debugger_step_into', {}],
  ['debugger_step_out', {}],
  ['debugger_resume', {}],
  ['debugger_save_session', {}],
  ['debugger_list_sessions', {}],
  ['debugger_export_session', {}],
  // Console & Streaming phase (95-126)
  ['console_enable', { enableNetwork: true }],
  ['console_get_logs', {}],
  ['console_execute', { expression: '1+1' }],
  ['console_get_exceptions', {}],
  ['console_inject_script_monitor', {}],
  ['console_inject_function_tracer', { functionName: 'fetch' }],
  ['console_clear_injected_buffers', {}],
  ['console_reset_injected_interceptors', {}],
  ['framework_state_extract', {}],
  ['extension_list_installed', {}],
  ['network_enable', {}],
  ['network_get_status', {}],
  ['network_get_requests', {}],
  ['network_get_stats', {}],
  ['network_extract_auth', {}],
  ['ws_monitor_enable', {}],
  ['ws_get_frames', {}],
  ['ws_get_connections', {}],
  ['sse_monitor_enable', {}],
  ['sse_get_events', {}],
  ['ws_monitor_disable', {}],
  ['performance_get_metrics', {}],
  ['performance_start_coverage', {}],
  ['performance_trace_start', {}],
  ['js_heap_search', { pattern: 'fetch' }],
  ['performance_stop_coverage', {}],
  ['performance_take_heap_snapshot', {}],
  ['profiler_cpu_start', {}],
  ['profiler_heap_sampling_stop', {}],
  ['performance_trace_stop', {}],
  ['network_export_har', {}],
  // Code Analysis phase (127-160)
  ['network_disable', {}],
  ['debugger_disable', {}],
  ['binary_detect_format', { data: 'SGVsbG8=', source: 'base64' }],
  ['binary_decode', { data: 'SGVsbG8=', encoding: 'base64' }],
  ['binary_encode', { data: 'Hello', inputFormat: 'utf8', outputEncoding: 'base64' }],
  ['binary_entropy_analysis', { data: 'SGVsbG8gV29ybGQ=', source: 'base64' }],
  ['protobuf_decode_raw', { data: 'CAESBXdvcmxk' }],
  ['deobfuscate', { code: 'var a = 1;' }],
  ['advanced_deobfuscate', { code: 'var a = 1;' }],
  ['webcrack_unpack', { code: 'var a = 1;' }],
  ['understand_code', { code: 'function add(a,b){return a+b}' }],
  ['detect_obfuscation', { code: 'eval(atob("YWxlcnQoMSk="))' }],
  ['detect_crypto', { code: 'crypto.subtle.digest("SHA-256", data)' }],
  ['extract_function_tree', { scriptId: '__placeholder__' }],
  ['manage_hooks', { action: 'list' }],
  ['ai_hook_inject', { hookId: '__placeholder__', code: 'console.log("e2e hook")' }],
  ['ai_hook_toggle', { hookId: '__placeholder__', enabled: true }],
  ['ai_hook_get_data', { hookId: '__placeholder__' }],
  ['ai_hook_list', {}],
  ['ai_hook_export', {}],
  ['ai_hook_clear', {}],
  ['hook_preset', { preset: 'network_monitor' }],
  ['graphql_introspect', { endpoint: TARGET }],
  ['graphql_extract_queries', {}],
  ['graphql_replay', { endpoint: TARGET, query: '{ __typename }' }],
  ['call_graph_analyze', { code: 'function a(){b()} function b(){return 1}' }],
  ['ast_transform_preview', { code: 'var a = 1;', transforms: ['rename_vars'] }],
  ['ast_transform_apply', { code: 'var a = 1;', transforms: ['rename_vars'] }],
  ['ast_transform_chain', { name: 'e2e_chain', transforms: ['rename_vars'] }],
  // Crypto & Antidebug phase (161-180)
  [
    'crypto_compare',
    {
      code1: 'function encrypt(a){return a}',
      code2: 'function encrypt(a){return a}',
      functionName: 'encrypt',
      testInputs: ['test'],
    },
  ],
  ['crypto_extract_standalone', { targetFunction: 'CryptoJS.AES.encrypt' }],
  [
    'crypto_test_harness',
    { code: 'function encrypt(d){return d}', functionName: 'encrypt', testInputs: ['test'] },
  ],
  ['antidebug_detect_protections', {}],
  ['antidebug_bypass_all', {}],
  ['antidebug_bypass_debugger_statement', {}],
  ['antidebug_bypass_console_detect', {}],
  ['antidebug_bypass_stack_trace', {}],
  ['antidebug_bypass_timing', {}],
  ['sourcemap_discover', {}],
  ['source_map_extract', { url: TARGET }],
  ['sourcemap_fetch_and_parse', { sourceMapUrl: TARGET }],
  ['sourcemap_reconstruct_tree', { sourceMapUrl: TARGET }],
  ['page_script_register', { name: 'e2e_lib', code: 'function e2eHelper() { return 42; }' }],
  ['page_script_run', { name: 'e2e_lib' }],
  ['js_bundle_search', { url: TARGET, patterns: [{ name: 'fetch_calls', regex: 'fetch\\(' }] }],
  ['webpack_enumerate', {}],
  ['web_api_capture_session', { url: TARGET }],
  ['api_probe_batch', { baseUrl: TARGET, paths: ['/'] }],
  ['tab_workflow', { action: 'list' }],
  ['script_replace_persist', { url: '__never_match_e2e__', replacement: '// replaced' }],
  // Process & System phase (181-210)
  ['process_list', { pattern: 'test' }],
  ['process_get', { pid: 0 }],
  ['process_windows', { pid: 0 }],
  ['process_find', { pattern: 'browser' }],
  ['process_find_chromium', {}],
  ['process_check_debug_port', { pid: 0 }],
  [
    'process_launch_debug',
    {
      executablePath: 'C:/Program Files/Browser/Application/browser.exe',
      debugPort: 19222,
      args: ['--headless'],
    },
  ],
  ['memory_list_regions', { pid: 0 }],
  ['memory_dump_region', { pid: 0, address: '0x0', size: 16 }],
  ['memory_read', { pid: 0, address: '0x0', size: 16 }],
  ['memory_scan', { pid: 0, pattern: 'test' }],
  ['memory_scan_filtered', { pid: 0, pattern: 'test', addresses: ['0x0'] }],
  ['memory_check_protection', { pid: 0, address: '0x0' }],
  ['memory_audit_export', { pid: 0 }],
  ['enumerate_modules', { pid: 0 }],
  ['wasm_dump', { url: TARGET }],
  ['wasm_decompile', { inputPath: '__placeholder__.wasm' }],
  ['wasm_disassemble', { inputPath: '__placeholder__.wasm' }],
  ['wasm_inspect_sections', { inputPath: '__placeholder__.wasm' }],
  ['wasm_memory_inspect', {}],
  ['wasm_optimize', { inputPath: '__placeholder__.wasm' }],
  ['wasm_vmp_trace', {}],
  ['captcha_vision_solve', {}],
  ['widget_challenge_solve', {}],
  [
    'batch_register',
    {
      registerUrl: TARGET,
      accounts: [{ fields: { email: 'e2e@test.local', password: 'Test123!' } }],
    },
  ],
  ['list_extension_workflows', {}],
  ['run_extension_workflow', { workflowId: '__placeholder__' }],
  ['clear_collected_data', {}],
  ['clear_all_caches', {}],
  ['get_collection_stats', {}],
  ['browser_close', {}],
];

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ ok: boolean; value?: T; error?: string; ms: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setTimeout(() => {
      resolve({ ok: false, error: `TIMEOUT ${ms}ms`, ms: Date.now() - start });
    }, ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve({ ok: true, value: v, ms: Date.now() - start });
      })
      .catch((e) => {
        clearTimeout(timer);
        resolve({ ok: false, error: (e as Error).message, ms: Date.now() - start });
      });
  });
}

function parseContent(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result;
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.content) || r.content.length === 0) return result;
  const first = r.content[0] as Record<string, unknown>;
  if (typeof first?.text !== 'string') return result;
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text;
  }
}

async function main() {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  env.MCP_TRANSPORT = 'stdio';
  env.MCP_TOOL_PROFILE = 'full';
  env.LOG_LEVEL = 'error';
  env.PUPPETEER_HEADLESS = 'false';

  const client = new Client({ name: 'e2e-timing', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.mjs'],
    cwd: process.cwd(),
    env,
    stderr: 'pipe',
  });

  console.log('[E2E] Connecting...');
  await withTimeout(client.connect(transport), 30000);
  await withTimeout(client.listTools(), 15000);
  console.log('[E2E] Ready. Starting tools...\n');

  const results: { i: number; name: string; ok: boolean; ms: number; error?: string }[] = [];

  for (let i = 0; i < TOOLS.length; i++) {
    const tool = TOOLS[i] as [string, Record<string, unknown>];
    const [name, args] = tool;
    const result = await withTimeout(
      client.callTool({ name, arguments: args }),
      60000, // 60s per tool
    );

    const r: { i: number; name: string; ok: boolean; ms: number; error?: string } = {
      i,
      name,
      ok: result.ok,
      ms: result.ms,
    };

    if (!result.ok) {
      r.error = result.error;
      // Check if it's a real response or error
      const parsed = parseContent(result.value);
      if (parsed && typeof parsed === 'object') {
        const p = parsed as Record<string, unknown>;
        if (p.success === false) {
          r.error = `SOFT: ${String(p.message || p.error || 'unknown').slice(0, 80)}`;
        } else if (p.isError) {
          r.error = `ERR: ${String(p.message || p.error || 'unknown').slice(0, 80)}`;
        }
      }
    }

    results.push(r);

    const icon = !result.ok ? '❌' : result.ms > 10000 ? '🐢' : '✅';
    const status = !result.ok ? ` [${r.error?.slice(0, 60)}]` : '';
    console.log(
      `${icon} [${String(i).padStart(3)}] ${name.padEnd(35)} ${result.ms.toString().padStart(6)}ms${status}`,
    );
  }

  // Summary
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const total = results.length;
  console.log(
    `\n=== SUMMARY: ${passed}/${total} passed (${Math.round((passed / total) * 100)}%) ===`,
  );
  console.log(`FAILED (${failed}):`);
  results
    .filter((r) => !r.ok)
    .forEach((r) => {
      console.log(`  [${String(r.i).padStart(3)}] ${r.name}: ${r.error}`);
    });

  try {
    await transport.close();
  } catch {}
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
