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
- browser + hooks
- browser + workflow

## Full tool list (60)

| Tool | Description |
| --- | --- |
| `get_detailed_data` | Retrieve large data by detailId. |
| `browser_attach` | Connect to a running browser. |
| `browser_list_tabs` | List open browser tabs with URLs and titles. |
| `browser_list_cdp_targets` | List CDP targets with optional type/URL/title filters. |
| `browser_select_tab` | Switch active tab by index, URL pattern, or title pattern. |
| `browser_attach_cdp_target` | Attach to a CDP target by targetId. |
| `browser_detach_cdp_target` | Detach the current CDP target session. |
| `browser_evaluate_cdp_target` | Evaluate JS in the attached CDP target. |
| `browser_launch` | Launch Chromium/Camoufox or connect to a running browser. |
| `browser_close` | Close the browser and release all resources. |
| `browser_status` | Report browser status: running, tab count, version. |
| `page_navigate` | Navigate the page to a URL with wait and network options. |
| `page_reload` | Reload the page with optional cache bypass. |
| `page_back` | Navigate back in browser history. |
| `page_forward` | Navigate forward in browser history. |
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
| `page_cookies` | Manage page cookies; clear requires matching expectedCount. |
| `page_set_viewport` | Set the browser viewport dimensions. |
| `page_emulate_device` | Emulate a mobile device profile. |
| `page_local_storage` | Read or write localStorage entries for the current origin. |
| `page_press_key` | Simulate a key press by name. |
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
| `indexeddb_dump` | Export all IndexedDB databases and records for offline analysis. |
| `js_heap_search` | Search JS heap for strings matching a pattern. |
| `tab_workflow` | Cross-tab coordination. |
| `human_mouse` | Move mouse along a Bezier curve with jitter. |
| `human_scroll` | Scroll with randomized speed and pauses to mimic human behavior. |
| `human_typing` | Type text with human-like speed and occasional typos. |
| `captcha_solver_capabilities` | Report CAPTCHA solving mode availability. |
| `captcha_vision_solve` | Solve a CAPTCHA with manual flow or a configured external service. |
| `widget_challenge_solve` | Solve a widget challenge with hook, manual, or configured external service. |
| `browser_jsdom_parse` | Parse HTML into an in-memory JSDOM session. No browser needed. |
| `browser_jsdom_query` | Query a JSDOM session with a CSS selector. |
| `browser_jsdom_execute` | Evaluate JS inside a JSDOM session. |
| `browser_jsdom_serialize` | Serialize a JSDOM session to HTML. |
| `browser_jsdom_cookies` | Manage cookies on a JSDOM session. Isolated from the attached browser. |
