/**
 * Shared search quality fixture — single source of truth for:
 *   - tests/server/search/SearchQuality.test.ts (regression)
 *   - scripts/search-tune/ (offline parameter tuning)
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolProfile } from '@server/ToolCatalog';

// ── public types ──

export type SearchCaseTag =
  | 'browser'
  | 'network'
  | 'debugger'
  | 'analysis'
  | 'synonym'
  | 'fuzzy'
  | 'exact'
  | 'workflow'
  | 'extension'
  | 'protocol'
  | 'evidence'
  | 'v8-inspector'
  | 'boringssl'
  | 'binary-instrument'
  | 'adb-bridge'
  | 'mojo-ipc'
  | 'syscall-hook';

export interface SearchExpectation {
  readonly tool: string;
  readonly gain: 1 | 2 | 3;
}

export interface SearchEvalCase {
  readonly id: string;
  readonly title: string;
  readonly query: string;
  readonly topK: number;
  readonly expectations: readonly SearchExpectation[];
  readonly idealTool?: string;
  readonly profile?: ToolProfile;
  readonly visibleDomains?: readonly string[];
  readonly tags: readonly SearchCaseTag[];
  readonly notes?: string;
}

export interface SearchQualityFixture {
  readonly tools: readonly Tool[];
  readonly domainByToolName: ReadonlyMap<string, string>;
  readonly cases: readonly SearchEvalCase[];
}

// ── helpers ──

function makeTool(name: string, description: string): Tool {
  return { name, description, inputSchema: { type: 'object', properties: {} } };
}

// ── domain resolver ──

export function resolveSearchQualityToolDomain(name: string): string | null {
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
  if (
    name.startsWith('debug_') ||
    name === 'breakpoint' ||
    name.startsWith('breakpoint_') ||
    name === 'watch'
  )
    return 'debugger';
  if (name.startsWith('network_') || name.startsWith('ws_') || name.startsWith('sse_'))
    return 'network';
  if (
    name.startsWith('workflow_') ||
    name.startsWith('run_extension_') ||
    name.startsWith('list_extension_') ||
    name.startsWith('api_probe_') ||
    name.startsWith('page_script_')
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
}

// ── mock tool catalog ──

const TOOLS: readonly Tool[] = [
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
  makeTool('ws_monitor', 'Enable or disable WebSocket frame monitoring'),
  makeTool('ws_get_frames', 'Get captured WebSocket frames'),
  makeTool('sse_monitor_enable', 'Enable Server-Sent Events monitoring'),
  // debugger
  makeTool('debug_pause', 'Pause JavaScript execution'),
  makeTool('debug_resume', 'Resume paused JavaScript execution'),
  makeTool('breakpoint', 'Set, remove, or list breakpoints'),
  makeTool('watch', 'Add, remove, list, evaluate, or clear watch expressions'),
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
  makeTool('evidence_query', 'Query evidence graph by URL, function name, or script ID'),
  makeTool('evidence_export', 'Export evidence graph as JSON or Markdown'),
  // workflow
  makeTool('run_extension_workflow', 'Run an installed extension workflow'),
  makeTool('list_extension_workflows', 'List available extension workflows'),
  makeTool('api_probe_batch', 'Probe multiple API endpoints in a single workflow burst'),
  // v8-inspector
  makeTool('v8_heap_snapshot_capture', 'Capture V8 heap snapshot via CDP'),
  makeTool('v8_heap_snapshot_analyze', 'Analyze V8 heap snapshot for leaks'),
  makeTool('v8_bytecode_extract', 'Attempt V8 bytecode extraction for a script'),
  makeTool('v8_jit_inspect', 'Inspect JIT status and optimization'),
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
  makeTool('mojo_monitor', 'Start or stop monitoring Chromium Mojo IPC messages'),
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

// ── evaluation cases ──

const CASES: readonly SearchEvalCase[] = [
  // browser
  {
    id: 'browser-navigate',
    title: 'browser: "navigate to URL" → page_navigate in top-3',
    query: 'navigate to URL',
    topK: 10,
    expectations: [{ tool: 'page_navigate', gain: 3 }],
    idealTool: 'page_navigate',
    tags: ['browser'],
  },
  {
    id: 'browser-click',
    title: 'browser: "click on element" → page_click in top-3',
    query: 'click on element',
    topK: 10,
    expectations: [{ tool: 'page_click', gain: 3 }],
    idealTool: 'page_click',
    tags: ['browser'],
  },
  {
    id: 'browser-screenshot',
    title: 'browser: "screenshot page" → page_screenshot in top-3',
    query: 'take a screenshot',
    topK: 10,
    expectations: [{ tool: 'page_screenshot', gain: 3 }],
    idealTool: 'page_screenshot',
    tags: ['browser'],
  },
  // network
  {
    id: 'network-capture',
    title: 'network: "capture network requests" → network_enable in top-3',
    query: 'capture network requests',
    topK: 10,
    expectations: [{ tool: 'network_enable', gain: 3 }],
    idealTool: 'network_enable',
    tags: ['network'],
  },
  {
    id: 'network-auth',
    title: 'network: "extract auth token" → network_extract_auth in top-3',
    query: 'extract authentication tokens',
    topK: 10,
    expectations: [{ tool: 'network_extract_auth', gain: 3 }],
    idealTool: 'network_extract_auth',
    tags: ['network'],
  },
  {
    id: 'network-intercept',
    title: 'network: "intercept API calls" → fetch interceptor or network tool in top-5',
    query: 'intercept API calls',
    topK: 10,
    expectations: [
      { tool: 'console_inject_fetch_interceptor', gain: 3 },
      { tool: 'network_enable', gain: 2 },
      { tool: 'run_extension_workflow', gain: 2 },
    ],
    tags: ['network'],
  },
  // debugger
  {
    id: 'debugger-breakpoint',
    title: 'debugger: "set a breakpoint" → breakpoint in top-3',
    query: 'set a breakpoint at line 42',
    topK: 10,
    expectations: [{ tool: 'breakpoint', gain: 3 }],
    idealTool: 'breakpoint',
    tags: ['debugger'],
  },
  {
    id: 'debugger-pause',
    title: 'debugger: "pause execution" → debug_pause in top-3',
    query: 'pause JavaScript execution',
    topK: 10,
    expectations: [{ tool: 'debug_pause', gain: 3 }],
    idealTool: 'debug_pause',
    tags: ['debugger'],
  },
  // analysis
  {
    id: 'analysis-crypto',
    title: 'analysis: "detect crypto" → detect_crypto in top-10',
    query: 'detect crypto operations',
    topK: 10,
    expectations: [{ tool: 'detect_crypto', gain: 3 }],
    idealTool: 'detect_crypto',
    tags: ['analysis'],
  },
  {
    id: 'analysis-search-scripts',
    title: 'analysis: "search for strings in scripts" → search_in_scripts in top-3',
    query: 'search for patterns in loaded scripts',
    topK: 10,
    expectations: [{ tool: 'search_in_scripts', gain: 3 }],
    idealTool: 'search_in_scripts',
    tags: ['analysis'],
  },
  // synonym
  {
    id: 'synonym-sniff',
    title: 'synonym: "sniff traffic" → network tools via synonym expansion',
    query: 'sniff HTTP traffic',
    topK: 10,
    expectations: [
      { tool: 'network_enable', gain: 3 },
      { tool: 'network_get_requests', gain: 2 },
    ],
    tags: ['synonym', 'network'],
  },
  {
    id: 'synonym-snapshot',
    title: 'synonym: "snapshot page" → page_screenshot via synonym',
    query: 'snapshot the page',
    topK: 10,
    expectations: [{ tool: 'page_screenshot', gain: 3 }],
    idealTool: 'page_screenshot',
    tags: ['synonym', 'browser'],
    notes: '"snapshot" triggers evidence intent boost; page_screenshot may be pushed down',
  },
  // fuzzy (trigram)
  {
    id: 'fuzzy-navigate',
    title: 'fuzzy: "nagivate" → page_navigate via trigram',
    query: 'nagivate page',
    topK: 10,
    expectations: [{ tool: 'page_navigate', gain: 3 }],
    idealTool: 'page_navigate',
    tags: ['fuzzy', 'browser'],
  },
  // exact name match
  {
    id: 'exact-navigate',
    title: 'exact: "page_navigate" → page_navigate as top-1',
    query: 'page_navigate',
    topK: 10,
    expectations: [{ tool: 'page_navigate', gain: 3 }],
    idealTool: 'page_navigate',
    tags: ['exact', 'browser'],
  },
  // v8-inspector
  {
    id: 'v8-heap-snapshot',
    title: 'v8-inspector: "V8 heap snapshot" → v8_heap_snapshot_capture in top-10',
    query: 'V8 heap snapshot capture',
    topK: 10,
    expectations: [{ tool: 'v8_heap_snapshot_capture', gain: 3 }],
    idealTool: 'v8_heap_snapshot_capture',
    tags: ['v8-inspector'],
  },
  {
    id: 'v8-bytecode',
    title: 'v8-inspector: "bytecode extraction" → v8_bytecode_extract in top-3',
    query: 'extract V8 bytecode',
    topK: 10,
    expectations: [{ tool: 'v8_bytecode_extract', gain: 3 }],
    idealTool: 'v8_bytecode_extract',
    tags: ['v8-inspector'],
  },
  // boringssl-inspector
  {
    id: 'boringssl-tls-keylog',
    title: 'boringssl: "TLS key log" → tls_keylog_enable in top-3',
    query: 'enable TLS key logging',
    topK: 10,
    expectations: [{ tool: 'tls_keylog_enable', gain: 3 }],
    idealTool: 'tls_keylog_enable',
    tags: ['boringssl'],
  },
  // binary-instrument
  {
    id: 'binary-frida',
    title: 'binary: "attach Frida" → frida_attach in top-3',
    query: 'attach Frida to process',
    topK: 10,
    expectations: [{ tool: 'frida_attach', gain: 3 }],
    idealTool: 'frida_attach',
    tags: ['binary-instrument'],
  },
  {
    id: 'binary-jadx',
    title: 'binary: "decompile APK" → jadx_decompile in top-3',
    query: 'decompile APK using JADX',
    topK: 10,
    expectations: [{ tool: 'jadx_decompile', gain: 3 }],
    idealTool: 'jadx_decompile',
    tags: ['binary-instrument'],
  },
  // adb-bridge
  {
    id: 'adb-devices',
    title: 'adb: "list Android devices" → adb_devices in top-3',
    query: 'list Android devices connected via ADB',
    topK: 10,
    expectations: [{ tool: 'adb_devices', gain: 3 }],
    idealTool: 'adb_devices',
    tags: ['adb-bridge'],
  },
  // mojo-ipc
  {
    id: 'mojo-monitor',
    title: 'mojo: "monitor Mojo IPC" → mojo_monitor in top-3',
    query: 'monitor Chromium Mojo IPC messages',
    topK: 10,
    expectations: [{ tool: 'mojo_monitor', gain: 3 }],
    idealTool: 'mojo_monitor',
    tags: ['mojo-ipc'],
  },
  // syscall-hook
  {
    id: 'syscall-monitor',
    title: 'syscall: "monitor syscalls" → syscall_start_monitor in top-3',
    query: 'monitor system calls via ETW',
    topK: 10,
    expectations: [{ tool: 'syscall_start_monitor', gain: 3 }],
    idealTool: 'syscall_start_monitor',
    tags: ['syscall-hook'],
  },
  // extension-registry
  {
    id: 'extension-install',
    title: 'extension: "install extension" → install_extension in top-3',
    query: 'install a plugin from the registry',
    topK: 10,
    expectations: [{ tool: 'install_extension', gain: 3 }],
    idealTool: 'install_extension',
    tags: ['extension'],
  },
  // workflow (intent boost)
  {
    id: 'intent-workflow',
    title: 'intent: "run a workflow" → run_extension_workflow should be in top-3',
    query: 'execute an extension workflow',
    topK: 10,
    expectations: [{ tool: 'run_extension_workflow', gain: 3 }],
    idealTool: 'run_extension_workflow',
    tags: ['workflow'],
  },
  // protocol-analysis
  {
    id: 'protocol-decode',
    title: 'protocol: "decode packet fields" → packet_decode_field in top-3',
    query: 'decode fields from binary packet',
    topK: 10,
    expectations: [{ tool: 'packet_decode_field', gain: 3 }],
    idealTool: 'packet_decode_field',
    tags: ['protocol'],
  },
  // evidence
  {
    id: 'evidence-export',
    title: 'evidence: "export evidence report" → evidence tools in top-5',
    query: 'export evidence as markdown report',
    topK: 10,
    expectations: [
      { tool: 'evidence_export', gain: 3 },
      { tool: 'evidence_query', gain: 2 },
    ],
    tags: ['evidence'],
  },
];

// ── fixture builder ──

export function buildSearchQualityFixture(): SearchQualityFixture {
  const domainByToolName = new Map<string, string>();
  for (const tool of TOOLS) {
    const domain = resolveSearchQualityToolDomain(tool.name);
    if (domain) {
      domainByToolName.set(tool.name, domain);
    }
  }
  return { tools: TOOLS, domainByToolName, cases: CASES };
}
