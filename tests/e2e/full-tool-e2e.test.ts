import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';
import {
  getObservedWasmArtifactPath,
  recordCapabilityObservation,
  resetCapabilityProbes,
} from '@tests/e2e/helpers/capability-probe';
import { buildArgs } from '@tests/e2e/helpers/schema-builder';
import { ALL_PHASES } from '@tests/e2e/phases/index';
import { applyContextCapture } from '@tests/e2e/context-capture';
import { analyzeCoverage, formatCoverageReport } from '@tests/e2e/helpers/coverage-analyzer';
import type { E2EConfig, E2EContext, ToolResult, ToolStatus } from '@tests/e2e/helpers/types';

function flag(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
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
const ARTIFACT_DIR = join(process.cwd(), '.tmp_mcp_artifacts');
const WASM_FIXTURE_PATH = join(process.cwd(), 'tests', 'e2e', 'fixtures', 'wasm', 'sample.wasm');

const config: E2EConfig = {
  targetUrl: TARGET_URL,
  targetDomain: extractDomain(TARGET_URL),
  electronPath: flag('--electron-path', ''),
  miniappPath: flag('--miniapp-path', ''),
  asarPath: flag('--asar-path', ''),
  browserPath: flag('--browser-path', 'C:/Program Files/Browser/Application/browser.exe'),
  perToolTimeout: Number(flag('--timeout', '60000')),
  artifactDir: ARTIFACT_DIR,
};

// Tools that require runtime context and should be skipped if not available
const STRICT_OVERRIDE_TOOLS = new Set<string>([
  'ai_hook_get_data',
  'ai_hook_inject',
  'ai_hook_toggle',
  'asar_extract',
  'breakpoint_remove',
  'check_debug_port',
  'debugger_load_session',
  'electron_inspect_app',
  'event_breakpoint_remove',
  'extension_execute_in_context',
  'extract_function_tree',
  'get_detailed_data',
  'get_object_properties',
  'inject_dll',
  'inject_shellcode',
  'install_extension',
  'memory_batch_write',
  'memory_check_protection',
  'memory_dump_region',
  'memory_protect',
  'memory_read',
  'memory_scan',
  'memory_scan_filtered',
  'memory_write',
  'miniapp_pkg_analyze',
  'miniapp_pkg_scan',
  'miniapp_pkg_unpack',
  'module_inject_dll',
  'module_inject_shellcode',
  'module_list',
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
  'timed out',
  'Timeout',
  'Protocol error',
  'Input validation error',
  'Configuration Error',
  'Node is either not clickable',
  'not an Element',
];

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
  const wasmInputPath = getObservedWasmArtifactPath() ?? WASM_FIXTURE_PATH;
  const { targetUrl, targetDomain, artifactDir, browserPath, asarPath, electronPath, miniappPath } =
    cfg;
  const browserPid =
    typeof ctx.browserPid === 'number' && ctx.browserPid > 0 ? ctx.browserPid : null;

  return {
    browser_launch: { headless: false },
    browser_attach: { endpoint: 'http://localhost:9222' },
    page_navigate: { url: targetUrl, waitUntil: 'load', timeout: 15000 },
    page_evaluate: { code: 'document.title' },
    page_click: { selector: 'h1' },
    page_type: { selector: 'input, body', text: 'e2e' },
    page_select: { selector: '#test_select_e2e', values: ['b'] },
    page_hover: { selector: 'body' },
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
    console_enable: { enableNetwork: true },
    console_execute: { expression: '1+1' },
    console_inject_function_tracer: { functionName: 'fetch' },
    debugger_evaluate: { expression: '1+1' },
    debugger_evaluate_global: { expression: 'document.title' },
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
    debugger_step_into: {},
    debugger_step_out: {},
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
    ...(ctx.hookId
      ? {
          ai_hook_inject: { hookId: ctx.hookId, code: 'console.log("e2e hook")' },
          ai_hook_toggle: { hookId: ctx.hookId, enabled: true },
          ai_hook_get_data: { hookId: ctx.hookId },
        }
      : {}),
    ai_hook_export: {},
    ai_hook_clear: {},
    ai_hook_list: {},
    hook_preset: { preset: 'network_monitor' },
    deobfuscate: { code: 'var a = 1;' },
    advanced_deobfuscate: { code: 'var a = 1;' },
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
    process_list: { pattern: 'chrome' },
    process_find: { pattern: 'chrome' },
    process_find_chromium: {},
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
    antidebug_bypass_all: {},
    antidebug_bypass_debugger_statement: {},
    antidebug_bypass_console_detect: {},
    antidebug_bypass_stack_trace: {},
    antidebug_bypass_timing: {},
    source_map_extract: { url: targetUrl },
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
    human_mouse: { selector: 'p, h1, div' },
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
          module_inject_dll: { pid: browserPid, dllPath: ctx.dllPath },
        }
      : {}),
    ...(browserPid
      ? {
          inject_shellcode: { pid: browserPid, shellcode: 'cc' },
          module_inject_shellcode: { pid: browserPid, shellcode: 'cc' },
          memory_write: { pid: browserPid, address: '0x10000', data: '00' },
          memory_batch_write: { pid: browserPid, patches: [{ address: '0x10000', data: '00' }] },
          memory_protect: { pid: browserPid, address: '0x10000' },
          process_kill: { pid: browserPid },
        }
      : {}),
    frida_bridge: { action: 'status' },
    jadx_bridge: { action: 'status' },
    camoufox_server_launch: {},
    camoufox_server_close: {},
    ...(browserPid
      ? { module_list: { pid: browserPid }, check_debug_port: { pid: browserPid } }
      : {}),
    ...(ctx.sessionPath ? { debugger_load_session: { filePath: ctx.sessionPath } } : {}),
    ...(ctx.workflowId ? { run_extension_workflow: { workflowId: ctx.workflowId } } : {}),
    list_extensions: {},
    reload_extensions: {},
    browse_extension_registry: {},
    batch_register: {
      registerUrl: targetUrl,
      accounts: [{ fields: { email: 'e2e@test.local', password: 'Test123!' } }],
    },
    list_extension_workflows: {},
    electron_attach: { endpoint: 'http://localhost:9229' },
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

describe.skipIf(!TARGET_URL)('Full Tool E2E', { timeout: 300_000, sequential: true }, () => {
  const client = new MCPTestClient();
  const ctx: E2EContext = {
    scriptId: null,
    breakpointId: null,
    requestId: null,
    hookId: null,
    objectId: null,
    workflowId: null,
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
  ): Promise<{ parsed: any; result: ToolResult }> {
    if (!toolMap.has(name)) {
      const result = client.recordSynthetic(
        name,
        'SKIP',
        'Tool not registered by current MCP server',
        {
          code: 'TOOL_UNAVAILABLE',
        },
      );
      recordCapabilityObservation(name, null, result);
      return { parsed: null, result };
    }

    const response = await client.call(name, args, timeoutMs);
    recordCapabilityObservation(name, response.parsed, response.result);
    applyContextCapture(name, response.parsed, ctx, overrides);
    return response;
  }

  beforeAll(async () => {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    resetCapabilityProbes();
    await client.connect();
    toolMap = client.getToolMap();
    overrides = getOverrides(ctx, config);
  });

  afterAll(async () => {
    const results = client.results;
    const byStatus: Record<ToolStatus, number> = {
      PASS: 0,
      SKIP: 0,
      EXPECTED_LIMITATION: 0,
      FAIL: 0,
    };

    for (const result of results) {
      byStatus[normalizeStatus(result)] += 1;
    }

    const report = {
      schemaVersion: 2,
      format: 'jshookmcp-e2e-report',
      timestamp: new Date().toISOString(),
      targetUrl: TARGET_URL,
      serverToolCount: toolMap?.size ?? 0,
      tested: results.length,
      total: results.length,
      pass: byStatus.PASS,
      skip: byStatus.SKIP,
      expectedLimitation: byStatus.EXPECTED_LIMITATION,
      fail: byStatus.FAIL,
      isErrorCount: results.filter((result) => result.isError).length,
      summary: {
        byStatus,
        blockingFailures: byStatus.FAIL,
        nonBlocking: byStatus.SKIP + byStatus.EXPECTED_LIMITATION,
      },
      results: results.map((result) => {
        const status = normalizeStatus(result);
        return { ...result, status, ok: result.ok ?? status === 'PASS' };
      }),
    };

    // Add per-domain coverage analysis
    const coverageReport = analyzeCoverage(toolMap);
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

    const reportPath = join(ARTIFACT_DIR, 'e2e-full-report.json');
    try {
      await writeFile(reportPath, JSON.stringify(fullReport, null, 2));
    } catch {
      /* ignore */
    }

    // Write separate coverage report
    try {
      await writeFile(
        join(ARTIFACT_DIR, 'e2e-coverage-report.json'),
        JSON.stringify(coverageReport, null, 2),
      );
      // Write human-readable summary
      await writeFile(
        join(ARTIFACT_DIR, 'e2e-coverage-summary.txt'),
        formatCoverageReport(coverageReport),
      );
    } catch {
      /* ignore */
    }
    await client.cleanup();
  });

  /* ---------- group phases by execution lane ---------- */
  const browserGroup = ALL_PHASES.filter((p) => (p.group ?? 'browser') === 'browser');
  const computeGroup = ALL_PHASES.filter((p) => p.group === 'compute');
  const cleanupGroup = ALL_PHASES.filter((p) => p.group === 'cleanup');

  /** Register describe/it blocks for a list of phases (sequential between phases). */
  function registerPhases(phases: typeof ALL_PHASES) {
    for (const phase of phases) {
      const phaseOpts =
        phase.concurrent && phase.group === 'compute'
          ? { concurrent: true, timeout: 120_000 }
          : { sequential: true as const, timeout: 120_000 };

      describe(phase.name, phaseOpts, () => {
        beforeAll(async () => {
          if (typeof phase.setup === 'function') {
            await phase.setup(async (name, args, timeout) => {
              const nextOverrides = getOverrides(ctx, config);
              if (shouldSkipTool(name, nextOverrides)) return undefined;
              overrides = nextOverrides;
              const callArgs =
                Object.keys(args ?? {}).length > 0
                  ? args
                  : (overrides[name] ?? buildArgs(toolMap.get(name)?.inputSchema, config));
              const { parsed } = await invokeTool(name, callArgs, timeout ?? 45_000);
              return parsed;
            });
          } else if (Array.isArray(phase.setup)) {
            for (const setupTool of phase.setup) {
              if (!toolMap.has(setupTool)) continue;
              const nextOverrides = getOverrides(ctx, config);
              if (shouldSkipTool(setupTool, nextOverrides)) continue;
              overrides = nextOverrides;
              const args =
                overrides[setupTool] ?? buildArgs(toolMap.get(setupTool)?.inputSchema, config);
              await invokeTool(setupTool, args, 45_000);
              await new Promise((r) => setTimeout(r, 200));
            }
          }
          if (phase.name === 'Browser Launch & Navigation') {
            await new Promise((r) => setTimeout(r, 4_000));
          }
        });

        for (const toolName of phase.tools) {
          it(toolName, async () => {
            const nextOverrides = getOverrides(ctx, config);
            if (shouldSkipTool(toolName, nextOverrides)) return;
            overrides = nextOverrides;
            const args =
              overrides[toolName] ?? buildArgs(toolMap.get(toolName)?.inputSchema, config);

            const isTimeoutProne = [
              'sse_monitor_enable',
              'sse_get_events',
              'performance_get_metrics',
              'performance_start_coverage',
            ].includes(toolName);
            const timeout = isTimeoutProne ? 1500 : config.perToolTimeout;

            const { result } = await invokeTool(toolName, args, timeout);

            if (toolName === 'debugger_wait_for_paused' && normalizeStatus(result) === 'PASS') {
              await new Promise((r) => setTimeout(r, 500));
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

  /* Execute browser -> compute -> cleanup in declaration order. */
  describe('Browser-dependent', { sequential: true as const, timeout: 300_000 }, () => {
    registerPhases(browserGroup);
  });

  describe('Pure Compute', { sequential: true as const, timeout: 300_000 }, () => {
    registerPhases(computeGroup);
  });

  describe('Cleanup', { sequential: true as const, timeout: 300_000 }, () => {
    registerPhases(cleanupGroup);
  });
});
