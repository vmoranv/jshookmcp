# jshhookmcp

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-2025--03--26-8A2BE2.svg)](https://modelcontextprotocol.io/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220.svg)](https://pnpm.io/)

English | [中文](./README.zh.md)

An MCP (Model Context Protocol) server providing **175+ tools** for AI-assisted JavaScript reverse engineering. Combines browser automation, Chrome DevTools Protocol debugging, network monitoring, intelligent JavaScript hooks, LLM-powered code analysis, process/memory inspection, and high-level composite workflow orchestration in a single server.

## Features

- **Browser Automation** — Launch Chromium/Camoufox, navigate pages, interact with the DOM, take screenshots, manage cookies and storage
- **CDP Debugger** — Set breakpoints, step through execution, inspect scope variables, watch expressions, session save/restore
- **Network Monitoring** — Capture requests/responses, filter by URL or method, retrieve response bodies, paginated access with `offset+limit`
- **JS Heap Search** — CE (Cheat Engine) equivalent for browser runtime: snapshot the V8 heap and search string values by pattern
- **Auth Extraction** — Automatically scan captured requests for Authorization headers, Bearer/JWT tokens, cookies, and query-string credentials with confidence scoring
- **HAR Export / Request Replay** — Export captured traffic as HAR 1.2; replay any captured request with header/body/method overrides and SSRF-safe execution
- **Tab Workflow** — Multi-tab coordination with named aliases and shared key-value context
- **Composite Workflows** — Single-call orchestration tools (`web_api_capture_session`, `register_account_flow`, `api_probe_batch`, `js_bundle_search`) that chain navigation, DOM actions, network capture, and auth extraction into atomic operations
- **Script Library** — Named reusable JavaScript snippets (`page_script_register` / `page_script_run`) with built-in RE presets
- **Dynamic Profile Boost** — `boost_profile` / `unboost_profile` meta-tools; dynamically load debugger/hooks/analysis tools without restarting; auto-expires after configurable TTL (default 30 min)
- **JavaScript Hooks** — AI-generated hooks for any function, 20+ built-in presets (eval, crypto, atob, WebAssembly, etc.)
- **Code Analysis** — Deobfuscation (JScrambler, JSVMP, packer), crypto algorithm detection, LLM-powered understanding
- **CAPTCHA Handling** — AI vision detection, manual solve flow, configurable polling
- **Stealth Injection** — Anti-detection patches for headless browser fingerprinting
- **Process & Memory** — Cross-platform process enumeration, memory read/write/scan, DLL/shellcode injection (Windows), Electron app attachment
- **Performance** — Smart caching, token budget management, code coverage, progressive tool disclosure with lazy domain initialization
- **Security** — Bearer token auth (`MCP_AUTH_TOKEN`), Origin-based CSRF protection, per-hop SSRF validation, symlink-safe path handling, PowerShell injection prevention

## Architecture

Built on `@modelcontextprotocol/sdk` v1.27+ using the **McpServer high-level API**:

- All tools registered via `server.tool()` — no manual request handlers
- Tool schemas built dynamically from JSON Schema (input validated per-tool by domain handlers)
- **Three tool profiles**: `minimal` (fast startup), `workflow` (end-to-end RE), `full` (all domains)
- **Lazy domain initialization**: handler classes instantiated on first tool invocation, not during init
- **Filtered handler binding**: `createToolHandlerMap` only binds resolvers for selected tools
- Two transport modes: **stdio** (default) and **Streamable HTTP** (MCP 2025-03-26)
- Capabilities: `{ tools: { listChanged: true }, logging: {} }`

## Requirements

- Node.js >= 20
- pnpm

## Installation

### Default (Puppeteer only)

```bash
pnpm install
pnpm build
```

### Full (Puppeteer + Camoufox)

```bash
pnpm run install:full
pnpm build
```

`install:full` includes `pnpm exec camoufox-js fetch`.

### Cache cleanup (optional)

```bash
# Puppeteer browser cache
rm -rf ~/.cache/puppeteer

# Camoufox browser cache
rm -rf ~/.cache/camoufox
```

On Windows, common cache locations are:

- `%USERPROFILE%\.cache\puppeteer`
- `%LOCALAPPDATA%\camoufox`

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
| `PUPPETEER_HEADLESS` | Run browser in headless mode | `false` |
| `PUPPETEER_EXECUTABLE_PATH` | Optional browser executable path | Puppeteer managed |
| `LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) | `info` |
| `MCP_TRANSPORT` | Transport mode: `stdio` or `http` | `stdio` |
| `MCP_PORT` | HTTP port (only when `MCP_TRANSPORT=http`) | `3000` |
| `MCP_HOST` | HTTP bind address | `127.0.0.1` |
| `MCP_TOOL_PROFILE` | Tool profile: `minimal`, `full`, or `workflow` | `minimal` (stdio) / `workflow` (http) |
| `MCP_TOOL_DOMAINS` | Comma-separated domain override | — |
| `MCP_AUTH_TOKEN` | Bearer token for HTTP transport auth | — |
| `MCP_MAX_BODY_BYTES` | HTTP request body size limit (bytes) | `10485760` (10 MB) |
| `MCP_ALLOW_INSECURE` | Allow non-localhost HTTP without auth token | `false` |
| `MCP_SCREENSHOT_DIR` | Screenshot base directory (normalized under project root) | `screenshots/manual` |

### Profiles

| Profile | Domains | Use case |
|---------|---------|----------|
| `minimal` | browser, debugger, network, maintenance | Fast startup for basic automation |
| `workflow` | browser, network, workflow, maintenance, core | End-to-end reverse engineering flows |
| `full` | all domains | Complete toolset including hooks, process, debugger |

> If `MCP_TOOL_DOMAINS` is set, it overrides `MCP_TOOL_PROFILE`.

Examples:

```bash
# Lean local MCP profile
MCP_TOOL_PROFILE=minimal node dist/index.js

# Full reverse-engineering + composite workflow profile
MCP_TOOL_PROFILE=workflow node dist/index.js

# Only keep browser and maintenance tools
MCP_TOOL_DOMAINS=browser,maintenance node dist/index.js

# HTTP mode with auth
MCP_TRANSPORT=http MCP_AUTH_TOKEN=mysecret node dist/index.js
```

## MCP Client Setup

### stdio (default — local MCP clients)

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

```bash
MCP_TRANSPORT=http MCP_PORT=3000 node dist/index.js
```

Connect your MCP client to `http://localhost:3000/mcp`. The server supports:

- `POST /mcp` — send JSON-RPC requests (returns JSON or SSE stream)
- `GET /mcp` — open SSE stream
- `DELETE /mcp` — close session

Session IDs are issued via the `Mcp-Session-Id` response header.

## Tool Domains (175+ Tools)

### Analysis (13 tools)

<details>
<summary>LLM-powered code collection, deobfuscation, crypto detection, webpack/source-map analysis</summary>

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

</details>

### Browser (59 tools)

<details>
<summary>Browser control, DOM interaction, stealth, CAPTCHA, storage, framework tools, JS heap search, tab workflow</summary>

| # | Tool | Description |
|---|------|-------------|
| 1 | `get_detailed_data` | Retrieve large data by `detailId` token (returned when results exceed context limits) |
| 2 | `browser_launch` | Launch browser instance (`chrome` via rebrowser-puppeteer-core, or `camoufox` anti-detect Firefox) |
| 3 | `camoufox_server_launch` | Launch a Camoufox WebSocket server for multi-process / remote connections |
| 4 | `camoufox_server_close` | Close the Camoufox WebSocket server |
| 5 | `camoufox_server_status` | Get Camoufox WebSocket server status |
| 6 | `browser_attach` | Attach to an existing browser via CDP WebSocket URL |
| 7 | `browser_close` | Close the browser instance |
| 8 | `browser_status` | Get browser status (running, page count, version) |
| 9 | `browser_list_tabs` | List all open tabs/pages |
| 10 | `browser_select_tab` | Switch active tab by index or URL/title pattern |
| 11 | `page_navigate` | Navigate to a URL with auto CAPTCHA detection and optional network monitoring |
| 12 | `page_reload` | Reload current page |
| 13 | `page_back` | Navigate back in history |
| 14 | `page_forward` | Navigate forward in history |
| 15 | `dom_query_selector` | Query a single DOM element |
| 16 | `dom_query_all` | Query all matching DOM elements |
| 17 | `dom_get_structure` | Get page DOM structure; large DOM auto-returns summary + `detailId` |
| 18 | `dom_find_clickable` | Find all clickable elements (buttons, links) |
| 19 | `dom_get_computed_style` | Get computed CSS styles of an element |
| 20 | `dom_find_by_text` | Find elements by text content |
| 21 | `dom_get_xpath` | Get XPath for an element |
| 22 | `dom_is_in_viewport` | Check if an element is visible in the viewport |
| 23 | `page_click` | Click an element |
| 24 | `page_type` | Type text into an input element |
| 25 | `page_select` | Select option(s) in a `<select>` element |
| 26 | `page_hover` | Hover over an element |
| 27 | `page_scroll` | Scroll the page |
| 28 | `page_press_key` | Press a keyboard key |
| 29 | `page_wait_for_selector` | Wait for an element to appear in the DOM |
| 30 | `page_evaluate` | Execute JavaScript in page context; large results return summary + `detailId` |
| 31 | `page_screenshot` | Take a screenshot of the current page |
| 32 | `page_get_performance` | Get page performance metrics |
| 33 | `page_inject_script` | Inject JavaScript code into the page |
| 34 | `page_set_cookies` | Set cookies for the page |
| 35 | `page_get_cookies` | Get all cookies for the page |
| 36 | `page_clear_cookies` | Clear all cookies |
| 37 | `page_set_viewport` | Set viewport size |
| 38 | `page_emulate_device` | Emulate a mobile device (iPhone, iPad, Android) |
| 39 | `page_get_local_storage` | Get all `localStorage` items |
| 40 | `page_set_local_storage` | Set a `localStorage` item |
| 41 | `page_get_all_links` | Get all links on the page |
| 42 | `get_all_scripts` | Get list of all loaded script URLs (with `maxScripts` cap to prevent OOM) |
| 43 | `get_script_source` | Get script source code; large scripts return summary + `detailId` |
| 44 | `console_enable` | Enable console monitoring |
| 45 | `console_get_logs` | Get captured console logs |
| 46 | `console_execute` | Execute JavaScript in the console context |
| 47 | `captcha_detect` | Detect CAPTCHA on the current page using AI vision |
| 48 | `captcha_wait` | Wait for manual CAPTCHA solve |
| 49 | `captcha_config` | Configure CAPTCHA detection behaviour |
| 50 | `stealth_inject` | Inject stealth scripts to bypass bot detection |
| 51 | `stealth_set_user_agent` | Set a realistic User-Agent and browser fingerprint |
| 52 | `framework_state_extract` | Extract React/Vue component state from the live page |
| 53 | `indexeddb_dump` | Dump all IndexedDB databases |
| 54 | `js_heap_search` | Search the live V8 JS heap for strings matching a pattern (CE-equivalent for browser) |
| 55 | `tab_workflow` | Multi-tab coordination with alias binding, cross-tab navigation, and KV context |

> Additional browser tools (viewport presets, device catalog, etc.) are registered dynamically.

</details>

### Debugger (39 tools)

<details>
<summary>CDP debugger control, breakpoints, watches, XHR/event breakpoints, session persistence</summary>

| # | Tool | Description |
|---|------|-------------|
| 1 | `debugger_enable` | Enable the CDP debugger |
| 2 | `debugger_disable` | Disable the debugger and clear all breakpoints |
| 3 | `debugger_pause` | Pause execution at the next statement |
| 4 | `debugger_resume` | Resume execution |
| 5 | `debugger_step_into` | Step into the next function call |
| 6 | `debugger_step_over` | Step over the next function call |
| 7 | `debugger_step_out` | Step out of the current function |
| 8 | `debugger_wait_for_paused` | Wait for the debugger to pause |
| 9 | `debugger_get_paused_state` | Get the current paused state |
| 10 | `debugger_evaluate` | Evaluate an expression in the current call frame |
| 11 | `debugger_evaluate_global` | Evaluate an expression in the global context |
| 12 | `debugger_save_session` | Save the current debugging session to a JSON file |
| 13 | `debugger_load_session` | Load a previously saved debugging session |
| 14 | `debugger_export_session` | Export the current session as JSON for sharing |
| 15 | `debugger_list_sessions` | List all saved debugging sessions |
| 16 | `breakpoint_set` | Set a breakpoint (URL-based or scriptId-based, with optional condition) |
| 17 | `breakpoint_remove` | Remove a breakpoint by ID |
| 18 | `breakpoint_list` | List all active breakpoints |
| 19 | `breakpoint_set_on_exception` | Pause on exceptions — all or uncaught only |
| 20 | `get_call_stack` | Get the current call stack (when paused) |
| 21 | `get_object_properties` | Get all properties of an object by `objectId` |
| 22 | `get_scope_variables_enhanced` | Enhanced scope variable inspection with deep object traversal |
| 23 | `watch_add` | Add a watch expression |
| 24 | `watch_remove` | Remove a watch expression |
| 25 | `watch_list` | List all watch expressions |
| 26 | `watch_evaluate_all` | Evaluate all enabled watch expressions |
| 27 | `watch_clear_all` | Clear all watch expressions |
| 28 | `xhr_breakpoint_set` | Set an XHR/Fetch breakpoint |
| 29 | `xhr_breakpoint_remove` | Remove an XHR breakpoint |
| 30 | `xhr_breakpoint_list` | List all XHR breakpoints |
| 31 | `event_breakpoint_set` | Set an event listener breakpoint |
| 32 | `event_breakpoint_set_category` | Set breakpoints for an entire event category |
| 33 | `event_breakpoint_remove` | Remove an event breakpoint |
| 34 | `event_breakpoint_list` | List all event breakpoints |
| 35 | `blackbox_add` | Blackbox scripts by URL pattern |
| 36 | `blackbox_add_common` | Blackbox all common libraries at once |
| 37 | `blackbox_list` | List all blackboxed URL patterns |

> Additional debugger tools for advanced stepping and conditional evaluation are available in the `full` profile.

</details>

### Network (20 tools)

<details>
<summary>CDP network monitoring, auth extraction, HAR export, request replay, console injection</summary>

| # | Tool | Description |
|---|------|-------------|
| 1 | `network_enable` | Enable network request monitoring |
| 2 | `network_disable` | Disable network request monitoring |
| 3 | `network_get_status` | Get network monitoring status |
| 4 | `network_get_requests` | Get captured requests with `offset+limit` pagination; case-insensitive URL filter; `urlSamples` on empty results |
| 5 | `network_get_response_body` | Get response body for a specific request |
| 6 | `network_get_stats` | Get network statistics |
| 7 | `network_extract_auth` | Scan all captured requests for auth credentials with confidence scoring |
| 8 | `network_export_har` | Export captured traffic as HAR 1.2 |
| 9 | `network_replay_request` | Replay a captured request with overrides; SSRF-protected with per-hop DNS validation |
| 10 | `performance_get_metrics` | Get page Web Vitals |
| 11 | `performance_start_coverage` | Start JS/CSS code coverage recording |
| 12 | `performance_stop_coverage` | Stop coverage recording and return report |
| 13 | `performance_take_heap_snapshot` | Take a V8 heap memory snapshot |
| 14 | `console_get_exceptions` | Get captured uncaught exceptions |
| 15 | `console_inject_script_monitor` | Inject a monitor for dynamically created `<script>` elements |
| 16 | `console_inject_xhr_interceptor` | Inject an XHR interceptor for AJAX request/response capture |
| 17 | `console_inject_fetch_interceptor` | Inject a Fetch API interceptor; auto-persists URLs to `localStorage.__capturedAPIs` |
| 18 | `console_clear_injected_buffers` | Clear injected in-page buffers |
| 19 | `console_reset_injected_interceptors` | Reset injected interceptors for clean reinjection |
| 20 | `console_inject_function_tracer` | Inject a Proxy-based function tracer |

</details>

### Workflow / Composite (8 tools)

<details>
<summary>High-level orchestration for full-chain reverse engineering tasks</summary>

| # | Tool | Description |
|---|------|-------------|
| 1 | `web_api_capture_session` | Navigate + actions + collect requests + extract auth + export HAR — all in one call |
| 2 | `register_account_flow` | Automate registration form: fill, submit, collect tokens, optionally verify via email tab |
| 3 | `api_probe_batch` | Probe multiple API endpoints in one browser-context fetch burst with auto Bearer injection |
| 4 | `js_bundle_search` | Server-side fetch + cache of remote JS bundle; multi-regex search with noise filtering |
| 5 | `page_script_register` | Register a named reusable JavaScript snippet in the session-local Script Library |
| 6 | `page_script_run` | Execute a named script from the Script Library with runtime `__params__` injection |
| 7 | `boost_profile` | *(meta-tool)* Dynamically load tools from a higher-capability profile; TTL auto-expires (default 30 min) |
| 8 | `unboost_profile` | *(meta-tool)* Remove boost-added tools and revert to base profile |

**Built-in Script Library presets** (usable via `page_script_run` without registering):
`auth_extract`, `bundle_search`, `react_fill_form`, `dom_find_upgrade_buttons`

</details>

### Hooks (8 tools)

<details>
<summary>AI-generated JavaScript hooks and 20+ built-in presets</summary>

| # | Tool | Description |
|---|------|-------------|
| 1 | `ai_hook_generate` | Generate hook code for a function, API, or object method |
| 2 | `ai_hook_inject` | Inject a generated hook into the page |
| 3 | `ai_hook_get_data` | Retrieve captured data from an active hook |
| 4 | `ai_hook_list` | List all active hooks |
| 5 | `ai_hook_clear` | Remove one or all hooks |
| 6 | `ai_hook_toggle` | Enable or disable a hook |
| 7 | `ai_hook_export` | Export captured hook data (JSON/CSV) |
| 8 | `hook_preset` | Install a pre-built hook from 20+ presets |

**Built-in presets:** `eval`, `function-constructor`, `atob-btoa`, `crypto-subtle`, `json-stringify`, `object-defineproperty`, `settimeout`, `setinterval`, `addeventlistener`, `postmessage`, `webassembly`, `proxy`, `reflect`, `history-pushstate`, `location-href`, `navigator-useragent`, `eventsource`, `window-open`, `mutationobserver`, `formdata`

</details>

### Maintenance (6 tools)

<details>
<summary>Token budget tracking and cache management</summary>

| # | Tool | Description |
|---|------|-------------|
| 1 | `get_token_budget_stats` | Get token budget usage statistics |
| 2 | `manual_token_cleanup` | Manually trigger token budget cleanup |
| 3 | `reset_token_budget` | Reset all token budget counters |
| 4 | `get_cache_stats` | Get cache statistics for all internal caches |
| 5 | `smart_cache_cleanup` | Intelligently clean caches, preserving hot data |
| 6 | `clear_all_caches` | Clear all internal caches |

</details>

### Process / Memory / Electron (26 tools)

<details>
<summary>Process enumeration, memory operations, DLL/shellcode injection, Electron attachment</summary>

| # | Tool | Description |
|---|------|-------------|
| 1 | `process_find` | Find processes by name pattern |
| 2 | `process_list` | List all running processes |
| 3 | `process_get` | Get detailed info about a specific process |
| 4 | `process_windows` | Get all window handles for a process |
| 5 | `process_find_chromium` | Find Chromium-based browser processes |
| 6 | `process_check_debug_port` | Check if a process has a debug port enabled |
| 7 | `process_launch_debug` | Launch an executable with remote debugging port |
| 8 | `process_kill` | Kill a process by PID |
| 9 | `memory_read` | Read process memory at a specific address |
| 10 | `memory_write` | Write data to process memory |
| 11 | `memory_scan` | Scan process memory for a hex/value pattern |
| 12 | `memory_check_protection` | Check memory protection flags (R/W/X) |
| 13 | `memory_protect` | Change memory protection flags (Windows only) |
| 14 | `memory_scan_filtered` | Secondary scan within a filtered address set |
| 15 | `memory_batch_write` | Write multiple memory patches at once |
| 16 | `memory_dump_region` | Dump a memory region to binary file |
| 17 | `memory_list_regions` | List all memory regions with protection flags |
| 18 | `inject_dll` | Inject a DLL into a target process (Windows only) |
| 19 | `module_inject_dll` | Alias for `inject_dll` |
| 20 | `inject_shellcode` | Inject and execute shellcode (Windows only) |
| 21 | `module_inject_shellcode` | Alias for `inject_shellcode` |
| 22 | `check_debug_port` | Check if a process is being debugged |
| 23 | `enumerate_modules` | List all loaded modules (DLLs) with base addresses |
| 24 | `module_list` | Alias for `enumerate_modules` |
| 25 | `electron_attach` | Connect to a running Electron app via CDP |

> **Platform notes:** Memory read/write/scan/dump work on **Windows** (native API) and **macOS** (lldb + vmmap). Injection tools require Windows with elevated privileges.

</details>

## Generated Artifacts & Cleanup

| Artifact | Default location | Created by |
|----------|-----------------|------------|
| HAR traffic dumps | `./jshhook-capture-<timestamp>.har` | `web_api_capture_session`, `network_export_har` |
| Screenshots | `screenshots/manual/` | `page_screenshot` |
| CAPTCHA screenshots | `screenshots/` | `page_navigate` CAPTCHA detection |
| Debug sessions | `sessions/` | `debugger_save_session` / `debugger_export_session` |

All paths are in `.gitignore`.

```bash
# One-liner cleanup
rm -f *.har && rm -rf screenshots/ sessions/
```

## Security

- **Authentication**: Set `MCP_AUTH_TOKEN` to require Bearer token for HTTP transport
- **CSRF Protection**: Origin validation blocks cross-origin browser requests without auth
- **SSRF Defense**: `network_replay_request` and `safeFetch` use per-hop DNS pinning with `redirect: 'manual'`
- **Path Traversal**: HAR export and debugger sessions validate paths with `fs.realpath` and symlink detection
- **Injection Prevention**: All PowerShell-based operations use `execFile` with input sanitization

## License

MIT
