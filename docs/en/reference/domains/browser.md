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

- `get_detailed_data` — Retrieve large data by detailId.
- `browser_attach` — Attach to a running browser via CDP.
- `browser_list_tabs` — List open tabs.
- `browser_list_cdp_targets` — List CDP targets.
- `browser_select_tab` — Switch active tab.
- `browser_attach_cdp_target` — Attach to a CDP target by targetId.
- `browser_detach_cdp_target` — Detach the current CDP target session.
- `browser_evaluate_cdp_target` — Evaluate JS in the attached CDP target.
- `browser_launch` — Launch or connect to a browser.
- `browser_close` — Close browser.

## Full tool list (58)

| Tool | Description |
| --- | --- |
| `get_detailed_data` | Retrieve large data by detailId. |
| `browser_attach` | Attach to a running browser via CDP. |
| `browser_list_tabs` | List open tabs. |
| `browser_list_cdp_targets` | List CDP targets. |
| `browser_select_tab` | Switch active tab. |
| `browser_attach_cdp_target` | Attach to a CDP target by targetId. |
| `browser_detach_cdp_target` | Detach the current CDP target session. |
| `browser_evaluate_cdp_target` | Evaluate JS in the attached CDP target. |
| `browser_launch` | Launch or connect to a browser. |
| `browser_close` | Close browser. |
| `browser_status` | Browser status. |
| `page_navigate` | Navigate to a URL. |
| `page_reload` | Reload current page |
| `page_back` | Go back in history |
| `page_forward` | Go forward in history |
| `page_click` | Click an element. |
| `page_type` | Type text into an element. |
| `page_select` | Select option(s) in a &lt;select&gt; element. |
| `page_hover` | Hover over an element. |
| `page_scroll` | Scroll the page. |
| `page_wait_for_selector` | Wait for an element to appear. |
| `page_evaluate` | Execute JavaScript in page context. |
| `page_screenshot` | Take a screenshot. |
| `get_all_scripts` | List all loaded scripts. |
| `get_script_source` | Get source code of a script. |
| `console_monitor` | Enable or disable console monitoring. |
| `console_get_logs` | Get captured console logs. |
| `console_execute` | Execute JS in console context. |
| `page_inject_script` | Inject JS into the page. |
| `page_cookies` | Manage page cookies. Clear requires expectedCount (call get first). |
| `page_set_viewport` | Set viewport size. |
| `page_emulate_device` | Emulate a mobile device. |
| `page_local_storage` | Manage localStorage. |
| `page_press_key` | Press a keyboard key. |
| `captcha_detect` | Detect CAPTCHA on the page. |
| `captcha_wait` | Wait for manual CAPTCHA solve. |
| `captcha_config` | Configure CAPTCHA detection and auto-handling. |
| `stealth_inject` | Inject stealth scripts. |
| `stealth_set_user_agent` | Set User-Agent and fingerprint. |
| `stealth_configure_jitter` | Configure CDP timing jitter. |
| `stealth_generate_fingerprint` | Generate a browser fingerprint. |
| `stealth_verify` | Run anti-detection checks. |
| `camoufox_geolocation` | Get geolocation for a locale. |
| `camoufox_server` | Manage Camoufox WebSocket server. |
| `framework_state_extract` | Extract framework component state. |
| `indexeddb_dump` | Dump IndexedDB contents. |
| `js_heap_search` | Search JS heap for strings matching a pattern. |
| `tab_workflow` | Cross-tab coordination. |
| `human_mouse` | Move mouse along a Bezier curve with jitter. |
| `human_scroll` | Scroll with human-like speed variation. |
| `human_typing` | Type text with human-like speed and occasional typos. |
| `captcha_vision_solve` | Solve CAPTCHA via external service or AI vision. |
| `widget_challenge_solve` | Solve embedded widget challenge. |
| `browser_jsdom_parse` | Parse HTML into an in-memory JSDOM session. No browser needed. |
| `browser_jsdom_query` | Query a JSDOM session with a CSS selector. |
| `browser_jsdom_execute` | Evaluate JS inside a JSDOM session. |
| `browser_jsdom_serialize` | Serialize a JSDOM session to HTML. |
| `browser_jsdom_cookies` | Manage cookies on a JSDOM session. Isolated from the attached browser. |
