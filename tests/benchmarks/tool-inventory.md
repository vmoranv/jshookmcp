
## adb-bridge (26)
- adb_apk_analyze: Analyze an installed APK: package, permissions, activities, and security info.
- adb_apk_pull: Pull an APK from a device to the local filesystem.
- adb_app_cold_start_trace: High-level Android startup trace: force-stop, clear logcat, start activity with -W, wait, collect PID-filtered logs, and parse launch/Looper timing.
- adb_device_list: List all connected Android devices and emulators.
- adb_dumpsys: Run adb shell dumpsys for a service and return parsed structured output. Supports key-value extraction, array parsing, and section detection. Common services: package, activity, window, battery, meminfo, alarm, cpuinfo, diskstats, netstats, usagestats.
- adb_file_pull: Pull a file from an Android device using normal ADB permissions.
- adb_file_push: Push a local file to an Android device using normal ADB permissions.
- adb_getprop: Dump and parse Android system properties (getprop) into a structured map with a curated device fingerprint (model, SDK, ABI, build fingerprint, security patch, bootloader lock).
- adb_input_keyevent: Send an Android keyevent name or numeric key code through adb shell input.
- adb_input_swipe: Send a touchscreen swipe event through adb shell input.
- adb_input_tap: Send a touchscreen tap event through adb shell input.
- adb_input_text: Send text through adb shell input text with Android-safe whitespace encoding.
- adb_install: Install one APK or a split-APK set onto a device with parsed success output.
- adb_logcat_query: Capture and filter Android logcat output in-process without shell grep pipelines.
- adb_package_summary: Return structured Android package metadata: launcher, uid, versions, permissions, components, and native library dirs.
- adb_port_forward: Manage ADB forward/reverse port mappings for device-host bridge workflows.
- adb_proc_maps: Read and parse /proc/PID/maps from a device, resolving PID from packageName when needed.
- adb_pull_native_libs: Pull native shared libraries (.so) for an installed app from a device.
- adb_root_check: Probe root indicators such as su, Magisk, test-keys, SELinux, and shell uid.
- adb_screenrecord: Record a short MP4 screen capture through adb shell screenrecord and pull it locally.
- adb_screenshot: Capture a PNG screenshot through adb exec-out screencap -p.
- adb_shell: Execute an ADB shell command on a specific device.
- adb_ui_dump: Capture Android UI hierarchy via uiautomator dump. Runs uiautomator dump on-device, pulls the XML, and returns parsed UI tree. Useful for UI automation verification, layout inspection, and accessibility tree analysis.
- adb_uninstall: Uninstall a package from a device, optionally keeping app data.
- adb_webview_attach: Attach to a WebView via ADB; returns WebSocket debugger URL for CDP.
- adb_webview_list: List debuggable WebView targets connected via ADB.

## binary-instrument (46)
- android_runtime_dump_session: Create or inspect a managed Android runtime dump session from Frida/ADB dump artifacts, DEX files, and /proc/PID/maps snapshots.
- apk_dex_intake: Build a cohesive APK/DEX intake evidence packet: ZIP entries, manifest summary, DEX headers, native libraries, generic surface hints, caller-supplied hint matches, and next actions.
- apk_manifest_dump: Extract AndroidManifest.xml from an APK for quick inspection.
- apk_manifest_query: Return a compact structured AndroidManifest summary: package, launcher activity, app class, SDKs, permissions, components, providers, and SDK/surface hints.
- apk_native_libs_list: List packaged native shared libraries (.so) inside an APK.
- apk_packer_detect: Detect Android APK packers by matching `lib/<abi>/lib*.so` filenames against user-supplied customSignatures (ReDoS-guarded regex compilation). The framework ships no built-in signature table — callers provide their own. **Does not unpack, execute, or otherwise interact with packed code.**
- apk_packer_list_signatures: List the in-process signature table used by `apk_packer_detect`. Empty by default; reflects caller-managed state at request time. Optionally filter by case-insensitive category substring.
- apk_sign: Sign an APK with apksigner using a caller-supplied keystore. Pairs with apktool_build for a full repack-and-sign workflow.
- apk_signing_block_parse: Read-only parser for the APK Signing Block (schemes v2/v3/v3.1/v4) plus key-rotation lineage detection and residue-block / dex-prefix / magic-offset anomaly flags. Never mutates the APK.
- apk_static_triage: One-shot APK triage: ZIP metadata, manifest summary, native libs, asset hints, likely packers/protectors, and recommended next steps.
- apktool_build: Rebuild an APK from a decoded apktool source directory (closes the patch-and-repack loop with apk_sign).
- apktool_decode: Decode an APK using apktool to inspect resources, manifest, and smali output.
- binary_entropy_profile: Compute Shannon entropy across fixed-size chunks of a binary file to locate encrypted / packed / compressed sections. High-entropy regions (>=7.0 bits/byte) are likely encrypted or compressed; low-entropy (<4.0) are typically code or text. Pure-compute, no external tools.
- binary_instrument_capabilities: Report binary instrumentation backend availability.
- binary_key_extract: Scan a binary for hardcoded key candidates (raw high-entropy, Base64, hex). Read-only — no decryption.
- binary_strings_extract: Extract printable ASCII/UTF-16LE strings from a binary file with regex filtering.
- dex_scan_file: Scan a binary/memory-dump file for DEX or CompactDex magic and optionally extract hits.
- export_hook_script: Export generated hook templates as a complete, runnable Frida script.
- frida_attach: Attach Frida to a target and open a session. Defaults to the local device; pass device+host for USB/remote devices. On Android the frida process name is the App Label (not the package name) — use frida_list_processes and attach by pid to avoid name mismatches.
- frida_attach_interceptor: Generate a real Frida Interceptor.attach block for a symbol and optionally install it in a session.
- frida_detach: Detach from a Frida session and clean up resources.
- frida_dex_dump: Run frida-dexdump as a high-level Android DEX dump helper by package/process name or PID.
- frida_enumerate_functions: Enumerate exported functions for a specific module in a Frida session.
- frida_enumerate_modules: List loaded modules in an attached Frida session, with an isSystem tag and a summary (total/system/nonSystem). Use filter to focus on non-system modules for broker-vs-agent diffing.
- frida_find_symbols: Search for symbols matching a pattern in a Frida session.
- frida_generate_script: Generate a Frida interceptor or hook script from built-in templates.
- frida_list_devices: List frida-visible devices (local, USB, remote) via frida-ls-devices. Use the returned id with frida_attach device=id, or connect directly with device=remote + host.
- frida_list_processes: List processes on a Frida device via frida-ps (defaults to the local device; pass device+host for USB/remote). On Android the process name is the App Label, not the package name — attach by the returned pid.
- frida_list_sessions: List all active Frida attach sessions with target info.
- frida_memory_read: Read raw bytes from a Frida session via ptr(address).readByteArray. Returns hex; capped at 65536 bytes per call.
- frida_memory_scan: Scan process memory for a byte pattern via Frida Memory.scanSync. Searches a named module, an explicit address range, or all readable ranges by default. Pass async:true to scan in a background task (MCP 2.0 Tasks) and poll with tasks_get/tasks_result — broad scans survive past the default 15s CLI timeout.
- frida_resume: Resume a target previously spawned for early Frida instrumentation.
- frida_run_script: Execute a Frida JavaScript snippet inside an attached Frida session. By default each call spawns a fresh frida CLI that tears down when the script returns, so hooks and timer callbacks do NOT survive — pass keepAliveMs (sync, clamped to 25s) or async:true + keepAlive:true (background task) to park the script with recv().wait() so hooks stay armed for the window. A frida 17 API compatibility shim (Module.findExportByName, Process.getCurrentPid) is injected automatically; scripts that need file writes on Windows must use send() instead of new File().
- frida_spawn: Spawn a target through Frida for early instrumentation before normal execution. Until frida_resume succeeds, every tool call on a spawn session re-spawns the target (restarts the app on remote Android).
- generate_hooks: Generate a Frida interceptor script for a list of symbols.
- get_available_plugins: List installed binary analysis plugins.
- ghidra_analyze: Analyze a binary and return metadata.
- ghidra_decompile: Decompile a single named function via a stateless Ghidra headless run (no bridge server or plugin needed; ~5-10s per call). Run ghidra_analyze first to list function names — the name must match exactly.
- ida_decompile: Decompile a function using IDA Pro.
- jadx_decompile: Decompile an APK class or method with JADX CLI.
- jadx_decompile_apk: High-level JADX APK decompile: decompile the whole APK to a stable output directory and return sourcesDir for jadx_search_code.
- jadx_search_code: Ripgrep-backed search over jadx output. Pass decompileDir for read-only search, or apkPath to auto-decompile to a temporary directory first.
- unidbg_call: Call a JNI function in a running Unidbg emulator session.
- unidbg_emulate: Emulate a native function with Unidbg when available.
- unidbg_launch: Emulate a native shared library in Unidbg.
- unidbg_trace: Get execution trace from Unidbg session with configurable detail.

## browser (85)
- browser_attach: Connect to a running browser.
- browser_attach_cdp_target: Attach to a CDP target by targetId.
- browser_cdp_performance_metrics: Atomic primitive: fetch browser runtime metrics via CDP Performance.getMetrics() on the active page. Returns raw CDP-level counters (LayoutCount, RecalcStyleCount, ScriptDuration, TaskDuration, JSHeapUsedSize, Nodes, Documents, Frames, ...) — not Web Vitals (use browser_get_metrics for those).
- browser_close: Close the browser and release all resources.
- browser_codegen_start: Start recording browser actions as replayable steps.
- browser_codegen_stop: Stop recording browser actions and return cleaned replay steps.
- browser_cpu_profile_start: Atomic primitive: begin CDP CPU profiling on the active page (Profiler.start). Pair with browser_cpu_profile_stop to save the .cpuprofile. Set samplingInterval to 30-100 µs for high-resolution profiles (default 1000 µs / 1 ms).
- browser_cpu_profile_stop: Atomic primitive: stop CDP CPU profiling, rank hot functions by sample count, and persist the raw profile to artifacts/profiles/ (or a custom path). The hot function list is derived from the samples array — modern Chrome profiles do not populate hitCount. Fails clearly if profiling was never started.
- browser_detach_cdp_target: Detach the current CDP target session.
- browser_evaluate_cdp_target: Evaluate JS in the attached CDP target.
- browser_font_fingerprint: Enumerate locally-installed fonts for fingerprint analysis. Primary path is the Local Font Access API (queryLocalFonts, Chromium 103+); when unavailable or denied, falls back to a small document.fonts.check probe set. Returns the detected font set, a stable hash for comparison, and optionally spoofs the font fingerprint.
- browser_get_metrics: Atomic primitive: collect page performance metrics via PerformanceMonitor — Web Vitals (FCP, LCP, CLS, TTFB), DOM timing (domContentLoaded, loadComplete), engine-level counters (scriptDuration, layoutDuration, recalcStyleDuration) and JS heap sizes (usedJSHeapSize / totalJSHeapSize / jsHeapSizeLimit). Optionally include the raw performance timeline entries. Replaces the legacy network-domain performance_get_metrics (still working as a backward-compat alias).
- browser_jsdom_cookies: Manage cookies on a JSDOM session. Isolated from the attached browser.
- browser_jsdom_execute: Evaluate JS inside a JSDOM session. Requires explicit authorization — arbitrary code execution.
- browser_jsdom_parse: Parse HTML into an in-memory JSDOM session. No browser needed.
- browser_jsdom_query: Query a JSDOM session with a CSS selector.
- browser_jsdom_serialize: Serialize a JSDOM session to HTML.
- browser_launch: Launch Chromium/Camoufox or connect to a running browser.
- browser_list_cdp_targets: List CDP targets with optional type/URL/title filters.
- browser_list_tabs: List open browser tabs with URLs and titles.
- browser_list_workers: Enumerate Service Worker / Shared Worker / dedicated Web Worker targets via Target.getTargets. Use browser_worker_scripts(targetId=...) afterwards to dump a worker's loaded scripts — essential for inspecting PWA / SW-backed auth code.
- browser_passkey_seed: Seed a WebAuthn/Passkey credential into the browser for test automation.
- browser_performance_observer: Atomic primitive: subscribe to PerformanceObserver entry types in the active page and return both buffered and live entries observed during a collection window. Entry types are passed through to PerformanceObserver.observe({ type }) verbatim (e.g. largest-contentful-paint, layout-shift, longtask, event, long-animation-frame); unsupported entry types are skipped silently. One observer per type — the API does not accept multiple types in a single observe() call.
- browser_resource_timing: Atomic primitive: read Resource Timing API entries for the active page and decompose each resource into dns / connect / tls / ttfb / download phases plus transfer and body sizes. Optionally include Server-Timing headers and filter by URL substring. A read-only snapshot — no observers or listeners are installed.
- browser_select_tab: Switch active tab by index, URL pattern, or title pattern.
- browser_status: Report browser status: running, tab count, version.
- browser_trace_start: Atomic primitive: begin a Chrome performance trace on the active page via page.tracing.start(). Pair with browser_trace_stop to save the trace to disk. Use a sensible categories list when you have a specific hypothesis (e.g. ["devtools.timeline","v8.execute","blink.user_timing"]); the default set covers most profiling needs.
- browser_trace_stop: Atomic primitive: stop the Chrome performance trace started by browser_trace_start and persist it to artifacts/traces/ (or to a custom path). Returns event count, file size, and a Chrome DevTools hint. Fails clearly if tracing was never started or has already been stopped.
- browser_worker_scripts: Attach a CDP session to a worker target and dump its parsed scripts (equivalent to get_all_scripts, but scoped to a worker). Debugger.scriptParsed is replayed on Debugger.enable, so already-loaded worker scripts are returned.
- camoufox_geolocation: Get geolocation for a locale.
- camoufox_server: Start, close, or check status of a Camoufox anti-detect server.
- captcha_config: Configure CAPTCHA detection sensitivity and solver backend.
- captcha_detect: Detect CAPTCHAs on the current page.
- captcha_solver_capabilities: Report CAPTCHA solving mode availability.
- captcha_vision_solve: Solve a CAPTCHA with manual flow or a configured external service.
- captcha_wait: Block until the user manually solves the CAPTCHA.
- console_execute: Evaluate a JS expression in the browser console context.
- console_get_logs: Retrieve captured console logs with type and time filters.
- console_monitor: Toggle console log capture (log, warn, error, info, debug).
- framework_state_extract: Extract React/Vue/Svelte/Solid component state and meta-framework info.
- get_all_scripts: List all scripts loaded by the page with optional source.
- get_detailed_data: Retrieve large data by detailId.
- get_offloaded_data: Retrieve the original bytes of a field that was offloaded to disk (see the `_offload.path` in a placeholder). Returns base64 by default for binary blobs (e.g. decoded data: URIs); use encoding="utf8" for text.
- get_script_source: Retrieve source code of a script by ID or URL pattern.
- human_mouse: Move mouse along a Bezier curve with jitter.
- human_scroll: Scroll with randomized speed and pauses to mimic human behavior.
- human_typing: Type text with human-like speed and occasional typos.
- indexeddb_dump: Export IndexedDB databases and records. Supports keyRange queries (IDBKeyRange.bound/lower/upper), indexName (query a specific index), count (count-only mode), and cursor pagination (stream large stores in batches).
- js_heap_search: Search JS heap for strings matching a pattern.
- page_back: Navigate back in browser history.
- page_block_script: Manage script blocking rules by URL pattern. Blocked scripts are prevented from loading/executing. Actions: add/block (add a rule), remove/unblock (remove a rule), list (show all rules), clear (remove all).
- page_click: Click a page element by CSS selector.
- page_cookies: Manage page cookies; clear requires matching expectedCount.
- page_coverage_start: Start JS+CSS code coverage collection on the active page. Coverage tracks which bytes of each loaded script/stylesheet are actually executed. Use page_coverage_stop to stop collection and retrieve results.
- page_coverage_stop: Stop coverage collection and return per-script JS+CSS coverage results. Includes total bytes, used bytes, and coverage percentage per URL.
- page_emulate_device: Emulate a mobile device profile.
- page_evaluate: Execute JavaScript in page context.
- page_forward: Navigate forward in browser history.
- page_handle_dialog: Control how JavaScript dialogs (alert/confirm/prompt/beforeunload) are answered. By default installs a persistent handler that auto-dismisses all dialogs. Set dismissAll=false for one-shot handling of the next dialog.
- page_hover: Hover over an element by CSS selector.
- page_inject_script: Inject JavaScript to run on every page load.
- page_list_frames: List page frames for frame targeting.
- page_local_storage: Read, write, delete, or clear localStorage entries for the current origin.
- page_navigate: Navigate the page to a URL with wait and network options.
- page_press_key: Simulate a key press by name.
- page_reload: Reload the current page.
- page_screenshot: Capture a page or element screenshot.
- page_scroll: Scroll to absolute or relative coordinates.
- page_select: Select option(s) in a <select> element.
- page_session_storage: Read, write, delete, or clear sessionStorage entries for the current origin.
- page_set_viewport: Set the browser viewport dimensions.
- page_storage_info: Query navigator.storage.estimate() for {usage, quota} and navigator.storage.persisted() to inspect the origin storage budget and persistence status (offline/PWA reverse engineering).
- page_type: Type text into an element.
- page_upload_files: Upload one or more local files into an <input type="file"> element.
- page_wait_for_selector: Wait for an element to appear.
- service_worker_deliver_push: Deliver a synthetic push message to a service worker via CDP ServiceWorker.deliverPushMessage. Requires an attached CDP session on a SW target.
- service_worker_dispatch_sync: Dispatch a Background Sync event to a service worker via CDP ServiceWorker.dispatchSyncEvent. Requires an attached CDP session on a SW target.
- stealth_configure_jitter: Configure CDP timing jitter.
- stealth_generate_fingerprint: Generate a browser fingerprint.
- stealth_inject: Inject anti-detection scripts to reduce bot fingerprint exposure.
- stealth_set_user_agent: Set User-Agent and fingerprint.
- stealth_verify: Run anti-detection checks.
- tab_workflow: Cross-tab coordination.
- v8_type_profile: Atomic primitive: start or stop V8 type profiling via CDP Profiler.startTypeProfile() / takeTypeProfile() / stopTypeProfile(). Type profiles record the runtime types flowing through each function entry (type:Array, type:Object, type:number, ...) — the raw material for deobfuscating VM dispatchers or polymorphic call sites. action="stop" returns per-script entries and optionally persists the raw profile to a JSON artifact (artifacts/profiles/).
- widget_challenge_solve: Solve a widget challenge with hook, manual, or configured external service.

## canvas (11)
- canvas_dump_shaders: Dump the linked shader programs (vertex + fragment source, uniforms) running on the target canvas. Uses engine introspection where available (Three.js renderer.info.programs, BABYLON.Effect.ShadersStore, Laya.Shader registry) and the WEBGL_debug_shaders extension to recover source where the driver allows. Returns programs[] + an honest `reason` when the engine / driver refuses to expose source. Academic basis: WGPULens arXiv 2606.26412 + DarthShader arXiv 2409.01824.
- canvas_engine_fingerprint: Detect Canvas/WebGL game engines in the page.
- canvas_inject_draw_hook: Intercept Canvas 2D (drawImage/fillText/strokeText) and WebGL (drawArrays/drawElements) draw calls into a ring buffer on the page. Actions: install (wrap prototypes), read (dump captured calls), uninstall (restore). Set timing=true at install to also sample a requestAnimationFrame loop; then includeTiming=true at read to get frame-level stats (avg/p95 frame time, dropped frames, 60fps budget misses).
- canvas_memory_invariants: Assert runtime invariants about WebGL context lifetime, engine state consistency, and texture/program leaks. Reports checks[], violations[] (with severity + safe-cleanup fix), and a recommendations[] block. Honest scope: only JS-observable metrics (DOM canvas count vs live WebGL contexts, renderer.info.memory counts, contextLoss events). Full GC sweep / native-heap inspection is out of scope. Academic basis: JSidentify-V2 arXiv 2508.01655.
- canvas_pick_object_at_point: Pick / hit-test the topmost object at a given screen coordinate using the engine's hit-test system
- canvas_scene_dump: Extract the full scene tree / display list from a detected canvas engine.
- canvas_scene_search: Search a previously-dumped scene tree (canvas_scene_dump output) for nodes by name regex and/or type. Pure-compute — no browser session required. Returns matching nodes with their path from root, depth, and engine-specific properties.
- canvas_trace_click_handler: Trace a click event from DOM to JS call stack.
- skia_correlate_objects: Correlate requested Skia node identifiers with the extracted scene tree.
- skia_detect_renderer: Detect the active Skia renderer backend from the current page context.
- skia_extract_scene: Extract a lightweight Skia scene tree from the selected canvas.

## coordination (12)
- append_session_insight: Record a persisted insight for the current session.
- complete_task_handoff: Mark a task handoff as completed.
- coordination_restore_snapshot: Restore a saved page snapshot including IndexedDB data. Navigates to the captured URL, re-injects cookies, localStorage, sessionStorage, and IndexedDB records from the snapshot.
- create_task_handoff: Create a persisted task handoff for cross-tool coordination.
- get_task_context: Read persisted task handoff context and session insights.
- list_page_snapshots: List saved page snapshots.
- restore_page_snapshot: Restore a saved page snapshot.
- save_page_snapshot: Save current page state.
- state_board: CRUD operations on the cross-tool shared state board. TTL contract for set: omitting ttlSeconds defaults to 24h expiry; ttlSeconds: 0 means explicit permanent (no expiry, bounded only by the LRU cap); any other value is honored verbatim. NOTE: before this change, omitting ttlSeconds meant permanent — this is a behavior change.
- state_board_io: Serialize state board to JSON or restore from a previous export.
- state_board_watch: Watch state board keys for changes with configurable polling.
- update_task_handoff: Update task handoff status or metadata without completing it.

## core (25)
- ai_suggest_exploits: Use LLM to suggest exploit primitives and attack chains for a given vulnerability. Returns theoretical exploitation steps, references, and required conditions. IMPORTANT: Does NOT generate executable payloads or malicious code.
- analysis_ast_match: Match AST nodes by type and optional property filter.
- analysis_data_flow: Trace data flow through JavaScript: identify sources (user input, network, storage), sinks (XSS, eval, SQL injection, command execution), sanitizer pass-through points, and tainted variable propagation paths. Useful for finding injection vulnerabilities.
- analysis_decode_string_array: Decode literal string-array access back to strings.
- analysis_deflat_control_flow: Flatten switch-dispatch control flow back to straight-line code.
- analysis_security_scan: Static security scan of JavaScript: detect hardcoded secrets (API keys, tokens), dangerous functions (eval, Function constructor), XSS sinks (innerHTML, document.write), SQL injection patterns, and weak crypto (Math.random). Returns structured risks with severity and recommendations.
- clear_collected_data: Clear collected script data, caches, and in-memory indexes.
- collect_code: Collect JavaScript from a target website with configurable strategy.
- deobfuscate: Run webcrack-powered JavaScript deobfuscation with bundle unpacking.
- detect_crypto: Detect cryptographic algorithms and usage patterns in source code.
- detect_obfuscation: Detect obfuscation techniques in JavaScript source.
- extract_function_tree: Extract a function and its dependency tree from collected scripts.
- get_collection_stats: Get collection, cache, and compression statistics.
- js_analyze_vm: Analyze JSVMP/VM interpreter: dispatch type, handler table, opcode map.
- js_deobfuscate_jsvmp: Deobfuscate JSVMP/VM-protected JavaScript: extract VM bytecode and restore original logic.
- js_deobfuscate_pipeline: Three-stage deobfuscation pipeline: preprocess → deobfuscate → humanize.
- js_solve_constraints: Solve opaque predicates and constant expressions in obfuscated code.
- js_symbolic_execute: Symbolic execution of JavaScript: explore all feasible execution paths, collect path constraints, and solve them. Best for control-flow-flattened code with complex branching.
- js_symbolic_execute_jsvmp: Symbolic execution of JSVMP bytecode: step through instructions symbolically to infer original logic, constraints, and confidence score. Use after js_analyze_vm to get instructions.
- llm_suggest_names: Use LLM to suggest meaningful names for obfuscated identifiers.
- manage_hooks: Create, inspect, and clear JavaScript runtime hooks.
- search_in_scripts: Search collected scripts by keyword or regex pattern.
- understand_code: Run semantic code analysis for structure, behavior, and risks.
- webcrack_unpack: Run webcrack bundle unpacking and return extracted module graph.
- webpack_enumerate: Enumerate webpack modules in current page and search for keywords.

## cross-domain (8)
- cross_domain_capabilities: List all cross-domain capability categories and available workflows.
- cross_domain_correlate_all: Run the built-in skia, mojo, syscall, and binary correlators and merge the results into the shared evidence graph.
- cross_domain_evidence_export: Export the shared cross-domain evidence graph as JSON.
- cross_domain_evidence_query: Query the shared evidence graph by URL, heap address, function, script, node type, metadata, or chain.
- cross_domain_evidence_stats: Get node and edge statistics for the shared cross-domain evidence graph.
- cross_domain_health: Report health status of cross-domain bridges and correlators.
- cross_domain_suggest_workflow: Recommend a multi-domain workflow to achieve a specific analysis goal.
- cross_domain_synonym: Map natural-language queries to tool recommendations using a lightweight synonym graph. Pure TS — no LLM. Useful for discovering which tools implement a concept described in plain English (e.g. "find where the app signs requests" → deobfuscation, crypto, network).

## dart-inspector (16)
- dart_call_function: Execute a Dart function in the ARM64 emulator by address or name, with simplified runtime (mock built-ins, tagged pointers). Pass a sessionId to reuse the cached snapshot; the executor still initialises fresh CPU state per call (register state is never shared across calls).
- dart_call_graph: Build a best-effort static call graph from a Dart AOT snapshot: nodes are Code objects, edges are ObjectPool entries whose value matches another Code entry point (caller to callee). Pass a sessionId to reuse a cached snapshot. Honest boundary: indirect/dynamic calls without a pool entry, and PcDescriptors-level mapping, require instruction decoding (deferred — cross-Dart-SDK version work).
- dart_create_session: Parse a Dart AOT snapshot once and cache it under a sessionId, so subsequent dart_load_snapshot / dart_list_functions / dart_call_graph / dart_inspect_object_pool / dart_call_function / dart_trace_execution calls can pass sessionId and skip re-parsing libapp.so (the dominant cost on a 10-40 MB Flutter snapshot). Destroy with dart_destroy_session when done; idle sessions auto-expire (TTL + sweep, see DART_SESSION_*).
- dart_destroy_session: Destroy a Dart snapshot session created by dart_create_session, releasing the cached parsed snapshot. Returns destroyed=true if the session existed, false if it was unknown or already swept by the idle TTL.
- dart_inspect_object_pool: Dump an ObjectPool at a specific address, showing all entries with types and values. Pass a sessionId to reuse a cached snapshot.
- dart_list_functions: List all Dart Code objects (compiled functions) from a loaded snapshot, with entry point address, size, and name (if available). Pass a sessionId to reuse a cached snapshot.
- dart_load_snapshot: Load and parse a Dart AOT snapshot from libapp.so, extracting metadata and statistics (Code objects, ObjectPool entries, clusters). Pass a sessionId from dart_create_session to reuse an already-parsed snapshot (skips re-parsing libapp.so).
- dart_object_pool_dump: Read-only static dump of the Dart isolate ObjectPool in a libapp.so: classify each slot as smi/mint/double/string/classRef/functionRef/pool/null/unknown.
- dart_pc_descriptors: Parse PcDescriptors for one or all Dart functions in a loaded snapshot and resolve call targets by decoding ARM64 BL instructions at each call-site PC offset. Returns structured call-site entries with pcOffset, kind (1=icCall, 2=unoptStaticCall, 3=runtimeCall), and optionally resolved target addresses when code section bytes are available. Pass a sessionId or file path to load the snapshot.
- dart_smi_scan: Recover Dart Small Integer (Smi) constants from a libapp.so by reading aligned little-endian words and stripping the heap-pointer tag bit.
- dart_snapshot_header_parse: Parse the Dart isolate snapshot header in a libapp.so: magic, kind, 32-byte hash, features, target arch. Read-only.
- dart_strings_extract: Stream-extract ASCII/UTF-16LE strings from a Dart AOT libapp.so and classify them (urls, paths, classNames, packageRefs, cryptoKeywords, Dart identifiers, plus customRules). ReDoS-guarded.
- dart_symbolize: Resolve obfuscated Dart identifiers using a developer-supplied Flutter --save-obfuscation-map JSON (flat, pairs, or object shape).
- dart_trace_execution: Trace Dart function execution step-by-step, emitting each instruction with register state (PC, x0-x30, PP, THR). Pass a sessionId to reuse the cached snapshot.
- dart_version_fingerprint: Identify Flutter/Dart SDK release from a libapp.so by combining header parse with a built-in (and optionally user-supplied) hash table.
- flutter_packages_detect: Detect third-party Dart `package:` refs in a Flutter libapp.so, aggregated and SDK-stdlib-filtered.

## debugger (21)
- antidebug_bypass: Bypass one or more anti-debug protection types. Specify types to apply; omit or use ["all"] to apply all bypasses. Types: all, debugger_statement, timing, stack_trace, console_detect.
- antidebug_detect_protections: Detect anti-debug protections in current page with bypass recommendations.
- blackbox_add: Blackbox scripts (skip during debugging)

Usage:
- Skip third-party library c...
- blackbox_add_common: Blackbox all common libraries (one-click)

Includes:
- jquery, react, vue, an...
- blackbox_list: List script blackbox patterns.
- breakpoint: Manage breakpoints: code (line/script), function-name, XHR (URL pattern), event listener, event category, and exception breakpoints.

Actions:
- set: Create a breakpoint. Type determines required params.
- remove: Remove a breakpoint by ID.
- list: List active breakpoints of the given type.

Types & params:
- code: lineNumber (required), scriptId?, columnNumber?, condition?, logMessage? (logpoint: logs without pausing)
- function: functionName (required for set) — resolves via globalThis lookup and breaks whenever that function is called
- xhr: urlPattern (required for set)
- event: eventName (required for set), targetName?
- event_category: category (required for set)
- exception: state (required for set)
- debugger_capture_hit: Wait for the next debugger pause and capture call stack plus optional top-frame scope variables.
- debugger_disassemble: Disassemble V8 bytecode / instructions at the current paused location (or a given scriptId). Resolves the target scriptId automatically from the current paused call frame — useful when paused inside obfuscated/VM code to decide whether to step in. Native bytecode requires V8 natives syntax; set includeSourceFallback to derive a pseudo-bytecode from source when native extraction is unavailable.
- debugger_evaluate: Evaluate a JavaScript expression. context="frame" evaluates in the current call frame (requires paused state); context="global" evaluates in the global context (no pause required).
- debugger_get_paused_state: Get current paused state and reason.
- debugger_lifecycle: Enable or disable the CDP debugger session.
- debugger_pause: Pause execution at the next statement.
- debugger_resume: Resume execution.
- debugger_run_to_location: Run execution until a source location by setting a temporary code breakpoint, resuming, waiting for pause, and removing the breakpoint.
- debugger_session: Manage debugger sessions. Actions: save (persist current session to file), load (restore session from file/JSON), export (export session as JSON string), list (list saved sessions in ./debugger-sessions/).
- debugger_step: Step execution: into (enter next call), over (skip next call), out (exit current function).
- debugger_wait_for_paused: Wait for debugger pause after setting breakpoints.
- get_call_stack: Get the current call stack.
- get_object_properties: Get properties of an object by objectId.
- get_scope_variables_enhanced: Enhanced scope variable inspection with deep object traversal.
- watch: Manage watch expressions for monitoring variable values during debugging.

Actions:
- add: Add a watch expression (requires expression)
- remove: Remove by watchId
- list: List all watches
- evaluate_all: Evaluate all enabled watches (optional callFrameId)
- clear_all: Clear all watches

## encoding (5)
- binary_decode: Decode binary payloads, transport encodings, and compressed blobs into hex, utf8, or json output.
- binary_detect_format: Detect binary payload format and encoding signals.
- binary_encode: Encode utf8/hex/json input into transport encodings or compressed base64 blobs.
- binary_entropy_analysis: Compute entropy and byte frequency for a payload.
- protobuf_decode_raw: Decode protobuf bytes. Raw wire-format walk by default; schema mode returns ProtoJSON, expands valid google.protobuf.Any messages, preserves open-enum numeric values, and reports unknown fields with raw bytes plus wire details.

## exploit-dev (21)
- exploit_analyze_mitigations: Detect binary security mitigations (NX/DEP, PIE/ASLR, stack canary, RELRO, FORTIFY_SOURCE, CFG). Returns boolean flags for each protection. CFG (Control Flow Guard) is detected on Windows PE via IMAGE_DLLCHARACTERISTICS_GUARD_CF (0x4000).
- exploit_build_format_string: Generate format string exploit payload for arbitrary write. Uses %hn (2-byte) writes for reliability. Returns hex payload and reliability assessment.
- exploit_build_heap_spray: Generate heap spray payload for predictable heap layout. Supports V8 (ArrayBuffer), IE (BSTR), and generic (ArrayBuffer) spray targets. Returns spray code, allocation count, and predictability score.
- exploit_build_jop_chain: Build a JOP (Jump-Oriented Programming) chain from binary gadgets. JOP bypasses CFI by chaining gadgets via an indirect-jump dispatcher (e.g. jmp [rax]) instead of ret. Discovers dispatcher candidates, groups functional gadgets by dispatch register, and assembles a chain that covers the specified goal constraints. Also supports COP (Call-Oriented) and COOP (Counter-Object Oriented) chains.
- exploit_build_ret2dlresolve: Build a ret2dlresolve payload that forges ELF dynamic-linker structures to resolve an arbitrary symbol (e.g. "system") without knowing libc addresses. Generates fake .rel.plt, .dynsym, and .dynstr entries. Supports x86 (Elf32_Rel) and x64 (Elf64_Rela). Returns hex payload, reloc_offset, and structural details. Pure-TS offline builder — no live process needed. Reference: phrack #58 article 4, pwntools Ret2dlresolvePayload.
- exploit_build_rop_chain: Construct a ROP chain for a specified goal (execve, write_memory, call_function). Automatically searches for required gadgets and chains them. Returns hex chain and gadget list. User must provide command/address/function as needed.
- exploit_build_stack_pivot: Find and assemble stack pivot gadgets from a binary. Stack pivots redirect the stack pointer (ESP/RSP) to a controlled buffer, enabling ROP chains when limited stack space is available. Detects xchg(add/sub/mov,sp), push/pop(sp), leave, and add sp,N pivot patterns.
- exploit_cache_clear: Clear all cached exploit-dev results. Use when binaries have been modified or to free memory.
- exploit_cache_configure: Update exploit-dev cache configuration (TTLs, memory limits, enable/disable). Changes take effect immediately.
- exploit_cache_invalidate: Invalidate cached exploit-dev results for a specific binary (by path). Computes the binary hash and removes all matching cache entries. Call without binaryPath to clear the entire cache. Use when binaries have been recompiled or modified.
- exploit_cache_stats: Get exploit-dev cache statistics including hit rate, memory usage, and entry count. Used for performance monitoring and cache tuning.
- exploit_calculate_offsets: Calculate buffer overflow offset from crash value and De Bruijn pattern. Used to determine exact EIP/RIP overwrite offset.
- exploit_discover_one_gadget: Discover one-gadget (single-address shell-spawning) offsets for common libc versions. First checks a built-in database (glibc 2.23/2.27/2.31/2.35/2.39 for x64/x86, musl 1.2), then falls back to heuristic binary scanning for custom libcs. Returns offsets with constraints (e.g. "[rsp+0x70] == NULL") that must be satisfied for the one-gadget to work. Also lists all known libc identities when called with listKnown=true.
- exploit_encode_shellcode: Encode shellcode to avoid bad characters or detection. Supports alphanumeric, unicode, XOR, and fnstenv encodings. Returns encoded shellcode and decoder stub. User must provide raw shellcode.
- exploit_find_gadgets: Search for ROP/JOP/COP/COOP gadgets in a binary file. Returns addresses, instructions, and bytes for each gadget. Supports filtering by regex pattern and gadget type. User must provide target binary.
- exploit_find_jmp_esp: Find "jmp esp" / "call esp" style gadgets for stack pivoting. Searches for jump/call instructions targeting a specific register.
- exploit_generate_egghunter: Generate egghunter shellcode for constrained buffer sizes. An egghunter searches process memory for a 4-byte "egg" tag (repeated twice) and jumps to the real shellcode following it. Supports Linux x86 access(2)-based and Windows SEH-based egghunters. Reference: skape, "Safely Searching Process Virtual Address Space" (2004).
- exploit_generate_pattern: Generate De Bruijn sequence for offset finding. Every 4-byte substring is unique, allowing precise offset calculation from crash dumps.
- exploit_generate_pwntools: Generate a pwntools-compatible Python exploit script (exploit.py). Accepts ROP chain data, JOP chain data, shellcode payload, or one-gadget offset and emits a ready-to-run script with proper ELF loading, remote/local I/O setup, and payload assembly. Templates: io, rop, shellcode, ret2libc, format.
- exploit_solve_constraints: Solve a system of constraints using the Z3 SMT solver. Each constraint is a JavaScript-like boolean expression (e.g. "x > 10", "y <= 20", "x + y < 100"). Constraints are conjunctive (AND-ed together). Supports int, real, bool, and bitvec variable types. Returns sat/unsat/unknown plus an optional model with variable assignments when SAT. Use this for ROP gadget verification, opaque predicate inversion, and general constraint solving.
- exploit_verify_rop_chain: Verify a user-supplied ROP chain against an exploit goal using Z3. Decodes the hex chain into gadget addresses, matches each to a known gadget, simulates the register effects, and checks whether the final state satisfies the goal (e.g. execve syscall registers, write_memory address/value, call_function ABI args). Use this to audit hand-crafted or third-party ROP chains before use. Returns valid flag, decoded chain, final register state, violations, and warnings.

## extension-registry (7)
- extension_execute_in_context: Load an extension and execute a named exported context function.
- extension_info: Read installed extension manifest details without importing plugin code.
- extension_install: Install/register an extension from a manifest, local package directory, local module file, or remote module URL. Directory mode is zero-config: pass source=<plugin dir> after `pnpm build` and the tool reads id/name/version from package.json and discovers dist/manifest.js (or dist/index.js) automatically when no entry pointer exists.
- extension_list_installed: List installed extensions from the local registry.
- extension_reload: Reload an installed extension by unloading and loading it again.
- extension_uninstall: Uninstall an extension from the local registry.
- webhook: Manage webhook endpoints for external callbacks. Actions: create, list, delete, commands.

## graphql (7)
- call_graph_analyze: Analyze runtime function call graph from in-page traces.
- graphql_enum_schema: Enumerate GraphQL fields from server suggestion errors with introspection fallback.
- graphql_extract_queries: Extract GraphQL queries/mutations from captured network traces.
- graphql_introspect: Run GraphQL introspection and optional Apollo Federation _service.sdl probing.
- graphql_replay: Replay a GraphQL operation with optional variables, batch array, or Apollo persisted-query (APQ) extensions.
- graphql_subscribe: Open a GraphQL subscription WebSocket, perform the graphql-transport-ws (or legacy graphql-ws) handshake, send a subscribe frame, and collect frames for collectMs. Runs in-page so the browser-session auth (cookies + connectionPayload) is preserved. Pairs with graphql_replay for targets that expose queries/mutations only via the authed WebSocket session.
- script_replace_persist: Persistently replace matching script responses.

## instrumentation (13)
- ai_hook: Manage AI hooks. Actions: inject (inject code into page), get_data (retrieve captured hook data), list (all active hooks), clear (remove hook data by id or all), toggle (enable/disable a hook), export (export data as JSON/CSV).
- evidence_chain: Get full provenance chain from a node ID in specified direction.
- evidence_export: Export the reverse evidence graph as JSON snapshot or Markdown report.
- evidence_query: Query reverse evidence graph by URL, function name, or script ID to find associated nodes.
- hook_preset: Install a pre-built JavaScript hook from 20+ built-in presets (eval, atob/btoa, Proxy, Reflect, Object.defineProperty, etc.), or provide customTemplate/customTemplates to install your own reusable hook bodies. Use listPresets=true to see all available preset descriptions.
- instrumentation_artifact: Manage artifacts captured by instrumentation operations.
- instrumentation_hook_preset: Apply hook presets inside an instrumentation session.
- instrumentation_network_replay: Replay a captured network request inside an instrumentation session.
- instrumentation_operation: Manage operations inside an instrumentation session.
- instrumentation_session: Start, stop, or query status of an instrumentation recording session. Destroying a session archives it read-only (the last 8 destroyed sessions are retained, oldest evicted) so export/diff/merge/status can still inspect it.
- instrumentation_session_diff: Diff two instrumentation session snapshots: operations added/removed/common (by id) plus artifact fingerprints and per-type counts. Pure compare, mutates nothing.
- instrumentation_session_export: Export an instrumentation session snapshot to an artifacts JSON file.
- instrumentation_session_merge: Merge two sessions into a new session: copies operations (with id remapping) and artifacts from both sources. Original sessions are untouched.

## maintenance (17)
- browse_extension_registry: Browse the online extension registry for installable plugins and workflows.
- cleanup_artifacts: Clean generated artifacts by age and size.
- clear_all_caches: Clear all internal caches. Destructive — prefer smart_cache_cleanup.
- doctor_environment: Run environment doctor: dependencies, bridges, platform limits.
- execute_sandbox_script: Execute JavaScript in an isolated sandbox.
- get_cache_stats: Get cache statistics: entries, sizes, hit rates, and cleanup recommendations.
- get_token_budget_stats: Get token budget usage stats, warnings, and optimization suggestions.
- install_extension: Install an extension from the remote registry.
- list_extensions: List all loaded plugins, workflows, and extension tools.
- maintenance_detect_gpu: Detect GPU family from WebGL/WebGPU renderer strings. Classifies into NVIDIA, AMD, Intel, Apple, Mali, Adreno, PowerVR, Vivante, Broadcom, Qualcomm, Microsoft. Pure-TS classifier — no browser needed. Provide at least one of webglRenderer, webgpuDescription, or deviceName.
- manual_token_cleanup: Clear stale entries and reset counters to free 10-30% of token budget.
- reload_extensions: Reload plugins and workflows from configured directories, and directly register extension tools visible in the current profile. The response includes capabilityFixed — tools that only became available through this reload (previously blocked on a missing plugin).
- reset_token_budget: Hard-reset all token budget counters. Destructive — prefer manual_token_cleanup.
- smart_cache_cleanup: Evict LRU and stale entries while preserving hot data.
- snapshot_create: Create a shadow-git snapshot of a scan-artifact directory (artifacts, HAR, screenshots, debugger-sessions, ...) so it can be rolled back later. Uses an ISOLATED git object store outside the target directory — the project .git is never touched and no git commit is made. The store keeps full file contents, so snapshots can grow large; snapshot output directories, not source trees.
- snapshot_list: List shadow-git snapshots recorded for a directory, newest first.
- snapshot_restore: Restore a directory to a recorded shadow-git snapshot. DESTRUCTIVE: files modified after the snapshot are overwritten, files created after it are DELETED, and files deleted after it are written back (full revert semantics). The isolated store never touches the project .git. Create a fresh snapshot_create first if you may need the current state.

## memory (75)
- memory_allocate: Allocate executable memory in target process (VirtualAllocEx wrapper). Win32 only. Requires JSHOOK_INJECTION_ENABLE=1.
- memory_anticheat_detect: Scan process imports for anti-debug/anti-cheat mechanisms: IsDebuggerPresent, NtQueryInformationProcess, timing checks (QPC, GetTickCount), thread hiding, heap flag checks, and DR register inspection. Each detection includes a bypass suggestion.
- memory_antidetection: Anti-detection hardening toolkit. Actions: check (run all detectors — kernel callbacks, instrumentation callback, AMSI/ETW status, chaos mode, platform info), harden (apply AMSI/ETW patches + process masquerade + self-defense — destructive), status (read-only current protection state). WARNING: harden action modifies process memory and mitigation policies. ProcessBreakOnTermination is PERMANENTLY DISABLED (stub — no BSOD risk). On non-Windows, returns platform info only.
- memory_antidetection_check: Pre-flight anti-detection security audit. READ-ONLY — no patches or modifications. Checks: (1) ETW/AMSI patch status, (2) debugger attached to self via IsDebuggerPresent, (3) HVCI (Hypervisor-protected Code Integrity) and VBS (Virtualization-Based Security) status via registry, (4) known anti-cheat/EDR/AV/debugger processes via process enumeration. Returns a pass/warn/fail verdict with a 0-100 score, per-check results, and actionable recommendations. All checks are safe, user-mode, read-only operations. For actual hardening, use memory_antidetection action=harden.
- memory_aob_scan: Array-of-Bytes scan with wildcard and operator support (CE 7.6 parity). Search for byte patterns like "48 8B ?? ?? 00 00" across readable memory. Supports hex bytes (00-FF, optional 0x prefix), "??" wildcards, and operators: >XX (greater than), <XX (less than), XX-YY (range inclusive). Example: "48 8B >40 <80 00 00" matches bytes >0x40 at position 2 and <0x80 at position 3. Case insensitive. Use regionFilter to restrict to specific modules or skip system modules.
- memory_assemble: Assemble x64 assembly instructions to machine code bytes (x64dbg inline assembler parity). Uses Keystone assembler via koffi FFI (keystone.dll) if available on Windows, with a built-in fallback opcode table for common instructions (NOP, RET, INT3, PUSH/POP, MOV, XOR, ADD, SUB, INC, DEC). assemble: compile ASM string to hex bytes. assemble_at: assemble + write directly to target process memory at address (destructive, audit trail recorded). Separate multiple instructions with semicolons or newlines. Max 256 instructions, 4096 assembled bytes.
- memory_auto_assemble: Execute a Cheat Engine-style Auto Assembler script. Parses [ENABLE]/[DISABLE] sections and executes ENABLE commands. Supported commands: ALLOC(name,size), DEALLOC(name), LABEL(name[,addr]), REGISTERSYMBOL(name), AOBSCAN(name,pattern), ASSERT(address,bytes), CREATETHREAD(address), DEFINE(name,value), FULLACCESS(address,size), READMEM(address,size), WRITEMEM(address,bytes). INCLUDE and LOADBINARY are rejected for security. Returns a disableScript for use with memory_auto_assemble_disable. Win32 only — requires native process access.
- memory_auto_assemble_disable: Execute the DISABLE section of a previously-run Auto Assembler script. Pass the disableScript returned by memory_auto_assemble. Executes DISABLE commands, running DEALLOC last (CE convention). Win32 only — requires native process access.
- memory_batch_edit: Write a value to ALL addresses in a scan session at once. Thin wrapper that iterates through the session address list and calls writeValue for each. Capped at 1000 addresses per call with a clear error when exceeded. Destructive — an audit trail entry is recorded for each write. Equivalent to GameGuardian's gg.editAll() or Cheat Engine's "Edit All".
- memory_bookmark: Manage address bookmarks for a process. Actions: add (bookmark an address with optional label and color), remove (delete a bookmark), list (show all bookmarks for the PID), clear (remove all bookmarks for the PID). Labels help categorize findings; colors use hex format (e.g. "#FF0000"). Bookmarks are scoped per PID. For long-term persistence, export via state_board_io with namespace "memory_bookmarks:<pid>".
- memory_breakpoint: Breakpoint via hardware debug registers (DR0-DR3) or software INT3 (0xCC). Actions: set, remove, list, trace. Hardware BPs (type='hardware'): use x64 DR0-DR3, max 4 concurrent, support read/write/readwrite/execute. Software BPs (type='software'): use INT3 (0xCC) patching, unlimited count, execute-only. Two debugger modes: "win32" (default, uses DebugActiveProcess — freezes entire process) and "veh" (Vectored Exception Handler — injects shellcode, only faulting thread pauses). VEH mode is less intrusive but requires code injection which may be detected by anti-cheat systems. Conditional breakpoints: pass a JS expression as "condition" (e.g. "rax > 0x1000"), evaluated against register context on each hit; falsy results auto-resume without reporting.
- memory_call_stack: Walk the call stack of a target process thread using the x64 RBP frame-pointer chain. Suspends the thread, reads the CONTEXT to get RBP/RSP/RIP, then follows the linked list of saved_RBP / return_address frames via ReadProcessMemory. Resolves module names using Toolhelp32 module snapshots. Returns an array of {frameIndex, returnAddress, moduleName, functionName}. Equivalent to x64dbg's "standard" call stack mode. Win32 (x64) only — requires Administrator privileges.
- memory_cheat_table: Import, export, sign, or verify Cheat Engine .CT files. Export: converts JSON entries to valid .CT XML. Import: parses .CT XML to JSON. Sign: HMAC-SHA256 sign the XML using a secret (from JSHOOK_TABLE_SECRET env var, state_board "memory_ct_sign" secret key, or explicit "secret" arg). Verify: validate a signed table's HMAC signature. Addresses can be hex or module+offset.
- memory_code_caves: Find code caves (runs of 0x00 or 0xCC) in executable sections of loaded modules. Returns largest caves first.
- memory_dump: Dump memory region as hex with ASCII column. Outputs a formatted hex dump similar to xxd.
- memory_emulator_detect: Detect if a target process is a known console emulator (ArtMoney parity). Supports: PCSX2, Dolphin, RPCS3, Yuzu, Cemu, ePSXe, PPSSPP, xemu. Detection uses process name matching + optional module fingerprint confirmation. Returns emulator name, platform, and known memory region layout for emulator-mode scanning. Set list=true to enumerate all known emulators without a process check.
- memory_find_accesses: Find what writes to or accesses a memory address (Cheat Engine MWT workflow). Sets a hardware breakpoint on the target address, auto-rearms after each hit, captures the faulting instruction address + context + timestamp, and optionally disassembles the instruction. Returns aggregated hits with per-hit instruction details.
- memory_find_references: Find all references to an address in executable memory (x64dbg parity). Scans all executable regions for CALL rel32, JMP rel32, Jcc rel32, LEA [RIP+disp32], and MOV [RIP+disp32] instructions that reference the target address. Uses pure-TS byte-pattern heuristics — no Capstone dependency. Returns reference type, source address, disassembly, module name, and module offset. Optionally filter by module name.
- memory_first_scan: Start a new memory scan session.
- memory_free: Free remote memory in target process (VirtualFreeEx wrapper). Win32 only. Requires JSHOOK_INJECTION_ENABLE=1.
- memory_freeze: Freeze or unfreeze a memory address. Freeze continuously writes a value to prevent changes; unfreeze stops it.
- memory_freeze_export: Export all active freeze entries as structured JSON. Returns an array of freeze entries with freezeId, pid, address, value, valueType, intervalMs, and active flag. Optional pid filter to scope the export to a single process. Pure data export — no workflow, no replay.
- memory_generate_signature: Generate an update-resistant AOB (Array-of-Bytes) signature from bytes at a memory address. Detects relative offsets in CALL/JMP/LEA/Jcc instructions and replaces the displacement bytes with wildcards (??), making the signature survive minor code changes between updates. Uses byte-pattern heuristics — no Capstone dependency required.
- memory_group_scan: Search for multiple values at known offsets simultaneously.
- memory_guard_pages: Find all memory regions with PAGE_GUARD protection in a process. Guard pages are often used as anti-tampering mechanisms or stack overflow detection.
- memory_handle_enum: Enumerate all open handles in a target process via NtQuerySystemInformation. Returns handle value, object type, access mask, and object name for each handle. Filterable by type: File, Key, Process, Thread, Token, Section, etc. Useful for finding handles to protected resources and analyzing process security posture. Win32-only, admin required.
- memory_heap_anomalies: Detect heap anomalies: heap spray patterns (many same-size blocks), possible use-after-free (non-zero free blocks), and suspicious block sizes (0 or >100MB).
- memory_heap_enumerate: Enumerate all heaps and heap blocks in a process via Toolhelp32 snapshot. Returns heap list with block counts, sizes, and overall statistics.
- memory_heap_stats: Get detailed heap statistics with size distribution buckets (0-64B, 64B-1KB, 1-64KB, 64KB-1MB, >1MB), fragmentation ratio, and aggregate metrics.
- memory_hypervisor: EPT Hypervisor Phase 1: VMXON, VMCS setup, basic VM-exit handler design, CPUID spoofing. Intel VT-x only. Requires BYOVD kernel driver for MSR reads and VMXON region preparation. Gate: JSHOOK_HYPERVISOR_ENABLE=1 + admin. Actions: capabilities (detect VT-x/EPT/VPID, MSR values, Hyper-V conflicts), load (validate readiness + build VMCS config), unload (reset state), status (runtime state). NOTE: Actual VMXON/VMLAUNCH execution requires a kernel-mode component (not yet implemented). Phase 1 provides detection, configuration, and the exit-handler design.
- memory_inject_dll: Inject a DLL into target process. Win32 only. Modes: loadlibrary (LoadLibraryW injection) or manualmap (manual mapping). Requires JSHOOK_INJECTION_ENABLE=1.
- memory_inject_shellcode: Inject shellcode into target process. Win32 only. Methods: createremote (CreateRemoteThread) or ntcreatethread (NtCreateThreadEx). Requires JSHOOK_INJECTION_ENABLE=1.
- memory_inline_hook_detect: Detect hooks in process modules. scanMode "inline" (default) compares the first 16 bytes of each exported function disk-vs-memory and recognises 8 hook patterns (JMP/CALL/short-jmp/MOV+JMP/MOV+CALL/PUSH+RET/INT3/padding). scanMode "iat" detects Import Address Table hooks (entries redirected outside their source module — evades inline detection, used by EasyHook/MinHook/Detours). scanMode "both" runs both scans.
- memory_integrity_check: Check executable memory regions against their corresponding on-disk PE files (.text sections) to detect modifications like inline hooks or code patches.
- memory_list_types: List all registered custom scan types.
- memory_mono_assemblies: List Mono assemblies loaded in the root domain of a Unity/Mono process. Returns assembly name, address, and image address. Optionally filter by name substring.
- memory_mono_classes: List Mono classes in a specific assembly from a Unity/Mono process. Reads the MonoImage type definition table (MONO_TABLE_TYPEDEF) and resolves class names from the string heap. Optionally filter by namespace.
- memory_mono_detect: Detect Mono or IL2CPP runtime in a target process. Returns runtime kind (mono/il2cpp), module name, pointer size, and root domain address if resolved. Works on Unity games and other Mono/.NET applications.
- memory_mono_fields: Read field values from a Mono object at the given address. Resolves the class via vtable pointer, walks MonoClass fields, and decodes each field value with type-aware heuristics (int, float, string pointer detection).
- memory_mono_methods: Inspect method count for a Mono class in a Unity/Mono process. Full method name enumeration requires walking the MonoMethod table from MonoImage (not yet implemented — returns methodCount from the type definition table).
- memory_mono_objects: Find live Mono objects of a specific class in the managed heap. Resolves class vtable, then scans writable heap regions for vtable pointer matches. Returns object addresses with class name and estimated size.
- memory_next_scan: Narrow an existing scan session. Supports delta modes: changed_by (value changed by exactly N), increased_by (value increased by at least N), decreased_by (value decreased by at least N), changed_by_variable (returns per-address delta in results).
- memory_parse_dump: Parse a Windows Minidump (.dmp) file and extract forensic information: loaded modules (base/size/name/timestamp), threads (ID/stack/context), memory ranges (64-bit or 32-bit), system info (OS/CPU), and exception records. Optionally resolve a list of addresses against the dump contents. Pure TS — cross-platform (can analyze Windows dumps on Linux/macOS).
- memory_patch_bytes: Write bytes to target process at address. Saves original bytes for undo. Use for runtime code patching.
- memory_patch_nop: NOP out instructions at address (replace with 0x90). Useful for disabling checks or jumps.
- memory_patch_undo: Undo a previous patch by restoring the original bytes.
- memory_pe_headers: Parse PE headers (DOS, NT, File, Optional) from a module base address in process memory. Returns machine type, entry point, image base, section count, and data directory info.
- memory_pe_imports_exports: Parse import and/or export tables from a PE module in process memory. Returns DLL names, function names, ordinals, hints, and forwarded exports. Cross-platform: parses ELF .dynsym / Mach-O LC_SYMTAB from disk when moduleName is given on Linux/macOS.
- memory_pointer_chain: Pointer chain operations: scan (multi-level BFS), autoscan (auto-discover pointer chains by recursively scanning for pointers that point to or near the target address), validate, resolve, or export as JSON. autoscan is Cheat Engine's "pointer scan" equivalent — no manual base/offsets needed.
- memory_pointer_map: Save, load, or compare pointer maps for cross-instance filtering (Cheat Engine .PTR parity). save: serialize pointer scan results to a .ptr.json file in <project>/.ptr/. load: deserialize a pointer map from file. compare: load 2+ pointer map files and find addresses that appear in ALL maps — the CE "rescan across multiple instances" workflow for finding stable pointer chains.
- memory_pointer_scan: Find pointers to a target address.
- memory_process_control: Suspend or resume a target process for consistent memory snapshots. Suspend freezes all threads (NtSuspendProcess on Win32, SIGSTOP on Linux, task_suspend on macOS) so memory reads/scans see a consistent state. Resume thaws all threads. Useful before memory_dump or memory_first_scan for processes with actively-changing memory. Cross-platform.
- memory_protect: Change memory page protection for a region in the target process. Wraps VirtualProtectEx (Win32) / mprotect (Linux) / mach_vm_protect (macOS). Protection: r (read-only), rw (read-write), rx (read-execute), rwx (all), none (no-access). Returns the old protection. Destructive — audit trail recorded.
- memory_read_typed: Read process memory as typed numeric values with explicit endianness. Decodes consecutive values starting at address via koffi endian-sensitive integer types (uint64_le / int32_be / …) — no manual byte swapping needed. 64-bit values are returned as decimal strings alongside two's-complement hex. float/double use IEEE-754 with the requested endianness. Supports up to 1024 consecutive values. Ideal for struct inspection, big-endian network payloads, and game memory analysis.
- memory_region_compare: Compare two memory regions byte-by-byte and return a diff summary. Equivalent to Cheat Engine's compareMemory(). Returns identical flag, diff count, and per-offset differences (byte1, byte2). Max compare size: 64KB.
- memory_region_enumerate: Enumerate memory regions in a target process. Cross-platform: Windows (VirtualQueryEx), macOS (mach_vm_region), Linux (/proc/pid/maps). Returns base address, size, protection (r/w/x/rw/rx/rwx), state, type (image/mapped/private), and module name (if module-backed). Emulator mode (mode="emulator"): use with memory_emulator_detect to get emulator-specific memory region descriptors (EE RAM for PCSX2, MEM1/MEM2 for Dolphin, etc.) and filter results.
- memory_register_type: Register a custom value type for memory scanning (Cheat Engine parity). Registered types can be used as valueType in memory_first_scan, memory_unknown_scan, etc. Types are session-scoped (live as long as the domain handler instance).
- memory_remote: Connect to a remote jshookmcp MCP server via WebSocket for remote debugging. Enables ceserver-style remote memory operations: connect to a remote instance, forward tool calls (memory read/write, process enumerate, etc.), and receive results. Uses JSON-RPC 2.0 over WebSocket with auth token support and auto-reconnect. Actions: connect (establish WebSocket link), disconnect (tear down), status (connection state + stats), forward (proxy a tool call to the remote instance).
- memory_reverse_mwt: Reverse memory write trace — given a code address, find what data addresses the instruction accesses. Inverse of memory_find_accesses. Disassembles the instruction at the given address using Capstone, then resolves RIP-relative and absolute memory operands to their target addresses. Returns instruction text, raw bytes, and a list of accessed addresses with access type (READ/WRITE/RIP_REL). Useful for understanding what data a specific piece of code operates on.
- memory_rtti_info: Parse MSVC RTTI (Run-Time Type Information) at an object address. Reads vtable pointer, follows the Complete Object Locator chain, extracts class name, base classes, and class hierarchy descriptor. Equivalent to CE's "Find out what addresses this code accesses" for type discovery — quickly answer "what type is this object?" without a full structure analysis. Only works on MSVC x64 binaries with RTTI enabled.
- memory_scan_session: Manage scan sessions. Actions: list (all sessions), delete (by sessionId), export (as JSON).
- memory_search_string: Search process memory for strings matching a pattern. Wraps memory_first_scan with valueType=string for convenience and adds substring/regex post-filtering. Optionally also searches for UTF-16LE (wide) strings.
- memory_session_export: Export a scan session's complete state as structured JSON. Returns sessionId, pid, valueType, addresses[], values{}, and metadata. Pure data export — no workflow, no replay. Addresses are capped at 100K with a truncated flag when the cap is hit.
- memory_speedhack: Hook time APIs (GetTickCount64/GetTickCount/QueryPerformanceCounter/QueryPerformanceFrequency/timeGetTime/GetSystemTimeAsFileTime) to scale process time via an in-process SSE2 trampoline. time via an in-process SSE2 trampoline. Actions: apply (hook + set speed), set (adjust speed without re-hooking), restore (unhook and restore original functions). Speed range 0.01–100x; values outside this range are rejected to avoid destabilising the target.
- memory_structure_analyze: Analyze memory at an address to infer data structure layout.
- memory_structure_compare: Compare struct instances to identify differing vs constant fields. Two modes: (1) Pairwise—compare address1 vs address2. (2) Group comparison (CE dissect data parity)—pass arrays of addresses in group1Addresses and group2Addresses. Group mode computes per-offset statistics and classifies fields as: between_groups (differs across groups—likely gameplay state), within_group (varies within groups—dynamic), constant_all (same everywhere—likely vtable, type flags). Returns confidence scores.
- memory_structure_export_c: Export an inferred structure as a C-style struct definition, ReClass.NET XML, Rust #[repr(C)], or C# [StructLayout] with explicit FieldOffset attributes. C export auto-detects composite types (Vector3, Matrix4x4, pointer arrays).
- memory_trace_code: Ultimap-style instruction-level code tracing. Sets INT3 (0xCC) software breakpoints at function entry points and logs every execution. Aggregates hit counts per address to produce a hot-code-path heat map. Win32-only — requires the Win32 debug API (DebugActiveProcess). Provide either "addresses" (list of specific hex addresses) or "startAddress" + "size" (range to scan for 0x55 push-rbp prologues). Max trace time: 30s, max hits: 10000.
- memory_type_define: Override field types in an inferred structure. Actions: set (define a type at offset+size), list (show all overrides), clear (remove all overrides). Overrides are applied in subsequent memory_structure_analyze calls. Supported types: int8, uint8, int16, uint16, int32, uint32, int64, uint64, float, double, pointer, string_ptr, vtable_ptr, hex, padding, unknown.
- memory_unknown_scan: Start an unknown initial value scan.
- memory_unregister_type: Remove a registered custom scan type by name.
- memory_vtable_parse: Parse a vtable to enumerate virtual function pointers and resolve them to module+offset. Also attempts RTTI parsing for class name and inheritance hierarchy.
- memory_watch: Poll a memory address until its value changes (like scanmem's "watch" command). Reads the current value, then polls at a configurable interval. Returns immediately with the old value, new value, and elapsed time when a change is detected. If no change occurs within the timeout, returns the unchanged value and a hint. Useful for "tell me when this variable changes" workflows.
- memory_write_history: Undo or redo the last memory write operation. Pass pid to scope the operation to a specific process — per-PID undo prevents reverting an unrelated process's write when multiple processes are being edited concurrently.
- memory_write_value: Write a typed value to a memory address. Supports undo/redo via memory_write_history(action=undo|redo).

## mojo-ipc (8)
- mojo_decode_message: Decode a Mojo IPC hex payload into a structured field map.
- mojo_encode_message: Encode a structured Mojo IPC message into a hex payload.
- mojo_ipc_capabilities: Report Mojo IPC monitoring availability.
- mojo_list_interfaces: List discovered Mojo IPC interfaces and their pending message counts.
- mojo_messages_get: Retrieve captured Mojo IPC messages from the active monitoring session.
- mojo_messages_summarize: Aggregate the captured Mojo IPC buffer (non-destructive) into interface/method/direction breakdowns, top-N lists, and a capture time window. Does not drain the buffer.
- mojo_monitor: Start or stop Mojo IPC monitoring for the active Chromium-based target.
- mojo_verify_live: Generate a Frida verification script that probes a target Chromium process for known Mojo C-API exports (MojoWriteMessage, MojoWriteMessageNew) across modules. Uses a curated symbol database covering Chromium M96+ across Win32, Linux, and macOS. Returns a ready-to-run Frida script and probe metadata. Honest boundary (B-class): symbol DB is manually curated; symbols may vary by build config. Verified flag is always false — confirm against the live binary.

## native-bridge (6)
- binary_ninja_bridge: Send a command to a local Binary Ninja analysis bridge.
- ghidra_bridge: Send a command to a Ghidra bridge. Two backends: the pip ghidra_bridge server (TCP 127.0.0.1:4768 — pip install ghidra_bridge, then in Ghidra run ghidra_bridge_server.py) or a REST bridge (HTTP 18080). Auto mode prefers the pip TCP server when it answers.
- ida_bridge: Send a command to an IDA Pro plugin bridge.
- native_bridge_status: Check native bridge backend health.
- native_symbol_sync: Export native symbols to connected analysis backends. Supports json/csv/idc/sqlite output; an optional sinceHash requests an incremental export (only changed symbols) from backends that support it.
- rizin_bridge: Send a command to a local Rizin/r2 analysis bridge.

## native-emulator (57)
- nemu_alloc_memory: Allocate raw guest memory (NOT a JNI handle — a real char* address). Optionally fill with initial data via fillBytes (base64). Returns the guest address to pass as an integer arg to call_symbol. Use at the start of a session to stage encrypted blobs for a native decrypt/signing routine, then read the output with nemu_read_memory.
- nemu_bind_all_imports: Batch-bind host functions to ALL resolved import stubs in the GOT. Reads the GOT table (0x74000 range), finds every unique resolved address, and binds the given JS function body to each. Call after load_library to mock every unresolved shell import at once.
- nemu_bind_host_fn: Register a JavaScript host function at a specific guest address, overriding any existing stub. The function receives guest registers (ctx.x(0)..x(7)), can read/write guest memory (ctx.read/ctx.write), and returns a BigInt value placed in x0. Use to mock custom shell imports at their resolved GOT addresses.
- nemu_bytecode_decode: Decode a u32 LiteVM bytecode word into its opcode fields: group (G0-G7), sub-opcode, a1 register index, fl field index, imm signed offset, and validity. Matches the Python LiteVM Opcode.is_valid_opcode() semantics. No session needed — pure computation. Use to understand what a native bytecode word means without external scripts.
- nemu_bytecode_scan: Scan a guest memory region and decode all valid LiteVM bytecode words. Reads `count` u32 words starting at `address`, decodes each one, and returns only the valid opcodes with their offsets. Much faster than manual decode+filter — one call to survey an entire bytecode table.
- nemu_call_address: Call a function at an arbitrary guest address (e.g. a native method registered via RegisterNatives). Uses AArch64 AAPCS with args in x0..x7; returns x0. Set injectJni=true to prepend guest JNIEnv* as x0 + thiz=0 as x1 (standard JNI method convention).
- nemu_call_jni_export: Invoke an exported `Java_*` JNI function. Injects the guest `JNIEnv*` and thiz, then the Java arguments. Returns x0 — an int/jboolean directly, or a jobject/jbyteArray/jstring handle to resolve via read_byte_array. The main entry point for reversing a native signing/crypto routine.
- nemu_call_symbol: Invoke an exported function by name following AArch64 AAPCS (integer args in x0..x7, result in x0). Auto-detects JNI signatures. Set injectJni=false to force raw arguments. Set debug=true for auto-NOP on NULL indirect calls + auto TLS prep.
- nemu_capabilities: Report native-emulator backend availability, supported features, and explicit ISA/SIMD gaps. Unsupported opcodes fail loudly instead of being reported as emulated.
- nemu_create_jni_handle: Create a mock JNI object handle pre-populated with controlled data. Use BEFORE calling JNI functions to seed the handle table so that GetStringUTFChars / GetObjectArrayElement / GetIntField return expected values. Returns the handle id to pass as an argument to nemu_call_address or nemu_call_symbol.
- nemu_create_session: Create an isolated ARM64 emulator session and return its sessionId. Each session owns its own CPU registers, guest stack, and JNI object table, so concurrent analyses never interfere. Destroy it with nemu_destroy_session when done; idle sessions auto-expire. Pass `files` to populate the virtual device filesystem (path→base64 content) so native code can fopen/fread assets like jiagu_config directly from the emulated FS.
- nemu_create_vtable: Create a C++ vtable-backed object in guest memory. Allocates a vtable with `numSlots` entries (each pointing to a return-0 host stub) and an object that points to it. Use when native code does direct vtable dispatch (BLR X8 through [obj+offset]) — common in obfuscated SO files calling virtual methods on C++ objects. Returns {objectAddr, vtableAddr} for use with nemu_call_address/nemu_call_symbol.
- nemu_data_dump: Read a guest memory region and format it as a structured table of u32 or u64 values. Each row shows offset, hex value, ASCII preview, and optional annotations. Auto-classifies each word as pointer, bytecode, ASCII, or raw data. Pointers are resolved to show target data when possible.
- nemu_destroy_session: Destroy an emulator session and free its memory (mapped library, stack, JNI tables).
- nemu_disassemble: Disassemble instructions. Two modes: (1) single-instruction — pass `opcode` (a number, 0x hex string, or hex bytes) and optional `pc`; no session needed. (2) batch — pass `sessionId`, `vaddr`, and `count`; reads `count` 4-byte words from guest memory starting at `vaddr` and returns a `{pc, opcode, asm}[]` list. Batch supports fixed-width ISAs only (arm64/aarch64, riscv32/riscv64, mips/mips32/mipsel); x86/x64 are rejected. A local lightweight decoder for trace readability, including common SSE/AVX/AVX2/AVX-512 EVEX, RISC-V, and MIPS instructions.
- nemu_dlsym_diag: Read the dlsym resolution log from the current session. Tracks every symbol lookup the emulated code requested via dlsym() — essential for discovering which VM handler names an obfuscated dispatch engine tries to resolve. Actions: read (default, reads+clears), snapshot (read-only), clear.
- nemu_dump_frame: Read and decode a CreateLitevm frame structure from guest memory. Parses the 256-byte frame fields: chain pointer, bytecode count, frame data, and sub-function flags. Essential for understanding the VM dispatch state at any point during execution.
- nemu_dump_got: Dump the PLT trampoline → GOT → symbol mapping for an AArch64 ELF shared object. Scans .text for the 4-instruction trampoline pattern (adrp x16 → ldr x17 → add x17,x16,x17 → br x17) used by obfuscated SO files and cross-references each slot against dynamic relocations to resolve the callee name. Use this when you need to know what "bl 0xACD0" actually calls without manual readelf + Python scripting.
- nemu_extract_apk_libs: List the loadable arm64-v8a native libraries (.so) packaged inside an APK, with their byte sizes. Use nemu_load_apk_library to load one. Note: libapp.so (Flutter Dart AOT) is listed but is not executable here — route it to the Dart layer.
- nemu_gdbserver: GDB Remote Serial Protocol (RSP) TCP server. Starts a real TCP server on host:port that GDB clients can connect to. Provides full register read/write, memory read/write, step, continue, software breakpoints (Z0/z0), vCont extended step/continue, qXfer target description, thread listing, and feature negotiation (qSupported). The server dispatches commands to the nemu emulator session in real-time. Packet format: $data#checksum (RFC 5.1 GDB Remote Serial Protocol). Actions: start (launch TCP server), stop (shut down), status (server + clients). Note: step/continue are simulated (PC += 4, immediate SIGTRAP); real execution control requires CpuEngine.runUntilBreakpoint() which is not yet exposed.
- nemu_get_jni_stub: Get the guest stub address for a JNI table index. Pass a specific `index` to look up one entry (returns 0 + bound=false if the index was never bound), or omit to return all bound index→stubAddress mappings. Use to read stub addresses from a session so they can be written into SO caches or external tooling that expects specific JNI function addresses (especially the extended indices 280-336 used by obfuscation VM dispatch bridges).
- nemu_inspect_imports: Inspect an AArch64 ELF .so before emulation and list imported symbols from dynamic relocations, including GOT offsets and whether each import is backed by the built-in bionic stubs. Use this to diagnose PLT/GOT NULL indirect-call failures without writing ad-hoc readelf/Capstone scripts.
- nemu_jni_diag: Read the JNI diagnostic log for a session. Tracks every JNI function call (FindClass, GetMethodID, CallIntMethod, etc.) and unimplemented stub invocations. Use after nemu_call_symbol or nemu_trace to see what Java methods the native code tried to call. Actions: "read" (default) reads and clears the log; "snapshot" reads without clearing; "clear" clears without returning.
- nemu_jni_handles: List all JNI object handles allocated in a session, with their kind and summary. Handles are opaque IDs (jclass, jstring, jbyteArray, jobject) that native code passes around. Use to verify mock setups and debug handle leaks. Optionally filter by kind (e.g. "class", "string", "bytes", "method", "field", "auto-object", "mock-int", "mock-string", "mock-boolean", "objarray") or by specific handle number.
- nemu_list_sessions: List active emulator sessions with their creation and last-use timestamps.
- nemu_list_symbols: List the exported function symbols of the loaded library — the names callable via call_symbol / call_jni_export.
- nemu_load_apk_library: Extract a specific arm64-v8a .so from an APK by name and load it into a session in one step (no temp files). Pair with nemu_extract_apk_libs to discover library names.
- nemu_load_library: Load an AArch64 ELF shared object (.so) from a filesystem path into a session, mapping its segments and resolving exported symbols. Prerequisite for list_symbols / call_symbol / call_jni_export.
- nemu_load_library_chain: Load a chain of dependent libraries into a session, resolving inter-library imports. Pass dependency .so paths as dependencyPaths (loaded first in order), then the primary .so path. Each dependency exports are visible to the primary and later dependencies. Use this for FFmpeg-style multi-library loads where libijkplayer.so calls exports from libijkffmpeg.so and libijksdl.so.
- nemu_mem_inspect: Single convergence entry point for the guest-memory inspection family — one tool, five `action` subcommands, each mapping 1:1 onto an existing read-only memory tool (which remains available unchanged): read → nemu_read_memory (raw bytes as base64 preview/data), dump → nemu_data_dump (u32/u64 word table with pointer/bytecode/ASCII classification), chain → nemu_pointer_chain (follow pointer indirection hops), frame → nemu_dump_frame (decode a 256-byte CreateLitevm frame), scan → nemu_scan_memory (byte-pattern search over an address range, pattern as base64). Each subcommand accepts exactly the parameters of the wrapped tool; per-subcommand required parameters are enforced by the handler's action-discriminated union, and defaults are those of the wrapped tool. All subcommands are read-only observations of guest memory in an emulator session.
- nemu_mem_map: Map a memory region in guest address space. Use to extend the mapped area for output buffers or scratch data that would otherwise cause unmapped-memory faults. Idempotent — safe to call on already-mapped regions.
- nemu_mem_shadow: Add a shadow memory overlay at a specific address. Reads from shadow take priority over underlying memory — use to provide mock data at addresses that would otherwise crash (e.g. address 0 where SO ELF header resides). Does NOT modify the underlying SO mapping.
- nemu_new_byte_array: Wrap base64 bytes as a JNI jbyteArray handle to pass as an argument into call_jni_export (e.g. the plaintext a signing routine consumes). Returns the handle.
- nemu_patch_apply: Apply multiple memory patches in a single call. Each patch is {address, dataBase64, writeProtect?}. Faster than repeated nemu_write_memory calls — essential for atomic code patches that must be applied together to avoid intermediate corrupt states.
- nemu_pointer_chain: Walk a chain of pointers in guest memory. Starting from `base`, reads a u64 pointer, then follows it to the next address, repeating up to `maxDepth` times. At each hop, shows the address, the pointer value, and the first 32 bytes of data there. Essential for understanding CreateLitevm's x24 table indirection structure.
- nemu_prepare_tls: Map the TPIDR_EL0 (thread-pointer) TLS block so its memory is accessible for pre-population via nemu_write_regions. Returns the TLS base address. Use this before writing data to TLS offsets (e.g. frame-table pointer at +0x1768) that native code reads via mrs xN, tpidr_el0; ldr xM, [xN, #large_offset].
- nemu_read_byte_array: Resolve a jbyteArray handle (e.g. a native call's return value) back to its bytes, returned as base64 plus length.
- nemu_read_memory: Read raw bytes from guest memory at a given address. Returns a bounded preview by default; set includeDataBase64=true for full base64 within the configured cap.
- nemu_regs_restore: Restore GPR registers from a previously-saved snapshot (created by nemu_regs_save). Partially restores: only registers that were saved are written back. Use after an obfuscated function call to recover decode/context registers.
- nemu_regs_save: Save a named snapshot of current GPR registers (x0-x30, sp). Returns a snapshot id usable with nemu_regs_restore. The snapshot persists until the session is destroyed or the name is overwritten. Use to preserve registers before calling an obfuscated function that corrupts callee-saved state.
- nemu_relay: Connect to a remote native-emulator session via IPC relay. Proxies nemu operations through a named pipe (Windows) or Unix domain socket (Linux/macOS) with JSON-RPC over length-prefixed frames. Use to drive ARM64 nemu sessions on a Linux host from a Windows MCP server (or vice versa).
- nemu_scan_memory: Scan emulated memory for a byte pattern (like Volatility). Searches a guest address range for an exact byte match using Boyer-Moore-Horspool. Returns a list of matched addresses. Skips unmapped regions silently — use nemu_mem_map to extend the scan range if needed.
- nemu_session_info: Inspect one emulator session without executing native code. Returns timestamps, exported symbols, unresolved imports, constructor faults, and active session count.
- nemu_session_load: Load a JSON-serialised array of tool calls and execute them sequentially to set up a session. Each entry is {tool, args}. Supported tools: alloc_memory, write_regions, call_address, call_symbol, prepare_tls, setup_java_mocks, map_memory, bind_host_fn. Use this to replay a debug session from a saved JSON plan without repeating ~20 manual MCP calls.
- nemu_set_pac_key: Configure the ARMv8.3 Pointer Authentication key set used by PACIA/PACIB/AUTIA/AUTIB/PACGA instructions in this emulator session. Set a 128-bit key (32 hex chars) by key slot (ia/ib/da/db/ga) to match keys dumped from a real device via Frida. Note: the emulator signs with an 8-bit PAC field and a 32→64 duplicated modifier, so AUT of pointers signed by real hardware verifies as a mismatch (stripped in-place, control flow preserved) — round-trips inside the emulator stay self-consistent.
- nemu_set_registers: Set arbitrary CPU registers by index. Pass an object mapping register number to value (e.g. {0: 0x60000000, 10: 0, 11: 0x55150}). Supports x0-x30 and floating-point d0-d31. Use to fix up loop variables or inject context pointers before/after host function calls.
- nemu_set_vtable_slot: Override a specific vtable slot with a custom host function. The slot at vtableAddr + slotIndex*8 is rewritten to point to a stub executing `fnBody` (JS, with ctx.x/ctx.writeU64/ctx.persistReg etc.). Use to mock specific C++ virtual methods after creating a vtable with nemu_create_vtable.
- nemu_setup_java_field: Register a mock Java field the emulated native code reads back via JNI (GetFieldID/GetStaticFieldID + Get<Type>Field). Declaratively specify the value with valueInt, valueString, or valueBytes (base64) — the 'Java world' constant a native routine folds into its result. No code is executed.
- nemu_setup_java_mock: Register a mock Java method for JNI callbacks. returnInt/returnString/returnBytes for single constant; returnMap (JSON) for per-key dispatch: first Java arg matched as key→{type,value}. Single-constant is fallback for unmatched keys.
- nemu_setup_java_mocks: Batch-register multiple Java method mocks in one call. Each entry in the array has the same fields as nemu_setup_java_mock: className, methodName, signature, plus one return value (returnInt, returnString, returnBytes, returnObject, returnArray, or returnMap). Use this to define the full mock chain without rebuilding jshook.
- nemu_trace: Invoke an exported symbol while recording every instruction executed (pc, opcode, step), optionally snapshotting named registers per step. Bounded by maxSteps. Use to follow the control flow / algorithm of an obfuscated native function.
- nemu_vm_state_compare: Compare native VM state (read from guest memory) against an expected state (e.g. Python LiteVM dump). For each of ctx, table, and output, reports whether they match and lists the first mismatches. Use to cross-validate native VM execution against the known-good Python implementation.
- nemu_vm_state_dump: Dump LiteVM state from guest memory at specified base addresses. Reads ctx (32×64-bit), table (32×64-bit), and optional output buffer. Returns structured hex values suitable for comparison with Python LiteVM dumps. Use after nemu_call_symbol to inspect native VM execution results.
- nemu_vm_state_load: Load VM state into guest memory. Takes ctx values and table values as hex strings and writes them at the specified base addresses. Use to bridge Python LiteVM state into native VM: run Python vm.run(), dump ctx/table as hex, then load into nemu guest memory before calling bb2i34u32clsb.
- nemu_write_memory: Write raw bytes into guest memory at a given address via base64 data. Use to update an input buffer between call_symbol invocations without re-allocating, or to patch code/data in place.
- nemu_write_regions: Write multiple memory regions in a single call. Accepts an array of {address, dataBase64} objects. Essential for atomic code patching: apply all patches in one call to avoid intermediate corrupt states.
- nemu_xor_region: XOR a region of emulated memory with a single-byte key. Returns the XOR result as base64. Use for quick decryption testing — XOR a buffer with a candidate key byte and inspect the preview without modifying guest state. Set dryRun=false to write the XOR result back into guest memory.

## network (38)
- console_buffers: Manage injected interceptor state.
- console_get_exceptions: Get captured uncaught exceptions from the page
- console_inject: Inject an in-page script, XHR, fetch, or function monitor.
- console_inject_fetch_interceptor: Inject a fetch interceptor.
- console_inject_xhr_interceptor: Inject an XMLHttpRequest interceptor.
- dns_bulk_resolve: Resolve many hostnames concurrently with per-host status.
- dns_cname_chain: Trace the full CNAME chain for a hostname.
- dns_probe: Run a DNS query and return structured status instead of throwing.
- dns_resolve: Resolve a hostname to DNS records using the system resolver or an optional DNS server.
- dns_reverse: Reverse DNS lookup — find hostnames for an IP address.
- grpc_frame_build: Encode one or more messages into a gRPC / gRPC-Web length-prefixed body. Inverse of grpc_frame_parse — for constructing test or replay bodies. Each message takes payloadHex plus optional compressed / isTrailer flags.
- grpc_frame_parse: Split a captured gRPC / gRPC-Web body into its length-prefixed messages. Each message is 1 compressed-flag byte + 4-byte big-endian length + payload. Detects gRPC-Web trailer frames (flag bit 7) and the compression flag (bit 0). Lenient: a truncated trailing message is still emitted with a warning. Each message exposes payloadHex and payloadBase64 — feed payloadBase64 directly to protobuf_decode_raw to complete the gRPC decode chain (capture body -> grpc_frame_parse -> protobuf_decode_raw).
- http_plain_request: Send a raw HTTP request over plain TCP.
- http_request_build: Build a raw HTTP/1.x request payload.
- http2_frame_build: Build a raw HTTP/2 frame.
- http2_frame_parse: Decode a raw HTTP/2 frame (hex string) back into its header fields and type-specific payload (SETTINGS entries, PING opaque data, WINDOW_UPDATE increment, RST_STREAM/GOAWAY error codes, GOAWAY debug data). Inverse of http2_frame_build. Lenient: malformed payloads set decodeError but still return payloadHex.
- http2_probe: Probe an HTTP/2 endpoint.
- network_bot_detect_analyze: Analyze captured requests for bot-detection signals. Optionally supply a JA3/JA4 TLS fingerprint (from network_tls_fingerprint parse_client_hello) plus user-defined knownBad hash lists; matching hashes raise the bot score. Ships NO hardcoded feature library — the caller decides which hashes are bot-like.
- network_disable: Disable network request monitoring
- network_enable: Enable network request monitoring.
- network_export_har: Export captured network traffic as HAR.
- network_extract_auth: Extract authentication data from captured network requests.
- network_get_requests: Get captured network requests.
- network_get_response_body: Get the response body for a captured request.
- network_get_stats: Get network statistics.
- network_get_status: Get network monitoring status.
- network_http2_fingerprint: Compute an Akamai-style HTTP/2 fingerprint from one or more captured HTTP/2 frames (the client connection preface: SETTINGS + stream-0 WINDOW_UPDATE + any PRIORITY frames). Returns the canonical "<settings>|<window_update>|<priority>" string, a sha256 hash, and the structured fields (settings entries, window update increment, priorities). Ships NO hardcoded feature library — the structured fields are authoritative; the caller decides what is "bad". Pair with network_tls_fingerprint for full client identity.
- network_icmp_probe: Run an ICMP echo probe.
- network_intercept: Manage network interception rules.
- network_latency_stats: Measure repeated latency and compute percentile stats.
- network_monitor: Manage network request monitoring.
- network_replay_request: Replay a captured network request with optional changes.
- network_rtt_measure: Measure round-trip time to a target URL.
- network_tls_fingerprint: Compute TLS/HTTP fingerprints for bot detection. compute_tls/compute_http build fingerprints from user-supplied lists; parse_client_hello parses a raw ClientHello record (hex) and emits JA3 + JA4 from the real wire bytes; analyze_request links a captured requestId.
- network_traceroute: Run an ICMP traceroute.
- performance_get_metrics: Get page performance metrics.
- performance_trace: Start or stop a Chrome performance trace.
- profiler_cpu: Start or stop CPU profiling.

## platform (18)
- asar_deobfuscate: Scan every .js file inside an ASAR archive for obfuscation indicators (string-array arrays, webpack bundles, control-flow flattening, dynamic code, minification) and classify each file. Flagged files are optionally extracted to a directory for downstream deobfuscation.
- asar_extract: Extract and list files from an Electron ASAR package.
- asar_repack: Pack a directory tree into an Electron ASAR archive (inverse of asar_extract). Walks the input directory and writes a valid .asar (4xUInt32LE pickle prefix + JSON header + data segment) that parseAsarBuffer and Electron accept. Closes the unpack → patch → repack → retest loop without leaving jshookmcp.
- asar_search: Grep text patterns inside ASAR archive contents without extraction.
- electron_check_fuses: Read Electron fuse states.
- electron_debug_status: Check status of dual-CDP debug sessions launched by electron_launch_debug.
- electron_inspect_app: Analyze Electron app structure: main/renderer entry, preload, IPC.
- electron_ipc_sniff: Monitor Electron IPC messages.
- electron_launch_debug: Launch Electron with main and renderer CDP ports.
- electron_patch_fuses: Patch Electron fuse states.
- electron_scan_userdata: Scan a directory for Electron JSON userdata files.
- electron_verify_integrity: Verify Electron ASAR integrity: parse the ElectronAsarIntegrity JSON embedded in the main binary, locate each referenced ASAR, and compare the on-disk SHA256/SHA512 hash against the embedded hash. A mismatch means the ASAR was tampered with after build.
- electron_verify_signature: Inspect a packaged Electron binary's own code signature (PE Authenticode on Windows, Mach-O embedded code signature on macOS). Pure-TS structural parse: locates the WIN_CERTIFICATE / SuperBlob, decodes the PKCS#7 SignedData, and surfaces the cert chain, signer, digest algorithm, and (macOS) the CodeDirectory ident + best-effort cdhash. No codesign/signtool dependency (runs in any CI). Cryptographic signature validity and timestamp counter-signatures are out of scope (verified:false).
- miniapp_pkg_analyze: Analyze an unpacked miniapp package.
- miniapp_pkg_scan: Scan local directories for miniapp package files.
- miniapp_pkg_unpack: Unpack a miniapp package.
- platform_capabilities: Report platform tool backend availability.
- v8_bytecode_decompile: Decompile or extract strings from V8 bytecode files.

## process (29)
- check_debug_port: Check if a process is being debugged using NtQueryInformationProcess (ProcessDebugPort).
- electron_attach: Attach to an Electron CDP port and optionally evaluate in a matching page.
- enumerate_modules: List all loaded modules (DLLs) in a process with their base addresses.
- inject_dll: Inject a DLL into a target process. Requires elevated privileges. Target process and payload are validated before injection.
- inject_shellcode: Allocate and execute raw shellcode in a target process. Requires elevated privileges. Target process and payload are validated before injection.
- memory_audit_export: Export the in-memory audit trail for memory operations as JSON.
- memory_batch_write: Write multiple memory patches at once. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.
- memory_check_protection: Check memory protection flags at a specific address. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.
- memory_dump_region: Dump a process memory region to a binary file for offline analysis. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.
- memory_list_regions: List all memory regions in a process with protection flags. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.
- memory_read: Read memory from a process at a specific address. Requires elevated privileges. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.
- memory_scan: Scan process memory for a pattern or value. Requires elevated privileges. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.
- memory_scan_filtered: Refine a previous memory scan with filtered addresses. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.
- memory_write: Write data to process memory at a given address. If pid is omitted, the active browser renderer PID is auto-discovered from the current browser session.
- process_check_debug_port: Check if a process has a debug port enabled for CDP attachment.
- process_detect_apc: Detect APC (Asynchronous Procedure Call) injection in a process. Enumerates threads, probes each thread APC queue via NtQueryInformationThread(ThreadApcState), and detects threads in alertable wait state (SleepEx/WaitForMultipleObjectsEx). Returns verdict (clean/suspicious/infected), confidence score, and risk reasons. Requires elevated privileges (run as Administrator). Win32 only.
- process_detect_hollowing: Detect process hollowing (malware technique that unmaps original process image and injects malicious code). Compares process memory sections (.text, .data, .rdata) with on-disk PE file using SHA-256 hashes. Returns detection result with confidence score and list of differing sections. WARNING: autoRestore=true is HIGH RISK, may crash the target process, and is Win32-only. Cross-platform: Win32 compares PE sections; Linux/macOS compare ELF/Mach-O executable sections via IntegrityScanner (autoRestore unavailable).
- process_enum_handles: Enumerate open handles for a process using NtQuerySystemInformation. Resolves handle type and object name, decodes access masks, identifies security risks (high-privilege handles to sensitive processes, dangerous Token handles, inheritable sensitive handles, Section handles to executables). Skips name resolution for File/EtwRegistration types (known to hang). Requires elevated privileges (run as Administrator). Win32 only.
- process_enum_threads: Enumerate all threads in a process. Returns thread IDs, with optional per-thread context and diagnostics. Cross-platform: Win32 uses CreateToolhelp32Snapshot; Linux reads /proc/{pid}/task; macOS uses `ps -M`.
- process_find: Search for processes by name pattern. Returns a list of matching processes with PID, name, path, and window information.
- process_get: Get detailed information about a specific process by PID, including command line, parent PID, and debug port status.
- process_hollowing_scan: Pure-TS static hollowing indicator scan. Analyses /proc/pid/maps (RWX regions), /proc/pid/exe (deleted backing file), and PE headers (suspicious section names, RWX sections, entry point anomalies, mismatched binary path) without requiring native OS APIs. Complements process_detect_hollowing (which does live memory comparison). Provide at least one of: mapsContent, exeLink, peHex, or expectedImagePath. Honest boundary: Win32 live detection needs native API — use process_detect_hollowing for confirmed detection.
- process_kill: Terminate a process by PID. Requires appropriate privileges.
- process_launch_debug: Launch an executable with remote debugging port enabled.
- process_list: List all running processes. This is an alias for process_find with an empty pattern.
- process_resume: Resume a previously suspended process. Cross-platform: NtResumeProcess (Win32), SIGCONT (Linux), task_resume (macOS).
- process_runtime_info: Read /proc/{pid} runtime info on Linux: full command line, the complete environment block (paths, API keys, device IDs), and the status summary (VmRSS/VmPeak, thread count, capability set). Complements process_get, which returns only the command line. Fail-soft per source: an unreadable file (permission, process gone) leaves that field empty instead of failing the whole call.
- process_suspend: Suspend a process for forensic snapshotting. Cross-platform: NtSuspendProcess (Win32), SIGSTOP (Linux), task_suspend (macOS). Pair with process_resume to restore. Use before memory_scan/dump for a consistent snapshot. Requires admin/root on most platforms.
- process_windows: Get all window handles for a process.

## protocol-analysis (20)
- arp_build: Build a deterministic ARP payload for Ethernet/IPv4.
- checksum_apply: Apply a deterministic 16-bit Internet checksum across a payload slice, optionally zeroing and writing the checksum field back into the packet.
- ethernet_frame_build: Build a deterministic Ethernet II frame from source/destination MAC addresses, EtherType, and payload bytes.
- icmp_echo_build: Build a deterministic ICMPv4 echo request or reply payload with an automatically computed checksum.
- payload_mutate: Apply deterministic byte-level mutations to a hex payload.
- payload_template_build: Build a deterministic payload from field definitions.
- pcap_read: Read a classic PCAP file and return compact deterministic packet summaries. PCAPNG is intentionally not supported.
- pcap_write: Write a compact classic PCAP file from deterministic packet byte records.
- pcapng_read: Read a PCAPNG (pcap-ng) capture file and return structured Section/Interface/Packet blocks. Supports Section Header, Interface Description, Enhanced/Simple Packet, Name Resolution, and Interface Statistics blocks; unknown block types are surfaced as warnings. For multi-MB captures pass async:true to parse in a background task (MCP 2.0 Tasks) and poll with tasks_get/tasks_result instead of blocking this call.
- pcapng_write: Write a PCAPNG (pcap-ng) capture file from one or more interfaces and deterministic packet byte records. Emits a Section Header Block, an Interface Description Block per interface, and an Enhanced Packet Block per packet.
- proto_auto_detect: Auto-detect a protocol pattern from one or more hex payload samples.
- proto_define_pattern: Define a protocol pattern with delimiter, byte order, and field layout.
- proto_dissect_dns: Dissect a raw DNS payload (RFC 1035 + EDNS(0)) into header flags, questions, answers, authorities, and additionals with full compression-pointer handling and OPT pseudo-record decoding.
- proto_dissect_http: Dissect a raw HTTP/1.x request or response payload (RFC 7230) into the start line, headers, and body. Unwinds chunked transfer-encoding and reports Content-Length / Content-Type / Content-Encoding hints.
- proto_export_schema: Export a protocol pattern to a schema definition. format: proto (default, .proto-like text), ksy (Kaitai Struct for Wireshark/010 Editor), json-schema (draft-07).
- proto_fingerprint: Identify protocol type from hex payload samples.
- proto_infer_fields: Infer likely protocol fields from repeated hex payload samples.
- proto_infer_state_machine: Infer a protocol state machine from captured message sequences.
- proto_visualize_state: Generate a Mermaid state diagram from a protocol state machine definition.
- raw_ip_packet_build: Build a deterministic IPv4 or IPv6 packet.

## proxy (11)
- proxy_add_rule: Add an interception rule: forward, mock_response, redirect, or block.
- proxy_clear_logs: Clear all captured proxy request/response logs.
- proxy_clear_rules: Clear active proxy interception rules while keeping the proxy running.
- proxy_export_ca: Read the proxy CA certificate.
- proxy_get_requests: Read captured proxy request/response metadata, body previews, and timing.
- proxy_list_rules: List active proxy interception rules tracked by this handler.
- proxy_remove_rule: Remove a single proxy interception rule by endpointId. Returns the removed rule record.
- proxy_setup_adb_device: Configure an Android device to use the proxy.
- proxy_start: Start the local HTTP/HTTPS interception proxy with optional TLS.
- proxy_status: Report proxy status, listen port, and CA certificate path.
- proxy_stop: Stop the proxy and release all active rules.

## session (3)
- session_progress_clear: Clear session progress entries. With no `kind`, the entire session bucket is reset to an empty ledger; with `kind`, only that evidence category is cleared. Returns the number of removed entries. State is per-server in-memory only (tied to the MCP server process lifetime): it is NOT persisted and is lost when the server restarts.
- session_progress_coverage: Query the session progress ledger: per-kind entry counts plus the matching entries sorted newest-first (by first-recorded time). Use it to audit reverse-engineering coverage and surface uncovered areas. Pass `kind` to inspect a single evidence category. State is per-server in-memory only (tied to the MCP server process lifetime): it is NOT persisted and is lost when the server restarts.
- session_progress_record: Record a piece of reverse-engineering progress evidence for the current session (a hooked process, a hook point, or a decoded protocol field). Recording the same (kind, key) pair again is idempotent: it updates `metadata` in place without creating a duplicate entry. Use session_progress_coverage to audit what has been recorded and find coverage gaps. State is per-server in-memory only (tied to the MCP server process lifetime): it is NOT persisted and is lost when the server restarts. Each (sessionId, kind) bucket holds at most 500 entries; a record that would exceed the cap is rejected.

## sourcemap (7)
- sourcemap_coverage: Summarize mapped and unmapped source coverage.
- sourcemap_diff: Compare two source map revisions: which sources were added/removed, per-source mapping segment deltas, and generated-position shifts beyond a configurable threshold (default 1 line).
- sourcemap_discover: Discover source maps on the current page.
- sourcemap_fetch_and_parse: Fetch a source map from URL and parse to original sources.
- sourcemap_lookup: Resolve generated code position to original source (default), or — when originalSource is supplied — resolve original source:line:column back to the generated position. Supports indexed (sectioned) source maps transparently.
- sourcemap_parse_v4: Parse source map with ECMA-426 v4 scope/debug-id support; falls back to v3.
- sourcemap_reconstruct_tree: Reconstruct source files from a source map. When a vendor stripped sourcesContent, set inferMissing=true to emit a best-effort name+position skeleton (from mapping segments) instead of a placeholder. Set emitScopes=true to also decode the ECMA-426 v4 scopes field and write a `.scopes.json` sidecar (per-source variables, function kind, hidden ranges) next to each reconstructed file.

## streaming (17)
- fetch_stream_export_capture: Export events captured by the fetch()-based stream monitor to artifacts/captures as JSON or NDJSON.
- fetch_stream_get_events: Get events captured by the fetch()-based stream monitor (text/event-stream consumed via fetch). Set fullData=true to include full event data.
- fetch_stream_monitor: Enable or disable capture of fetch()-based streams. Wraps window.fetch and, for responses with content-type text/event-stream, clones the body and parses the SSE frame stream into events. Covers the LLM / GraphQL-subscription streaming that the EventSource-based sse_monitor_enable misses (fetch + POST + custom headers). Use fetch_stream_get_events to read captured events.
- grpc_export_capture: Export captured gRPC / gRPC-Web calls to artifacts/captures as JSON or NDJSON.
- grpc_get_calls: Get captured gRPC / gRPC-Web calls with parsed message summaries. Set fullMessages=true to include the parsed message arrays (each carries payloadBase64 — feed to protobuf_decode_raw). Without fullMessages only per-call counts and flags are returned.
- grpc_monitor: Enable or disable live capture of gRPC / gRPC-Web calls. gRPC calls are detected by content-type application/grpc(-web)?(+proto)? on the HTTP/2 response. On loadingFinished the response body is pulled (base64) and split into length-prefixed messages; feed each message payloadBase64 to protobuf_decode_raw to complete the decode chain. Must be enabled before navigating so requests are captured from the start.
- sse_export_capture: Export captured SSE events to artifacts/captures as JSON or NDJSON.
- sse_get_events: Get captured SSE events with filters and pagination.
- sse_monitor_enable: Enable SSE monitoring by injecting EventSource interceptor.
- webrtc_export_capture: Export messages captured by the WebRTC data-channel monitor to artifacts/captures as JSON or NDJSON.
- webrtc_get_events: Get messages captured by the WebRTC data-channel monitor. Set fullData=true to include full message data. Filter by channel label and direction (sent/received).
- webrtc_monitor: Enable or disable capture of WebRTC data-channel traffic. Wraps RTCPeerConnection in-page (no CDP coverage for RTCDataChannel): intercepts createDataChannel (local channels) and the datachannel event (remote channels), capturing both outbound send() and inbound message events. Use webrtc_get_events to read captured messages.
- ws_export_capture: Export captured WebSocket frames to artifacts/captures as JSON or NDJSON.
- ws_get_connections: Get tracked WebSocket connections, frame counts, and timing metadata.
- ws_get_frames: Get captured WebSocket frames with pagination and payload filter.
- ws_monitor: Enable or disable WebSocket frame capture.
- ws_send_frame: Send a frame through a live in-page WebSocket instance retained by ws_monitor(exposeInstances=true). Enables edit-and-resend replay of WebSocket traffic. Only reaches WebSockets created AFTER exposeInstances was enabled (existing sockets are not retroactively reachable).

## syscall-hook (15)
- syscall_capture_events: Capture syscall events from the active or last monitoring session.
- syscall_correlate_js: Correlate captured syscalls with likely JavaScript functions.
- syscall_direct_invoke: Direct NT syscall invocation guidance. Resolves SSN for a given NT function and returns a stub template with usage instructions for in-process direct syscall invocation. Bypasses user-mode hooks on ntdll.dll. Win32 only.
- syscall_ebpf_attach: Live eBPF syscall attach — spawns a bpftrace process, captures syscall events as structured JSON in real time, and returns them directly. Unlike syscall_ebpf_trace (script-generator), this tool actually runs bpftrace and captures output. Falls back to script mode on non-Linux or when bpftrace is unavailable. Requires bpftrace + CAP_BPF or root on Linux.
- syscall_ebpf_trace: Trace syscalls on Linux with eBPF. Requires root or CAP_BPF.
- syscall_filter: Filter captured syscall events by name, PID, or return value.
- syscall_get_stats: Get syscall monitoring statistics.
- syscall_origin_map: Build a unified syscall→JS origin map by integrating live CDP call stacks (syscall_stack_capture) with static timing heuristics (syscall_correlate_js). Aggregates recent syscall events by JavaScript function so callers can see which JS function triggered which syscalls and how often. Debugger stacks are preferred when available; heuristics fill the gaps.
- syscall_pattern_detect: Scan captured syscall events for behavioral patterns relevant to reverse engineering: anti-debug probes (ptrace / IsDebuggerPresent), system fingerprinting (uname / getuid), filesystem enumeration (openat + getdents), network beaconing (connect / sendto), process spawning (clone / execve), and Windows registry probing. Returns classified patterns with evidence.
- syscall_resolve_ssn: Resolve NT syscall service numbers (SSN) from on-disk ntdll.dll. Parses the export table to extract Zw* → SSN mappings and locates a syscall;ret gadget for direct invocation stubs. Win32 only.
- syscall_stack_capture: Correlate captured syscall events with real JS call stacks via debugger integration. Goes beyond static heuristics by querying live CDP call stacks for syscall→JS mapping. Falls back to heuristic-only mode when no debugger is attached.
- syscall_start_monitor: Start syscall monitoring.
- syscall_stop_monitor: Stop syscall interception and release all captured events.
- syscall_trace_compare: Diff two syscall trace snapshots to find appeared/disappeared syscalls and frequency changes. Useful for understanding what OS calls a JS operation triggers. Capture baseline events → perform the operation → capture target events → pass both arrays here. Use syscall_capture_events (or syscall_trace_export) to obtain each snapshot.
- syscall_trace_export: Export captured syscall events to portable NDJSON with optional time-range filtering and deduplication. Returns both structured array and NDJSON string.

## tasks (4)
- tasks_cancel: Request cancellation of a background task (MCP 2.0 Tasks protocol). Only tasks in the working state can be cancelled; the tool-defined cancel handler runs if present.
- tasks_get: Get the current state of a background task (MCP 2.0 Tasks protocol). Returns status (working/completed/failed/cancelled), progress and message.
- tasks_list: List recent background tasks tracked by the server (MCP 2.0 Tasks protocol). Expired tasks are pruned automatically based on their TTL.
- tasks_result: Fetch the payload/result of a background task (MCP 2.0 Tasks protocol). Optionally waits (polls) up to waitMs for the task to reach a terminal state.

## tls-inspector (29)
- net_raw_tcp_listen: Listen on a local TCP port for one incoming connection.
- net_raw_tcp_send: Send raw TCP data to a remote host; accepts hex or text input.
- net_raw_udp_listen: Listen on a local UDP port for an incoming datagram.
- net_raw_udp_send: Send a raw UDP datagram and wait for a response.
- tcp_close: Close an open TCP session.
- tcp_open: Open a TCP session.
- tcp_read_until: Read from an open TCP session until a delimiter or byte limit is reached.
- tcp_write: Write data to an open TCP session.
- tls_cert_pin_bypass: Return a certificate pinning bypass strategy for the selected platform.
- tls_cert_pin_bypass_frida: Bypass certificate pinning via Frida injection (supports the target TLS library and HTTP client frameworks).
- tls_cipher_suites: List TLS cipher suites with IANA id, protocol, key-exchange / authentication / encryption / MAC split, and AEAD flag (each dimension derived from the suite name).
- tls_close: Close an open TLS session.
- tls_decrypt_payload: Decrypt a TLS payload using a provided key, nonce, and algorithm.
- tls_keylog_disable: Disable SSLKEYLOGFILE capture and unset the environment variable.
- tls_keylog_enable: Enable SSLKEYLOGFILE output for TLS library clients.
- tls_keylog_lookup_secret: Look up a TLS secret by client random hex from the parsed keylog.
- tls_keylog_parse: Parse an SSLKEYLOGFILE and summarize available key material.
- tls_keylog_seal: Encrypt the current keylog file in place with a fresh ephemeral key and securely wipe the plaintext source. Mitigates disk-forensics exposure (pagefile/hibernation/TEMP scraping) of captured TLS secrets. The returned keyHex is not persisted anywhere — hold onto it to decrypt the sealed envelope later, or it is unrecoverable once the process exits.
- tls_keylog_summarize: Summarize an SSLKEYLOGFILE: per-label distribution, secret-type classification (TLS 1.2 master-secret vs TLS 1.3 traffic-secret kinds), TLS version inference, and unique session (client_random) count.
- tls_open: Open a TLS session.
- tls_parse_certificate: Parse a TLS Certificate message from raw hex and extract X.509 details (subject/issuer/SAN/validity/keyUsage), SHA-256 fingerprint, and SPKI pin hash (Android Network Security Config / HPKP format).
- tls_parse_handshake: Parse TLS handshake metadata from raw hex. For payload decryption, use tls_decrypt_payload with explicit keyHex/nonceHex/authTagHex.
- tls_probe_endpoint: Probe a TLS endpoint and report handshake and certificate details.
- tls_read_until: Read from an open TLS session until a delimiter or byte limit is reached.
- tls_write: Write data to an open TLS session.
- websocket_close: Close an open WebSocket session.
- websocket_open: Open a WebSocket session.
- websocket_read_frame: Read the next queued WebSocket frame from an open session.
- websocket_send_frame: Send a WebSocket frame.

## trace (10)
- diff_heap_snapshots: Compare two heap snapshots from a trace.
- export_trace: Export a trace database. format="chrome-trace" (default) emits Chrome Trace Event JSON with per-category thread tracks, thread_name metadata, and CPU-profile flame-graph X events. format="har" emits HTTP Archive 1.4 joining network_resources + response bodies — interchange format for Burp/ZAP/Postman.
- query_trace_sql: Execute a read-only SQL query against a trace database.
- seek_to_timestamp: Reconstruct trace state at a specific timestamp.
- start_trace_recording: Start recording debugger traces into a SQLite database for time-travel.
- stop_trace_recording: Stop trace recording and return the final session summary.
- summarize_trace: Generate a compact summary of a trace database.
- trace_get_network_flow: Get a recorded request-scoped network flow from a trace.
- trace_get_samples: Query recorded CPU profile samples. mode="top" returns the hottest functions by self time (per-function rollup); mode="function" returns samples for one function; mode="window" returns samples near a timestamp. Ships NO hardcoded hot-function library — ordering is pure data projection, the caller decides what counts as hot.
- trace_recording: Start or stop trace recording into a SQLite database.

## transform (8)
- ast_transform_apply: Apply transforms to input code or a live page scriptId.
- ast_transform_beautify: Pretty-print minified or obfuscated JavaScript: re-emit the parsed source with standard 2-space indentation and normalised spacing. Formatting only — the AST is preserved, so program semantics do not change. Unparseable input is returned unchanged.
- ast_transform_chain: Create and store an in-memory transform chain.
- ast_transform_preview: Preview lightweight AST-like transforms (string/regex based) and return before/after diff.
- crypto_compare: Compare two crypto implementations against identical test vectors.
- crypto_extract_standalone: Extract crypto/sign/encrypt function from current page and generate standalone runnable code.
- crypto_test_harness: Run extracted crypto code in worker_threads + vm sandbox and return deterministic test results.
- transform_workbench: Run a reproducible binary transform workbench over base64 inputs: base64, hex, XOR, RC4, AES-CBC/ECB decrypt, zlib/gzip inflate, entropy, previews, and magic hints.

## v8-inspector (21)
- v8_allocation_track: Track live V8 allocations via CDP HeapProfiler object tracking. Enables the HeapProfiler, calls startTrackingHeapObjects({ trackAllocations: true }) to collect lastSeenObjectId events for a capture window (default 3s), then stopTrackingHeapObjects (with an explicit takeHeapSnapshot fallback) to return currently-live objects seen during the window with their allocation stack (top frame + size). Useful for finding objects that survive GC during a specific interaction. Requires browser/page CDP context and V8 natives for full stack resolution.
- v8_bytecode_extract: Extract V8 bytecode for a script by scriptId, with source fallback.
- v8_deopt_trace: Trace V8 deoptimization events during a capture window. Primary path uses CDP Tracing (v8 category, V8.DeoptimizeFrame events — no natives syntax needed, structured reason/type/line data, timestamps aligned with profiler_cpu). Falls back to %TraceDeoptimizations console parsing when Tracing is unavailable (requires V8 natives syntax).
- v8_function_retained: Find all heap objects retained by functions matching a name pattern. Walks the dominator tree to find objects whose constructor/class name matches the given pattern, then returns each with its retainer chain. Useful for understanding which objects a specific function/class is holding alive.
- v8_heap_diff: Compare two heap snapshots to find allocation changes.
- v8_heap_find_leaks: Find suspected memory leaks in a heap snapshot. Returns leak candidates sorted by confidence, including detached DOM nodes, large arrays, closure leaks, and unexpectedly large retained objects.
- v8_heap_retainers: Trace retainer chains from suspect leak objects back to GC roots. For each nodeId, walks the immediate-dominator chain to produce a "what keeps it alive" path: leaf → ... → GC root. Each step includes nodeId, name, className, shallowSize, retainedSize, and distance from the leaf. Use after v8_heap_find_leaks or v8_heap_snapshot_analyze to understand why a specific object is not being collected.
- v8_heap_sampling: Collect a V8 allocation sampling profile via CDP HeapProfiler. Starts sampling for a capture window (default 5s), then returns the aggregated allocation call tree: per-function self/total bytes + sample count, sorted by total bytes allocated. Useful for finding hot allocation sites without a full heap snapshot. Requires browser/page CDP context.
- v8_heap_snapshot_analyze: Analyze a heap snapshot: class histogram (object count/sizes by constructor), statistics (total objects, detached DOM nodes), optional dominator tree, and leak detection.
- v8_heap_snapshot_capture: Capture a V8 heap snapshot for offline analysis. The snapshot is persisted to artifacts/heap-snapshots/ (data + sidecar meta) so it survives a server restart; set persist=false to keep it in-memory only.
- v8_heap_snapshot_delete: Delete persisted V8 heap snapshot artifact files (.heapsnapshot data + .meta.json sidecar) and drop the matching in-memory cache entry. Use deleteAll=true to remove every persisted snapshot. Does not affect the live V8 heap.
- v8_heap_snapshot_export: Export a heap snapshot as a complete .heapsnapshot JSON file under artifacts/heap-snapshots/, loadable by the Chrome DevTools Memory panel. The file path is returned; the snapshot content is written to disk, not injected into the response (it can be very large).
- v8_heap_snapshot_list: List V8 heap snapshots — both in-memory (current session) and persisted to artifacts/heap-snapshots/ (survive a server restart). Reports id, capture time, size, source (in-memory/persisted), simulated flag, and expiry status, plus aggregate stats. Snapshot payloads are NOT returned (only metadata).
- v8_heap_stats: Report V8 heap statistics: used, total, external.
- v8_object_compare: Compare heap objects by shallow/retained size, class name, and property count. Same-snapshot mode (objectIds only) does all-pairs comparison (n-choose-2). Cross-snapshot mode (anotherSnapshotId + anotherObjectIds) does pairwise A[i]↔B[i] comparison. Use to track object growth over time, find memory regression candidates, or compare leaked vs healthy objects of the same class.
- v8_object_inspect: Inspect a live JS object by objectId with property enumeration.
- v8_turbofan_graph: Collect and visualize V8 TurboFan IR (sea-of-nodes / Turboshaft graph). Two modes: (1) Provide JS source code — spawns an isolated V8 child with --trace-turbo to generate IR JSON, then parses nodes, edges, phases, and opcode histogram. (2) Provide a traceDir path to read already-generated turbo-*.json files (e.g. from a browser launched with --trace-turbo). Returns per-function graph summaries with phase-level node/edge counts, sample nodes, and opcode distribution.
- v8_turbofan_inspect: Inspect JIT/TurboFan compilation state for functions in a script. Reports optimization tier (interpreted/maglev/turbofan) with V8 optimization status codes. Supports actions: inspect (default), optimize (%OptimizeFunctionOnNextCall), deoptimize (%DeoptimizeFunction). Requires V8 natives syntax; falls back to heuristic JIT inspection when natives is unavailable.
- v8_version_detect: Detect V8 engine version, flags, and runtime capabilities.
- v8_wasm_inspect: Inspect WebAssembly modules and garbage-collected WASM objects in the page. Discovers .wasm script resources via performance.getEntriesByType, detects WASM GC (struct/array/ref-types) availability, and enumerates feature flags (gc/threads/simd). Supports optional scriptId filter to inspect a specific WASM module. Requires browser/page CDP context. Note: structural type enumeration (includeStructs) requires Chrome ≥ M119 with --enable-features=WebAssemblyGC; absent that, returns gcAvailable flag and script-level summary only.
- v8_weakrefs_inspect: Enumerate WeakRef and FinalizationRegistry instances in the page via Runtime.evaluate. Inspects registered finalization callbacks and live WeakRef targets, reporting how many WeakRefs are dereferenced vs cleared and which FinalizationRegistry callbacks have pending entries. Useful for diagnosing cleanup logic in long-lived pages. Requires browser/page CDP context.

## wasm (17)
- wasm_capabilities: Report WASM tool availability.
- wasm_decompile: Decompile .wasm bytecode to readable pseudo-code with type info.
- wasm_detect_obfuscation: Detect WASM obfuscation: opaque predicates, control-flow flattening, bogus ops.
- wasm_diff: Patch-diff two .wasm binaries (original vs. patched) for vulnerability research: disassembles both via wasm2wat and emits a structured function-level diff (added/removed/changed) plus a per-function WAT line-level unified diff. The full diff is written to an artifact; the response carries summaries and previews.
- wasm_disassemble: Disassemble a .wasm binary to WAT text format.
- wasm_dump: Dump a captured WebAssembly module from the current page.
- wasm_inspect: Pure-TS wasm binary structural inspector (no wabt dependency). Parses the module surface — types, imports, functions (with name-section recovery), tables, memories, globals, exports, start, element/data/code segment counts, and custom sections (name/producers/target_features) — directly from the binary, returning structured JSON. The wabt-independent counterpart to wasm_inspect_sections (wasm-objdump): the only structural path when wabt is unavailable (see wasm_capabilities). Honest boundary: structure only, no code-body disassembly; element/data/global-init payloads reported as counts.
- wasm_inspect_sections: Parse .wasm section headers: imports, exports, memory, tables, code.
- wasm_instrument_binary: Real wasm-level binary instrumentation: disassembles via wasm2wat, inserts a call to an imported trace function at every function entry, and reassembles via wat2wasm. Unlike wasm_instrument_trace (which only proxies JS-visible exports), this rewrites the code section so every function entry is observable. Honest boundary: function-ENTRY-level tracing, not basic-block — the host must supply the trace_fn import at instantiation.
- wasm_instrument_block: Real wasm-level basic-block instrumentation: disassembles via wasm2wat, inserts a call to an imported trace function at every block/loop/if body entry (and function entry), and reassembles via wat2wasm. Unlike wasm_instrument_binary (function-entry-only) and wasm_instrument_trace (JS-proxy-only), this observes structured control-flow entries — branch targets (br/br_if/br_table) are covered because Wasm resolves them to block/loop/if labels. The host must supply the trace_block import at instantiation.
- wasm_instrument_trace: Generate a JS instrumentation wrapper for a .wasm module.
- wasm_memory_inspect: Inspect exported WebAssembly.Memory from the current page. Pages often load multiple WASM modules (crypto/DRM/app) — the response always includes totalInstances + an instance inventory; pass instanceIndex to target a specific module.
- wasm_offline_run: Run an exported .wasm function.
- wasm_optimize: Optimize a .wasm binary for size or speed.
- wasm_string_extract: Extract printable strings from a .wasm binary, grouped by section, with name-section function-name recovery and classification (url/base64/hex-hash/file-path). Wasm-aware alternative to generic binary strings tools.
- wasm_to_c: Transpile .wasm bytecode to C source and header files.
- wasm_vmp_trace: Read captured WASM VMP import-call traces from the current page.

## webgpu (10)
- webgpu_adapter_info: Get WebGPU adapter information (vendor, architecture, device). Used for fingerprinting GPU capabilities and detecting hardware-level vulnerabilities.
- webgpu_capture_commands: Capture GPU command queue submissions (render passes, compute dispatches). Used for analyzing GPU workload and detecting malicious shader behavior.
- webgpu_error_capture: Capture WebGPU validation/out-of-memory/internal errors the target app swallows (via device uncapturederror), plus the current device.lost state. Optionally wraps createBuffer/createTexture in error scopes to attribute failures to specific calls. Surfaces the real diagnostics behind "empty buffer" / "zero draw call" symptoms.
- webgpu_frame_timing: Measure per-frame CPU and GPU cost over a rAF loop using GPU timestamp queries (device.limits.timestampPeriod conversion). Answers "how long did the GPU take" and "CPU-bound vs GPU-bound". Degrades to CPU round-trip timing with precision=cpu-roundtrip when the timestamp-query feature is unavailable.
- webgpu_memory_layout: Analyze GPU memory allocations and buffer usage. Identifies memory layout patterns that may be vulnerable to side-channel attacks. With track=true, snapshots are stored on the shared state board (webgpu_memory_<canvasId>) and the response includes the delta vs the previous snapshot plus the growth rate in KB/s.
- webgpu_pipeline_dump: Enumerate active render/compute pipelines, bind-group layouts, and render-pass descriptors by hooking GPUDevice createRenderPipeline / createComputePipeline / createBindGroupLayout (plus async variants). Captures the full descriptor (vertex/fragment entry points, buffer stride/attributes, bind-group layout entries, visibility) so a captured bindGroups index can be resolved to actual resources.
- webgpu_shader_compile: Compile WGSL shader and extract metadata (entry points, bindings, attributes). Validates shader code and detects potential security issues.
- webgpu_shader_disassemble: Parse WGSL or SPIR-V shader into AST and generate human-readable disassembly. Used for reverse engineering shader logic. SPIR-V input (hex/base64) is reflected into entry points, bindings, structs, and locations without compilation.
- webgpu_shader_source_capture: Capture WGSL shader sources a running app compiles via GPUDevice.createShaderModule — the only artifact revealing what a compute/render pipeline computes (e.g. physics vs. cryptominer). Pairs with webgpu_capture_commands to reconstruct what data each draw/dispatch operated on.
- webgpu_timing_analysis: GPU timing analysis for side-channel detection. Measures GPU command execution time variance to detect cache-based side-channel attacks (Graz University 2025 research).

## workflow (13)
- api_probe_batch: Batch-probe API endpoints in browser context with auto token injection and HTML skip.
- js_bundle_search: Fetch a remote JS bundle and search it with named regex patterns, with caching and noise filtering.
- list_extension_workflows: List runtime-loaded extension workflows from plugins/ or workflows/ directories.
- list_macros: List all available macros.
- page_script_register: Register a named reusable JS snippet in the Script Library. Execute with page_script_run.
- page_script_run: Execute a named script from the Script Library with optional runtime params (__params__).
- reverse_session: Create, inspect, list, preview, or run an end-to-end reverse-engineering workflow session with artifact root, cross-domain tool calls, and evidence refs.
- run_extension_workflow: Execute an extension workflow by workflowId with optional config and timeout overrides.
- run_macro: Execute a registered macro with sequence, parallel, branch, fallback, and retry orchestration.
- workflow_conditional_step: Evaluate a condition against the stepResults argument and execute one of two tool branches. Supports built-in predicates: always_true, always_false, any_step_failed, success_rate_gte_N (N=0-100), variable_equals_KEY_VALUE, variable_contains_KEY_VALUE, variable_matches_KEY_REGEX, plus history-driven predicates history_failure_rate_gte_N / history_failure_rate_lte_N, last_run_failed[:workflowId], recent_steps_failing_L[:workflowId], history_fallback_rate_gte_N / history_fallback_rate_lte_N. History predicates read the workflow run store (the last 10 runs of the workflow named by the :workflowId suffix, or the current workflow when none is given); they evaluate false when no history exists. When stepResults is omitted, an empty set is used, so value-based predicates (variable_*, success_rate_gte_N, any_step_failed) will not match.
- workflow_retry_policy: Configure a global retry policy with exponential backoff for workflow steps. The stored policy is applied by run_extension_workflow / run_macro when individual nodes lack an explicit retry config. Returns the normalised policy.
- workflow_run_inspect: Inspect the global workflow run store: list recent run_extension_workflow / run_macro runs, get a run entry by runId, or fetch the last successful run summary (runId, status, durationMs, stepResultKeys) for a workflow or macro id.
- workflow_suggest: Suggest the next extension workflow to run from the chainsWith / prerequisites chain metadata declared by loaded workflows. Pass the workflow ids already executed in this session; the server stays stateless. Candidates chained from an executed workflow rank first (the reason names the chain), workflows with all prerequisites satisfied rank before those with missing ones, already-executed workflows are never suggested, and executed ids that match no loaded workflow are returned in unmatched. Workflows without chain metadata are never suggested, so an empty catalog of metadata yields empty suggestions.

TOTAL: 736 tools in 36 domains
