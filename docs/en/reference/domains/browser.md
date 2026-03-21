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

- `get_detailed_data` — Retrieve detailed data using detailId token.
- `browser_attach` — Attach to an existing browser instance via Chrome DevTools Protocol (CDP).
- `browser_list_tabs` — List all open tabs/pages in the connected browser.
- `browser_select_tab` — Switch the active tab/page by index or URL/title pattern.
- `browser_launch` — Launch browser instance.
- `browser_close` — Close browser instance
- `browser_status` — Get browser status (running, pages count, version)
- `page_navigate` — Navigate to a URL
- `page_reload` — Reload current page
- `page_back` — Navigate back in history

## Full tool list (63)

| Tool                           | Description                                                                                                                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_detailed_data`            | Retrieve detailed data using detailId token.                                                                                                                                                                                      |
| `browser_attach`               | Attach to an existing browser instance via Chrome DevTools Protocol (CDP).                                                                                                                                                        |
| `browser_list_tabs`            | List all open tabs/pages in the connected browser.                                                                                                                                                                                |
| `browser_select_tab`           | Switch the active tab/page by index or URL/title pattern.                                                                                                                                                                         |
| `browser_launch`               | Launch browser instance.                                                                                                                                                                                                          |
| `browser_close`                | Close browser instance                                                                                                                                                                                                            |
| `browser_status`               | Get browser status (running, pages count, version)                                                                                                                                                                                |
| `page_navigate`                | Navigate to a URL                                                                                                                                                                                                                 |
| `page_reload`                  | Reload current page                                                                                                                                                                                                               |
| `page_back`                    | Navigate back in history                                                                                                                                                                                                          |
| `page_forward`                 | Navigate forward in history                                                                                                                                                                                                       |
| `dom_query_selector`           | Query single element (like document.querySelector). AI should use this BEFORE clicking to verify element exists.                                                                                                                  |
| `dom_query_all`                | Query all matching elements (like document.querySelectorAll)                                                                                                                                                                      |
| `dom_get_structure`            | Get page DOM structure (for AI to understand page layout).                                                                                                                                                                        |
| `dom_find_clickable`           | Find all clickable elements (buttons, links). Use this to discover what can be clicked.                                                                                                                                           |
| `page_click`                   | Click an element. Use dom_query_selector FIRST to verify element exists.                                                                                                                                                          |
| `page_type`                    | Type text into an input element                                                                                                                                                                                                   |
| `page_select`                  | Select option(s) in a &lt;select&gt; element                                                                                                                                                                                      |
| `page_hover`                   | Hover over an element                                                                                                                                                                                                             |
| `page_scroll`                  | Scroll the page                                                                                                                                                                                                                   |
| `page_wait_for_selector`       | Wait for an element to appear                                                                                                                                                                                                     |
| `page_evaluate`                | Execute JavaScript code in page context and get result.                                                                                                                                                                           |
| `page_screenshot`              | Take a screenshot of the page, a specific DOM element, multiple elements, or a pixel region.                                                                                                                                      |
| `get_all_scripts`              | Get list of all loaded scripts on the page                                                                                                                                                                                        |
| `get_script_source`            | Get source code of a specific script.                                                                                                                                                                                             |
| `console_enable`               | Enable console monitoring to capture console.log, console.error, etc.                                                                                                                                                             |
| `console_get_logs`             | Get captured console logs                                                                                                                                                                                                         |
| `console_execute`              | Execute JavaScript expression in console context                                                                                                                                                                                  |
| `dom_get_computed_style`       | Get computed CSS styles of an element                                                                                                                                                                                             |
| `dom_find_by_text`             | Find elements by text content (useful for dynamic content)                                                                                                                                                                        |
| `dom_get_xpath`                | Get XPath of an element                                                                                                                                                                                                           |
| `dom_is_in_viewport`           | Check if element is visible in viewport                                                                                                                                                                                           |
| `page_get_performance`         | Get page performance metrics (load time, network time, etc.)                                                                                                                                                                      |
| `page_inject_script`           | Inject JavaScript code into page                                                                                                                                                                                                  |
| `page_set_cookies`             | Set cookies for the page                                                                                                                                                                                                          |
| `page_get_cookies`             | Get all cookies for the page                                                                                                                                                                                                      |
| `page_clear_cookies`           | Clear all cookies                                                                                                                                                                                                                 |
| `page_set_viewport`            | Set viewport size                                                                                                                                                                                                                 |
| `page_emulate_device`          | Emulate mobile device (iPhone, iPad, Android)                                                                                                                                                                                     |
| `page_get_local_storage`       | Get all localStorage items                                                                                                                                                                                                        |
| `page_set_local_storage`       | Set localStorage item                                                                                                                                                                                                             |
| `page_press_key`               | Press a keyboard key (e.g., "Enter", "Escape", "ArrowDown")                                                                                                                                                                       |
| `page_get_all_links`           | Get all links on the page                                                                                                                                                                                                         |
| `captcha_detect`               | Detect CAPTCHA on the current page using AI vision analysis.                                                                                                                                                                      |
| `captcha_wait`                 | Wait for the user to manually solve a CAPTCHA.                                                                                                                                                                                    |
| `captcha_config`               | Configure CAPTCHA detection behavior.                                                                                                                                                                                             |
| `stealth_inject`               | Inject modern stealth scripts to bypass bot detection.                                                                                                                                                                            |
| `stealth_set_user_agent`       | Set a realistic User-Agent and browser fingerprint for the target platform.                                                                                                                                                       |
| `stealth_configure_jitter`     | Configure CDP command timing jitter to mimic natural network latency.                                                                                                                                                             |
| `stealth_generate_fingerprint` | Generate a realistic browser fingerprint using real-world datasets.                                                                                                                                                               |
| `stealth_verify`               | Run offline anti-detection checks on the current page.                                                                                                                                                                            |
| `camoufox_server_launch`       | Launch a Camoufox WebSocket server for multi-process / remote connections.                                                                                                                                                        |
| `camoufox_server_close`        | Close the Camoufox WebSocket server. Connected clients are disconnected.                                                                                                                                                          |
| `camoufox_server_status`       | Get the current status of the Camoufox WebSocket server (running, wsEndpoint).                                                                                                                                                    |
| `framework_state_extract`      | Extract React/Vue component state from the live page. Useful for debugging frontend applications and finding hidden state.                                                                                                        |
| `indexeddb_dump`               | Dump all IndexedDB databases and their contents. Useful for analyzing PWA data, stored tokens, or offline application state.                                                                                                      |
| `js_heap_search`               | Search the browser JavaScript heap for string values matching a pattern. This is the CE (Cheat Engine) equivalent for web — scans the JS runtime memory to find tokens, API keys, signatures, or any string stored in JS objects. |
| `tab_workflow`                 | Cross-tab coordination for multi-page automation flows.                                                                                                                                                                           |
| `human_mouse`                  | Move the mouse along a natural Bezier curve path with random jitter.                                                                                                                                                              |
| `human_scroll`                 | Scroll the page with human-like behavior: variable speed, micro-pauses, and deceleration.                                                                                                                                         |
| `human_typing`                 | Type text with human-like patterns: variable speed, occasional typos, and natural corrections.                                                                                                                                    |
| `captcha_vision_solve`         | Attempt to solve a CAPTCHA using an external solving service or AI vision.                                                                                                                                                        |
| `widget_challenge_solve`       | Solve an embedded widget challenge.                                                                                                                                                                                               |
