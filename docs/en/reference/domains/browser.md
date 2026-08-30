# Browser

Domain: `browser`

Primary browser control and DOM interaction domain; the usual entry point for most workflows.

## Profiles

- workflow
- full

## Typical scenarios

- Navigate pages
- Interact with the DOM and capture screenshots
- Work with tabs and storage

## Common combinations

- browser + network
- browser + instrumentation
- browser + workflow

## Full tool list (85)

| Tool | Description |
| --- | --- |
| `get_detailed_data` | Retrieve large data by detailId. |
| `get_offloaded_data` | Retrieve the original bytes of a field that was offloaded to disk (see the `_offload.path` in a placeholder). Returns base64 by default for binary blobs (e.g. decoded data: URIs); use encoding="utf8" for text. |
| `browser_attach` | Connect to a running browser. |
| `browser_list_tabs` | List open browser tabs with URLs and titles. |
| `browser_list_cdp_targets` | List CDP targets with optional type/URL/title filters. |
| `browser_select_tab` | Switch active tab by index, URL pattern, or title pattern. |
| `browser_attach_cdp_target` | Attach to a CDP target by targetId. |
| `browser_detach_cdp_target` | Detach the current CDP target session. |
| `browser_evaluate_cdp_target` | Evaluate JS in the attached CDP target. |
| `browser_list_workers` | Enumerate Service Worker / Shared Worker / dedicated Web Worker targets via Target.getTargets. Use browser_worker_scripts(targetId=...) afterwards to dump a worker's loaded scripts — essential for inspecting PWA / SW-backed auth code. |
| `browser_worker_scripts` | Attach a CDP session to a worker target and dump its parsed scripts (equivalent to get_all_scripts, but scoped to a worker). Debugger.scriptParsed is replayed on Debugger.enable, so already-loaded worker scripts are returned. |
| `browser_font_fingerprint` | Enumerate locally-installed fonts for fingerprint analysis. Primary path is the Local Font Access API (queryLocalFonts, Chromium 103+); when unavailable or denied, falls back to a small document.fonts.check probe set. Returns the detected font set, a stable hash for comparison, and optionally spoofs the font fingerprint. |
| `browser_launch` | Launch Chromium/Camoufox or connect to a running browser. |
| `browser_close` | Close the browser and release all resources. |
| `browser_status` | Report browser status: running, tab count, version. |
| `page_navigate` | Navigate the page to a URL with wait and network options. |
| `page_reload` | Reload the current page. |
| `page_back` | Navigate back in browser history. |
| `page_forward` | Navigate forward in browser history. |
| `page_list_frames` | List page frames for frame targeting. |
| `page_click` | Click a page element by CSS selector. |
| `page_type` | Type text into an element. |
| `page_upload_files` | Upload one or more local files into an &lt;input type="file"&gt; element. |
| `page_select` | Select option(s) in a &lt;select&gt; element. |
| `page_hover` | Hover over an element by CSS selector. |
| `page_scroll` | Scroll to absolute or relative coordinates. |
| `page_wait_for_selector` | Wait for an element to appear. |
| `page_evaluate` | Execute JavaScript in page context. |
| `page_screenshot` | Capture a page or element screenshot. |
| `get_all_scripts` | List all scripts loaded by the page with optional source. |
| `get_script_source` | Retrieve source code of a script by ID or URL pattern. |
| `console_monitor` | Toggle console log capture (log, warn, error, info, debug). |
| `console_get_logs` | Retrieve captured console logs with type and time filters. |
| `console_execute` | Evaluate a JS expression in the browser console context. |
| `page_inject_script` | Inject JavaScript to run on every page load. |
| `page_coverage_start` | Start JS+CSS code coverage collection on the active page. Coverage tracks which bytes of each loaded script/stylesheet are actually executed. Use page_coverage_stop to stop collection and retrieve results. |
| `page_coverage_stop` | Stop coverage collection and return per-script JS+CSS coverage results. Includes total bytes, used bytes, and coverage percentage per URL. |
| `page_block_script` | Manage script blocking rules by URL pattern. Blocked scripts are prevented from loading/executing. Actions: add/block (add a rule), remove/unblock (remove a rule), list (show all rules), clear (remove all). |
| `page_cookies` | Manage page cookies; clear requires matching expectedCount. |
| `page_set_viewport` | Set the browser viewport dimensions. |
| `page_emulate_device` | Emulate a mobile device profile. |
| `page_local_storage` | Read, write, delete, or clear localStorage entries for the current origin. |
| `page_session_storage` | Read, write, delete, or clear sessionStorage entries for the current origin. |
| `page_storage_info` | Query navigator.storage.estimate() for {usage, quota} and navigator.storage.persisted() to inspect the origin storage budget and persistence status (offline/PWA reverse engineering). |
| `browser_passkey_seed` | Seed a WebAuthn/Passkey credential into the browser for test automation. |
| `page_press_key` | Simulate a key press by name. |
| `page_handle_dialog` | Control how JavaScript dialogs (alert/confirm/prompt/beforeunload) are answered. By default installs a persistent handler that auto-dismisses all dialogs. Set dismissAll=false for one-shot handling of the next dialog. |
| `service_worker_deliver_push` | Deliver a synthetic push message to a service worker via CDP ServiceWorker.deliverPushMessage. Requires an attached CDP session on a SW target. |
| `service_worker_dispatch_sync` | Dispatch a Background Sync event to a service worker via CDP ServiceWorker.dispatchSyncEvent. Requires an attached CDP session on a SW target. |
| `captcha_detect` | Detect CAPTCHAs on the current page. |
| `captcha_wait` | Block until the user manually solves the CAPTCHA. |
| `captcha_config` | Configure CAPTCHA detection sensitivity and solver backend. |
| `stealth_inject` | Inject anti-detection scripts to reduce bot fingerprint exposure. |
| `stealth_set_user_agent` | Set User-Agent and fingerprint. |
| `stealth_configure_jitter` | Configure CDP timing jitter. |
| `stealth_generate_fingerprint` | Generate a browser fingerprint. |
| `stealth_verify` | Run anti-detection checks. |
| `camoufox_geolocation` | Get geolocation for a locale. |
| `camoufox_server` | Start, close, or check status of a Camoufox anti-detect server. |
| `framework_state_extract` | Extract React/Vue/Svelte/Solid component state and meta-framework info. |
| `indexeddb_dump` | Export IndexedDB databases and records. Supports keyRange queries (IDBKeyRange.bound/lower/upper), indexName (query a specific index), count (count-only mode), and cursor pagination (stream large stores in batches). |
| `js_heap_search` | Search JS heap for strings matching a pattern. |
| `tab_workflow` | Cross-tab coordination. |
| `browser_codegen_start` | Start recording browser actions as replayable steps. |
| `browser_codegen_stop` | Stop recording browser actions and return cleaned replay steps. |
| `browser_performance_observer` | Atomic primitive: subscribe to PerformanceObserver entry types in the active page and return both buffered and live entries observed during a collection window. Entry types are passed through to PerformanceObserver.observe({ type }) verbatim (e.g. largest-contentful-paint, layout-shift, longtask, event, long-animation-frame); unsupported entry types are skipped silently. One observer per type — the API does not accept multiple types in a single observe() call. |
| `browser_resource_timing` | Atomic primitive: read Resource Timing API entries for the active page and decompose each resource into dns / connect / tls / ttfb / download phases plus transfer and body sizes. Optionally include Server-Timing headers and filter by URL substring. A read-only snapshot — no observers or listeners are installed. |
| `browser_cdp_performance_metrics` | Atomic primitive: fetch browser runtime metrics via CDP Performance.getMetrics() on the active page. Returns raw CDP-level counters (LayoutCount, RecalcStyleCount, ScriptDuration, TaskDuration, JSHeapUsedSize, Nodes, Documents, Frames, ...) — not Web Vitals (use browser_get_metrics for those). |
| `v8_type_profile` | Atomic primitive: start or stop V8 type profiling via CDP Profiler.startTypeProfile() / takeTypeProfile() / stopTypeProfile(). Type profiles record the runtime types flowing through each function entry (type:Array, type:Object, type:number, ...) — the raw material for deobfuscating VM dispatchers or polymorphic call sites. action="stop" returns per-script entries and optionally persists the raw profile to a JSON artifact (artifacts/profiles/). |
| `browser_get_metrics` | Atomic primitive: collect page performance metrics via PerformanceMonitor — Web Vitals (FCP, LCP, CLS, TTFB), DOM timing (domContentLoaded, loadComplete), engine-level counters (scriptDuration, layoutDuration, recalcStyleDuration) and JS heap sizes (usedJSHeapSize / totalJSHeapSize / jsHeapSizeLimit). Optionally include the raw performance timeline entries. Replaces the legacy network-domain performance_get_metrics (still working as a backward-compat alias). |
| `browser_trace_start` | Atomic primitive: begin a Chrome performance trace on the active page via page.tracing.start(). Pair with browser_trace_stop to save the trace to disk. Use a sensible categories list when you have a specific hypothesis (e.g. ["devtools.timeline","v8.execute","blink.user_timing"]); the default set covers most profiling needs. |
| `browser_trace_stop` | Atomic primitive: stop the Chrome performance trace started by browser_trace_start and persist it to artifacts/traces/ (or to a custom path). Returns event count, file size, and a Chrome DevTools hint. Fails clearly if tracing was never started or has already been stopped. |
| `browser_cpu_profile_start` | Atomic primitive: begin CDP CPU profiling on the active page (Profiler.start). Pair with browser_cpu_profile_stop to save the .cpuprofile. Set samplingInterval to 30-100 µs for high-resolution profiles (default 1000 µs / 1 ms). |
| `browser_cpu_profile_stop` | Atomic primitive: stop CDP CPU profiling, rank hot functions by sample count, and persist the raw profile to artifacts/profiles/ (or a custom path). The hot function list is derived from the samples array — modern Chrome profiles do not populate hitCount. Fails clearly if profiling was never started. |
| `human_mouse` | Move mouse along a Bezier curve with jitter. |
| `human_scroll` | Scroll with randomized speed and pauses to mimic human behavior. |
| `human_typing` | Type text with human-like speed and occasional typos. |
| `captcha_solver_capabilities` | Report CAPTCHA solving mode availability. |
| `captcha_vision_solve` | Solve a CAPTCHA with manual flow or a configured external service. |
| `widget_challenge_solve` | Solve a widget challenge with hook, manual, or configured external service. |
| `browser_jsdom_parse` | Parse HTML into an in-memory JSDOM session. No browser needed. |
| `browser_jsdom_query` | Query a JSDOM session with a CSS selector. |
| `browser_jsdom_execute` | Evaluate JS inside a JSDOM session. Requires explicit authorization — arbitrary code execution. |
| `browser_jsdom_serialize` | Serialize a JSDOM session to HTML. |
| `browser_jsdom_cookies` | Manage cookies on a JSDOM session. Isolated from the attached browser. |
