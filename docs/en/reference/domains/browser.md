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

## Full tool list (60)

<details>
<summary><b>Navigation & Browser Control</b> (12 tools)</summary>

| Tool                      | Description |
| ------------------------- | ------------|
| `get_detailed_data`       | Retrieve detailed data using detailId token. |
| `browser_attach`          | Attach to an existing browser instance via Chrome DevTools Protocol (CDP). |
| `browser_list_tabs`       | List all open tabs/pages in the connected browser. |
| `browser_select_tab`      | Switch the active tab/page by index or URL/title pattern. |
| `browser_launch`          | Launch browser instance. |
| `browser_close`           | Close browser instance |
| `browser_status`          | Get browser status (running, pages count, version) |
| `page_navigate`           | Navigate to a URL |
| `page_reload`             | Reload current page |
| `page_back`               | Navigate back in history |
| `page_forward`            | Navigate forward in history |
| `page_press_key`          | Press a keyboard key (e.g., "Enter", "Escape", "ArrowDown") |
</details>

<details>
<summary><b>DOM Interaction</b> (18 tools)</summary>

| Tool                      | Description |
| ------------------------- | ------------|
| `dom_query_selector`      | Query single element. Use BEFORE clicking to verify element exists. |
| `dom_query_all`           | Query all matching elements |
| `dom_get_structure`       | Get page DOM structure |
| `dom_find_clickable`      | Find all clickable elements |
| `dom_find_by_text`        | Find elements by text content |
| `dom_get_computed_style`  | Get computed CSS styles |
| `dom_get_xpath`           | Get XPath of an element |
| `dom_is_in_viewport`      | Check if element is visible in viewport |
| `page_click`              | Click an element |
| `page_type`               | Type text into an input element |
| `page_select`             | Select option(s) in a select element |
| `page_hover`              | Hover over an element |
| `page_scroll`             | Scroll the page |
| `page_wait_for_selector`  | Wait for an element to appear |
| `page_evaluate`           | Execute JavaScript in page context |
| `page_screenshot`         | Take a screenshot |
| `page_get_all_links`      | Get all links on the page |
| `page_inject_script`      | Inject JavaScript into page |
| `page_get_performance`    | Get page performance metrics |
</details>

<details>
<summary><b>Storage & Cookies</b> (6 tools)</summary>

| Tool                      | Description |
| ------------------------- | ------------|
| `page_set_cookies`        | Set cookies for the page |
| `page_get_cookies`        | Get all cookies |
| `page_clear_cookies`      | Clear all cookies |
| `page_get_local_storage`  | Get localStorage items |
| `page_set_local_storage`  | Set localStorage item |
| `indexeddb_dump`          | Dump all IndexedDB databases |
</details>

<details>
<summary><b>Scripts & Console</b> (6 tools)</summary>

| Tool                      | Description |
| ------------------------- | ------------|
| `get_all_scripts`         | Get list of all loaded scripts |
| `get_script_source`       | Get source code of a script |
| `console_enable`          | Enable console monitoring |
| `console_get_logs`        | Get captured console logs |
| `console_execute`         | Execute JS in console context |
| `js_heap_search`          | Search JS heap for string patterns |
</details>

<details>
<summary><b>Device & Viewport</b> (2 tools)</summary>

| Tool                      | Description |
| ------------------------- | ------------|
| `page_set_viewport`       | Set viewport size |
| `page_emulate_device`     | Emulate mobile device |
</details>

<details>
<summary><b>Stealth, CAPTCHA & Human Simulation</b> (10 tools)</summary>

| Tool                      | Description |
| ------------------------- | ------------|
| `captcha_detect`          | Detect CAPTCHA using AI vision |
| `captcha_wait`            | Wait for manual CAPTCHA solve |
| `captcha_config`          | Configure CAPTCHA behavior |
| `captcha_vision_solve`    | Auto-solve CAPTCHA via AI |
| `widget_challenge_solve`  | Solve widget challenge |
| `stealth_inject`          | Inject stealth scripts |
| `stealth_set_user_agent`  | Set realistic User-Agent |
| `human_mouse`             | Human-like mouse movement |
| `human_scroll`            | Human-like scrolling |
| `human_typing`            | Human-like typing |
</details>

<details>
<summary><b>Camoufox Server</b> (3 tools)</summary>

| Tool                      | Description |
| ------------------------- | ------------|
| `camoufox_server_launch`  | Launch Camoufox WebSocket server |
| `camoufox_server_close`   | Close Camoufox server |
| `camoufox_server_status`  | Get Camoufox server status |
</details>

<details>
<summary><b>Advanced Features</b> (2 tools)</summary>

| Tool                      | Description |
| ------------------------- | ------------|
| `framework_state_extract` | Extract React/Vue component state |
| `tab_workflow`            | Cross-tab coordination |
</details>
