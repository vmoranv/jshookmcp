# @jshookmcp/jshook

[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-red.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-current-8A2BE2.svg)](https://modelcontextprotocol.io/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220.svg)](https://pnpm.io/)

English | [中文](./README.zh.md)

An MCP (Model Context Protocol) server providing **245 built-in tools** — **238 domain tools across 16 domains** plus **8 built-in meta-tools** — with runtime extension loading from `plugins/` and `workflows/` for AI-assisted JavaScript analysis and security analysis. Combines browser automation, Chrome DevTools Protocol debugging, network monitoring, intelligent JavaScript hooks, LLM-powered code analysis, process/memory inspection, WASM toolchain, binary encoding, anti-anti-debug, GraphQL discovery, source map reconstruction, AST transforms, crypto reconstruction, platform package analysis, Burp Suite / native analysis tool bridges, human behavior simulation, CAPTCHA solving, batch account workflows, and high-level composite workflow orchestration in a single server.

## Start Here

- **Documentation**: <https://vmoranv.github.io/jshookmcp/>

## Features

<details>
<summary>Open the full feature list</summary>

- **Browser Automation** — Launch Chromium/Camoufox, navigate pages, interact with the DOM, take screenshots, manage cookies and storage
- **CDP Debugger** — Set breakpoints, step through execution, inspect scope variables, watch expressions, session save/restore
- **Network Monitoring** — Capture requests/responses, filter by URL or method, retrieve response bodies, paginated access with `offset+limit`
- **Performance Tracing** — Chrome Performance Trace recording, CPU profiling, heap allocation sampling via CDP Tracing/Profiler domains
- **JS Heap Search** — CE (Cheat Engine) equivalent for browser runtime: snapshot the V8 heap and search string values by pattern
- **Auth Extraction** — Automatically scan captured requests for Authorization headers, Bearer/JWT tokens, cookies, and query-string credentials with confidence scoring
- **HAR Export / Request Replay** — Export captured traffic as HAR 1.2; replay any captured request with header/body/method overrides and SSRF-safe execution
- **Tab Workflow** — Multi-tab coordination with named aliases and shared key-value context
- **Composite Workflows** — Single-call orchestration tools (`web_api_capture_session`, `register_account_flow`, `api_probe_batch`, `js_bundle_search`) that chain navigation, DOM actions, network capture, and auth extraction into atomic operations
- **Script Library** — Named reusable JavaScript snippets (`page_script_register` / `page_script_run`) with built-in analysis presets
- **Progressive Tool Discovery** — BM25-based `search_tools` meta-tool searches built-in + currently loaded extension tools by keyword (total is dynamic); `activate_tools` / `deactivate_tools` for individual tools; `activate_domain` for bulk domain activation; `boost_profile` / `unboost_profile` for tier-level upgrades with auto-expiring TTL
- **JavaScript Hooks** — AI-generated hooks for any function, 20+ built-in presets (eval, crypto, atob, WebAssembly, etc.) plus inline custom preset templates for team-specific hook bodies
- **Code Analysis** — Deobfuscation (JScrambler, JSVMP, packer), crypto algorithm detection, LLM-powered understanding
- **WASM Toolchain** — Dump, disassemble, decompile, inspect, optimize, and offline-run WebAssembly modules via wabt/binaryen/wasmtime
- **WebSocket & SSE Monitoring** — Real-time frame capture, connection tracking, and SSE event interception
- **Binary Encoding** — Format detection, entropy analysis, Protobuf raw decode, MessagePack decode, base64/hex/URL encode/decode
- **Anti-Anti-Debug** — Bypass debugger statements, timing checks, stack trace detection, console-based devtools detection
- **GraphQL** — Introspection, query extraction from network traces, operation replay
- **Call Graph Analysis** — Runtime function call graph from in-page tracer records
- **Script Replacement** — Persistent script response interception via CDP request interception
- **Source Map** — Auto-discovery, VLQ decoding (pure TS, no npm dependency), project tree reconstruction
- **Chrome Extension** — List installed extensions, execute code in extension background contexts
- **AST Transforms** — Constant folding, string decryption, dead code removal, control flow flattening, variable renaming (pure regex, no babel)
- **Crypto Reconstruction** — Extract standalone crypto functions, worker-thread sandbox testing, implementation comparison
- **Platform Tools** — Miniapp package scanning/unpacking/analysis, Electron ASAR extraction, Electron app inspection
- **External Tool Bridges** — Frida script generation and Jadx decompilation integration (link-only, user installs externally)
- **CAPTCHA Handling** — AI vision detection, manual solve flow, configurable polling, external solver integration, widget challenge solving (hook / manual / API), per-service API key isolation
- **Human Behavior Simulation** — Bezier-curve mouse movement, natural scrolling with deceleration, realistic typing with typo simulation; all parameters runtime-clamped for safety
- **Burp Suite Bridge** — Proxy status, intercept-and-replay, HAR import/diff, send-to-repeater; SSRF-protected loopback-only endpoints
- **Native Analysis Tool Bridge** — Ghidra and IDA Pro bridge: decompile functions, list symbols, run scripts, cross-reference analysis; loopback-only SSRF protection
- **Batch Account Registration** — Orchestrate multi-account registration with per-account retry, capped exponential backoff, idempotent key deduplication, PII masking, timeout cleanup
- **Stealth Injection** — Anti-detection patches for headless browser fingerprinting
- **Process & Memory** — Cross-platform process enumeration, memory read/write/scan with structured diagnostics, in-memory audit export, controlled DLL/shellcode injection (Windows, disabled by default), Electron app attachment
- **Performance** — Smart caching, token budget management, code coverage, progressive tool disclosure with lazy domain initialization, BM25 search-based discovery (~800 tokens init for search profile vs ~18K for full)
- **B-Skeleton Contracts** — Extensibility contracts for plugins (`PluginContract` with lifecycle state machine), workflows (`WorkflowContract` with declarative DAG builder), and observability (`InstrumentationContract` with noop default + OTLP-ready span/metric interface)
- **Domain Self-Discovery** — Runtime manifest scanning (`domains/*/manifest.ts`) replaces hardcoded imports; add new tool domains by creating a single `manifest.ts` file — no manual wiring needed
- **Security** — Bearer token auth (`MCP_AUTH_TOKEN`), Origin-based CSRF protection, per-hop SSRF validation, symlink-safe path handling, PowerShell injection prevention

</details>

## Architecture

<details>
<summary>Open architecture notes</summary>

Built on `@modelcontextprotocol/sdk` v1.27+ using the **McpServer high-level API**:

- All tools registered via `server.registerTool()` — no manual request handlers
- Tool schemas built dynamically from JSON Schema (input validated per-tool by domain handlers)
- **Four tool profiles**: `search` (BM25 discovery), `minimal` (fast startup), `workflow` (end-to-end JavaScript and security analysis), `full` (all domains)
- **Progressive discovery**: `search` profile exposes 12 maintenance-domain tools + 8 built-in meta-tools; `search_tools` covers built-ins plus loaded plugins/workflows, and workflow/full-tier sessions boost workflow-domain results
- **Domain self-discovery**: at startup the registry scans `domains/*/manifest.ts` via dynamic ESM import — new domains are auto-detected without modifying any central file
- **DomainManifest contract**: each domain exports a standardized manifest (`kind`, `version`, `domain`, `depKey`, `profiles`, `registrations`, `ensure`) — profile membership, tool definitions, and handler factories all co-located in one file
- **Lazy domain initialization**: handler classes instantiated on first tool invocation via Proxy, not during init
- **Filtered handler binding**: `createToolHandlerMap` only binds resolvers for selected tools
- Two transport modes: **stdio** (default) and **Streamable HTTP** (MCP current revision)
- Capabilities: `{ tools: { listChanged: true }, logging: {} }`

</details>

## Requirements

- Node.js >= 20
- npm (for global installation)
- pnpm (only if you want to build from source)

## Installation

### Recommended: Run with npx

```bash
npx @jshookmcp/jshook
```

This is the recommended way to use the package if you just want to run the MCP server without managing a global install.

Notes:

- This is a **stdio MCP server**, not a GUI application. It is normal that running it directly in a terminal does not open a window.
- The process stays attached to the current terminal and waits for an MCP client to complete the stdin/stdout handshake.
- If your MCP client launches the server through `npx`, add `-y` explicitly so the client does not get stuck on the first-install confirmation prompt.

### Optional: Global install

```bash
npm install -g @jshookmcp/jshook
```

This installs the `jshook` and `jshookmcp` commands globally, but `npx` is preferred for most users.

### From source (development / local hacking)

```bash
pnpm install
pnpm build
pnpm run doctor
```

### From source with Camoufox

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

See the dedicated docs chapter for configuration details: `docs/guide/configuration.md:1`

If you are running from source, copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

If you installed the package globally, you can provide the same settings through your shell environment or your MCP client configuration.

Key variables from `.env.example`:

| Variable                        | Description                                                                           | Default / Example                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `DEFAULT_LLM_PROVIDER`          | Active LLM provider: `openai` or `anthropic`                                          | `openai`                                                                       |
| `OPENAI_API_KEY`                | OpenAI-compatible API key                                                             | —                                                                              |
| `OPENAI_MODEL`                  | OpenAI-compatible model name                                                          | `gpt-4-turbo-preview`                                                          |
| `OPENAI_BASE_URL`               | OpenAI-compatible base URL                                                            | `https://api.openai.com/v1`                                                    |
| `ANTHROPIC_API_KEY`             | Anthropic API key                                                                     | —                                                                              |
| `ANTHROPIC_MODEL`               | Anthropic model name                                                                  | `claude-3-5-sonnet-20241022`                                                   |
| `PUPPETEER_HEADLESS`            | Run the browser in headless mode                                                      | `true` in `.env.example`                                                       |
| `PUPPETEER_TIMEOUT`             | Default Puppeteer timeout in milliseconds                                             | `30000`                                                                        |
| `PUPPETEER_EXECUTABLE_PATH`     | Optional explicit browser executable path                                             | commented example                                                              |
| `MCP_SERVER_NAME`               | Server name advertised by the process                                                 | `jshookmcp`                                                                    |
| `MCP_SERVER_VERSION`            | Server version advertised by the process                                              | `0.1.0` in `.env.example`                                                      |
| `MCP_TOOL_PROFILE`              | Tool profile: `search`, `minimal`, `workflow`, or `full`                              | commented example: `minimal`                                                   |
| `MCP_TOOL_DOMAINS`              | Comma-separated domain override; takes precedence over `MCP_TOOL_PROFILE`             | commented example                                                              |
| `LOG_LEVEL`                     | Logging verbosity (`debug`, `info`, `warn`, `error`)                                  | `info`                                                                         |
| `ENABLE_CACHE`                  | Enable disk-backed caching                                                            | `true`                                                                         |
| `CACHE_DIR`                     | Cache directory                                                                       | `.cache`                                                                       |
| `CACHE_TTL`                     | Cache TTL in seconds                                                                  | `3600`                                                                         |
| `MAX_CONCURRENT_ANALYSIS`       | Max concurrent analysis jobs                                                          | `3`                                                                            |
| `MAX_CODE_SIZE_MB`              | Max code payload size for analysis                                                    | `10`                                                                           |
| `CAPTCHA_SCREENSHOT_DIR`        | Fallback CAPTCHA screenshot directory                                                 | `./screenshots`                                                                |
| `MCP_SCREENSHOT_DIR`            | Screenshot output root constrained inside project root                                | commented example: `./screenshots/manual`                                      |
| `MCP_PLUGIN_ROOTS`              | Comma-separated plugin roots                                                          | commented example: `./plugins,./dist/plugins`                                  |
| `MCP_WORKFLOW_ROOTS`            | Comma-separated workflow roots                                                        | commented example: `./workflows`                                               |
| `MCP_DEFAULT_PLUGIN_BOOST_TIER` | Default tier for plugin auto-registration during boost                                | commented example: `full`                                                      |
| `BURP_MCP_SSE_URL`              | Burp SSE bridge URL                                                                   | commented example                                                              |
| `BURP_MCP_AUTH_TOKEN`           | Optional Burp SSE auth token                                                          | commented example                                                              |
| `ZAP_API_URL`                   | OWASP ZAP REST endpoint                                                               | commented example                                                              |
| `ZAP_API_KEY`                   | OWASP ZAP API key                                                                     | commented example                                                              |
| `GHIDRA_BRIDGE_URL`             | Ghidra bridge endpoint                                                                | commented example: `http://127.0.0.1:18080`                                    |
| `IDA_BRIDGE_URL`                | IDA bridge endpoint                                                                   | commented example: `http://127.0.0.1:18081`                                    |
| `EXTENSION_REGISTRY_BASE_URL`   | Extension registry base URL used by `browse_extension_registry` / `install_extension` | `https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry` |

Additional runtime options exist in code but are not enabled by default in `.env.example`, such as `MCP_PORT`, `MCP_HOST`, `MCP_AUTH_TOKEN`, `MCP_MAX_BODY_BYTES`, and `MCP_ALLOW_INSECURE`.

### Profiles

| Profile    | Domains                                                                               | Tools                     | Init Tokens | vs Full |
| ---------- | ------------------------------------------------------------------------------------- | ------------------------- | ----------- | ------- |
| `search`   | maintenance                                                                           | 20 (12 domain + 8 meta)   | ~3,440      | 8%      |
| `minimal`  | browser, maintenance                                                                  | 80 (72 domain + 8 meta)   | ~13,760     | 33%     |
| `workflow` | browser, network, workflow, maintenance, core, debugger, streaming, encoding, graphql | 181 (173 domain + 8 meta) | ~31,132     | 74%     |
| `full`     | all 16 domains                                                                        | 245 (238 domain + 8 meta) | ~42,140     | 100%    |

> Token counts are rough estimates derived from the previous `claude /doctor` average of ~172 tokens/tool. All profiles include 8 meta-tools: `search_tools`, `activate_tools`, `deactivate_tools`, `activate_domain`, `boost_profile`, `unboost_profile`, `extensions_list`, `extensions_reload`.

> If `MCP_TOOL_DOMAINS` is set, it overrides `MCP_TOOL_PROFILE`.

Examples:

```bash
# Search-based progressive discovery (recommended for context-constrained LLMs)
MCP_TOOL_PROFILE=search jshook

# Lean local MCP profile
MCP_TOOL_PROFILE=minimal jshook

# Full JavaScript analysis + composite workflow profile
MCP_TOOL_PROFILE=workflow jshook

# Only keep browser and maintenance tools
MCP_TOOL_DOMAINS=browser,maintenance jshook

# HTTP mode with auth
MCP_TRANSPORT=http MCP_AUTH_TOKEN=mysecret jshook
```

## MCP Client Setup

### stdio (default — local MCP clients)

```json
{
  "mcpServers": {
    "jshook": {
      "command": "jshook",
      "env": {
        "OPENAI_API_KEY": "your-key"
      }
    }
  }
}
```

Set `OPENAI_MODEL` or `OPENAI_BASE_URL` only if you need to override the defaults. If you plan to use image-heavy tools (for example CAPTCHA vision workflows), choose a vision-capable model explicitly rather than treating it as the default for every installation.

If you prefer to let the client launch the server via `npx` instead of a global binary, use:

```json
{
  "mcpServers": {
    "jshook": {
      "command": "npx",
      "args": ["-y", "@jshookmcp/jshook"],
      "env": {
        "OPENAI_API_KEY": "your-key"
      }
    }
  }
}
```

The `-y` flag matters: without it, `npx` may wait for an interactive install confirmation, and many MCP clients cannot answer that prompt. The result usually looks like a handshake failure or startup timeout.

### Streamable HTTP (remote / MCP current revision)

```bash
MCP_TRANSPORT=http MCP_PORT=3000 jshook
```

Connect your MCP client to `http://localhost:3000/mcp`. The server supports:

- `POST /mcp` — send JSON-RPC requests (returns JSON or SSE stream)
- `GET /mcp` — open SSE stream
- `DELETE /mcp` — close session

Session IDs are issued via the `Mcp-Session-Id` response header.

## Tool Domains

### Core / Analysis

<details>
<summary>LLM-powered code collection, deobfuscation, crypto detection, webpack/source-map analysis</summary>

| #   | Tool                    | Description                                                                                   |
| --- | ----------------------- | --------------------------------------------------------------------------------------------- |
| 1   | `collect_code`          | Collect JavaScript code from a target website (summary / priority / incremental / full modes) |
| 2   | `search_in_scripts`     | Search collected scripts by keyword or regex pattern                                          |
| 3   | `extract_function_tree` | Extract a function and its full dependency tree from collected scripts                        |
| 4   | `deobfuscate`           | Webcrack-powered JavaScript deobfuscation with bundle unpacking support                       |
| 5   | `understand_code`       | Semantic code analysis for structure, behaviour, and risks                                    |
| 6   | `detect_crypto`         | Detect cryptographic algorithms and usage patterns in source code                             |
| 7   | `manage_hooks`          | Create, inspect, and clear JavaScript runtime hooks                                           |
| 8   | `detect_obfuscation`    | Detect obfuscation techniques in JavaScript source                                            |
| 9   | `advanced_deobfuscate`  | Advanced deobfuscation with webcrack backend (deprecated legacy flags ignored)                |
| 10  | `webcrack_unpack`       | Direct webcrack bundle unpacking returning module graph details                               |
| 11  | `clear_collected_data`  | Clear collected script data, caches, and in-memory indexes                                    |
| 12  | `get_collection_stats`  | Get collection, cache, and compression statistics                                             |
| 13  | `webpack_enumerate`     | Enumerate all webpack modules in the current page; optionally search for keywords             |
| 14  | `source_map_extract`    | Find and parse JavaScript source maps to recover original source code                         |

</details>

### Browser

<details>
<summary>Browser control, DOM interaction, stealth, CAPTCHA solving, human behavior simulation, storage, framework tools, JS heap search, tab workflow</summary>

| #   | Tool                      | Description                                                                                                   |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `get_detailed_data`       | Retrieve large data by `detailId` token (returned when results exceed context limits)                         |
| 2   | `browser_launch`          | Launch browser instance (`chrome` via rebrowser-puppeteer-core, or `camoufox` anti-detect Firefox)            |
| 3   | `camoufox_server_launch`  | Launch a Camoufox WebSocket server for multi-process / remote connections                                     |
| 4   | `camoufox_server_close`   | Close the Camoufox WebSocket server                                                                           |
| 5   | `camoufox_server_status`  | Get Camoufox WebSocket server status                                                                          |
| 6   | `browser_attach`          | Attach to an existing browser via CDP WebSocket URL                                                           |
| 7   | `browser_close`           | Close the browser instance                                                                                    |
| 8   | `browser_status`          | Get browser status (running, page count, version)                                                             |
| 9   | `browser_list_tabs`       | List all open tabs/pages                                                                                      |
| 10  | `browser_select_tab`      | Switch active tab by index or URL/title pattern                                                               |
| 11  | `page_navigate`           | Navigate to a URL with auto CAPTCHA detection and optional network monitoring                                 |
| 12  | `page_reload`             | Reload current page                                                                                           |
| 13  | `page_back`               | Navigate back in history                                                                                      |
| 14  | `page_forward`            | Navigate forward in history                                                                                   |
| 15  | `dom_query_selector`      | Query a single DOM element                                                                                    |
| 16  | `dom_query_all`           | Query all matching DOM elements                                                                               |
| 17  | `dom_get_structure`       | Get page DOM structure; large DOM auto-returns summary + `detailId`                                           |
| 18  | `dom_find_clickable`      | Find all clickable elements (buttons, links)                                                                  |
| 19  | `dom_get_computed_style`  | Get computed CSS styles of an element                                                                         |
| 20  | `dom_find_by_text`        | Find elements by text content                                                                                 |
| 21  | `dom_get_xpath`           | Get XPath for an element                                                                                      |
| 22  | `dom_is_in_viewport`      | Check if an element is visible in the viewport                                                                |
| 23  | `page_click`              | Click an element                                                                                              |
| 24  | `page_type`               | Type text into an input element                                                                               |
| 25  | `page_select`             | Select option(s) in a `<select>` element                                                                      |
| 26  | `page_hover`              | Hover over an element                                                                                         |
| 27  | `page_scroll`             | Scroll the page                                                                                               |
| 28  | `page_press_key`          | Press a keyboard key                                                                                          |
| 29  | `page_wait_for_selector`  | Wait for an element to appear in the DOM                                                                      |
| 30  | `page_evaluate`           | Execute JavaScript in page context; large results return summary + `detailId`                                 |
| 31  | `page_screenshot`         | Take a screenshot of the current page                                                                         |
| 32  | `page_get_performance`    | Get page performance metrics                                                                                  |
| 33  | `page_inject_script`      | Inject JavaScript code into the page                                                                          |
| 34  | `page_set_cookies`        | Set cookies for the page                                                                                      |
| 35  | `page_get_cookies`        | Get all cookies for the page                                                                                  |
| 36  | `page_clear_cookies`      | Clear all cookies                                                                                             |
| 37  | `page_set_viewport`       | Set viewport size                                                                                             |
| 38  | `page_emulate_device`     | Emulate a mobile device (iPhone, iPad, Android)                                                               |
| 39  | `page_get_local_storage`  | Get all `localStorage` items                                                                                  |
| 40  | `page_set_local_storage`  | Set a `localStorage` item                                                                                     |
| 41  | `page_get_all_links`      | Get all links on the page                                                                                     |
| 42  | `get_all_scripts`         | Get list of all loaded script URLs (with `maxScripts` cap)                                                    |
| 43  | `get_script_source`       | Get script source code; large scripts return summary + `detailId`                                             |
| 44  | `console_enable`          | Enable console monitoring                                                                                     |
| 45  | `console_get_logs`        | Get captured console logs                                                                                     |
| 46  | `console_execute`         | Execute JavaScript in the console context                                                                     |
| 47  | `captcha_detect`          | Detect CAPTCHA on the current page using AI vision                                                            |
| 48  | `captcha_wait`            | Wait for manual CAPTCHA solve                                                                                 |
| 49  | `captcha_config`          | Configure CAPTCHA detection behaviour                                                                         |
| 50  | `stealth_inject`          | Inject stealth scripts to bypass bot detection                                                                |
| 51  | `stealth_set_user_agent`  | Set a realistic User-Agent and browser fingerprint                                                            |
| 52  | `framework_state_extract` | Extract React/Vue component state from the live page                                                          |
| 53  | `indexeddb_dump`          | Dump all IndexedDB databases                                                                                  |
| 54  | `js_heap_search`          | Search the live V8 JS heap for strings matching a pattern (CE-equivalent for browser)                         |
| 55  | `tab_workflow`            | Multi-tab coordination with alias binding, cross-tab navigation, and KV context                               |
| 56  | `human_mouse`             | Bezier-curve mouse movement with jitter, easing, and optional click — mimics real human motion                |
| 57  | `human_scroll`            | Natural scrolling with segment deceleration, jitter, and direction control                                    |
| 58  | `human_typing`            | Realistic typing with per-character delay variance, typo simulation, and WPM-based pacing                     |
| 59  | `captcha_vision_solve`    | Solve image or widget challenges via external service or manual mode with auto-detection                      |
| 60  | `widget_challenge_solve`  | Solve embedded widget challenges via hook interception, external service, or manual mode with token injection |

</details>

### Debugger

<details>
<summary>CDP debugger control, breakpoints, watches, XHR/event breakpoints, session persistence, blackboxing</summary>

| #   | Tool                            | Description                                                             |
| --- | ------------------------------- | ----------------------------------------------------------------------- |
| 1   | `debugger_enable`               | Enable the CDP debugger                                                 |
| 2   | `debugger_disable`              | Disable the debugger and clear all breakpoints                          |
| 3   | `debugger_pause`                | Pause execution at the next statement                                   |
| 4   | `debugger_resume`               | Resume execution                                                        |
| 5   | `debugger_step_into`            | Step into the next function call                                        |
| 6   | `debugger_step_over`            | Step over the next function call                                        |
| 7   | `debugger_step_out`             | Step out of the current function                                        |
| 8   | `debugger_wait_for_paused`      | Wait for the debugger to pause                                          |
| 9   | `debugger_get_paused_state`     | Get the current paused state                                            |
| 10  | `debugger_evaluate`             | Evaluate an expression in the current call frame                        |
| 11  | `debugger_evaluate_global`      | Evaluate an expression in the global context                            |
| 12  | `debugger_save_session`         | Save the current debugging session to a JSON file                       |
| 13  | `debugger_load_session`         | Load a previously saved debugging session                               |
| 14  | `debugger_export_session`       | Export the current session as JSON for sharing                          |
| 15  | `debugger_list_sessions`        | List all saved debugging sessions                                       |
| 16  | `breakpoint_set`                | Set a breakpoint (URL-based or scriptId-based, with optional condition) |
| 17  | `breakpoint_remove`             | Remove a breakpoint by ID                                               |
| 18  | `breakpoint_list`               | List all active breakpoints                                             |
| 19  | `breakpoint_set_on_exception`   | Pause on exceptions — all or uncaught only                              |
| 20  | `get_call_stack`                | Get the current call stack (when paused)                                |
| 21  | `get_object_properties`         | Get all properties of an object by `objectId`                           |
| 22  | `get_scope_variables_enhanced`  | Enhanced scope variable inspection with deep object traversal           |
| 23  | `watch_add`                     | Add a watch expression                                                  |
| 24  | `watch_remove`                  | Remove a watch expression                                               |
| 25  | `watch_list`                    | List all watch expressions                                              |
| 26  | `watch_evaluate_all`            | Evaluate all enabled watch expressions                                  |
| 27  | `watch_clear_all`               | Clear all watch expressions                                             |
| 28  | `xhr_breakpoint_set`            | Set an XHR/Fetch breakpoint                                             |
| 29  | `xhr_breakpoint_remove`         | Remove an XHR breakpoint                                                |
| 30  | `xhr_breakpoint_list`           | List all XHR breakpoints                                                |
| 31  | `event_breakpoint_set`          | Set an event listener breakpoint                                        |
| 32  | `event_breakpoint_set_category` | Set breakpoints for an entire event category                            |
| 33  | `event_breakpoint_remove`       | Remove an event breakpoint                                              |
| 34  | `event_breakpoint_list`         | List all event breakpoints                                              |
| 35  | `blackbox_add`                  | Blackbox scripts by URL pattern                                         |
| 36  | `blackbox_add_common`           | Blackbox all common libraries at once                                   |
| 37  | `blackbox_list`                 | List all blackboxed URL patterns                                        |

</details>

### Network

<details>
<summary>CDP network monitoring, performance tracing, CPU/heap profiling, auth extraction, HAR export, request replay, console injection</summary>

| #   | Tool                                  | Description                                                                          |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `network_enable`                      | Enable network request monitoring                                                    |
| 2   | `network_disable`                     | Disable network request monitoring                                                   |
| 3   | `network_get_status`                  | Get network monitoring status                                                        |
| 4   | `network_get_requests`                | Get captured requests with `offset+limit` pagination; case-insensitive URL filter    |
| 5   | `network_get_response_body`           | Get response body for a specific request                                             |
| 6   | `network_get_stats`                   | Get network statistics                                                               |
| 7   | `network_extract_auth`                | Scan all captured requests for auth credentials with confidence scoring              |
| 8   | `network_export_har`                  | Export captured traffic as HAR 1.2                                                   |
| 9   | `network_replay_request`              | Replay a captured request with overrides; SSRF-protected with per-hop DNS validation |
| 10  | `performance_get_metrics`             | Get page Web Vitals                                                                  |
| 11  | `performance_start_coverage`          | Start JS/CSS code coverage recording                                                 |
| 12  | `performance_stop_coverage`           | Stop coverage recording and return report                                            |
| 13  | `performance_take_heap_snapshot`      | Take a V8 heap memory snapshot                                                       |
| 14  | `performance_trace_start`             | Start Chrome Performance Trace recording (CDP Tracing domain)                        |
| 15  | `performance_trace_stop`              | Stop Performance Trace and save trace file                                           |
| 16  | `profiler_cpu_start`                  | Start CDP CPU profiling                                                              |
| 17  | `profiler_cpu_stop`                   | Stop CPU profiling and return top hot functions                                      |
| 18  | `profiler_heap_sampling_start`        | Start V8 heap allocation sampling                                                    |
| 19  | `profiler_heap_sampling_stop`         | Stop heap sampling and return top allocators                                         |
| 20  | `console_get_exceptions`              | Get captured uncaught exceptions                                                     |
| 21  | `console_inject_script_monitor`       | Inject a monitor for dynamically created `<script>` elements                         |
| 22  | `console_inject_xhr_interceptor`      | Inject an XHR interceptor for AJAX request/response capture                          |
| 23  | `console_inject_fetch_interceptor`    | Inject a Fetch API interceptor; auto-persists URLs to `localStorage.__capturedAPIs`  |
| 24  | `console_clear_injected_buffers`      | Clear injected in-page buffers                                                       |
| 25  | `console_reset_injected_interceptors` | Reset injected interceptors for clean reinjection                                    |
| 26  | `console_inject_function_tracer`      | Inject a Proxy-based function tracer                                                 |

</details>

### Hooks

<details>
<summary>AI-generated JavaScript hooks and 20+ built-in presets</summary>

| #   | Tool               | Description                                              |
| --- | ------------------ | -------------------------------------------------------- |
| 1   | `ai_hook_generate` | Generate hook code for a function, API, or object method |
| 2   | `ai_hook_inject`   | Inject a generated hook into the page                    |
| 3   | `ai_hook_get_data` | Retrieve captured data from an active hook               |
| 4   | `ai_hook_list`     | List all active hooks                                    |
| 5   | `ai_hook_clear`    | Remove one or all hooks                                  |
| 6   | `ai_hook_toggle`   | Enable or disable a hook                                 |
| 7   | `ai_hook_export`   | Export captured hook data (JSON/CSV)                     |
| 8   | `hook_preset`      | Install a pre-built hook from 20+ presets                |

**Built-in presets:** `eval`, `function-constructor`, `atob-btoa`, `crypto-subtle`, `json-stringify`, `object-defineproperty`, `settimeout`, `setinterval`, `addeventlistener`, `postmessage`, `webassembly`, `proxy`, `reflect`, `history-pushstate`, `location-href`, `navigator-useragent`, `eventsource`, `window-open`, `mutationobserver`, `formdata`, `anti-debug-bypass`, `crypto-key-capture`, `webassembly-full`

</details>

### Maintenance

<details>
<summary>Token budget tracking and cache management</summary>

| #   | Tool                     | Description                                     |
| --- | ------------------------ | ----------------------------------------------- |
| 1   | `get_token_budget_stats` | Get token budget usage statistics               |
| 2   | `manual_token_cleanup`   | Manually trigger token budget cleanup           |
| 3   | `reset_token_budget`     | Reset all token budget counters                 |
| 4   | `get_cache_stats`        | Get cache statistics for all internal caches    |
| 5   | `smart_cache_cleanup`    | Intelligently clean caches, preserving hot data |
| 6   | `clear_all_caches`       | Clear all internal caches                       |

</details>

### Process / Memory / Electron

<details>
<summary>Process enumeration, memory diagnostics and audit export, controlled DLL/shellcode injection, Electron attachment</summary>

| #   | Tool                       | Description                                                                        |
| --- | -------------------------- | ---------------------------------------------------------------------------------- |
| 1   | `process_find`             | Find processes by name pattern                                                     |
| 2   | `process_list`             | List all running processes                                                         |
| 3   | `process_get`              | Get detailed info about a specific process                                         |
| 4   | `process_windows`          | Get all window handles for a process                                               |
| 5   | `process_find_chromium`    | Disabled by design; use managed browser sessions                                   |
| 6   | `process_check_debug_port` | Check if a process has a debug port enabled                                        |
| 7   | `process_launch_debug`     | Launch an executable with remote debugging port                                    |
| 8   | `process_kill`             | Kill a process by PID                                                              |
| 9   | `memory_read`              | Read process memory; failures include diagnostics                                  |
| 10  | `memory_write`             | Write process memory; failures include diagnostics                                 |
| 11  | `memory_scan`              | Scan memory for a hex/value pattern with diagnostics on failure                    |
| 12  | `memory_check_protection`  | Check memory protection flags (R/W/X)                                              |
| 13  | `memory_protect`           | Alias for `memory_check_protection`                                                |
| 14  | `memory_scan_filtered`     | Secondary scan within a filtered address set                                       |
| 15  | `memory_batch_write`       | Write multiple memory patches at once                                              |
| 16  | `memory_dump_region`       | Dump a memory region to binary file                                                |
| 17  | `memory_list_regions`      | List all memory regions with protection flags                                      |
| 18  | `memory_audit_export`      | Export the in-memory audit trail for memory operations                             |
| 19  | `inject_dll`               | Disabled by default; set `ENABLE_INJECTION_TOOLS=true` to enable on Windows        |
| 20  | `module_inject_dll`        | Alias for `inject_dll`                                                             |
| 21  | `inject_shellcode`         | Disabled by default; accepts hex/base64 and requires `ENABLE_INJECTION_TOOLS=true` |
| 22  | `module_inject_shellcode`  | Alias for `inject_shellcode`                                                       |
| 23  | `check_debug_port`         | Check if a process is being debugged                                               |
| 24  | `enumerate_modules`        | List all loaded modules (DLLs) with base addresses                                 |
| 25  | `module_list`              | Alias for `enumerate_modules`                                                      |
| 26  | `electron_attach`          | Connect to a running Electron app via CDP                                          |

> **Platform notes:** Memory read/write/scan/dump work on **Windows** (native API) and **macOS** (lldb + vmmap). Failed `memory_read` / `memory_write` / `memory_scan` calls now include structured `diagnostics`, and `memory_audit_export` lets you export the in-memory audit trail. Injection tools are disabled by default; enable them with `ENABLE_INJECTION_TOOLS=true` on Windows with elevated privileges.

</details>

### Workflow / Composite

<details>
<summary>High-level orchestration for full-chain JavaScript analysis and security analysis tasks, plus batch operations</summary>

| #   | Tool                      | Description                                                                                                                           |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `web_api_capture_session` | Navigate + actions + collect requests + extract auth + export HAR — all in one call                                                   |
| 2   | `register_account_flow`   | Automate registration form: fill, submit, collect tokens, optionally verify via email tab                                             |
| 3   | `api_probe_batch`         | Probe multiple API endpoints in one browser-context fetch burst with auto Bearer injection                                            |
| 4   | `js_bundle_search`        | Server-side fetch + cache of remote JS bundle; multi-regex search with noise filtering                                                |
| 5   | `page_script_register`    | Register a named reusable JavaScript snippet in the session-local Script Library                                                      |
| 6   | `page_script_run`         | Execute a named script from the Script Library with runtime `__params__` injection                                                    |
| 7   | `batch_register`          | Batch account registration: sequential execution with per-account retry, capped backoff, idempotent deduplication, PII-masked logging |

**Built-in Script Library presets** (usable via `page_script_run` without registering):
`auth_extract`, `bundle_search`, `react_fill_form`, `dom_find_upgrade_buttons`

</details>

### WASM

<details>
<summary>WebAssembly dump, disassembly, decompilation, inspection, optimization, offline execution, VMP tracing</summary>

| #   | Tool                    | Description                                                                |
| --- | ----------------------- | -------------------------------------------------------------------------- |
| 1   | `wasm_dump`             | Dump a WebAssembly module from the current browser page                    |
| 2   | `wasm_disassemble`      | Disassemble .wasm to WAT using wasm2wat (requires wabt)                    |
| 3   | `wasm_decompile`        | Decompile .wasm to C-like pseudo-code using wasm-decompile (requires wabt) |
| 4   | `wasm_inspect_sections` | Inspect sections and metadata using wasm-objdump (requires wabt)           |
| 5   | `wasm_offline_run`      | Execute an exported WASM function offline via wasmtime/wasmer              |
| 6   | `wasm_optimize`         | Optimize .wasm via binaryen wasm-opt                                       |
| 7   | `wasm_vmp_trace`        | Trace WASM VMP opcode execution with enhanced instrumentation              |
| 8   | `wasm_memory_inspect`   | Inspect WebAssembly.Memory linear memory contents                          |

> **External dependencies:** wabt (`wasm2wat`, `wasm-objdump`, `wasm-decompile`), binaryen (`wasm-opt`), wasmtime or wasmer. All optional — tools gracefully report when unavailable.

</details>

### Streaming

<details>
<summary>WebSocket frame capture and SSE event interception</summary>

| #   | Tool                 | Description                                                    |
| --- | -------------------- | -------------------------------------------------------------- |
| 1   | `ws_monitor_enable`  | Enable WebSocket frame capture via CDP Network events          |
| 2   | `ws_monitor_disable` | Disable WebSocket monitoring and return capture summary        |
| 3   | `ws_get_frames`      | Get captured WebSocket frames with pagination and regex filter |
| 4   | `ws_get_connections` | Get tracked WebSocket connections and frame counts             |
| 5   | `sse_monitor_enable` | Enable SSE monitoring via EventSource constructor interception |
| 6   | `sse_get_events`     | Get captured SSE events with filters and pagination            |

</details>

### Encoding

<details>
<summary>Binary format detection, entropy analysis, Protobuf/MessagePack decoding, encode/decode</summary>

| #   | Tool                      | Description                                                                            |
| --- | ------------------------- | -------------------------------------------------------------------------------------- |
| 1   | `binary_detect_format`    | Detect binary payload format via magic bytes, encoding heuristics, and Shannon entropy |
| 2   | `binary_decode`           | Decode binary payloads (base64/hex/url/protobuf/msgpack)                               |
| 3   | `binary_encode`           | Encode utf8/hex/json input into base64/hex/url output                                  |
| 4   | `binary_entropy_analysis` | Compute Shannon entropy + byte frequency distribution                                  |
| 5   | `protobuf_decode_raw`     | Decode base64 protobuf bytes without schema (wire-type aware recursive parser)         |

</details>

### Anti-Debug

<details>
<summary>Bypass anti-debugging protections and detect protection techniques</summary>

| #   | Tool                                  | Description                                                                                  |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | `antidebug_bypass_all`                | Inject all anti-anti-debug bypass scripts (dual injection: evaluateOnNewDocument + evaluate) |
| 2   | `antidebug_bypass_debugger_statement` | Bypass debugger-statement protection by patching Function constructor                        |
| 3   | `antidebug_bypass_timing`             | Bypass timing-based anti-debug by stabilizing performance.now / Date.now                     |
| 4   | `antidebug_bypass_stack_trace`        | Bypass Error.stack based detection by filtering suspicious frames                            |
| 5   | `antidebug_bypass_console_detect`     | Bypass console-based devtools detection                                                      |
| 6   | `antidebug_detect_protections`        | Detect anti-debug protections and return bypass recommendations                              |

</details>

### GraphQL / Call Graph

<details>
<summary>GraphQL introspection, query extraction, replay, runtime call graph analysis, script replacement</summary>

| #   | Tool                      | Description                                                        |
| --- | ------------------------- | ------------------------------------------------------------------ |
| 1   | `call_graph_analyze`      | Analyze runtime function call graph from in-page tracer records    |
| 2   | `script_replace_persist`  | Persistently replace script responses via CDP request interception |
| 3   | `graphql_introspect`      | Run GraphQL introspection query against a target endpoint          |
| 4   | `graphql_extract_queries` | Extract GraphQL queries/mutations from captured network traces     |
| 5   | `graphql_replay`          | Replay a GraphQL operation with optional variables and headers     |

</details>

### Platform

<details>
<summary>Miniapp package tools, Electron ASAR extraction/inspection, Frida/Jadx bridge</summary>

| #   | Tool                   | Description                                                                                                  |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | `miniapp_pkg_scan`     | Scan local miniapp cache directories for package files                                                       |
| 2   | `miniapp_pkg_unpack`   | Unpack miniapp package files (external CLI or pure Node.js fallback)                                         |
| 3   | `miniapp_pkg_analyze`  | Analyze unpacked miniapp structure (pages, subPackages, components)                                          |
| 4   | `asar_extract`         | Extract Electron app.asar (pure Node.js, no @electron/asar dependency)                                       |
| 5   | `electron_inspect_app` | Analyze Electron app structure (package.json, main, preload, dependencies)                                   |
| 6   | `frida_bridge`         | Frida integration bridge: env check, script template generation, usage guide (requires external frida-tools) |
| 7   | `jadx_bridge`          | Jadx integration bridge: env check, APK/DEX/AAR decompilation, usage guide (requires external jadx CLI)      |

> **External dependencies:** `unveilr` (miniapp unpacker), `frida` (pip install frida-tools), `jadx` (Java decompiler). All optional — tools gracefully handle missing dependencies.

</details>

### Burp Suite Bridge

<details>
<summary>Burp Suite REST API integration: proxy status, request replay, HAR import/diff, repeater</summary>

| #   | Tool                           | Description                                                                        |
| --- | ------------------------------ | ---------------------------------------------------------------------------------- |
| 1   | `burp_proxy_status`            | Check Burp Suite adapter health and connection status                              |
| 2   | `intercept_and_replay_to_burp` | Replay a captured request to Burp proxy or repeater                                |
| 3   | `import_har_from_burp`         | Import and filter HAR file entries (URL/method/status filters)                     |
| 4   | `diff_har`                     | Diff two HAR files: added/removed/modified entries with header and body comparison |
| 5   | `burp_send_to_repeater`        | Send a URL with custom headers/body to Burp Repeater                               |

> **External dependency:** Burp Suite with REST API adapter or Burp Suite Pro Extender. Endpoint must be loopback only (127.0.0.1 / localhost / ::1).

</details>

### Native Analysis Tool Bridge

<details>
<summary>Ghidra and IDA Pro bridge: decompilation, symbol lookup, script execution, cross-reference analysis</summary>

| #   | Tool                   | Description                                                                                  |
| --- | ---------------------- | -------------------------------------------------------------------------------------------- |
| 1   | `native_bridge_status` | Check Ghidra and IDA bridge connectivity                                                     |
| 2   | `ghidra_bridge`        | Ghidra integration: open project, decompile function, list symbols, get xrefs, run script    |
| 3   | `ida_bridge`           | IDA Pro integration: open binary, decompile function, list symbols, get xrefs, run IDAPython |
| 4   | `native_symbol_sync`   | Sync symbol/type data between Ghidra and IDA                                                 |

> **External dependencies:** Ghidra with `ghidra_bridge` Python server, IDA Pro with IDAPython HTTP bridge. Endpoints must be loopback only (127.0.0.1 / localhost / ::1).

</details>

### Source Map / Extension

<details>
<summary>Source map discovery, VLQ decoding, project tree reconstruction, Chrome extension interaction</summary>

| #   | Tool                           | Description                                                                      |
| --- | ------------------------------ | -------------------------------------------------------------------------------- |
| 1   | `sourcemap_discover`           | Auto-discover page source maps via CDP Debugger.scriptParsed events              |
| 2   | `sourcemap_fetch_and_parse`    | Fetch and parse SourceMap v3 (pure TS VLQ decoder, no source-map npm dependency) |
| 3   | `sourcemap_reconstruct_tree`   | Reconstruct original project file tree from SourceMap sources + sourcesContent   |
| 4   | `extension_list_installed`     | List installed Chrome extensions via CDP Target.getTargets                       |
| 5   | `extension_execute_in_context` | Execute code in Chrome extension background context via Target.attachToTarget    |

</details>

### Transform / Crypto

<details>
<summary>AST-like transforms (pure regex), crypto function extraction, sandbox testing, implementation comparison</summary>

| #   | Tool                        | Description                                                                                      |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | `ast_transform_preview`     | Preview lightweight transforms (constant fold, string decrypt, dead code remove, etc.) with diff |
| 2   | `ast_transform_chain`       | Create and store an in-memory named transform chain                                              |
| 3   | `ast_transform_apply`       | Apply transforms to code or a live page scriptId                                                 |
| 4   | `crypto_extract_standalone` | Extract crypto/sign/encrypt function from page as standalone runnable code                       |
| 5   | `crypto_test_harness`       | Run extracted crypto code in worker_threads + vm sandbox with test inputs                        |
| 6   | `crypto_compare`            | Compare two crypto implementations against identical test vectors                                |

</details>

### Meta-Tools

<details>
<summary>Open the meta-tool list</summary>

| #   | Tool                | Description                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `search_tools`      | _(meta-tool)_ BM25 keyword search across built-in tools + loaded plugin/workflow tools; in `workflow/full` tiers, workflow-domain matches receive a ranking boost. When extension workflows are loaded, `run_extension_workflow` / `list_extension_workflows` get extra ranking weight (especially for register/captcha/keygen-style intents). |
| 2   | `activate_tools`    | _(meta-tool)_ Dynamically register specific tools by name (from search results)                                                                                                                                                                                                                                                                |
| 3   | `deactivate_tools`  | _(meta-tool)_ Remove previously activated tools to free context                                                                                                                                                                                                                                                                                |
| 4   | `activate_domain`   | _(meta-tool)_ Activate all tools in a domain at once (e.g. `debugger`, `network`)                                                                                                                                                                                                                                                              |
| 5   | `boost_profile`     | _(meta-tool)_ Upgrade to a higher-capability tier (search → minimal → workflow → full); auto-expires after TTL                                                                                                                                                                                                                                 |
| 6   | `unboost_profile`   | _(meta-tool)_ Downgrade to a lower tier and remove boost-added tools                                                                                                                                                                                                                                                                           |
| 7   | `extensions_list`   | _(meta-tool)_ List currently loaded extensions from `plugins/` and `workflows/`                                                                                                                                                                                                                                                                |
| 8   | `extensions_reload` | _(meta-tool)_ Reload extensions at runtime and register extension tools dynamically                                                                                                                                                                                                                                                            |

</details>

## Dynamic Extensions (plugins/workflows)

<details>
<summary>Open extension layout, discovery, and reload rules</summary>

- Default extension roots (global, under jshook installation directory):
  - `<jshook-install>/plugins`
  - `<jshook-install>/workflows`
- Optional root overrides:
  - `MCP_PLUGIN_ROOTS` (comma-separated absolute/relative paths)
  - `MCP_WORKFLOW_ROOTS` (comma-separated absolute/relative paths)
- Optional trust policy:
  - `MCP_PLUGIN_ALLOWED_DIGESTS` (comma-separated SHA-256 hex allowlist; pre-import gate)
  - `MCP_PLUGIN_SIGNATURE_REQUIRED=true` (require plugin signature)
  - `MCP_PLUGIN_SIGNATURE_SECRET` (HMAC key for signature verification)
- Relative roots are resolved against the server process `cwd` (`process.cwd()`).
- Roots are scanned recursively.

### Plugin layout

- Put plugin manifests at:
  - `plugins/<plugin-name>/manifest.js` (preferred in production)
  - `plugins/<plugin-name>/manifest.ts` (supported)
- Export a default `PluginContract`.
- Recommended import source for extension repos: `@jshookmcp/extension-sdk/plugin`.
- A plugin can contribute `DomainManifest` + `WorkflowContract` via `manifest.contributes`.

### Workflow layout

- Put workflow contracts at:
  - `workflows/*.workflow.js` / `workflows/*.workflow.ts`
  - `workflows/**/workflow.js` / `workflows/**/workflow.ts`
- Export a default `WorkflowContract`.
- Recommended import source for extension repos: `@jshookmcp/extension-sdk/workflow`.
- Discovery de-dup behavior (important):
  - Workflow files are grouped by a normalized relative-directory key.
  - Only one workflow file is kept per key during reload.
  - If you place multiple files directly under `workflows/*.workflow.js`, only one may be retained.
  - Preferred multi-workflow layout: `workflows/<workflow-name>/workflow.js` (or `workflow.ts`).

### Runtime behavior

- Quick flow:
  1. Place plugin/workflow files under configured roots.
  2. Call `extensions_reload`.
  3. Check `warnings`, `errors`, `addedTools`, `removedTools` in reload response.
  4. Call `extensions_list` and `search_tools` to verify visibility.
- `extensions_reload` replaces currently loaded extensions (remove old, then rebuild from roots).
- Extension tools loaded by `extensions_reload` are registered and immediately searchable/callable.
- `activate_domain` can include extension domains only after `extensions_reload`.
- On reload, plugin lifecycle cleanup hooks are executed when available (`onDeactivate` then `onUnload`).

</details>

## Safety & Liability Disclaimer

- Process memory mutation, code injection, traffic replay, and similar low-level capabilities are provided as-is.
- Third-party plugins, workflows, and extensions loaded from local paths or registries are not audited, endorsed, or warranted by this project.
- You are responsible for reviewing what you enable and for any operational, legal, security, or data-loss consequences that follow from using built-in mutation features or external extensions.

## Generated Artifacts & Cleanup

| Artifact                  | Default location                                   | Created by                                                         |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| HAR traffic dumps         | `artifacts/har/jshook-capture-<timestamp>.har`     | `web_api_capture_session`, `network_export_har`                    |
| Workflow Markdown reports | `artifacts/reports/web-api-capture-<timestamp>.md` | `web_api_capture_session`                                          |
| Screenshots               | `screenshots/manual/`                              | `page_screenshot`                                                  |
| CAPTCHA screenshots       | `screenshots/`                                     | `page_navigate` CAPTCHA detection                                  |
| Debug sessions            | `sessions/`                                        | `debugger_save_session` / `debugger_export_session`                |
| WASM dumps                | `artifacts/wasm/`                                  | `wasm_dump`, `wasm_disassemble`, `wasm_decompile`, `wasm_optimize` |
| Source map trees          | `artifacts/sourcemap/`                             | `sourcemap_reconstruct_tree`                                       |
| Miniapp unpacks           | `artifacts/miniapp-unpack/`                        | `miniapp_pkg_unpack`                                               |
| Jadx decompilation        | `artifacts/jadx-decompile/`                        | `jadx_bridge`                                                      |
| Performance traces        | `artifacts/trace/`                                 | `performance_trace_stop`                                           |
| CPU profiles              | `artifacts/profile/`                               | `profiler_cpu_stop`                                                |
| Heap samples              | `artifacts/heap/`                                  | `profiler_heap_sampling_stop`                                      |

All paths are in `.gitignore`.

Retention support:

- `MCP_ARTIFACT_RETENTION_DAYS`
- `MCP_ARTIFACT_MAX_TOTAL_MB`
- `MCP_ARTIFACT_CLEANUP_ON_START=true`
- `MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES`

Built-in maintenance tools:

- `cleanup_artifacts`
- `doctor_environment`

```bash
# Dependency and environment diagnostics
pnpm run doctor
```

## Security

- **Authentication**: Set `MCP_AUTH_TOKEN` to require Bearer token for HTTP transport
- **CSRF Protection**: Origin validation blocks cross-origin browser requests without auth
- **SSRF Defense**: `network_replay_request` and `safeFetch` use per-hop DNS pinning with `redirect: 'manual'`; Burp/Ghidra/IDA bridge endpoints validated to loopback-only at construction (no user-controllable override)
- **Path Traversal**: HAR export and debugger sessions validate paths with `fs.realpath` and symlink detection
- **Injection Prevention**: All PowerShell-based operations use `execFile` with input sanitization; `BranchNode.predicateId` whitelist replaces arbitrary JS eval in workflow graphs
- **External Tool Safety**: `ExternalToolRunner` uses allowlist-only tool registry with `shell: false` execution
- **CAPTCHA Solver Isolation**: Unsupported legacy service overrides are explicitly rejected to prevent credential misrouting
- **PII Protection**: Batch registration logs mask identifying data (first 2 + last 2 chars only)
- **Parameter Clamping**: All user-facing numeric parameters in behavior/captcha handlers have runtime hard caps independent of JSON Schema
- **Plugin Security**: In production, plugin signature enforcement defaults to enabled unless explicitly overridden; digest allowlists remain the pre-import trust boundary

## Platform Notes

- Windows remains the primary platform for memory write / injection tooling.
- On Linux/macOS, prefer browser hooks, network capture, workflow composition, and bridge-based analysis where native memory operations are unavailable.
- Run `pnpm run doctor` or `doctor_environment` after setting up bridges like Ghidra / IDA / Burp.

## Extension Templates

> This section is about extension authoring templates, not the installation path for the main `jshook` server. If you only want to use the server, prefer `npx @jshookmcp/jshook` above. Clone and build the template repositories only when you want to develop your own plugin or workflow.

- Plugin starter repo: `https://github.com/vmoranv/jshook_plugin_template`
- Workflow starter repo: `https://github.com/vmoranv/jshook_workflow_template`
- Registry submissions: open an issue in `https://github.com/vmoranv/jshookmcpextension/issues` if you want your plugin or workflow considered for the extension registry

## Project Stats

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=vmoranv/jshookmcp&type=Date)](https://star-history.com/#vmoranv/jshookmcp&Date)

![Activity](https://repobeats.axiom.co/api/embed/83c000c790b1c665ff2686d2d02605412a0b8805.svg 'Repobeats analytics image')

</div>
