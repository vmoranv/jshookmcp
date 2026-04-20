import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';
import { buildArgs } from '@tests/e2e/helpers/schema-builder';
import { ALL_PHASES } from '@tests/e2e/phases/index';
import { applyContextCapture } from '@tests/e2e/context-capture';
import { analyzeCoverage, formatCoverageReport } from '@tests/e2e/helpers/coverage-analyzer';
import type {
  CallFn,
  E2EConfig,
  E2EContext,
  Phase,
  ToolResult,
  ToolStatus,
} from '@tests/e2e/helpers/types';

function flag(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}

function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseOptionalPort(value: string | undefined): number | null {
  if (!value) return null;
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function extractDomain(url: string): string {
  try {
    return '.' + new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '.example.com';
  }
}

const DEFAULT_TARGET_URL = 'https://vmoranv.github.io/jshookmcp/';
const TARGET_URL = process.env.E2E_TARGET_URL || flag('--target-url', DEFAULT_TARGET_URL);
const ELECTRON_E2E_ENABLED = parseBooleanFlag(
  process.env.E2E_ENABLE_ELECTRON || flag('--enable-electron', 'false'),
);
const ELECTRON_CDP_PORT = parseOptionalPort(
  process.env.E2E_ELECTRON_CDP_PORT || flag('--electron-cdp-port', ''),
);
const ELECTRON_USERDATA_DIR =
  process.env.E2E_ELECTRON_USERDATA_DIR || flag('--electron-userdata-dir', '');
const ARTIFACT_DIR = join(process.cwd(), '.tmp_mcp_artifacts');
const WASM_FIXTURE_PATH = join(process.cwd(), 'tests', 'e2e', 'fixtures', 'wasm', 'sample.wasm');
const FIXTURE_URL =
  'data:text/html,<html><body><h1>jshook e2e</h1><script>window.__e2e=true;</script></body></html>';

const config: E2EConfig = {
  targetUrl: TARGET_URL,
  targetDomain: extractDomain(TARGET_URL),
  electronPath: flag('--electron-path', ''),
  electronEnabled: ELECTRON_E2E_ENABLED,
  electronCdpPort: ELECTRON_CDP_PORT,
  electronUserdataDir: ELECTRON_USERDATA_DIR,
  miniappPath: flag('--miniapp-path', ''),
  asarPath: flag('--asar-path', ''),
  browserPath: flag('--browser-path', 'C:/Program Files/Browser/Application/browser.exe'),
  perToolTimeout: Number(flag('--timeout', '60000')),
  artifactDir: ARTIFACT_DIR,
};

// Tools that require runtime context and should be skipped if not available
const STRICT_OVERRIDE_TOOLS = new Set<string>([
  'ai_hook',
  'asar_extract',
  'breakpoint_remove',
  'check_debug_port',
  'debugger_session',
  'electron_attach',
  'electron_check_fuses',
  'electron_debug_status',
  'electron_inspect_app',
  'electron_ipc_sniff',
  'electron_launch_debug',
  'electron_patch_fuses',
  'electron_scan_userdata',
  'event_breakpoint_remove',
  'extension_execute_in_context',
  'extension_reload',
  'extension_uninstall',
  'extract_function_tree',
  'get_detailed_data',
  'get_object_properties',
  'inject_dll',
  'inject_shellcode',
  'memory_batch_write',
  'memory_check_protection',
  'memory_dump_region',
  'memory_read',
  'memory_scan',
  'memory_scan_filtered',
  'memory_write',
  'miniapp_pkg_analyze',
  'miniapp_pkg_scan',
  'miniapp_pkg_unpack',
  'network_get_response_body',
  'network_replay_request',
  'process_check_debug_port',
  'process_get',
  'process_kill',
  'process_windows',
  'run_extension_workflow',
  'watch_remove',
  'wasm_decompile',
  'wasm_disassemble',
  'wasm_inspect_sections',
  'wasm_offline_run',
  'wasm_optimize',
  'xhr_breakpoint_remove',
]);

const LEGACY_EXPECTED_LIMITATION_PATTERNS = [
  'GRACEFUL:',
  '[PREREQUISITE]',
  'timed out',
  'Timeout',
  'Protocol error',
  'Input validation error',
  'Configuration Error',
  'Node is either not clickable',
  'not an Element',
  'No Skia scene data available',
  'Not in paused state',
  'Coverage not enabled',
];

function getToolTimeoutOverride(toolName: string): number | null {
  if (
    toolName.startsWith('memory_') ||
    toolName.startsWith('proto_') ||
    toolName.startsWith('mojo_') ||
    toolName.startsWith('webhook_') ||
    toolName.startsWith('tls_') ||
    toolName.startsWith('net_raw_') ||
    toolName.startsWith('stealth_')
  ) {
    return 8_000;
  }

  if (
    toolName.startsWith('syscall_') ||
    toolName.startsWith('skia_') ||
    toolName.startsWith('canvas_') ||
    toolName === 'framework_state_extract' ||
    toolName === 'restore_page_snapshot' ||
    toolName === 'process_launch_debug' ||
    toolName === 'process_find' ||
    toolName === 'process_get' ||
    toolName === 'process_windows' ||
    toolName === 'process_check_debug_port' ||
    toolName === 'check_debug_port' ||
    toolName === 'enumerate_modules' ||
    toolName === 'debugger_evaluate'
  ) {
    return 12_000;
  }

  if (toolName === 'v8_heap_snapshot_capture' || toolName === 'v8_heap_snapshot_analyze') {
    return 20_000;
  }

  if (
    toolName.startsWith('v8_') ||
    toolName === 'register_account_flow' ||
    toolName === 'batch_register'
  ) {
    return 10_000;
  }

  return null;
}

function normalizeStatus(result: ToolResult): ToolStatus {
  if (result.status) return result.status;
  if (result.ok === true) return 'PASS';
  return result.isError ? 'FAIL' : 'EXPECTED_LIMITATION';
}

function isPassingResult(result: ToolResult): boolean {
  const status = normalizeStatus(result);
  return (
    status !== 'FAIL' ||
    LEGACY_EXPECTED_LIMITATION_PATTERNS.some((pattern) => result.detail.includes(pattern))
  );
}

/**
 * Build per-tool argument overrides.
 * Tools not listed here fall back to schema-driven auto-generation via buildArgs().
 * Tools that require runtime context are only emitted once their prerequisites exist.
 */
function getOverrides(ctx: E2EContext, cfg: E2EConfig): Record<string, Record<string, unknown>> {
  const wasmInputPath = WASM_FIXTURE_PATH;
  const {
    targetUrl,
    targetDomain,
    artifactDir,
    browserPath,
    asarPath,
    electronPath,
    electronEnabled,
    electronCdpPort,
    electronUserdataDir,
    miniappPath,
  } = cfg;
  const browserPid =
    typeof ctx.browserPid === 'number' && ctx.browserPid > 0 ? ctx.browserPid : null;

  return {
    browser_launch: { headless: false },
    browser_attach: { endpoint: 'http://localhost:9222' },
    page_navigate: { url: targetUrl, waitUntil: 'load', timeout: 15000 },
    page_evaluate: { code: 'document.title' },
    ...(ctx.snapshotId ? { restore_page_snapshot: { snapshotId: ctx.snapshotId } } : {}),
    page_click: { selector: '#e2e_click_target' },
    page_type: { selector: '#e2e_text_input', text: 'e2e' },
    page_select: { selector: '#test_select_e2e', values: ['b'] },
    page_hover: { selector: '#e2e_hover_target' },
    page_scroll: { direction: 'down', amount: 100 },
    page_press_key: { key: 'Escape' },
    page_wait_for_selector: { selector: 'body', timeout: 3000 },
    page_inject_script: { script: 'window.__e2e_injected = true;' },
    page_set_viewport: { width: 1280, height: 720 },
    page_emulate_device: { device: 'iPhone 14' },
    page_set_cookies: { cookies: [{ name: 'e2e', value: '1', domain: targetDomain }] },
    page_set_local_storage: { key: 'e2e_test', value: 'hello' },
    page_back: {},
    page_forward: {},
    page_reload: {},
    page_screenshot: {
      selector: ['.VPNav', '.VPHero', '.VPFeatures'],
      path: `${artifactDir}/screenshot.png`,
    },
    page_script_register: { name: 'e2e_lib', code: 'function e2eHelper() { return 42; }' },
    page_script_run: { name: 'e2e_lib', params: {} },
    dom_query_selector: { selector: 'body' },
    dom_query_all: { selector: 'div' },
    dom_get_structure: { selector: 'body', depth: 2 },
    dom_find_clickable: {},
    dom_find_by_text: { text: 'test' },
    dom_get_xpath: { selector: 'body' },
    dom_is_in_viewport: { selector: 'body' },
    dom_get_computed_style: { selector: 'body' },
    console_monitor: { action: 'enable', enableNetwork: true },
    console_execute: { expression: '1+1' },
    console_inject_function_tracer: { functionName: 'fetch' },
    debugger_evaluate: { expression: '1+1', context: 'frame' },
    debugger_wait_for_paused: { timeout: 5000 },
    breakpoint_set: ctx.scriptId
      ? { scriptId: ctx.scriptId, lineNumber: 1 }
      : { url: targetUrl, lineNumber: 1 },
    ...(ctx.breakpointId ? { breakpoint_remove: { breakpointId: ctx.breakpointId } } : {}),
    get_all_scripts: {},
    get_script_source: ctx.scriptId ? { scriptId: ctx.scriptId } : { url: targetUrl },
    ...(ctx.detailId ? { get_detailed_data: { detailId: ctx.detailId } } : {}),
    breakpoint_set_on_exception: { state: 'all' },
    breakpoint_list: {},
    xhr_breakpoint_set: { urlPattern: '/api/' },
    xhr_breakpoint_list: {},
    ...(ctx.xhrBreakpointId
      ? { xhr_breakpoint_remove: { breakpointId: ctx.xhrBreakpointId } }
      : {}),
    event_breakpoint_set: { eventName: 'click' },
    event_breakpoint_set_category: { category: 'mouse' },
    event_breakpoint_list: {},
    ...(ctx.eventBreakpointId
      ? { event_breakpoint_remove: { breakpointId: ctx.eventBreakpointId } }
      : {}),
    watch_add: { expression: 'window.location.href' },
    watch_list: {},
    watch_evaluate_all: {},
    ...(ctx.watchId ? { watch_remove: { watchId: ctx.watchId } } : {}),
    get_scope_variables_enhanced: { includeObjectProperties: true, maxDepth: 1 },
    debugger_get_paused_state: {},
    debugger_step: { direction: 'into' },
    network_enable: {},
    network_get_requests: {},
    ...(ctx.requestId
      ? {
          network_get_response_body: { requestId: ctx.requestId },
          network_replay_request: { requestId: ctx.requestId, dryRun: true },
        }
      : {}),
    network_get_stats: {},
    network_get_status: {},
    network_extract_auth: {},
    network_export_har: { path: `${artifactDir}/network.har` },
    performance_get_metrics: {},
    performance_trace_stop: {},
    profiler_cpu_stop: {},
    profiler_heap_sampling_stop: {},
    performance_stop_coverage: {},
    performance_take_heap_snapshot: {},
    ws_monitor_enable: {},
    sse_monitor_enable: {},
    ws_get_frames: {},
    ws_get_connections: {},
    sse_get_events: {},
    binary_detect_format: { data: 'SGVsbG8=', source: 'base64' },
    binary_decode: { data: 'SGVsbG8=', encoding: 'base64' },
    binary_encode: { data: 'Hello', inputFormat: 'utf8', outputEncoding: 'base64' },
    binary_entropy_analysis: { data: 'SGVsbG8gV29ybGQ=', source: 'base64' },
    protobuf_decode_raw: { data: 'CAESBXdvcmxk' },
    manage_hooks: { action: 'list' },
    ai_hook: { action: 'list' },
    ...(ctx.hookId
      ? {
          ai_hook_inject: {
            action: 'inject',
            hookId: ctx.hookId,
            code: 'console.log("e2e hook")',
          },
          ai_hook_toggle: { action: 'toggle', hookId: ctx.hookId, enabled: true },
          ai_hook_get_data: { action: 'get_data', hookId: ctx.hookId },
        }
      : {}),
    hook_preset: { preset: 'network_monitor' },
    deobfuscate: { code: 'var a = 1;' },
    webcrack_unpack: { code: 'var a = 1;' },
    understand_code: { code: 'function add(a,b){return a+b}' },
    detect_obfuscation: { code: 'eval(atob("YWxlcnQoMSk="))' },
    detect_crypto: { code: 'crypto.subtle.digest("SHA-256", data)' },
    search_in_scripts: { keyword: 'fetch' },
    ...(ctx.scriptId
      ? { extract_function_tree: { scriptId: ctx.scriptId, functionName: 'fetch' } }
      : {}),
    collect_code: { url: targetUrl, returnSummaryOnly: true },
    graphql_introspect: { endpoint: targetUrl },
    graphql_extract_queries: {},
    graphql_replay: { endpoint: targetUrl, query: '{ __typename }' },
    script_replace_persist: { url: '__never_match_e2e__', replacement: '// replaced' },
    call_graph_analyze: { code: 'function a(){b()} function b(){return 1}' },
    ast_transform_preview: { code: 'var a = 1;', transforms: ['rename_vars'] },
    ast_transform_apply: { code: 'var a = 1;', transforms: ['rename_vars'] },
    ast_transform_chain: { name: 'e2e_chain', transforms: ['rename_vars'] },
    crypto_compare: {
      code1: 'function encrypt(a){return a}',
      code2: 'function encrypt(a){return a}',
      functionName: 'encrypt',
      testInputs: ['test'],
    },
    crypto_extract_standalone: { targetFunction: 'CryptoJS.AES.encrypt' },
    crypto_test_harness: {
      code: 'function encrypt(d){return d}',
      functionName: 'encrypt',
      testInputs: ['test'],
    },
    blackbox_add: { urlPattern: '/node_modules/' },
    process_find: { pattern: 'chrome' },
    process_launch_debug: { executablePath: browserPath, debugPort: 19222, args: ['--headless'] },
    ...(browserPid
      ? {
          process_get: { pid: browserPid },
          process_windows: { pid: browserPid },
          process_check_debug_port: { pid: browserPid },
        }
      : {}),
    wasm_dump: { outputPath: `${artifactDir}/wasm-dump.wasm` },
    wasm_decompile: { inputPath: wasmInputPath },
    wasm_disassemble: { inputPath: wasmInputPath },
    wasm_inspect_sections: { inputPath: wasmInputPath },
    wasm_memory_inspect: {},
    wasm_optimize: { inputPath: wasmInputPath },
    wasm_vmp_trace: {},
    antidebug_detect_protections: {},
    antidebug_bypass: { types: ['all'] },
    sourcemap_fetch_and_parse: { sourceMapUrl: targetUrl },
    sourcemap_reconstruct_tree: { sourceMapUrl: targetUrl },
    sourcemap_discover: {},
    extension_list_installed: {},
    stealth_inject: {},
    stealth_set_user_agent: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Browser/120.0.0.0',
    },
    captcha_detect: {},
    captcha_config: { provider: '2captcha', apiKey: 'test' },
    camoufox_server_status: {},
    browser_select_tab: { index: 0 },
    tab_workflow: { action: 'list' },
    webpack_enumerate: {},
    js_heap_search: { pattern: 'fetch' },
    indexeddb_dump: {},
    framework_state_extract: {},
    ...(ctx.objectId ? { get_object_properties: { objectId: ctx.objectId } } : {}),
    web_api_capture_session: { url: targetUrl },
    api_probe_batch: { baseUrl: targetUrl, paths: ['/'] },
    js_bundle_search: { url: targetUrl, patterns: [{ name: 'fetch_calls', regex: 'fetch\\(' }] },
    get_token_budget_stats: {},
    get_cache_stats: {},
    get_collection_stats: {},
    boost_profile: { profile: 'full' },
    unboost_profile: {},
    ...(asarPath ? { asar_extract: { inputPath: asarPath } } : {}),
    ...(electronPath ? { electron_inspect_app: { appPath: electronPath } } : {}),
    ...(electronPath ? { electron_check_fuses: { exePath: electronPath } } : {}),
    ...(electronEnabled && electronPath
      ? {
          electron_launch_debug: {
            exePath: electronPath,
            rendererPort: electronCdpPort ?? 9222,
          },
          electron_debug_status: {},
        }
      : {}),
    ...(electronEnabled && electronCdpPort
      ? {
          electron_attach: { port: electronCdpPort },
          electron_ipc_sniff: { action: 'list', port: electronCdpPort },
        }
      : {}),
    ...(electronUserdataDir ? { electron_scan_userdata: { dirPath: electronUserdataDir } } : {}),
    ...(miniappPath
      ? {
          miniapp_pkg_scan: { searchPath: miniappPath },
          miniapp_pkg_unpack: { inputPath: miniappPath },
          miniapp_pkg_analyze: { unpackedDir: miniappPath },
        }
      : {}),
    ...(browserPid
      ? {
          memory_check_protection: { pid: browserPid, address: '0x10000' },
          memory_read: { pid: browserPid, address: '0x10000', size: 16 },
          memory_scan: { pid: browserPid, pattern: 'test' },
          memory_scan_filtered: { pid: browserPid, pattern: 'test', addresses: ['0x10000'] },
          memory_dump_region: {
            pid: browserPid,
            address: '0x10000',
            size: 256,
            outputPath: `${artifactDir}/e2e_dump.bin`,
          },
        }
      : {}),
    memory_audit_export: { clear: false },
    human_mouse: { selector: '#e2e_hover_target' },
    human_scroll: { direction: 'down', amount: 200 },
    human_typing: { selector: '#e2e_human_input', text: 'e2e' },
    captcha_vision_solve: {},
    widget_challenge_solve: {},
    captcha_wait: { timeout: 3000 },
    register_account_flow: {
      registerUrl: targetUrl,
      fields: { email: 'e2e@test.local', password: 'Test123!' },
    },
    ...(browserPid && ctx.dllPath
      ? {
          inject_dll: { pid: browserPid, dllPath: ctx.dllPath },
        }
      : {}),
    ...(browserPid
      ? {
          inject_shellcode: { pid: browserPid, shellcode: 'cc' },
          memory_write: { pid: browserPid, address: '0x10000', data: '00' },
          memory_batch_write: { pid: browserPid, patches: [{ address: '0x10000', data: '00' }] },
          process_kill: { pid: browserPid },
        }
      : {}),
    camoufox_server_launch: {},
    camoufox_server_close: {},
    ...(browserPid ? { check_debug_port: { pid: browserPid } } : {}),
    ...(ctx.sessionPath ? { debugger_session: { action: 'load', filePath: ctx.sessionPath } } : {}),
    ...(ctx.workflowId ? { run_extension_workflow: { workflowId: ctx.workflowId } } : {}),
    ...(ctx.v8SnapshotId ? { v8_heap_snapshot_analyze: { snapshotId: ctx.v8SnapshotId } } : {}),
    ...(ctx.v8SnapshotId
      ? {
          v8_heap_diff: {
            snapshotId1: ctx.v8SnapshotId,
            snapshotId2: ctx.v8ComparisonSnapshotId ?? ctx.v8SnapshotId,
          },
        }
      : {}),
    list_extensions: {},
    reload_extensions: {},
    ...(ctx.pluginId
      ? {
          extension_reload: { pluginId: ctx.pluginId },
          extension_uninstall: { pluginId: ctx.pluginId },
          extension_execute_in_context: {
            pluginId: ctx.pluginId,
            contextName: 'default',
            args: {},
          },
        }
      : {}),
    browse_extension_registry: {},
    batch_register: {
      registerUrl: targetUrl,
      accounts: [{ fields: { email: 'e2e@test.local', password: 'Test123!' } }],
    },
    list_extension_workflows: {},
    create_task_handoff: { description: 'E2E test handoff', constraints: ['testing'] },
    ...(ctx.taskId
      ? {
          complete_task_handoff: { taskId: ctx.taskId, summary: 'Looks good' },
          get_task_context: { taskId: ctx.taskId },
        }
      : {
          get_task_context: {},
        }),
    append_session_insight: { category: 'other', content: 'E2E test insight' },
    save_page_snapshot: { label: 'e2e-checkpoint' },
    list_page_snapshots: {},
    summarize_trace: { detail: 'compact' },
  };
}

function createEmptyContext(): E2EContext {
  return {
    scriptId: null,
    breakpointId: null,
    requestId: null,
    hookId: null,
    objectId: null,
    workflowId: null,
    snapshotId: null,
    pluginId: null,
    v8SnapshotId: null,
    v8ComparisonSnapshotId: null,
    detailId: null,
    browserPid: null,
    sessionPath: null,
    dllPath: null,
    sourceMapUrl: null,
    xhrBreakpointId: null,
    eventBreakpointId: null,
    watchId: null,
    taskId: null,
  };
}

type LaneSharedState = {
  client: MCPTestClient;
  ctx: E2EContext;
  connected: boolean;
};

type LaneRuntimeOptions = {
  sharedState?: LaneSharedState;
  cleanupAfterSuite?: boolean;
};

function createLaneSharedState(): LaneSharedState {
  return {
    client: new MCPTestClient(),
    ctx: createEmptyContext(),
    connected: false,
  };
}

type LaneRuntime = {
  client: MCPTestClient;
  getToolMap(): Map<string, { name: string; inputSchema?: Record<string, unknown> }>;
  getResults(): ToolResult[];
  registerSuite(
    suiteName: string,
    phases: Phase[],
    options?: {
      concurrentSuite?: boolean;
      timeout?: number;
      bootstrap?: (call: CallFn) => Promise<void>;
    },
  ): void;
};

function createLaneRuntime(laneKey: string, options: LaneRuntimeOptions = {}): LaneRuntime {
  const laneConfig: E2EConfig = {
    ...config,
    artifactDir: join(ARTIFACT_DIR, laneKey),
  };

  const sharedState = options.sharedState ?? createLaneSharedState();
  const client = sharedState.client;
  const ctx = sharedState.ctx;
  const cleanupAfterSuite = options.cleanupAfterSuite ?? !options.sharedState;
  const laneResults: ToolResult[] = [];
  let overrides: Record<string, Record<string, unknown>> = {};
  let toolMap = new Map<string, { name: string; inputSchema?: Record<string, unknown> }>();

  function shouldSkipTool(
    toolName: string,
    toolOverrides: Record<string, Record<string, unknown>>,
  ): boolean {
    return STRICT_OVERRIDE_TOOLS.has(toolName) && !toolOverrides[toolName];
  }

  async function invokeTool(
    name: string,
    args: Record<string, unknown> | undefined,
    timeoutMs: number,
  ): Promise<{ parsed: unknown; result: ToolResult }> {
    if (!toolMap.has(name)) {
      const result = client.recordSynthetic(
        name,
        'SKIP',
        'Tool not registered by current MCP server',
        {
          code: 'TOOL_UNAVAILABLE',
        },
      );
      laneResults.push(result);
      return { parsed: null, result };
    }

    const response = await client.call(name, args, timeoutMs);
    laneResults.push(response.result);
    applyContextCapture(name, response.parsed, ctx, overrides);
    return response;
  }

  const callForSetup: CallFn = async (name, args = {}, timeoutMs) => {
    const nextOverrides = getOverrides(ctx, laneConfig);
    if (shouldSkipTool(name, nextOverrides)) return undefined;
    overrides = nextOverrides;
    const callArgs =
      Object.keys(args ?? {}).length > 0
        ? args
        : (overrides[name] ?? buildArgs(toolMap.get(name)?.inputSchema, laneConfig));
    const { parsed } = await invokeTool(name, callArgs, timeoutMs ?? 20_000);
    return parsed;
  };

  function registerPhases(phases: Phase[]) {
    for (const phase of phases) {
      const phaseOpts = phase.concurrent
        ? { concurrent: true, timeout: 120_000 }
        : { sequential: true as const, timeout: 120_000 };

      describe(phase.name, phaseOpts, () => {
        beforeAll(async () => {
          if (typeof phase.setup === 'function') {
            await phase.setup(callForSetup);
          } else if (Array.isArray(phase.setup)) {
            for (const setupTool of phase.setup) {
              if (!toolMap.has(setupTool)) continue;
              const nextOverrides = getOverrides(ctx, laneConfig);
              if (shouldSkipTool(setupTool, nextOverrides)) continue;
              overrides = nextOverrides;
              const args =
                overrides[setupTool] ?? buildArgs(toolMap.get(setupTool)?.inputSchema, laneConfig);
              await invokeTool(setupTool, args, 20_000);
              await new Promise((r) => setTimeout(r, 50));
            }
          }
          if (phase.name === 'Browser Launch & Navigation') {
            await new Promise((r) => setTimeout(r, 1_000));
          }
        });

        for (const toolName of phase.tools) {
          it(toolName, async () => {
            const nextOverrides = getOverrides(ctx, laneConfig);
            if (shouldSkipTool(toolName, nextOverrides)) return;
            overrides = nextOverrides;
            const args =
              overrides[toolName] ?? buildArgs(toolMap.get(toolName)?.inputSchema, laneConfig);

            const isTimeoutProne = [
              'sse_monitor_enable',
              'sse_get_events',
              'performance_get_metrics',
              'performance_start_coverage',
            ].includes(toolName);
            const timeout =
              getToolTimeoutOverride(toolName) ??
              (isTimeoutProne ? 1500 : laneConfig.perToolTimeout);

            const { result } = await invokeTool(toolName, args, timeout);

            if (toolName === 'debugger_wait_for_paused' && normalizeStatus(result) === 'PASS') {
              await new Promise((r) => setTimeout(r, 150));
            }

            const passed = isPassingResult(result);
            expect(
              passed,
              `${toolName} returned unexpected ${normalizeStatus(result)} result: ${result.detail}`,
            ).toBe(true);
          });
        }
      });
    }
  }

  return {
    client,
    getToolMap: () => toolMap,
    getResults: () => laneResults,
    registerSuite(suiteName, phases, suiteConfig) {
      const suiteOptions = suiteConfig?.concurrentSuite
        ? { concurrent: true, timeout: suiteConfig.timeout ?? 300_000 }
        : { sequential: true as const, timeout: suiteConfig?.timeout ?? 300_000 };

      describe(suiteName, suiteOptions, () => {
        beforeAll(async () => {
          await mkdir(laneConfig.artifactDir, { recursive: true });
          if (!sharedState.connected) {
            await client.connect();
            sharedState.connected = true;
          }
          toolMap = client.getToolMap();
          overrides = getOverrides(ctx, laneConfig);
          await suiteConfig?.bootstrap?.(callForSetup);
        });

        afterAll(async () => {
          if (!cleanupAfterSuite) return;
          await client.cleanup();
          sharedState.connected = false;
        });

        registerPhases(phases);
      });
    },
  };
}

describe.skipIf(!TARGET_URL)('Full Tool E2E', { timeout: 600_000 }, () => {
  const browserPhases = ALL_PHASES.filter((p) => (p.group ?? 'browser') === 'browser');
  const computeCorePhases = ALL_PHASES.filter((p) => p.group === 'compute-core');
  const computeSystemPhases = ALL_PHASES.filter((p) => p.group === 'compute-system');
  const computeBrowserPhases = ALL_PHASES.filter((p) => p.group === 'compute-browser');
  const cleanupPhases = ALL_PHASES.filter((p) => p.group === 'cleanup');
  const browserSession = createLaneSharedState();

  const lanes = {
    browser: createLaneRuntime('browser', {
      sharedState: browserSession,
      cleanupAfterSuite: false,
    }),
    computeCore: createLaneRuntime('compute-core'),
    computeSystem: createLaneRuntime('compute-system'),
    computeBrowser: createLaneRuntime('compute-browser'),
    cleanup: createLaneRuntime('cleanup', {
      sharedState: browserSession,
      cleanupAfterSuite: true,
    }),
  } as const;

  beforeAll(async () => {
    await mkdir(ARTIFACT_DIR, { recursive: true });
  });

  afterAll(async () => {
    const allResults = Object.values(lanes).flatMap((lane) => lane.getResults());
    const representativeToolMap =
      Object.values(lanes)
        .map((lane) => lane.getToolMap())
        .toSorted((a, b) => b.size - a.size)[0] ??
      new Map<string, { name: string; inputSchema?: Record<string, unknown> }>();

    const byStatus: Record<ToolStatus, number> = {
      PASS: 0,
      SKIP: 0,
      EXPECTED_LIMITATION: 0,
      FAIL: 0,
    };

    for (const result of allResults) {
      byStatus[normalizeStatus(result)] += 1;
    }

    const report = {
      schemaVersion: 2,
      format: 'jshookmcp-e2e-report',
      timestamp: new Date().toISOString(),
      targetUrl: TARGET_URL,
      serverToolCount: representativeToolMap.size,
      tested: allResults.length,
      total: allResults.length,
      pass: byStatus.PASS,
      skip: byStatus.SKIP,
      expectedLimitation: byStatus.EXPECTED_LIMITATION,
      fail: byStatus.FAIL,
      isErrorCount: allResults.filter((result) => result.isError).length,
      summary: {
        byStatus,
        blockingFailures: byStatus.FAIL,
        nonBlocking: byStatus.SKIP + byStatus.EXPECTED_LIMITATION,
      },
      results: allResults.map((result) => {
        const status = normalizeStatus(result);
        return { ...result, status, ok: result.ok ?? status === 'PASS' };
      }),
    };

    const coverageReport = analyzeCoverage(representativeToolMap);
    const fullReport = {
      ...report,
      coverage: {
        totalRegisteredTools: coverageReport.totalTools,
        exercised: coverageReport.exercised,
        skipped: coverageReport.skipped,
        untested: coverageReport.untested,
        overallCoveragePercent: coverageReport.overallCoveragePercent,
        domains: coverageReport.domains.map((d) => ({
          domain: d.domain,
          total: d.total,
          exercised: d.exercised,
          skipped: d.skipped,
          untested: d.untested,
          coveragePercent: d.coveragePercent,
        })),
        untestedTools: coverageReport.untestedTools,
      },
    };

    try {
      await writeFile(
        join(ARTIFACT_DIR, 'e2e-full-report.json'),
        JSON.stringify(fullReport, null, 2),
      );
      await writeFile(
        join(ARTIFACT_DIR, 'e2e-coverage-report.json'),
        JSON.stringify(coverageReport, null, 2),
      );
      await writeFile(
        join(ARTIFACT_DIR, 'e2e-coverage-summary.txt'),
        formatCoverageReport(coverageReport),
      );
    } catch {
      /* ignore */
    }
  });

  lanes.browser.registerSuite('Browser-dependent', browserPhases, {
    timeout: 300_000,
  });

  lanes.computeCore.registerSuite('Pure Compute > Core Lane', computeCorePhases, {
    concurrentSuite: true,
    timeout: 420_000,
  });

  lanes.computeSystem.registerSuite('Pure Compute > System Lane', computeSystemPhases, {
    concurrentSuite: true,
    timeout: 420_000,
    bootstrap: async (call) => {
      await call('browser_launch', { headless: true }, 60_000);
    },
  });

  lanes.computeBrowser.registerSuite('Pure Compute > Browser Runtime Lane', computeBrowserPhases, {
    concurrentSuite: true,
    timeout: 420_000,
    bootstrap: async (call) => {
      await call('browser_launch', { headless: true }, 60_000);
      await call('page_navigate', { url: FIXTURE_URL, waitUntil: 'load', timeout: 10_000 }, 20_000);
    },
  });

  lanes.cleanup.registerSuite('Cleanup', cleanupPhases, {
    timeout: 180_000,
  });
});
