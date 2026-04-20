import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const state = vi.hoisted(() => ({
  allTools: [] as Tool[],
  getToolDomain: vi.fn((name: string) => {
    if (
      name.startsWith('page_') ||
      name.startsWith('browser_') ||
      name.startsWith('console_') ||
      name.startsWith('tab_') ||
      name.startsWith('captcha_') ||
      name.startsWith('stealth_') ||
      name.startsWith('dom_')
    )
      return 'browser';
    if (name.startsWith('debug_') || name.startsWith('breakpoint_')) return 'debugger';
    if (name.startsWith('network_') || name.startsWith('ws_') || name.startsWith('sse_'))
      return 'network';
    if (
      name.startsWith('workflow_') ||
      name.startsWith('web_api_') ||
      name.startsWith('run_extension_') ||
      name.startsWith('list_extension_')
    )
      return 'workflow';
    if (
      name.startsWith('analysis_') ||
      name.startsWith('deobfuscate') ||
      name.startsWith('detect_') ||
      name.startsWith('search_in_') ||
      name.startsWith('collect_') ||
      name.startsWith('manage_hooks') ||
      name.startsWith('extract_function')
    )
      return 'analysis';
    if (name.startsWith('transform_') || name.startsWith('ast_') || name.startsWith('webcrack_'))
      return 'transform';
    if (name.startsWith('memory_') || name.startsWith('heap_')) return 'memory';
    if (name.startsWith('process_')) return 'process';
    if (name.startsWith('hook_')) return 'hooks';
    if (name.startsWith('encode_') || name.startsWith('decode_')) return 'encoding';
    if (name.startsWith('graphql_')) return 'graphql';
    if (name.startsWith('stream_')) return 'streaming';
    if (name.startsWith('wasm_')) return 'wasm';
    if (
      name.startsWith('sourcemap_') ||
      name.startsWith('source_map_') ||
      name.startsWith('js_bundle_') ||
      name.startsWith('webpack_')
    )
      return 'sourcemap';
    if (name.startsWith('trace_')) return 'trace';
    if (name.startsWith('evidence_')) return 'evidence';
    if (name.startsWith('instrumentation_')) return 'instrumentation';
    if (name.startsWith('coordination_')) return 'coordination';
    if (name.startsWith('maintenance_')) return 'maintenance';
    if (name.startsWith('macro_')) return 'macro';
    if (name.startsWith('sandbox_')) return 'sandbox';
    if (name.startsWith('canvas_')) return 'canvas';
    if (name.startsWith('shared_state_')) return 'shared-state-board';
    if (name.startsWith('v8_')) return 'v8-inspector';
    if (name.startsWith('boringssl_') || name.startsWith('tls_')) return 'boringssl-inspector';
    if (name.startsWith('skia_')) return 'skia-capture';
    if (
      name.startsWith('frida_') ||
      name.startsWith('ghidra_') ||
      name.startsWith('unidbg_') ||
      name.startsWith('jadx_') ||
      name.startsWith('generate_hooks')
    )
      return 'binary-instrument';
    if (name.startsWith('adb_') || name.startsWith('android_')) return 'adb-bridge';
    if (name.startsWith('mojo_')) return 'mojo-ipc';
    if (name.startsWith('syscall_')) return 'syscall-hook';
    if (name.startsWith('protocol_') || name.startsWith('packet_')) return 'protocol-analysis';
    if (
      name.startsWith('extension_') ||
      name === 'webhook' ||
      name.startsWith('ble_') ||
      name.startsWith('serial_')
    )
      return 'extension-registry';
    if (name.startsWith('platform_')) return 'platform';
    if (name.startsWith('antidebug_')) return 'antidebug';
    return null;
  }),
}));

vi.mock('@server/ToolCatalog', () => ({
  get allTools() {
    return state.allTools;
  },
  getToolDomain: state.getToolDomain,
}));

vi.mock('@src/constants', () => ({
  SEARCH_TFIDF_COSINE_WEIGHT: 0,
  SEARCH_AFFINITY_BOOST_FACTOR: 0.15,
  SEARCH_AFFINITY_TOP_N: 5,
  SEARCH_DOMAIN_HUB_THRESHOLD: 3,
  SEARCH_QUERY_CACHE_CAPACITY: 500,
  SEARCH_TRIGRAM_WEIGHT: 0.12,
  SEARCH_TRIGRAM_THRESHOLD: 0.35,
  SEARCH_RRF_K: 60,
  SEARCH_RRF_RESCALE_FACTOR: 1000,
  SEARCH_RRF_BM25_BLEND: 0.5,
  SEARCH_SYNONYM_EXPANSION_LIMIT: 3,
  SEARCH_PARAM_TOKEN_WEIGHT: 1.5,
  SEARCH_BM25_K1: 1.5,
  SEARCH_BM25_B: 0.75,
  SEARCH_CACHE_VECTOR_WEIGHT_TOLERANCE: 0.05,
  SEARCH_TIER_PENALTY: 0.7,
  SEARCH_RECENCY_WINDOW_MS: 0,
  SEARCH_RECENCY_MAX_BOOST: 0,
  SEARCH_EXACT_NAME_MATCH_MULTIPLIER: 2.5,
  SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER: 1.08,
  SEARCH_AFFINITY_BASE_WEIGHT: 0.3,
  SEARCH_COVERAGE_PRECISION_FACTOR: 0.5,
  SEARCH_PREFIX_MATCH_MULTIPLIER: 0.5,
  SEARCH_VECTOR_ENABLED: false,
  SEARCH_VECTOR_MODEL_ID: 'Xenova/bge-micro-v2',
  SEARCH_VECTOR_COSINE_WEIGHT: 0.4,
  SEARCH_VECTOR_DYNAMIC_WEIGHT: false,
  SEARCH_VECTOR_LEARN_UP: 0.05,
  SEARCH_VECTOR_LEARN_DOWN: 0.03,
  SEARCH_VECTOR_LEARN_TOP_N: 5,
  SEARCH_RECENCY_TRACKER_MAX: 200,
}));

function makeTool(name: string, description: string): Tool {
  return { name, description, inputSchema: { type: 'object', properties: {} } };
}

function topNames(results: { name: string }[], k: number): string[] {
  return results.slice(0, k).map((r) => r.name);
}

const TOOLS = [
  // browser
  makeTool('page_navigate', 'Navigate to a URL in the browser tab'),
  makeTool('page_click', 'Click on a DOM element'),
  makeTool('page_screenshot', 'Take a screenshot of the current page'),
  makeTool('page_evaluate', 'Evaluate JavaScript in the page context'),
  makeTool('dom_query', 'Query DOM elements using CSS selectors'),
  makeTool('tab_workflow', 'Manage browser tabs: create, switch, close'),
  makeTool('captcha_detect', 'Detect CAPTCHA challenges on the page'),
  makeTool('stealth_inject', 'Inject stealth scripts to avoid detection'),
  makeTool(
    'console_inject_fetch_interceptor',
    'Inject a Fetch API interceptor to capture requests',
  ),
  // network
  makeTool('network_enable', 'Enable network request monitoring and capture'),
  makeTool('network_get_requests', 'List captured network requests'),
  makeTool('network_extract_auth', 'Extract authentication tokens from network traffic'),
  makeTool('network_export_har', 'Export network capture as HAR file'),
  makeTool('network_replay_request', 'Replay a previously captured network request'),
  makeTool('ws_monitor_enable', 'Enable WebSocket frame monitoring'),
  makeTool('ws_get_frames', 'Get captured WebSocket frames'),
  makeTool('sse_monitor_enable', 'Enable Server-Sent Events monitoring'),
  // debugger
  makeTool('debug_pause', 'Pause JavaScript execution'),
  makeTool('debug_resume', 'Resume paused JavaScript execution'),
  makeTool('breakpoint_set', 'Set a breakpoint at a URL and line number'),
  makeTool('breakpoint_list', 'List all active breakpoints'),
  // analysis
  makeTool('search_in_scripts', 'Search for patterns in loaded scripts'),
  makeTool('collect_code', 'Collect JavaScript source code from the page'),
  makeTool('detect_crypto', 'Detect cryptographic operations in scripts'),
  makeTool('manage_hooks', 'Create and manage function hooks and interceptors'),
  makeTool('extract_function_tree', 'Extract call tree for a function'),
  makeTool('deobfuscate', 'Deobfuscate JavaScript code'),
  makeTool('detect_obfuscation', 'Detect code obfuscation techniques'),
  // transform
  makeTool('webcrack_unpack', 'Unpack webcrack-bundled JavaScript'),
  makeTool('ast_transform_apply', 'Apply AST transformations to code'),
  // sourcemap
  makeTool('js_bundle_search', 'Search for strings in JS bundles'),
  makeTool('webpack_enumerate', 'Enumerate webpack modules in a bundle'),
  makeTool('sourcemap_fetch_and_parse', 'Extract and parse source maps'),
  // hooks
  makeTool('hook_function', 'Hook a JavaScript function with before/after callbacks'),
  // memory
  makeTool('memory_scan', 'Scan process memory for patterns'),
  makeTool('heap_snapshot', 'Capture a heap snapshot'),
  // evidence
  makeTool('evidence_query_url', 'Query evidence collected for a URL'),
  makeTool('evidence_export_markdown', 'Export evidence as a markdown report'),
  makeTool('evidence_export_json', 'Export evidence as JSON'),
  // workflow
  makeTool('run_extension_workflow', 'Run an installed extension workflow'),
  makeTool('list_extension_workflows', 'List available extension workflows'),
  makeTool('web_api_capture_session', 'Full-chain web API capture session'),
  // v8-inspector
  makeTool('v8_heap_snapshot_capture', 'Capture V8 heap snapshot via CDP'),
  makeTool('v8_heap_snapshot_analyze', 'Analyze V8 heap snapshot for leaks'),
  makeTool('v8_bytecode_extract', 'Extract V8 Ignition bytecode for a function'),
  makeTool('v8_jit_inspect', 'Inspect JIT-compiled assembly and optimization'),
  // boringssl-inspector
  makeTool('tls_keylog_enable', 'Enable TLS key logging via BoringSSL'),
  makeTool('tls_cert_extract', 'Extract TLS certificates from connections'),
  makeTool('tls_parse_handshake', 'Parse TLS handshake messages'),
  // skia-capture
  makeTool('skia_detect_renderer', 'Detect Skia GPU backend and renderer'),
  makeTool('skia_extract_scene', 'Extract Skia scene tree from page'),
  // binary-instrument
  makeTool('frida_attach', 'Attach Frida to a target process'),
  makeTool('ghidra_analyze', 'Analyze binary with Ghidra'),
  makeTool('jadx_decompile', 'Decompile APK using JADX'),
  makeTool('generate_hooks', 'Generate Frida hook scripts automatically'),
  // adb-bridge
  makeTool('adb_devices', 'List connected Android devices'),
  makeTool('adb_webview_debug', 'Enable WebView debugging on Android device'),
  // mojo-ipc
  makeTool('mojo_monitor_start', 'Start monitoring Chromium Mojo IPC messages'),
  makeTool('mojo_decode_message', 'Decode a Mojo IPC message'),
  // syscall-hook
  makeTool('syscall_start_monitor', 'Start monitoring system calls via ETW/strace'),
  makeTool('syscall_capture_events', 'Capture and filter syscall events'),
  // protocol-analysis
  makeTool('protocol_define_pattern', 'Define a protocol message pattern'),
  makeTool('packet_decode_field', 'Decode fields from a binary packet'),
  // extension-registry
  makeTool('install_extension', 'Install an extension from registry'),
  makeTool('extension_list_installed', 'List installed extensions'),
  makeTool('webhook', 'Create and manage webhook endpoints'),
  // antidebug
  makeTool('antidebug_bypass', 'Bypass common anti-debugging protections'),
  // encoding
  makeTool('decode_base64', 'Decode base64 encoded strings'),
  // macro
  makeTool('macro_record', 'Record a macro sequence of tool calls'),
];

describe('search/SearchQuality', () => {
  beforeEach(() => {
    vi.resetModules();
    state.getToolDomain.mockClear();
    state.allTools = TOOLS;
  });

  // ── Core browser domain ──

  it('browser: "navigate to URL" → page_navigate in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('navigate to URL', 10);
    expect(topNames(results, 3)).toContain('page_navigate');
  });

  it('browser: "click on element" → page_click in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('click on element', 10);
    expect(topNames(results, 3)).toContain('page_click');
  });

  it('browser: "screenshot page" → page_screenshot in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('take a screenshot', 10);
    expect(topNames(results, 3)).toContain('page_screenshot');
  });

  // ── Network domain ──

  it('network: "capture network requests" → network_enable in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('capture network requests', 10);
    expect(topNames(results, 3)).toContain('network_enable');
  });

  it('network: "extract auth token" → network_extract_auth in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('extract authentication tokens', 10);
    expect(topNames(results, 3)).toContain('network_extract_auth');
  });

  it('network: "intercept API calls" → fetch interceptor or network tool in top-5', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('intercept API calls', 10);
    const top5 = topNames(results, 5);
    const hasRelevant = top5.some(
      (n) => n.includes('intercept') || n.includes('network') || n.includes('capture'),
    );
    expect(hasRelevant).toBe(true);
  });

  // ── Debugger domain ──

  it('debugger: "set a breakpoint" → breakpoint_set in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('set a breakpoint at line 42', 10);
    expect(topNames(results, 3)).toContain('breakpoint_set');
  });

  it('debugger: "pause execution" → debug_pause in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('pause JavaScript execution', 10);
    expect(topNames(results, 3)).toContain('debug_pause');
  });

  // ── Analysis domain ──

  it('analysis: "detect crypto" → detect_crypto in top-10', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('detect crypto operations', 10);
    expect(topNames(results, 10)).toContain('detect_crypto');
  });

  it('analysis: "search for strings in scripts" → search_in_scripts in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('search for patterns in loaded scripts', 10);
    expect(topNames(results, 3)).toContain('search_in_scripts');
  });

  // ── Synonym expansion ──

  it('synonym: "sniff traffic" → network tools via synonym expansion', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('sniff HTTP traffic', 10);
    const top5 = topNames(results, 5);
    const hasNetwork = top5.some((n) => n.startsWith('network'));
    expect(hasNetwork).toBe(true);
  });

  it('synonym: "snapshot page" → page_screenshot via synonym', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('snapshot the page', 10);
    // "snapshot" triggers evidence intent boost; page_screenshot may be pushed down
    expect(topNames(results, 10)).toContain('page_screenshot');
  });

  // ── Trigram fuzzy matching ──

  it('fuzzy: "nagivate" → page_navigate via trigram', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('nagivate page', 10);
    expect(topNames(results, 5)).toContain('page_navigate');
  });

  // ── Exact name match ──

  it('exact: "page_navigate" → page_navigate as top-1', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('page_navigate', 10);
    expect(results[0]!.name).toBe('page_navigate');
  });

  // ── v8-inspector (new domain) ──

  it('v8-inspector: "V8 heap snapshot" → v8_heap_snapshot_capture in top-10', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('V8 heap snapshot capture', 10);
    expect(topNames(results, 10)).toContain('v8_heap_snapshot_capture');
  });

  it('v8-inspector: "bytecode extraction" → v8_bytecode_extract in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('extract V8 bytecode', 10);
    expect(topNames(results, 3)).toContain('v8_bytecode_extract');
  });

  // ── boringssl-inspector (new domain) ──

  it('boringssl: "TLS key log" → tls_keylog_enable in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('enable TLS key logging', 10);
    expect(topNames(results, 3)).toContain('tls_keylog_enable');
  });

  // ── binary-instrument (new domain) ──

  it('binary: "attach Frida" → frida_attach in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('attach Frida to process', 10);
    expect(topNames(results, 3)).toContain('frida_attach');
  });

  it('binary: "decompile APK" → jadx_decompile in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('decompile APK using JADX', 10);
    expect(topNames(results, 3)).toContain('jadx_decompile');
  });

  // ── adb-bridge (new domain) ──

  it('adb: "list Android devices" → adb_devices in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('list Android devices connected via ADB', 10);
    expect(topNames(results, 3)).toContain('adb_devices');
  });

  // ── mojo-ipc (new domain) ──

  it('mojo: "monitor Mojo IPC" → mojo_monitor_start in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('monitor Chromium Mojo IPC messages', 10);
    expect(topNames(results, 3)).toContain('mojo_monitor_start');
  });

  // ── syscall-hook (new domain) ──

  it('syscall: "monitor syscalls" → syscall_start_monitor in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('monitor system calls via ETW', 10);
    expect(topNames(results, 3)).toContain('syscall_start_monitor');
  });

  // ── extension-registry (new domain) ──

  it('extension: "install extension" → install_extension in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('install a plugin from the registry', 10);
    expect(topNames(results, 3)).toContain('install_extension');
  });

  // ── Intent boost: workflow/extension should rank high ──

  it('intent: "encrypt signature" → run_extension_workflow should be in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('detect encrypt signature in code', 10);
    expect(topNames(results, 3)).toContain('run_extension_workflow');
  });

  // ── Protocol analysis ──

  it('protocol: "decode packet fields" → packet_decode_field in top-3', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('decode fields from binary packet', 10);
    expect(topNames(results, 3)).toContain('packet_decode_field');
  });

  // ── Evidence ──

  it('evidence: "export evidence report" → evidence tools in top-5', async () => {
    const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
    const engine = new ToolSearchEngine();
    const results = await engine.search('export evidence as markdown report', 10);
    const top5 = topNames(results, 5);
    const hasEvidence = top5.some((n) => n.startsWith('evidence'));
    expect(hasEvidence).toBe(true);
  });
});
