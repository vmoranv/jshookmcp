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

## Representative tools

- `get_detailed_data` — Retrieve large data using detailId token from previous tool response.
- `browser_attach` — Attach to a running browser via CDP. Supports browserURL, wsEndpoint, and autoConnect.
- `browser_list_tabs` — List all open tabs/pages. Can auto-connect via browserURL/wsEndpoint/autoConnect.
- `browser_list_cdp_targets` — List all CDP targets (pages, workers, iframes). Can auto-connect first.
- `browser_select_tab` — Switch active tab by index or URL/title pattern. Console/network rebind lazily.
- `browser_attach_cdp_target` — Attach to a specific CDP target by targetId. Network/hooks bind to this target.
- `browser_detach_cdp_target` — Detach the currently attached low-level CDP target session and return network/hooks to normal page-based binding.
- `browser_evaluate_cdp_target` — Evaluate JS in the currently attached CDP target session (OOPIF/iframe/worker).
- `browser_launch` — Launch or connect to a browser. Drivers: chrome (full CDP) or camoufox (anti-detect Firefox).
- `browser_close` — Close browser instance

## Full tool list (61)

| Tool | Description |
| --- | --- |
| `get_detailed_data` | Retrieve large data using detailId token from previous tool response. |
| `browser_attach` | Attach to a running browser via CDP. Supports browserURL, wsEndpoint, and autoConnect. |
| `browser_list_tabs` | List all open tabs/pages. Can auto-connect via browserURL/wsEndpoint/autoConnect. |
| `browser_list_cdp_targets` | List all CDP targets (pages, workers, iframes). Can auto-connect first. |
| `browser_select_tab` | Switch active tab by index or URL/title pattern. Console/network rebind lazily. |
| `browser_attach_cdp_target` | Attach to a specific CDP target by targetId. Network/hooks bind to this target. |
| `browser_detach_cdp_target` | Detach the currently attached low-level CDP target session and return network/hooks to normal page-based binding. |
| `browser_evaluate_cdp_target` | Evaluate JS in the currently attached CDP target session (OOPIF/iframe/worker). |
| `browser_launch` | Launch or connect to a browser. Drivers: chrome (full CDP) or camoufox (anti-detect Firefox). |
| `browser_close` | Close browser instance |
| `browser_status` | Get browser status (running, pages count, version) |
| `page_navigate` | Navigate to a URL. Supports auto CAPTCHA detection and optional network monitoring. |
| `page_reload` | Reload current page |
| `page_back` | Navigate back in history |
| `page_forward` | Navigate forward in history |
| `dom_query_selector` | Query single element (like document.querySelector). AI should use this BEFORE clicking to verify element exists. |
| `dom_query_all` | Query all matching elements (like document.querySelectorAll) |
| `dom_get_structure` | Get page DOM structure. |
| `dom_find_clickable` | Find all clickable elements (buttons, links). |
| `page_click` | Click an element. Supports iframes via frameUrl/frameSelector. |
| `page_type` | Type text into an input element. Supports typing inside iframes via frameUrl/frameSelector. |
| `page_select` | Select option(s) in a &lt;select&gt; element. Supports iframes via frameUrl/frameSelector. |
| `page_hover` | Hover over an element. Supports iframes via frameUrl/frameSelector. |
| `page_scroll` | Scroll the page |
| `page_wait_for_selector` | Wait for an element to appear |
| `page_evaluate` | Execute JavaScript in page context. Large results (&gt;50KB) auto-return summary + detailId. |
| `page_screenshot` | Take a screenshot: full page, element(s), or pixel region. |
| `get_all_scripts` | Get list of all loaded scripts on the page |
| `get_script_source` | Get source code of a specific script. Large scripts auto-return summary + detailId. |
| `console_enable` | Enable console monitoring to capture console.log, console.error, etc. |
| `console_get_logs` | Get captured console logs |
| `console_execute` | Execute JavaScript expression in console context |
| `dom_get_computed_style` | Get computed CSS styles of an element |
| `dom_find_by_text` | Find elements by text content (useful for dynamic content) |
| `dom_get_xpath` | Get XPath of an element |
| `dom_is_in_viewport` | Check if element is visible in viewport |
| `page_inject_script` | Inject JavaScript code into page |
| `page_cookies` | Manage page cookies. Actions: get (all cookies), set (requires cookies array), clear (all cookies). |
| `page_set_viewport` | Set viewport size |
| `page_emulate_device` | Emulate mobile device (iPhone, iPad, Android) |
| `page_local_storage` | Manage localStorage. Actions: get (all items), set (requires key, value). |
| `page_press_key` | Press a keyboard key (e.g., "Enter", "Escape", "ArrowDown") |
| `page_get_all_links` | Get all links on the page |
| `captcha_detect` | Detect CAPTCHA on the current page via AI vision + rule-based analysis. |
| `captcha_wait` | Wait for manual CAPTCHA solve. Polls until CAPTCHA disappears. |
| `captcha_config` | Configure CAPTCHA detection and auto-handling behavior. |
| `stealth_inject` | Inject stealth scripts: webdriver, chrome, plugins, canvas, WebGL, permissions patches. |
| `stealth_set_user_agent` | Set realistic User-Agent and fingerprint for target platform. |
| `stealth_configure_jitter` | Configure CDP command timing jitter to mimic natural network latency. |
| `stealth_generate_fingerprint` | Generate realistic browser fingerprint. Cached per session, auto-applied on stealth_inject. |
| `stealth_verify` | Run anti-detection checks. Returns pass/fail per check + overall score (0-100). |
| `camoufox_server` | Manage Camoufox WebSocket server. Launch server, then connect via browser_launch. |
| `framework_state_extract` | Extract component state from the live page (React, Vue, Svelte, Solid, Preact). |
| `indexeddb_dump` | Dump IndexedDB databases and their contents. |
| `js_heap_search` | Search JS heap for string values matching a pattern. WARNING: takes a full heap snapshot. |
| `tab_workflow` | Cross-tab coordination: list/bind/navigate/wait/context-set/transfer across named tabs. |
| `human_mouse` | Move mouse along a natural Bezier curve with jitter. Use before page_click for anti-bot. |
| `human_scroll` | Scroll with human-like behavior: variable speed, micro-pauses, deceleration. |
| `human_typing` | Type text with human-like patterns: variable speed, occasional typos, corrections. |
| `captcha_vision_solve` | Solve CAPTCHA via external service or AI vision. Auto-detects challenge type. |
| `widget_challenge_solve` | Solve embedded widget challenge: detect, solve, inject token, trigger callback. |
