# jshhookmcp

English | [中文](./README.zh.md)

An MCP (Model Context Protocol) server providing **157 tools** for AI-assisted JavaScript reverse engineering. Combines browser automation, Chrome DevTools Protocol debugging, network monitoring, intelligent JavaScript hooks, LLM-powered code analysis, and CTF-specific reverse engineering utilities in a single server.

## Features

- **Browser Automation** — Launch Chromium/Camoufox, navigate pages, interact with the DOM, take screenshots, manage cookies and storage
- **CDP Debugger** — Set breakpoints, step through execution, inspect scope variables, watch expressions, session save/restore
- **Network Monitoring** — Capture requests/responses, filter by URL or method, retrieve response bodies
- **JavaScript Hooks** — AI-generated hooks for any function, 20+ built-in presets (eval, crypto, atob, WebAssembly, etc.)
- **Code Analysis** — Deobfuscation (JScrambler, JSVMP, packer), crypto algorithm detection, LLM-powered understanding
- **CAPTCHA Handling** — AI vision detection, manual solve flow, configurable polling
- **Stealth Injection** — Anti-detection patches for headless browser fingerprinting
- **Performance** — Smart caching, token budget management, code coverage
- **Process Management** — Cross-platform process enumeration, memory operations, debug port detection

## Architecture

Built on `@modelcontextprotocol/sdk` v1.27+ using the **McpServer high-level API**:

- All 157 tools registered via `server.tool()` — no manual request handlers
- Tool schemas built dynamically from JSON Schema (input validated per-tool by domain handlers)
- Two transport modes: **stdio** (default, for MCP clients) and **Streamable HTTP** (MCP 2025-03-26, for remote/HTTP deployments)
- Capabilities: `{ tools: {}, logging: {} }`

## Requirements

- Node.js >= 18
- pnpm

## Installation

```bash
pnpm install
pnpm build
```

> **Note:** If you plan to use Camoufox-based tools (`camoufox_server_launch`, `browser_launch` with `driver: "camoufox"`), you must manually fetch the Camoufox browser binary **after** `pnpm install`:
>
> ```bash
> npx camoufox-js fetch
> ```
>
> This step is **not** run automatically during installation.

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Key variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DEFAULT_LLM_PROVIDER` | `openai` or `anthropic` | `openai` |
| `OPENAI_API_KEY` | OpenAI (or compatible) API key | — |
| `OPENAI_BASE_URL` | Base URL for OpenAI-compatible endpoint | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | Model name | `gpt-4-turbo-preview` |
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `PUPPETEER_HEADLESS` | Run browser in headless mode | `true` |
| `PUPPETEER_EXECUTABLE_PATH` | Optional browser executable path (explicit override only) | Puppeteer managed |
| `LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) | `info` |
| `MCP_TRANSPORT` | Transport mode: `stdio` or `http` | `stdio` |
| `MCP_PORT` | HTTP port (only used when `MCP_TRANSPORT=http`) | `3000` |

## MCP Client Setup

### stdio (default — local MCP clients)

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "jshhookmcp": {
      "command": "node",
      "args": ["path/to/jshhookmcp/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "your-key",
        "OPENAI_BASE_URL": "https://api.openai.com/v1",
        "OPENAI_MODEL": "gpt-4-turbo-preview"
      }
    }
  }
}
```

### Streamable HTTP (remote / MCP 2025-03-26)

Start the server in HTTP mode:

```bash
MCP_TRANSPORT=http MCP_PORT=3000 node dist/index.js
```

Connect your MCP client to `http://localhost:3000/mcp`. The server supports:

- `POST /mcp` — send JSON-RPC requests (returns JSON or SSE stream)
- `GET /mcp` — open SSE stream
- `DELETE /mcp` — close session

Session IDs are issued via the `Mcp-Session-Id` response header on the first request.

Example with `curl`:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

## Tool Domains (157 Tools Total)

### Analysis (13 tools)

| # | Tool | Description |
|---|------|-------------|
| 1 | `collect_code` | Collect JavaScript code from a target website (summary / priority / incremental / full modes) |
| 2 | `search_in_scripts` | Search collected scripts by keyword or regex pattern |
| 3 | `extract_function_tree` | Extract a function and its full dependency tree from collected scripts |
| 4 | `deobfuscate` | LLM-assisted JavaScript deobfuscation |
| 5 | `understand_code` | Semantic code analysis for structure, behaviour, and risks |
| 6 | `detect_crypto` | Detect cryptographic algorithms and usage patterns in source code |
| 7 | `manage_hooks` | Create, inspect, and clear JavaScript runtime hooks |
| 8 | `detect_obfuscation` | Detect obfuscation techniques in JavaScript source |
| 9 | `advanced_deobfuscate` | Advanced deobfuscation with VM-oriented strategies |
| 10 | `clear_collected_data` | Clear collected script data, caches, and in-memory indexes |
| 11 | `get_collection_stats` | Get collection, cache, and compression statistics |
| 12 | `webpack_enumerate` | Enumerate all webpack modules in the current page; optionally search for keywords |
| 13 | `source_map_extract` | Find and parse JavaScript source maps to recover original source code |

### Browser (53 tools)

<details>
<summary>Click to expand — Browser control, DOM interaction, stealth, CAPTCHA, storage, and framework tools</summary>

| # | Tool | Description |
|---|------|-------------|
| 1 | `get_detailed_data` | Retrieve large data by `detailId` token (returned when results exceed context limits) |
| 2 | `browser_launch` | Launch browser instance (driver: `chrome` via rebrowser-puppeteer-core, or `camoufox` Firefox anti-detect) |
| 3 | `camoufox_server_launch` | Launch a Camoufox WebSocket server for multi-process / remote connections |
| 4 | `camoufox_server_close` | Close the Camoufox WebSocket server and disconnect all clients |
| 5 | `camoufox_server_status` | Get current Camoufox WebSocket server status (running, wsEndpoint) |
| 6 | `browser_attach` | Attach to an existing browser via Chrome DevTools Protocol (CDP) WebSocket URL |
| 7 | `browser_close` | Close the browser instance |
| 8 | `browser_status` | Get browser status (running, page count, version) |
| 9 | `browser_list_tabs` | List all open tabs/pages (index, URL, title) |
| 10 | `browser_select_tab` | Switch active tab by index or URL/title pattern |
| 11 | `page_navigate` | Navigate to a URL with automatic CAPTCHA detection and optional network monitoring |
| 12 | `page_reload` | Reload current page |
| 13 | `page_back` | Navigate back in history |
| 14 | `page_forward` | Navigate forward in history |
| 15 | `dom_query_selector` | Query a single DOM element (`document.querySelector`) — use before clicking |
| 16 | `dom_query_all` | Query all matching DOM elements (`document.querySelectorAll`) |
| 17 | `dom_get_structure` | Get page DOM structure; large DOM (>50 KB) auto-returns summary + `detailId` |
| 18 | `dom_find_clickable` | Find all clickable elements (buttons, links) to discover what can be clicked |
| 19 | `dom_get_computed_style` | Get computed CSS styles of an element |
| 20 | `dom_find_by_text` | Find elements by text content |
| 21 | `dom_get_xpath` | Get XPath for an element |
| 22 | `dom_is_in_viewport` | Check if an element is visible in the viewport |
| 23 | `page_click` | Click an element (use `dom_query_selector` first to verify it exists) |
| 24 | `page_type` | Type text into an input element |
| 25 | `page_select` | Select option(s) in a `<select>` element |
| 26 | `page_hover` | Hover over an element |
| 27 | `page_scroll` | Scroll the page |
| 28 | `page_press_key` | Press a keyboard key (e.g. `Enter`, `Escape`, `ArrowDown`) |
| 29 | `page_wait_for_selector` | Wait for an element to appear in the DOM |
| 30 | `page_evaluate` | Execute JavaScript in page context; large results (>50 KB) return summary + `detailId` |
| 31 | `page_screenshot` | Take a screenshot of the current page |
| 32 | `page_get_performance` | Get page performance metrics (load time, network time, etc.) |
| 33 | `page_inject_script` | Inject JavaScript code into the page |
| 34 | `page_set_cookies` | Set cookies for the page |
| 35 | `page_get_cookies` | Get all cookies for the page |
| 36 | `page_clear_cookies` | Clear all cookies |
| 37 | `page_set_viewport` | Set viewport size (width × height) |
| 38 | `page_emulate_device` | Emulate a mobile device (iPhone, iPad, Android) |
| 39 | `page_get_local_storage` | Get all `localStorage` items |
| 40 | `page_set_local_storage` | Set a `localStorage` item |
| 41 | `page_get_all_links` | Get all links (`<a href>`) on the page |
| 42 | `get_all_scripts` | Get list of all loaded script URLs on the page |
| 43 | `get_script_source` | Get source code of a specific script; large scripts (>50 KB) return summary + `detailId` |
| 44 | `console_enable` | Enable console monitoring to capture `console.log`, `console.error`, etc. |
| 45 | `console_get_logs` | Get captured console logs |
| 46 | `console_execute` | Execute JavaScript expression in the console context |
| 47 | `captcha_detect` | Detect CAPTCHA on the current page using AI vision analysis |
| 48 | `captcha_wait` | Wait for the user to manually solve a CAPTCHA (switches browser to headed mode) |
| 49 | `captcha_config` | Configure CAPTCHA detection behaviour (autoDetect, autoSwitchHeadless, timeout) |
| 50 | `stealth_inject` | Inject 2024–2025 stealth scripts to bypass bot detection |
| 51 | `stealth_set_user_agent` | Set a realistic User-Agent and browser fingerprint for the target platform |
| 52 | `framework_state_extract` | Extract React/Vue component state from the live page |
| 53 | `indexeddb_dump` | Dump all IndexedDB databases and their contents |

</details>

### Debugger (37 tools)

<details>
<summary>Click to expand — CDP debugger control, breakpoints, watches, XHR/event breakpoints, session persistence</summary>

| # | Tool | Description |
|---|------|-------------|
| 1 | `debugger_enable` | Enable the CDP debugger (must be called before setting breakpoints) |
| 2 | `debugger_disable` | Disable the debugger and clear all breakpoints |
| 3 | `debugger_pause` | Pause execution at the next statement |
| 4 | `debugger_resume` | Resume execution (continue) |
| 5 | `debugger_step_into` | Step into the next function call |
| 6 | `debugger_step_over` | Step over the next function call |
| 7 | `debugger_step_out` | Step out of the current function |
| 8 | `debugger_wait_for_paused` | Wait for the debugger to pause (use after setting breakpoints) |
| 9 | `debugger_get_paused_state` | Get the current paused state (is paused, and why) |
| 10 | `debugger_evaluate` | Evaluate an expression in the context of the current call frame |
| 11 | `debugger_evaluate_global` | Evaluate an expression in the global context (no paused state required) |
| 12 | `debugger_save_session` | Save the current debugging session (breakpoints, watches) to a JSON file |
| 13 | `debugger_load_session` | Load a previously saved debugging session |
| 14 | `debugger_export_session` | Export the current session as a JSON string for sharing or backup |
| 15 | `debugger_list_sessions` | List all saved debugging sessions |
| 16 | `breakpoint_set` | Set a breakpoint (URL-based or scriptId-based, with optional condition) |
| 17 | `breakpoint_remove` | Remove a breakpoint by its ID |
| 18 | `breakpoint_list` | List all active breakpoints |
| 19 | `breakpoint_set_on_exception` | Pause on exceptions — all exceptions or uncaught only |
| 20 | `get_call_stack` | Get the current call stack (only available when paused) |
| 21 | `get_object_properties` | Get all properties of an object by `objectId` (use when paused) |
| 22 | `get_scope_variables_enhanced` | Enhanced scope variable inspection with deep object traversal |
| 23 | `watch_add` | Add a watch expression to monitor variable values |
| 24 | `watch_remove` | Remove a watch expression by ID |
| 25 | `watch_list` | List all watch expressions |
| 26 | `watch_evaluate_all` | Evaluate all enabled watch expressions, returning current values and change indicators |
| 27 | `watch_clear_all` | Clear all watch expressions |
| 28 | `xhr_breakpoint_set` | Set an XHR/Fetch breakpoint (pause before matching network requests) |
| 29 | `xhr_breakpoint_remove` | Remove an XHR breakpoint by ID |
| 30 | `xhr_breakpoint_list` | List all XHR breakpoints |
| 31 | `event_breakpoint_set` | Set an event listener breakpoint (pause on specific event) |
| 32 | `event_breakpoint_set_category` | Set breakpoints for an entire event category (mouse, keyboard, timer, websocket) |
| 33 | `event_breakpoint_remove` | Remove an event breakpoint by ID |
| 34 | `event_breakpoint_list` | List all event breakpoints |
| 35 | `blackbox_add` | Blackbox scripts by URL pattern (skip during step-through debugging) |
| 36 | `blackbox_add_common` | Blackbox all common libraries at once (jQuery, React, Vue, etc.) |
| 37 | `blackbox_list` | List all blackboxed URL patterns |

</details>

### Network (15 tools)

| # | Tool | Description |
|---|------|-------------|
| 1 | `network_enable` | Enable network request monitoring (call before `page_navigate` to capture requests) |
| 2 | `network_disable` | Disable network request monitoring |
| 3 | `network_get_status` | Get network monitoring status (enabled, request count, response count) |
| 4 | `network_get_requests` | Get captured network requests; large results (>50 KB) return summary + `detailId` |
| 5 | `network_get_response_body` | Get response body for a specific request (auto-truncates >100 KB) |
| 6 | `network_get_stats` | Get network statistics (total requests, error rate, timing breakdown) |
| 7 | `performance_get_metrics` | Get page Web Vitals (FCP, LCP, FID, CLS) |
| 8 | `performance_start_coverage` | Start JavaScript and CSS code coverage recording |
| 9 | `performance_stop_coverage` | Stop coverage recording and return the coverage report |
| 10 | `performance_take_heap_snapshot` | Take a V8 heap memory snapshot |
| 11 | `console_get_exceptions` | Get captured uncaught exceptions from the page |
| 12 | `console_inject_script_monitor` | Inject a monitor that tracks dynamically created `<script>` elements |
| 13 | `console_inject_xhr_interceptor` | Inject an XHR interceptor to capture AJAX request/response data |
| 14 | `console_inject_fetch_interceptor` | Inject a Fetch API interceptor to capture fetch request/response data |
| 15 | `console_inject_function_tracer` | Inject a Proxy-based function tracer to log all calls to a named function |

### Hooks (8 tools)

| # | Tool | Description |
|---|------|-------------|
| 1 | `ai_hook_generate` | Generate hook code for a function, API, or object method (types: function, object-method, api, property, event, custom) |
| 2 | `ai_hook_inject` | Inject a generated hook into the page (`evaluateOnNewDocument` or `evaluate`) |
| 3 | `ai_hook_get_data` | Retrieve captured data from an active hook (arguments, return values, timestamps, call count) |
| 4 | `ai_hook_list` | List all active hooks with IDs, types, creation time, and call counts |
| 5 | `ai_hook_clear` | Remove one hook by ID or clear all hooks and their captured data |
| 6 | `ai_hook_toggle` | Enable or disable a hook without removing it |
| 7 | `ai_hook_export` | Export captured hook data in JSON or CSV format |
| 8 | `hook_preset` | Install a pre-built hook from 20+ built-in presets |

**Built-in presets:** `eval`, `function-constructor`, `atob-btoa`, `crypto-subtle`, `json-stringify`, `object-defineproperty`, `settimeout`, `setinterval`, `addeventlistener`, `postmessage`, `webassembly`, `proxy`, `reflect`, `history-pushstate`, `location-href`, `navigator-useragent`, `eventsource`, `window-open`, `mutationobserver`, `formdata`

### Maintenance (6 tools)

| # | Tool | Description |
|---|------|-------------|
| 1 | `get_token_budget_stats` | Get token budget usage statistics (consumption estimate, tool call counts, warnings) |
| 2 | `manual_token_cleanup` | Manually trigger token budget cleanup — frees 10–30% of context space |
| 3 | `reset_token_budget` | Reset all token budget counters to zero (hard reset) |
| 4 | `get_cache_stats` | Get cache statistics for all internal caches (entries, hit rates) |
| 5 | `smart_cache_cleanup` | Intelligently clean caches, preserving hot data |
| 6 | `clear_all_caches` | Clear all internal caches completely (destructive) |

### Process / Memory / Electron (25 tools)

| # | Tool | Description |
|---|------|-------------|
| 1 | `process_find` | Find processes by name pattern (returns PIDs, names, paths, window handles) |
| 2 | `process_list` | List all running processes (alias of `process_find` with empty pattern) |
| 3 | `process_get` | Get detailed information about a specific process by PID |
| 4 | `process_windows` | Get all window handles for a process (macOS: 5 s timeout via AppleScript) |
| 5 | `process_find_chromium` | Disabled by design — does not scan user-installed browser processes |
| 6 | `process_check_debug_port` | Check if a process has a debug port enabled for CDP attachment |
| 7 | `process_launch_debug` | Launch an executable with remote debugging port enabled |
| 8 | `process_kill` | Kill a process by PID |
| 9 | `memory_read` | Read process memory at a specific address (Windows/macOS via lldb) |
| 10 | `memory_write` | Write data to process memory at a specific address (Windows/macOS via lldb) |
| 11 | `memory_scan` | Scan process memory for a hex/value pattern (Windows/macOS via lldb) |
| 12 | `memory_check_protection` | Check memory protection flags at an address — readable/writable/executable (Windows/macOS via vmmap) |
| 13 | `memory_protect` | Change memory protection flags at an address (Windows only) |
| 14 | `memory_scan_filtered` | Secondary scan within a filtered address set (Windows only) |
| 15 | `memory_batch_write` | Write multiple memory patches at once (Windows/macOS via lldb) |
| 16 | `memory_dump_region` | Dump a memory region to a binary file for offline analysis (Windows/macOS via lldb) |
| 17 | `memory_list_regions` | List all memory regions with protection flags (Windows/macOS via vmmap) |
| 18 | `inject_dll` | Inject a DLL into a target process via `CreateRemoteThread` + `LoadLibraryA` (Windows only) |
| 19 | `module_inject_dll` | Alias for `inject_dll` |
| 20 | `inject_shellcode` | Inject and execute shellcode in a target process (Windows only) |
| 21 | `module_inject_shellcode` | Alias for `inject_shellcode` |
| 22 | `check_debug_port` | Check if a process is being debugged via `NtQueryInformationProcess` |
| 23 | `enumerate_modules` | List all loaded modules (DLLs) in a process with their base addresses |
| 24 | `module_list` | Alias for `enumerate_modules` |
| 25 | `electron_attach` | Connect to a running Electron app (VS Code, Cursor, etc.) via CDP and inspect/execute JS |

> **Platform notes:**
> - Memory read/write/scan/dump/list work on **Windows** (native API) and **macOS** (lldb + vmmap, requires Xcode CLT).
> - `memory_protect`, `memory_scan_filtered`, and inject tools require Windows and elevated privileges.
> - On Linux and unsupported platforms, memory tools return a clear "not available" message.
> - `process_windows` on macOS uses AppleScript with a 5-second timeout.

## Tool Testing Checklist

See [TOOL_TEST_CHECKLIST.md](./TOOL_TEST_CHECKLIST.md) for full test status.

## License

MIT
