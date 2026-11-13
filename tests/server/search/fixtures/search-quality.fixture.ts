/**
 * Shared search quality fixture — single source of truth for:
 *   - tests/server/search/SearchQuality.test.ts (regression)
 *   - scripts/search-tune/ (offline parameter tuning)
 */
import type { Tool } from '@modelcontextprotocol/server';
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
  | 'tls-inspector'
  | 'binary-instrument'
  | 'adb-bridge'
  | 'mojo-ipc'
  | 'syscall-hook'
  | 'canvas'
  | 'webgpu'
  | 'wasm'
  | 'graphql'
  | 'dart-inspector'
  | 'sourcemap'
  | 'streaming'
  | 'proxy'
  | 'session'
  | 'tasks'
  | 'coordination'
  | 'cross-domain'
  | 'native-bridge'
  | 'process'
  | 'trace'
  | 'realtime';

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

/**
 * One rule in the tool-name → domain table.
 *
 * `prefixes` are matched with `startsWith`; `exact` names are matched with
 * `===`. A rule may use either or both.
 */
interface DomainRule {
  domain: string;
  prefixes?: readonly string[];
  exact?: readonly string[];
}

/**
 * Ordered rules — FIRST MATCH WINS, and the order is load-bearing.
 *
 * Two spots that look reorderable but are not:
 *   - `page_` appears in the browser rule, which comes BEFORE the workflow rule
 *     containing `page_script_`, so `page_script_*` resolves to 'workflow'
 *     only because `page_` is checked earlier and cannot match it... it can, so
 *     `page_script_*` actually lands in 'browser'. That is the current
 *     behaviour and the fixture depends on it.
 *   - `shared_state_` / `state_board` sit in a later coordination rule than
 *     the `sourcemap_` group; moving them changes nothing today but pins the
 *     intended grouping.
 *
 * New prefixes must be appended where their precedence belongs, not at the
 * end, or previously-resolved tools silently change domain.
 */
const DOMAIN_RULES: readonly DomainRule[] = [
  {
    domain: 'browser',
    prefixes: ['page_', 'browser_', 'console_', 'tab_', 'captcha_', 'stealth_', 'dom_'],
  },
  {
    domain: 'debugger',
    prefixes: ['debug_', 'breakpoint_'],
    exact: ['breakpoint', 'watch'],
  },
  {
    domain: 'network',
    prefixes: ['network_', 'ws_', 'sse_'],
  },
  {
    domain: 'workflow',
    prefixes: ['workflow_', 'run_extension_', 'list_extension_', 'api_probe_', 'page_script_'],
  },
  {
    domain: 'analysis',
    prefixes: [
      'analysis_',
      'deobfuscate',
      'detect_',
      'search_in_',
      'collect_',
      'manage_hooks',
      'extract_function',
    ],
  },
  {
    domain: 'transform',
    prefixes: ['transform_', 'ast_', 'webcrack_'],
  },
  {
    domain: 'memory',
    prefixes: ['memory_', 'heap_'],
  },
  {
    domain: 'process',
    prefixes: ['process_'],
  },
  {
    domain: 'instrumentation',
    prefixes: ['hook_', 'ai_hook_', 'evidence_'],
  },
  {
    domain: 'encoding',
    prefixes: ['encode_', 'decode_', 'binary_'],
  },
  {
    domain: 'graphql',
    prefixes: ['graphql_'],
  },
  {
    domain: 'streaming',
    prefixes: ['stream_'],
  },
  {
    domain: 'wasm',
    prefixes: ['wasm_'],
  },
  {
    domain: 'sourcemap',
    prefixes: ['sourcemap_', 'source_map_', 'js_bundle_', 'webpack_'],
  },
  {
    domain: 'trace',
    prefixes: ['trace_'],
  },
  {
    domain: 'instrumentation',
    prefixes: ['instrumentation_'],
  },
  {
    domain: 'coordination',
    prefixes: ['coordination_'],
  },
  {
    domain: 'maintenance',
    prefixes: ['maintenance_'],
  },
  {
    domain: 'workflow',
    prefixes: ['macro_'],
  },
  {
    domain: 'maintenance',
    prefixes: ['sandbox_'],
  },
  {
    domain: 'canvas',
    prefixes: ['canvas_'],
  },
  {
    domain: 'coordination',
    prefixes: ['shared_state_', 'state_board'],
  },
  {
    domain: 'v8-inspector',
    prefixes: ['v8_'],
  },
  {
    domain: 'tls-inspector',
    prefixes: ['tls_'],
  },
  {
    domain: 'canvas',
    prefixes: ['skia_'],
  },
  {
    domain: 'binary-instrument',
    prefixes: ['frida_', 'ghidra_', 'unidbg_', 'jadx_', 'generate_hooks'],
  },
  {
    domain: 'adb-bridge',
    prefixes: ['adb_', 'android_'],
  },
  {
    domain: 'mojo-ipc',
    prefixes: ['mojo_'],
  },
  {
    domain: 'syscall-hook',
    prefixes: ['syscall_'],
  },
  {
    domain: 'protocol-analysis',
    prefixes: ['protocol_', 'packet_', 'proto_', 'pcap_'],
  },
  {
    domain: 'extension-registry',
    prefixes: ['extension_', 'ble_', 'serial_'],
    exact: ['webhook'],
  },
  {
    domain: 'platform',
    prefixes: ['platform_'],
  },
  {
    domain: 'debugger',
    prefixes: ['antidebug_'],
  },
  {
    domain: 'session',
    prefixes: ['session_'],
  },
  {
    domain: 'tasks',
    prefixes: ['tasks_'],
  },
  {
    domain: 'cross-domain',
    prefixes: ['cross_domain_'],
  },
  {
    domain: 'native-bridge',
    prefixes: [
      'native_bridge_',
      'ghidra_bridge',
      'ida_bridge',
      'rizin_bridge',
      'binary_ninja_bridge',
      'native_symbol_',
    ],
  },
];

function ruleMatches(rule: DomainRule, name: string): boolean {
  if (rule.exact?.includes(name)) {
    return true;
  }
  return rule.prefixes?.some((prefix) => name.startsWith(prefix)) ?? false;
}

export function resolveSearchQualityToolDomain(name: string): string | null {
  for (const rule of DOMAIN_RULES) {
    if (ruleMatches(rule, name)) {
      return rule.domain;
    }
  }
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
  makeTool('browser_launch', 'Launch a new browser instance for automation'),
  makeTool('browser_attach', 'Attach to an existing browser page via CDP'),
  makeTool(
    'console_inject_fetch_interceptor',
    'Inject a Fetch API interceptor to capture requests',
  ),
  makeTool(
    'console_inject_xhr_interceptor',
    'Inject an XMLHttpRequest interceptor to capture calls',
  ),
  // network
  makeTool('network_enable', 'Enable network request monitoring and capture'),
  makeTool('network_monitor', 'Start monitoring network traffic and intercept requests'),
  makeTool('network_get_requests', 'List captured network requests'),
  makeTool('network_extract_auth', 'Extract authentication tokens from network traffic'),
  makeTool('network_export_har', 'Export network capture as HAR file'),
  makeTool('network_replay_request', 'Replay a previously captured network request'),
  // network interference: real-registry tools that crowd generic queries like
  // "capture"/"sniff traffic" — without these the fixture under-models the
  // ranking difficulty present in the 636-tool catalog.
  makeTool('network_intercept', 'Intercept and modify network requests in flight'),
  makeTool('http_plain_request', 'Send a raw plain HTTP request over TCP'),
  makeTool('http_request_build', 'Build a raw HTTP request payload'),
  makeTool('http2_probe', 'Probe an HTTP/2 endpoint'),
  makeTool('ws_monitor', 'Enable or disable WebSocket frame monitoring'),
  makeTool('ws_get_frames', 'Get captured WebSocket frames'),
  makeTool('ws_export_capture', 'Export captured WebSocket frames as JSON or NDJSON'),
  makeTool('sse_monitor_enable', 'Enable Server-Sent Events monitoring'),
  makeTool('sse_export_capture', 'Export captured SSE events as JSON or NDJSON'),
  makeTool('webrtc_export_capture', 'Export captured WebRTC data-channel messages'),
  makeTool('fetch_stream_export_capture', 'Export captured fetch-based stream events'),
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
  // memory interference: tools sharing the "capture/export" suffix that crowd
  // generic "capture" queries in the real registry.
  makeTool('memory_dump', 'Dump process memory region to a binary buffer'),
  makeTool('memory_snapshot', 'Capture a memory snapshot of the target process'),
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
  makeTool('v8_turbofan_inspect', 'Inspect JIT/TurboFan status and optimization'),
  // tls-inspector
  makeTool('tls_keylog_enable', 'Enable TLS key logging'),
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
  makeTool('binary_detect_format', 'Detect binary format, container, and encoding magic bytes'),
  makeTool('binary_decode', 'Decode binary payload from base64, hex, or raw bytes'),
  makeTool('binary_encode', 'Encode data into a binary representation'),
  // macro
  makeTool('macro_record', 'Record a macro sequence of tool calls'),
  // --- generated: case-referenced real registry tools (P1 fixture expansion) ---
  makeTool('console_inject_fetch_interceptor', 'Inject a fetch interceptor.'),
  makeTool('debugger_pause', 'Pause execution at the next statement.'),
  makeTool('adb_device_list', 'List all connected Android devices and emulators.'),
  makeTool('proto_infer_fields', 'Infer likely protocol fields from repeated hex payload samples.'),
  makeTool('page_hover', 'Hover over an element by CSS selector.'),
  makeTool('page_set_viewport', 'Set the browser viewport dimensions.'),
  makeTool(
    'browser_cpu_profile_start',
    'Atomic primitive: begin CDP CPU profiling on the active page (Profiler.start). Pair with browser_cpu_profile_stop to save the .cpuprofile. Set samplingInterval to 30-100 µs for high-resolution profiles (default 1000 µs / 1 ms).',
  ),
  makeTool('page_reload', 'Reload the current page.'),
  makeTool(
    'debugger_evaluate',
    'Evaluate a JavaScript expression. context="frame" evaluates in the current call frame (requires paused state); context="global" evaluates in the global context (no pause required).',
  ),
  makeTool(
    'debugger_step',
    'Step execution: into (enter next call), over (skip next call), out (exit current function).',
  ),
  makeTool('get_call_stack', 'Get the current call stack.'),
  makeTool('debugger_wait_for_paused', 'Wait for debugger pause after setting breakpoints.'),
  makeTool(
    'v8_heap_find_leaks',
    'Find suspected memory leaks in a heap snapshot. Returns leak candidates sorted by confidence, including detached DOM nodes, large arrays, closure leaks, and unexpectedly large retained objects.',
  ),
  makeTool('v8_heap_stats', 'Report V8 heap statistics: used, total, external.'),
  makeTool(
    'tls_parse_certificate',
    'Parse a TLS Certificate message from raw hex and extract X.509 details (subject/issuer/SAN/validity/keyUsage), SHA-256 fingerprint, and SPKI pin hash (Android Network Security Config / HPKP format).',
  ),
  makeTool(
    'tls_decrypt_payload',
    'Decrypt a TLS payload using a provided key, nonce, and algorithm.',
  ),
  makeTool(
    'tls_probe_endpoint',
    'Probe a TLS endpoint and report handshake and certificate details.',
  ),
  makeTool(
    'frida_run_script',
    'Execute a Frida JavaScript snippet inside an attached Frida session. Pass async:true to run in a background task (MCP 2.0 Tasks) and poll with tasks_get/tasks_result — useful for long-running or persistent instrumentation scripts that would otherwise hit the CLI timeout.',
  ),
  makeTool(
    'frida_enumerate_functions',
    'Enumerate exported functions for a specific module in a Frida session.',
  ),
  makeTool('ghidra_decompile', 'Decompile a function using Ghidra.'),
  makeTool('ida_decompile', 'Decompile a function using IDA Pro.'),
  makeTool('adb_webview_list', 'List debuggable WebView targets connected via ADB.'),
  makeTool(
    'adb_webview_attach',
    'Attach to a WebView via ADB; returns WebSocket debugger URL for CDP.',
  ),
  makeTool('adb_shell', 'Execute an ADB shell command on a specific device.'),
  makeTool(
    'adb_logcat_query',
    'Capture and filter Android logcat output in-process without shell grep pipelines.',
  ),
  makeTool(
    'mojo_list_interfaces',
    'List discovered Mojo IPC interfaces and their pending message counts.',
  ),
  makeTool('mojo_encode_message', 'Encode a structured Mojo IPC message into a hex payload.'),
  makeTool(
    'mojo_messages_get',
    'Retrieve captured Mojo IPC messages from the active monitoring session.',
  ),
  makeTool(
    'syscall_resolve_ssn',
    'Resolve NT syscall service numbers (SSN) from on-disk ntdll.dll. Parses the export table to extract Zw* → SSN mappings and locates a syscall;ret gadget for direct invocation stubs. Win32 only.',
  ),
  makeTool('syscall_get_stats', 'Get syscall monitoring statistics.'),
  makeTool(
    'syscall_origin_map',
    'Build a unified syscall→JS origin map by integrating live CDP call stacks (syscall_stack_capture) with static timing heuristics (syscall_correlate_js). Aggregates recent syscall events by JavaScript function so callers can see which JS function triggered which syscalls and how often. Debugger stacks are preferred when available; heuristics fill the gaps.',
  ),
  makeTool('syscall_stop_monitor', 'Stop syscall interception and release all captured events.'),
  makeTool(
    'proto_auto_detect',
    'Auto-detect a protocol pattern from one or more hex payload samples.',
  ),
  makeTool(
    'proto_infer_state_machine',
    'Infer a protocol state machine from captured message sequences.',
  ),
  makeTool(
    'pcap_read',
    'Read a classic PCAP file and return compact deterministic packet summaries. PCAPNG is intentionally not supported.',
  ),
  makeTool(
    'extension_info',
    'Read installed extension manifest details without importing plugin code.',
  ),
  makeTool(
    'extension_execute_in_context',
    'Load an extension and execute a named exported context function.',
  ),
  makeTool(
    'workflow_suggest',
    'Suggest the next extension workflow to run from the chainsWith / prerequisites chain metadata declared by loaded workflows. Pass the workflow ids already executed in this session; the server stays stateless. Candidates chained from an executed workflow rank first (the reason names the chain), workflows with all prerequisites satisfied rank before those with missing ones, already-executed workflows are never suggested, and executed ids that match no loaded workflow are returned in unmatched. Workflows without chain metadata are never suggested, so an empty catalog of metadata yields empty suggestions.',
  ),
  makeTool(
    'workflow_run_inspect',
    'Inspect the global workflow run store: list recent run_extension_workflow / run_macro runs, get a run entry by runId, or fetch the last successful run summary (runId, status, durationMs, stepResultKeys) for a workflow or macro id.',
  ),
  makeTool(
    'page_script_run',
    'Execute a named script from the Script Library with optional runtime params (__params__).',
  ),
  makeTool(
    'page_script_register',
    'Register a named reusable JS snippet in the Script Library. Execute with page_script_run.',
  ),
  makeTool('page_inject_script', 'Inject JavaScript to run on every page load.'),
  makeTool('canvas_engine_fingerprint', 'Detect Canvas/WebGL game engines in the page.'),
  makeTool(
    'canvas_scene_dump',
    'Extract the full scene tree / display list from a detected canvas engine.',
  ),
  makeTool(
    'canvas_inject_draw_hook',
    'Intercept Canvas 2D (drawImage/fillText/strokeText) and WebGL (drawArrays/drawElements) draw calls into a ring buffer on the page. Actions: install (wrap prototypes), read (dump captured calls), uninstall (restore). Set timing=true at install to also sample a requestAnimationFrame loop; then includeTiming=true at read to get frame-level stats (avg/p95 frame time, dropped frames, 60fps budget misses).',
  ),
  makeTool(
    'webgpu_shader_disassemble',
    'Parse WGSL or SPIR-V shader into AST and generate human-readable disassembly. Used for reverse engineering shader logic. SPIR-V input (hex/base64) is reflected into entry points, bindings, structs, and locations without compilation.',
  ),
  makeTool(
    'webgpu_capture_commands',
    'Capture GPU command queue submissions (render passes, compute dispatches). Used for analyzing GPU workload and detecting malicious shader behavior.',
  ),
  makeTool(
    'webgpu_pipeline_dump',
    'Enumerate active render/compute pipelines, bind-group layouts, and render-pass descriptors by hooking GPUDevice createRenderPipeline / createComputePipeline / createBindGroupLayout (plus async variants). Captures the full descriptor (vertex/fragment entry points, buffer stride/attributes, bind-group layout entries, visibility) so a captured bindGroups index can be resolved to actual resources.',
  ),
  makeTool('wasm_decompile', 'Decompile .wasm bytecode to readable pseudo-code with type info.'),
  makeTool(
    'wasm_inspect_sections',
    'Parse .wasm section headers: imports, exports, memory, tables, code.',
  ),
  makeTool('wasm_dump', 'Dump a captured WebAssembly module from the current page.'),
  makeTool(
    'graphql_introspect',
    'Run GraphQL introspection and optional Apollo Federation _service.sdl probing.',
  ),
  makeTool(
    'graphql_extract_queries',
    'Extract GraphQL queries/mutations from captured network traces.',
  ),
  makeTool(
    'graphql_enum_schema',
    'Enumerate GraphQL fields from server suggestion errors with introspection fallback.',
  ),
  makeTool(
    'dart_smi_scan',
    'Recover Dart Small Integer (Smi) constants from a libapp.so by reading aligned little-endian words and stripping the heap-pointer tag bit.',
  ),
  makeTool(
    'dart_object_pool_dump',
    'Read-only static dump of the Dart isolate ObjectPool in a libapp.so: classify each slot as smi/mint/double/string/classRef/functionRef/pool/null/unknown.',
  ),
  makeTool(
    'dart_symbolize',
    'Resolve obfuscated Dart identifiers using a developer-supplied Flutter --save-obfuscation-map JSON (flat, pairs, or object shape).',
  ),
  makeTool(
    'flutter_packages_detect',
    'Detect third-party Dart `package:` refs in a Flutter libapp.so, aggregated and SDK-stdlib-filtered.',
  ),
  makeTool(
    'dart_strings_extract',
    'Stream-extract ASCII/UTF-16LE strings from a Dart AOT libapp.so and classify them (urls, paths, classNames, packageRefs, cryptoKeywords, Dart identifiers, plus customRules). ReDoS-guarded.',
  ),
  makeTool('sourcemap_discover', 'Discover source maps on the current page.'),
  makeTool(
    'sourcemap_lookup',
    'Resolve generated code position to original source (default), or — when originalSource is supplied — resolve original source:line:column back to the generated position. Supports indexed (sectioned) source maps transparently.',
  ),
  makeTool(
    'sourcemap_reconstruct_tree',
    'Reconstruct source files from a source map. When a vendor stripped sourcesContent, set inferMissing=true to emit a best-effort name+position skeleton (from mapping segments) instead of a placeholder. Set emitScopes=true to also decode the ECMA-426 v4 scopes field and write a `.scopes.json` sidecar (per-source variables, function kind, hidden ranges) next to each reconstructed file.',
  ),
  makeTool(
    'grpc_monitor',
    'Enable or disable live capture of gRPC / gRPC-Web calls. gRPC calls are detected by content-type application/grpc(-web)?(+proto)? on the HTTP/2 response. On loadingFinished the response body is pulled (base64) and split into length-prefixed messages; feed each message payloadBase64 to protobuf_decode_raw to complete the decode chain. Must be enabled before navigating so requests are captured from the start.',
  ),
  makeTool(
    'webrtc_monitor',
    'Enable or disable capture of WebRTC data-channel traffic. Wraps RTCPeerConnection in-page (no CDP coverage for RTCDataChannel): intercepts createDataChannel (local channels) and the datachannel event (remote channels), capturing both outbound send() and inbound message events. Use webrtc_get_events to read captured messages.',
  ),
  makeTool(
    'webrtc_get_events',
    'Get messages captured by the WebRTC data-channel monitor. Set fullData=true to include full message data. Filter by channel label and direction (sent/received).',
  ),
  makeTool(
    'ws_send_frame',
    'Send a frame through a live in-page WebSocket instance retained by ws_monitor(exposeInstances=true). Enables edit-and-resend replay of WebSocket traffic. Only reaches WebSockets created AFTER exposeInstances was enabled (existing sockets are not retroactively reachable).',
  ),
  makeTool('proxy_start', 'Start the local HTTP/HTTPS interception proxy with optional TLS.'),
  makeTool('proxy_export_ca', 'Read the proxy CA certificate.'),
  makeTool(
    'proxy_add_rule',
    'Add an interception rule: forward, mock_response, redirect, or block.',
  ),
  makeTool('proxy_list_rules', 'List active proxy interception rules tracked by this handler.'),
  // session, tasks, coordination, cross-domain, native-bridge, process, trace additions
  makeTool(
    'session_progress_record',
    'Record progress markers and evidence in the active session.',
  ),
  makeTool('tasks_get', 'Get status and details of background MCP tasks.'),
  makeTool(
    'create_task_handoff',
    'Create a handoff packet to transfer task context across agent sessions.',
  ),
  makeTool(
    'cross_domain_synonym',
    'Query cross-domain synonyms to map natural language intent to domain tools.',
  ),
  makeTool(
    'native_bridge_status',
    'Check loopback connection health to Ghidra, IDA, Rizin, and Binary Ninja.',
  ),
  makeTool(
    'process_find',
    'Search for running processes by name pattern with PID and executable path.',
  ),
  makeTool('query_trace_sql', 'Run SQLite queries against recorded execution traces.'),
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
    tags: ['fuzzy', 'browser'],
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
    title: 'network: "capture network requests" → network_enable or network_monitor in top-5',
    query: 'capture network requests',
    topK: 10,
    expectations: [
      { tool: 'network_enable', gain: 3 },
      { tool: 'network_monitor', gain: 3 },
      { tool: 'network_get_requests', gain: 2 },
    ],
    tags: ['fuzzy', 'network'],
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
    tags: ['fuzzy', 'debugger'],
  },
  {
    id: 'debugger-pause',
    title: 'debugger: "pause execution" → debugger_pause in top-3',
    query: 'pause JavaScript execution',
    topK: 10,
    expectations: [{ tool: 'debugger_pause', gain: 3 }],
    idealTool: 'debugger_pause',
    tags: ['fuzzy', 'debugger'],
  },
  // analysis
  {
    id: 'analysis-crypto',
    title: 'analysis: "detect crypto" → detect_crypto in top-10',
    query: 'detect crypto operations',
    topK: 10,
    expectations: [{ tool: 'detect_crypto', gain: 3 }],
    idealTool: 'detect_crypto',
    tags: ['fuzzy', 'analysis'],
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
  // tls-inspector
  {
    id: 'tls-keylog',
    title: 'tls: "TLS key log" → tls_keylog_enable in top-3',
    query: 'enable TLS key logging',
    topK: 10,
    expectations: [{ tool: 'tls_keylog_enable', gain: 3 }],
    idealTool: 'tls_keylog_enable',
    tags: ['fuzzy', 'tls-inspector'],
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
    title: 'adb: "list Android devices" → adb_device_list in top-3',
    query: 'list Android devices connected via ADB',
    topK: 10,
    expectations: [{ tool: 'adb_device_list', gain: 3 }],
    idealTool: 'adb_device_list',
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
    tags: ['fuzzy', 'extension'],
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
    title: 'protocol: "decode packet fields" → proto_infer_fields in top-3',
    query: 'decode fields from binary packet',
    topK: 10,
    expectations: [{ tool: 'proto_infer_fields', gain: 3 }],
    idealTool: 'proto_infer_fields',
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
  // ── rerank-critical: tools that rerank multipliers target ──
  {
    id: 'rerank-binary-decode',
    title: 'rerank: "decode base64 payload" → binary_decode in top-3',
    query: 'decode base64 payload',
    topK: 10,
    expectations: [{ tool: 'binary_decode', gain: 3 }],
    idealTool: 'binary_decode',
    tags: ['analysis'],
  },
  {
    id: 'rerank-binary-detect',
    title: 'rerank: "detect encoding format" → binary_detect_format in top-3',
    query: 'detect encoding format of bytes',
    topK: 10,
    expectations: [{ tool: 'binary_detect_format', gain: 3 }],
    idealTool: 'binary_detect_format',
    tags: ['analysis'],
  },
  {
    id: 'rerank-browser-launch',
    title: 'rerank: "open browser for automation" → browser_launch in top-3',
    query: 'open browser for automation',
    topK: 10,
    expectations: [{ tool: 'browser_launch', gain: 3 }],
    idealTool: 'browser_launch',
    tags: ['browser'],
  },
  {
    id: 'rerank-browser-attach',
    title: 'rerank: "launch chrome to analyze" → browser_launch + browser_attach',
    query: 'launch chrome to analyze page',
    topK: 10,
    expectations: [
      { tool: 'browser_launch', gain: 3 },
      { tool: 'browser_attach', gain: 2 },
    ],
    tags: ['browser'],
  },
  {
    id: 'rerank-network-monitor',
    title: 'rerank: "monitor network traffic" → network_monitor in top-3',
    query: 'monitor network traffic',
    topK: 10,
    expectations: [{ tool: 'network_monitor', gain: 3 }],
    idealTool: 'network_monitor',
    tags: ['network'],
  },
  {
    id: 'rerank-network-get',
    title: 'rerank: "get captured requests" → network_get_requests in top-3',
    query: 'get captured network requests',
    topK: 10,
    expectations: [{ tool: 'network_get_requests', gain: 3 }],
    idealTool: 'network_get_requests',
    tags: ['network'],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Expansion wave — the block above holds the original 32 locked cases (ids,
  // queries and expectations are asserted by SearchQuality.test.ts; never edit
  // them). Everything below exists so a stratified train/holdout split has at
  // least 3 cases per tag, i.e. >= 1 case per side after splitting. Tags that
  // previously held a single case (mojo-ipc, syscall-hook, tls-inspector,
  // protocol, adb-bridge, extension, evidence, workflow) cannot be stratified
  // at all — a one-member stratum is either fully train or fully holdout.
  // Domain tags with no coverage at all (canvas, webgpu, wasm, graphql,
  // dart-inspector, sourcemap, streaming, proxy) are added as new strata.
  //
  // Every expectation references a tool name verified to exist in
  // src/server/domains/*/definitions*.ts. A hallucinated name would rank
  // nowhere and silently depress the metric forever.
  // ══════════════════════════════════════════════════════════════════════════

  // ── browser (3 → 7) ──
  {
    id: 'browser-hover',
    title: 'browser: "hover over a menu item" → page_hover in top-3',
    query: 'hover over a menu item',
    topK: 10,
    expectations: [{ tool: 'page_hover', gain: 3 }],
    idealTool: 'page_hover',
    tags: ['browser'],
  },
  {
    id: 'browser-viewport',
    title: 'browser: "make the window look like a phone" → page_set_viewport in top-3',
    query: 'make the browser window look like a mobile phone',
    topK: 10,
    expectations: [
      { tool: 'page_set_viewport', gain: 3 },
      { tool: 'stealth_inject', gain: 1 },
    ],
    idealTool: 'page_set_viewport',
    tags: ['fuzzy', 'browser'],
  },
  {
    id: 'browser-perf-profile',
    title: 'browser: "profile CPU while the page runs" → browser_cpu_profile_start in top-3',
    query: 'profile CPU usage while scrolling the page',
    topK: 10,
    expectations: [{ tool: 'browser_cpu_profile_start', gain: 3 }],
    idealTool: 'browser_cpu_profile_start',
    tags: ['browser'],
  },
  {
    id: 'browser-synonym-reload',
    title: 'synonym: "refresh the page" → page_reload via synonym',
    query: 'refresh the page',
    topK: 10,
    expectations: [{ tool: 'page_reload', gain: 3 }],
    idealTool: 'page_reload',
    tags: ['synonym', 'browser'],
    notes: '"refresh" must expand to reload/navigate, not to cache or storage tools',
  },

  // ── network (4 → 8) ──
  {
    id: 'network-intercept-modify',
    title: 'network: "tamper with a request before it is sent" → network_intercept in top-3',
    query: 'modify a request before it is sent',
    topK: 10,
    expectations: [
      { tool: 'network_intercept', gain: 3 },
      { tool: 'network_monitor', gain: 2 },
    ],
    idealTool: 'network_intercept',
    tags: ['network'],
  },
  {
    id: 'network-replay',
    title: 'network: "send that same request again" → network_replay_request in top-3',
    query: 'send the same API request again',
    topK: 10,
    expectations: [{ tool: 'network_replay_request', gain: 3 }],
    idealTool: 'network_replay_request',
    tags: ['fuzzy', 'network'],
  },
  {
    id: 'network-har-export',
    title: 'network: "save the traffic to a HAR file" → network_export_har in top-3',
    query: 'save all captured traffic to a HAR file',
    topK: 10,
    expectations: [{ tool: 'network_export_har', gain: 3 }],
    idealTool: 'network_export_har',
    tags: ['network'],
  },
  {
    id: 'network-fuzzy-interceptor',
    title: 'fuzzy: "intercptor" → network interception tools via trigram',
    query: 'add a fetch interceptor',
    topK: 10,
    expectations: [
      { tool: 'console_inject_fetch_interceptor', gain: 3 },
      { tool: 'network_intercept', gain: 2 },
    ],
    tags: ['fuzzy', 'network'],
  },

  // ── debugger (2 → 6) ──
  {
    id: 'debugger-evaluate',
    title: 'debugger: "run an expression while paused" → debugger_evaluate in top-3',
    query: 'evaluate an expression while paused at a breakpoint',
    topK: 10,
    expectations: [{ tool: 'debugger_evaluate', gain: 3 }],
    idealTool: 'debugger_evaluate',
    tags: ['debugger'],
  },
  {
    id: 'debugger-stepping',
    title: 'debugger: "step over this line" → debugger_step in top-3',
    query: 'step over the current line of code',
    topK: 10,
    expectations: [{ tool: 'debugger_step', gain: 3 }],
    idealTool: 'debugger_step',
    tags: ['debugger'],
  },
  {
    id: 'debugger-call-stack',
    title: 'debugger: "who called this function" → get_call_stack in top-5',
    query: 'show me who called this function',
    topK: 10,
    expectations: [
      { tool: 'get_call_stack', gain: 3 },
      { tool: 'extract_function_tree', gain: 2 },
    ],
    idealTool: 'get_call_stack',
    tags: ['debugger', 'analysis'],
    notes: 'callers may be answered by the static analysis tree instead of the live stack',
  },
  {
    id: 'debugger-wait-pause',
    title: 'debugger: "block until the debugger hits a breakpoint" → debugger_wait_for_paused',
    query: 'wait until the debugger pauses on a breakpoint',
    topK: 10,
    expectations: [{ tool: 'debugger_wait_for_paused', gain: 3 }],
    idealTool: 'debugger_wait_for_paused',
    tags: ['debugger'],
  },

  // ── analysis (6 → 9) ──
  {
    id: 'analysis-hooks',
    title: 'analysis: "hook every call to this function" → manage_hooks in top-3',
    query: 'hook every call to this function',
    topK: 10,
    expectations: [
      { tool: 'manage_hooks', gain: 3 },
      { tool: 'generate_hooks', gain: 2 },
    ],
    idealTool: 'manage_hooks',
    tags: ['analysis'],
    notes: 'generic "function hooking" sits between the analysis and instrumentation domains',
  },
  {
    id: 'analysis-deobfuscate',
    title: 'analysis: "deobfuscate this script" → deobfuscate / detect_obfuscation in top-5',
    query: 'deobfuscate this obfuscated script',
    topK: 10,
    expectations: [
      { tool: 'deobfuscate', gain: 3 },
      { tool: 'detect_obfuscation', gain: 2 },
      { tool: 'webcrack_unpack', gain: 1 },
    ],
    idealTool: 'deobfuscate',
    tags: ['analysis'],
  },
  {
    id: 'analysis-extract-function',
    title: 'analysis: "pull out this one function" → extract_function_tree in top-3',
    query: 'extract a single function body from the bundle',
    topK: 10,
    expectations: [
      { tool: 'extract_function_tree', gain: 3 },
      { tool: 'collect_code', gain: 1 },
    ],
    idealTool: 'extract_function_tree',
    tags: ['fuzzy', 'analysis'],
  },

  // ── v8-inspector (2 → 4) ──
  {
    id: 'v8-turbofan',
    title: 'v8-inspector: "is this function optimized by TurboFan" → v8_turbofan_inspect',
    query: 'check whether TurboFan optimized this function',
    topK: 10,
    expectations: [{ tool: 'v8_turbofan_inspect', gain: 3 }],
    idealTool: 'v8_turbofan_inspect',
    tags: ['v8-inspector'],
  },
  {
    id: 'v8-leak-forensics',
    title: 'v8-inspector: "what keeps holding this object" → v8_heap_find_leaks in top-5',
    query: 'find what is leaking memory in the heap',
    topK: 10,
    expectations: [
      { tool: 'v8_heap_find_leaks', gain: 3 },
      { tool: 'v8_heap_stats', gain: 2 },
      { tool: 'v8_heap_snapshot_capture', gain: 1 },
    ],
    idealTool: 'v8_heap_find_leaks',
    tags: ['v8-inspector'],
  },

  // ── tls-inspector (1 → 4) ──
  {
    id: 'tls-cert-parse',
    title: 'tls: "read the server certificate" → tls_parse_certificate in top-3',
    query: 'read the certificate the server presented',
    topK: 10,
    expectations: [{ tool: 'tls_parse_certificate', gain: 3 }],
    idealTool: 'tls_parse_certificate',
    tags: ['tls-inspector'],
  },
  {
    id: 'tls-decrypt',
    title: 'tls: "decrypt the TLS session" → tls_decrypt_payload in top-3',
    query: 'decrypt a captured TLS session payload',
    topK: 10,
    expectations: [
      { tool: 'tls_decrypt_payload', gain: 3 },
      { tool: 'tls_keylog_enable', gain: 2 },
    ],
    idealTool: 'tls_decrypt_payload',
    tags: ['tls-inspector'],
  },
  {
    id: 'tls-probe-endpoint',
    title: 'tls: "check what protocols the server accepts" → tls_probe_endpoint in top-3',
    query: 'check which TLS versions the server accepts',
    topK: 10,
    expectations: [{ tool: 'tls_probe_endpoint', gain: 3 }],
    idealTool: 'tls_probe_endpoint',
    tags: ['fuzzy', 'tls-inspector'],
  },

  // ── binary-instrument (2 → 5) ──
  {
    id: 'binary-frida-script',
    title: 'binary: "run a Frida script" → frida_run_script in top-3',
    query: 'run a Frida script against the running app',
    topK: 10,
    expectations: [
      { tool: 'frida_run_script', gain: 3 },
      { tool: 'frida_attach', gain: 2 },
    ],
    idealTool: 'frida_run_script',
    tags: ['binary-instrument'],
  },
  {
    id: 'binary-frida-symbols',
    title: 'binary: "list native functions in the module" → frida_enumerate_functions top-3',
    query: 'list the native functions exported by the module',
    topK: 10,
    expectations: [{ tool: 'frida_enumerate_functions', gain: 3 }],
    idealTool: 'frida_enumerate_functions',
    tags: ['binary-instrument'],
  },
  {
    id: 'binary-ghidra-decompile',
    title: 'binary: "decompile this function in Ghidra" → ghidra_decompile in top-3',
    query: 'decompile this native function with Ghidra',
    topK: 10,
    expectations: [
      { tool: 'ghidra_decompile', gain: 3 },
      { tool: 'ghidra_analyze', gain: 2 },
      { tool: 'ida_decompile', gain: 1 },
    ],
    idealTool: 'ghidra_decompile',
    tags: ['binary-instrument'],
  },

  // ── adb-bridge (1 → 4) ──
  {
    id: 'adb-webview',
    title: 'adb: "debug the WebView on my phone" → adb_webview_list in top-5',
    query: 'debug the WebView inside the Android app',
    topK: 10,
    expectations: [
      { tool: 'adb_webview_list', gain: 3 },
      { tool: 'adb_webview_attach', gain: 3 },
    ],
    idealTool: 'adb_webview_list',
    tags: ['adb-bridge'],
  },
  {
    id: 'adb-shell',
    title: 'adb: "run a shell command on the device" → adb_shell in top-3',
    query: 'run a shell command on the Android device',
    topK: 10,
    expectations: [{ tool: 'adb_shell', gain: 3 }],
    idealTool: 'adb_shell',
    tags: ['adb-bridge'],
  },
  {
    id: 'adb-logcat',
    title: 'adb: "read the app logs from the device" → adb_logcat_query in top-3',
    query: 'read the app logcat output from the device',
    topK: 10,
    expectations: [{ tool: 'adb_logcat_query', gain: 3 }],
    idealTool: 'adb_logcat_query',
    tags: ['adb-bridge'],
  },

  // ── mojo-ipc (1 → 4) ──
  {
    id: 'mojo-list-interfaces',
    title: 'mojo: "what Mojo interfaces exist" → mojo_list_interfaces in top-3',
    query: 'list the Mojo interfaces exposed by Chromium',
    topK: 10,
    expectations: [{ tool: 'mojo_list_interfaces', gain: 3 }],
    idealTool: 'mojo_list_interfaces',
    tags: ['mojo-ipc'],
  },
  {
    id: 'mojo-encode-message',
    title: 'mojo: "craft a Mojo message" → mojo_encode_message in top-3',
    query: 'craft and send a Mojo IPC message to the browser',
    topK: 10,
    expectations: [
      { tool: 'mojo_encode_message', gain: 3 },
      { tool: 'mojo_decode_message', gain: 2 },
    ],
    idealTool: 'mojo_encode_message',
    tags: ['mojo-ipc'],
  },
  {
    id: 'mojo-messages-get',
    title: 'mojo: "show captured Mojo messages" → mojo_messages_get in top-3',
    query: 'show the Mojo messages captured so far',
    topK: 10,
    expectations: [{ tool: 'mojo_messages_get', gain: 3 }],
    idealTool: 'mojo_messages_get',
    tags: ['mojo-ipc'],
  },

  // ── syscall-hook (1 → 4) ──
  {
    id: 'syscall-capture',
    title: 'syscall: "capture syscall events" → syscall_capture_events in top-3',
    query: 'capture and filter the syscalls the process makes',
    topK: 10,
    expectations: [{ tool: 'syscall_capture_events', gain: 3 }],
    idealTool: 'syscall_capture_events',
    tags: ['syscall-hook'],
  },
  {
    id: 'syscall-ssn',
    title: 'syscall: "resolve the syscall number for this Nt API" → syscall_resolve_ssn',
    query: 'resolve the syscall number for a Windows native API',
    topK: 10,
    expectations: [{ tool: 'syscall_resolve_ssn', gain: 3 }],
    idealTool: 'syscall_resolve_ssn',
    tags: ['syscall-hook'],
  },
  {
    id: 'syscall-stats',
    title: 'syscall: "summarize syscall activity" → syscall_get_stats in top-5',
    query: 'summarize how many syscalls each thread made',
    topK: 10,
    expectations: [
      { tool: 'syscall_get_stats', gain: 3 },
      { tool: 'syscall_origin_map', gain: 2 },
      { tool: 'syscall_stop_monitor', gain: 1 },
    ],
    idealTool: 'syscall_get_stats',
    tags: ['syscall-hook'],
  },

  // ── protocol (1 → 4) ──
  {
    id: 'protocol-auto-detect',
    title: 'protocol: "figure out what protocol this is" → proto_auto_detect in top-3',
    query: 'auto-detect the protocol used by this captured traffic',
    topK: 10,
    expectations: [{ tool: 'proto_auto_detect', gain: 3 }],
    idealTool: 'proto_auto_detect',
    tags: ['protocol'],
  },
  {
    id: 'protocol-state-machine',
    title: 'protocol: "reconstruct the protocol state machine" → proto_infer_state_machine',
    query: 'reconstruct the state machine of a custom binary protocol',
    topK: 10,
    expectations: [{ tool: 'proto_infer_state_machine', gain: 3 }],
    idealTool: 'proto_infer_state_machine',
    tags: ['protocol'],
  },
  {
    id: 'protocol-pcap-read',
    title: 'protocol: "read this pcap file" → pcap_read in top-3',
    query: 'read the packets out of a pcap capture file',
    topK: 10,
    expectations: [{ tool: 'pcap_read', gain: 3 }],
    idealTool: 'pcap_read',
    tags: ['protocol'],
  },

  // ── extension (1 → 4) ──
  {
    id: 'extension-list',
    title: 'extension: "what plugins are installed" → extension_list_installed in top-3',
    query: 'what plugins do I currently have installed',
    topK: 10,
    expectations: [{ tool: 'extension_list_installed', gain: 3 }],
    idealTool: 'extension_list_installed',
    tags: ['extension'],
  },
  {
    id: 'extension-info',
    title: 'extension: "describe an installed plugin" → extension_info in top-3',
    query: 'show me the details of an installed extension',
    topK: 10,
    expectations: [{ tool: 'extension_info', gain: 3 }],
    idealTool: 'extension_info',
    tags: ['extension'],
  },
  {
    id: 'extension-webhook',
    title: 'extension: "push events to my own endpoint" → webhook in top-3',
    query: 'send tool events to my own webhook endpoint',
    topK: 10,
    expectations: [
      { tool: 'webhook', gain: 3 },
      { tool: 'extension_execute_in_context', gain: 1 },
    ],
    idealTool: 'webhook',
    tags: ['fuzzy', 'extension'],
  },

  // ── workflow (1 → 4) ──
  {
    id: 'workflow-suggest',
    title: 'workflow: "what is the right next step" → workflow_suggest in top-3',
    query: 'suggest the next workflow steps for this reverse task',
    topK: 10,
    expectations: [{ tool: 'workflow_suggest', gain: 3 }],
    idealTool: 'workflow_suggest',
    tags: ['workflow'],
  },
  {
    id: 'workflow-run-inspect',
    title: 'workflow: "what happened in that workflow run" → workflow_run_inspect in top-3',
    query: 'inspect what a previous workflow run actually executed',
    topK: 10,
    expectations: [{ tool: 'workflow_run_inspect', gain: 3 }],
    idealTool: 'workflow_run_inspect',
    tags: ['workflow'],
  },
  {
    id: 'workflow-page-script',
    title: 'workflow: "save this script to re-run in every page" → page_script_run in top-5',
    query: 'save a script to re-run automatically in every page load',
    topK: 10,
    expectations: [
      { tool: 'page_script_run', gain: 3 },
      { tool: 'page_script_register', gain: 3 },
      { tool: 'page_inject_script', gain: 1 },
    ],
    idealTool: 'page_script_register',
    tags: ['workflow'],
    notes: 'register persists the script; run executes it — both are correct answers',
  },

  // ── evidence (1 → 3) ──
  {
    id: 'evidence-query',
    title: 'evidence: "what evidence do we have for this URL" → evidence_query in top-3',
    query: 'what evidence has been collected for this URL',
    topK: 10,
    expectations: [{ tool: 'evidence_query', gain: 3 }],
    idealTool: 'evidence_query',
    tags: ['evidence'],
  },
  {
    id: 'evidence-fuzzy',
    title: 'fuzzy: "evidance" → evidence tools via trigram',
    query: 'evidance report for the script',
    topK: 10,
    expectations: [
      { tool: 'evidence_query', gain: 3 },
      { tool: 'evidence_export', gain: 2 },
    ],
    tags: ['fuzzy', 'evidence'],
  },

  // ── canvas (0 → 3) ──
  {
    id: 'canvas-detect-engine',
    title: 'canvas: "what engine draws this game" → canvas_engine_fingerprint in top-3',
    query: 'which game engine is drawing this canvas',
    topK: 10,
    expectations: [
      { tool: 'canvas_engine_fingerprint', gain: 3 },
      { tool: 'skia_detect_renderer', gain: 2 },
    ],
    idealTool: 'canvas_engine_fingerprint',
    tags: ['fuzzy', 'canvas'],
  },
  {
    id: 'canvas-scene-dump',
    title: 'canvas: "dump the canvas scene graph" → canvas_scene_dump in top-3',
    query: 'dump the scene graph of the canvas game',
    topK: 10,
    expectations: [
      { tool: 'canvas_scene_dump', gain: 3 },
      { tool: 'skia_extract_scene', gain: 2 },
    ],
    idealTool: 'canvas_scene_dump',
    tags: ['fuzzy', 'canvas'],
  },
  {
    id: 'canvas-draw-hook',
    title: 'canvas: "hook the canvas draw calls" → canvas_inject_draw_hook in top-3',
    query: 'hook the drawing calls made to the canvas',
    topK: 10,
    expectations: [{ tool: 'canvas_inject_draw_hook', gain: 3 }],
    idealTool: 'canvas_inject_draw_hook',
    tags: ['fuzzy', 'canvas'],
  },

  // ── webgpu (0 → 3) ──
  {
    id: 'webgpu-shader-disassemble',
    title: 'webgpu: "disassemble this WGSL shader" → webgpu_shader_disassemble in top-3',
    query: 'parse a WGSL shader into disassembly',
    topK: 10,
    expectations: [{ tool: 'webgpu_shader_disassemble', gain: 3 }],
    idealTool: 'webgpu_shader_disassemble',
    tags: ['fuzzy', 'webgpu'],
  },
  {
    id: 'webgpu-capture-commands',
    title: 'webgpu: "record the GPU command stream" → webgpu_capture_commands in top-3',
    query: 'record the GPU command stream sent to WebGPU',
    topK: 10,
    expectations: [{ tool: 'webgpu_capture_commands', gain: 3 }],
    idealTool: 'webgpu_capture_commands',
    tags: ['fuzzy', 'webgpu'],
  },
  {
    id: 'webgpu-pipeline-dump',
    title: 'webgpu: "inspect the render pipeline state" → webgpu_pipeline_dump in top-3',
    query: 'inspect the configured WebGPU render pipeline',
    topK: 10,
    expectations: [{ tool: 'webgpu_pipeline_dump', gain: 3 }],
    idealTool: 'webgpu_pipeline_dump',
    tags: ['webgpu'],
  },

  // ── wasm (0 → 3) ──
  {
    id: 'wasm-decompile',
    title: 'wasm: "turn this wasm module back into readable code" → wasm_decompile in top-3',
    query: 'turn this wasm module back into readable code',
    topK: 10,
    expectations: [{ tool: 'wasm_decompile', gain: 3 }],
    idealTool: 'wasm_decompile',
    tags: ['wasm'],
  },
  {
    id: 'wasm-sections',
    title: 'wasm: "list the sections of this wasm binary" → wasm_inspect_sections in top-3',
    query: 'list the sections of this wasm binary',
    topK: 10,
    expectations: [{ tool: 'wasm_inspect_sections', gain: 3 }],
    idealTool: 'wasm_inspect_sections',
    tags: ['wasm'],
  },
  {
    id: 'wasm-dump',
    title: 'wasm: "extract the wasm module from the page" → wasm_dump in top-3',
    query: 'extract the wasm module the page loaded',
    topK: 10,
    expectations: [
      { tool: 'wasm_dump', gain: 3 },
      { tool: 'collect_code', gain: 1 },
    ],
    idealTool: 'wasm_dump',
    tags: ['wasm'],
  },

  // ── graphql (0 → 3) ──
  {
    id: 'graphql-introspect',
    title: 'graphql: "get the API schema" → graphql_introspect in top-3',
    query: 'get the GraphQL schema from the endpoint',
    topK: 10,
    expectations: [{ tool: 'graphql_introspect', gain: 3 }],
    idealTool: 'graphql_introspect',
    tags: ['graphql'],
  },
  {
    id: 'graphql-extract-queries',
    title: 'graphql: "find the queries the app sends" → graphql_extract_queries in top-3',
    query: 'find the GraphQL queries the frontend sends',
    topK: 10,
    expectations: [{ tool: 'graphql_extract_queries', gain: 3 }],
    idealTool: 'graphql_extract_queries',
    tags: ['graphql'],
  },
  {
    id: 'graphql-enum-schema',
    title: 'graphql: "enumerate every field of the schema" → graphql_enum_schema in top-3',
    query: 'enumerate every type and field in the GraphQL schema',
    topK: 10,
    expectations: [
      { tool: 'graphql_enum_schema', gain: 3 },
      { tool: 'graphql_introspect', gain: 2 },
    ],
    idealTool: 'graphql_enum_schema',
    tags: ['graphql'],
  },

  // ── dart-inspector (0 → 3) ──
  {
    id: 'dart-smi-scan',
    title: 'dart: "scan the Dart heap for objects" → dart_smi_scan in top-5',
    query: 'recover small integer constants from the Flutter app',
    topK: 10,
    expectations: [
      { tool: 'dart_smi_scan', gain: 3 },
      { tool: 'dart_object_pool_dump', gain: 2 },
    ],
    idealTool: 'dart_smi_scan',
    tags: ['fuzzy', 'dart-inspector'],
  },
  {
    id: 'dart-symbolize',
    title: 'dart: "turn these addresses into function names" → dart_symbolize in top-3',
    query: 'resolve obfuscated Dart function names with an obfuscation map',
    topK: 10,
    expectations: [{ tool: 'dart_symbolize', gain: 3 }],
    idealTool: 'dart_symbolize',
    tags: ['fuzzy', 'dart-inspector'],
  },
  {
    id: 'dart-packages',
    title: 'dart: "which Flutter packages are in this app" → flutter_packages_detect in top-3',
    query: 'detect which Flutter packages this app bundles',
    topK: 10,
    expectations: [
      { tool: 'flutter_packages_detect', gain: 3 },
      { tool: 'dart_strings_extract', gain: 1 },
    ],
    idealTool: 'flutter_packages_detect',
    tags: ['fuzzy', 'dart-inspector'],
  },

  // ── sourcemap (0 → 3) ──
  {
    id: 'sourcemap-discover',
    title: 'sourcemap: "are there source maps for this bundle" → sourcemap_discover in top-3',
    query: 'discover source maps for this minified bundle',
    topK: 10,
    expectations: [
      { tool: 'sourcemap_discover', gain: 3 },
      { tool: 'js_bundle_search', gain: 1 },
    ],
    idealTool: 'sourcemap_discover',
    tags: ['fuzzy', 'sourcemap'],
  },
  {
    id: 'sourcemap-lookup',
    title: 'sourcemap: "which original file is this line from" → sourcemap_lookup in top-3',
    query: 'which original source file does this minified line come from',
    topK: 10,
    expectations: [{ tool: 'sourcemap_lookup', gain: 3 }],
    idealTool: 'sourcemap_lookup',
    tags: ['sourcemap'],
  },
  {
    id: 'sourcemap-tree',
    title: 'sourcemap: "rebuild the original file tree" → sourcemap_reconstruct_tree in top-3',
    query: 'rebuild the original source tree from the source map',
    topK: 10,
    expectations: [
      { tool: 'sourcemap_reconstruct_tree', gain: 3 },
      { tool: 'sourcemap_fetch_and_parse', gain: 2 },
    ],
    idealTool: 'sourcemap_reconstruct_tree',
    tags: ['sourcemap'],
  },

  // ── streaming (0 → 3) ──
  {
    id: 'streaming-grpc',
    title: 'streaming: "capture the gRPC calls" → grpc_monitor in top-3',
    query: 'capture the gRPC calls the app makes',
    topK: 10,
    expectations: [{ tool: 'grpc_monitor', gain: 3 }],
    idealTool: 'grpc_monitor',
    tags: ['streaming'],
  },
  {
    id: 'streaming-webrtc',
    title: 'streaming: "capture WebRTC data channel messages" → webrtc_monitor in top-5',
    query: 'capture the WebRTC data channel messages',
    topK: 10,
    expectations: [
      { tool: 'webrtc_monitor', gain: 3 },
      { tool: 'webrtc_get_events', gain: 2 },
    ],
    idealTool: 'webrtc_monitor',
    tags: ['streaming'],
  },
  {
    id: 'streaming-ws-send',
    title: 'streaming: "send a frame over the websocket" → ws_send_frame in top-5',
    query: 'send a custom frame over the websocket connection',
    topK: 10,
    expectations: [
      { tool: 'ws_send_frame', gain: 3 },
      { tool: 'ws_monitor', gain: 1 },
    ],
    idealTool: 'ws_send_frame',
    tags: ['streaming', 'network'],
  },

  // ── proxy (0 → 3) ──
  {
    id: 'proxy-start',
    title: 'proxy: "start a man-in-the-middle proxy" → proxy_start in top-3',
    query: 'start an intercepting proxy to inspect HTTPS traffic',
    topK: 10,
    expectations: [
      { tool: 'proxy_start', gain: 3 },
      { tool: 'proxy_export_ca', gain: 2 },
    ],
    idealTool: 'proxy_start',
    tags: ['proxy'],
  },
  {
    id: 'proxy-rule',
    title: 'proxy: "rewrite responses matching a pattern" → proxy_add_rule in top-3',
    query: 'add a proxy rule that mocks responses matching a URL pattern',
    topK: 10,
    expectations: [
      { tool: 'proxy_add_rule', gain: 3 },
      { tool: 'proxy_list_rules', gain: 2 },
    ],
    idealTool: 'proxy_add_rule',
    tags: ['proxy'],
  },
  {
    id: 'proxy-ca',
    title: 'proxy: "install the proxy CA on the device" → proxy_export_ca in top-5',
    query: 'export the proxy CA certificate to trust on the phone',
    topK: 10,
    expectations: [
      { tool: 'proxy_export_ca', gain: 3 },
      { tool: 'tls_parse_certificate', gain: 1 },
    ],
    idealTool: 'proxy_export_ca',
    tags: ['proxy'],
    notes: 'exporting the CA competes with certificate parsing tools',
  },

  // ── cross-domain disambiguation: one query, several plausible domains ──
  {
    id: 'cross-capture-generic',
    title: 'cross: bare "capture" must not collapse onto one domain',
    query: 'capture everything',
    topK: 10,
    expectations: [
      { tool: 'network_monitor', gain: 2 },
      { tool: 'network_enable', gain: 2 },
      { tool: 'memory_dump', gain: 1 },
    ],
    tags: ['fuzzy', 'synonym', 'network', 'syscall-hook'],
    notes: 'intentionally ambiguous — scores domain-spread, not a single winner',
  },
  {
    id: 'exact-workflow-suggest',
    title: 'exact: "workflow_suggest" → workflow_suggest as top-1',
    query: 'workflow_suggest',
    topK: 10,
    expectations: [{ tool: 'workflow_suggest', gain: 3 }],
    idealTool: 'workflow_suggest',
    tags: ['fuzzy', 'workflow'],
  },
  {
    id: 'exact-mojo-monitor',
    title: 'exact: "mojo_monitor" → mojo_monitor as top-1',
    query: 'mojo_monitor',
    topK: 10,
    expectations: [{ tool: 'mojo_monitor', gain: 3 }],
    idealTool: 'mojo_monitor',
    tags: ['exact', 'mojo-ipc'],
  },
  // ── newly covered domains: session, tasks, coordination, cross-domain, native-bridge, process, trace ──
  {
    id: 'session-record-progress',
    title: 'session: "record session progress" → session_progress_record in top-3',
    query: 'record session progress',
    topK: 10,
    expectations: [{ tool: 'session_progress_record', gain: 3 }],
    idealTool: 'session_progress_record',
    tags: ['session'],
  },
  {
    id: 'tasks-get-status',
    title: 'tasks: "get background task status" → tasks_get in top-3',
    query: 'get background task status',
    topK: 10,
    expectations: [{ tool: 'tasks_get', gain: 3 }],
    idealTool: 'tasks_get',
    tags: ['tasks'],
  },
  {
    id: 'coordination-task-handoff',
    title: 'coordination: "create task handoff" → create_task_handoff in top-3',
    query: 'create task handoff for agent',
    topK: 10,
    expectations: [{ tool: 'create_task_handoff', gain: 3 }],
    idealTool: 'create_task_handoff',
    tags: ['coordination'],
  },
  {
    id: 'cross-domain-synonym-query',
    title: 'cross-domain: "cross domain synonyms" → cross_domain_synonym in top-3',
    query: 'cross domain synonym search',
    topK: 10,
    expectations: [{ tool: 'cross_domain_synonym', gain: 3 }],
    idealTool: 'cross_domain_synonym',
    tags: ['cross-domain'],
  },
  {
    id: 'native-bridge-status-check',
    title: 'native-bridge: "check native bridge status" → native_bridge_status in top-3',
    query: 'check status of ida and ghidra native bridge',
    topK: 10,
    expectations: [{ tool: 'native_bridge_status', gain: 3 }],
    idealTool: 'native_bridge_status',
    tags: ['native-bridge'],
  },
  {
    id: 'process-find-query',
    title: 'process: "find running process" → process_find in top-3',
    query: 'find running process by name',
    topK: 10,
    expectations: [{ tool: 'process_find', gain: 3 }],
    idealTool: 'process_find',
    tags: ['process'],
  },
  {
    id: 'trace-query-sql',
    title: 'trace: "query trace with SQL" → query_trace_sql in top-3',
    query: 'query trace events with SQL',
    topK: 10,
    expectations: [{ tool: 'query_trace_sql', gain: 3 }],
    idealTool: 'query_trace_sql',
    tags: ['trace'],
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
