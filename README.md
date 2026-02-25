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

## Requirements

- Node.js >= 18
- pnpm

## Installation

```bash
pnpm install
pnpm build
```

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

## MCP Client Setup

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

## Tool Domains (157 Tools Total)

### Analysis (13 tools)

| # | Tool | Description |
|---|------|-------------|
| 1 | `collect_code` | Collect JavaScript from a page with smart caching |
| 2 | `search_in_scripts` | Search collected scripts for a pattern |
| 3 | `extract_function_tree` | Extract a function and its dependency tree |
| 4 | `deobfuscate` | LLM-assisted code deobfuscation |
| 5 | `understand_code` | LLM-powered code explanation and analysis |
| 6 | `detect_crypto` | Identify crypto algorithms (AES, RSA, DES, etc.) |
| 7 | `manage_hooks` | Create/list/clear browser hooks |
| 8 | `detect_obfuscation` | Identify obfuscation techniques used |
| 9 | `advanced_deobfuscate` | Deep deobfuscation with AST optimization |
| 10 | `clear_collected_data` | Clear all collected code data |
| 11 | `get_collection_stats` | Get statistics about collected code |
| 12 | `webpack_enumerate` | Enumerate webpack modules |
| 13 | `source_map_extract` | Extract and parse source maps |

### Browser (53 tools)

| # | Tool | Description |
|---|------|-------------|
| 1 | `browser_launch` | Launch a Chromium/Camoufox browser instance |
| 2 | `camoufox_server_launch` | Launch Camoufox WebSocket server |
| 3 | `camoufox_server_close` | Close Camoufox server |
| 4 | `camoufox_server_status` | Get Camoufox server status |
| 5 | `browser_attach` | Attach to existing browser via WebSocket |
| 6 | `browser_close` | Close the browser |
| 7 | `browser_status` | Get current browser/page status |
| 8 | `browser_list_tabs` | List all open tabs |
| 9 | `browser_select_tab` | Select a specific tab |
| 10 | `page_navigate` | Navigate to a URL |
| 11 | `page_reload` | Reload current page |
| 12 | `page_back` | Navigate back |
| 13 | `page_forward` | Navigate forward |
| 14 | `dom_query_selector` | Query a single element |
| 15 | `dom_query_all` | Query all matching elements |
| 16 | `dom_get_structure` | Get DOM tree structure |
| 17 | `dom_find_clickable` | Find all clickable elements |
| 18 | `page_click` | Click a DOM element |
| 19 | `page_type` | Type text into an input |
| 20 | `page_select` | Select an option |
| 21 | `page_hover` | Hover over an element |
| 22 | `page_scroll` | Scroll the page |
| 23 | `page_wait_for_selector` | Wait for selector to appear |
| 24 | `page_evaluate` | Execute JavaScript in page context |
| 25 | `page_screenshot` | Capture a screenshot |
| 26 | `get_all_scripts` | Get all script URLs |
| 27 | `get_script_source` | Get script source code |
| 28 | `console_enable` | Enable console monitoring |
| 29 | `console_get_logs` | Get console logs |
| 30 | `console_execute` | Execute console command |
| 31 | `dom_get_computed_style` | Get computed style |
| 32 | `dom_find_by_text` | Find elements by text |
| 33 | `dom_get_xpath` | Get XPath for element |
| 34 | `dom_is_in_viewport` | Check if element is visible |
| 35 | `page_get_performance` | Get page performance metrics |
| 36 | `page_inject_script` | Inject script into page |
| 37 | `page_set_cookies` | Set cookies |
| 38 | `page_get_cookies` | Get cookies |
| 39 | `page_clear_cookies` | Clear cookies |
| 40 | `page_set_viewport` | Set viewport size |
| 41 | `page_emulate_device` | Emulate mobile device |
| 42 | `page_get_local_storage` | Get local storage |
| 43 | `page_set_local_storage` | Set local storage |
| 44 | `page_press_key` | Press a key |
| 45 | `page_get_all_links` | Get all links on page |
| 46 | `captcha_detect` | AI-powered CAPTCHA detection |
| 47 | `captcha_wait` | Wait for manual CAPTCHA solving |
| 48 | `captcha_config` | Configure CAPTCHA detection |
| 49 | `stealth_inject` | Inject anti-detection patches |
| 50 | `stealth_set_user_agent` | Set custom user agent |
| 51 | `framework_state_extract` | Extract framework state |
| 52 | `indexeddb_dump` | Dump IndexedDB contents |
| 53 | `get_detailed_data` | Get detailed collected data by ID |

### Debugger (37 tools)

| # | Tool | Description |
|---|------|-------------|
| 1 | `debugger_enable` | Enable the CDP debugger |
| 2 | `debugger_disable` | Disable the debugger |
| 3 | `debugger_pause` | Pause execution |
| 4 | `debugger_resume` | Resume execution |
| 5 | `debugger_step_into` | Step into next call |
| 6 | `debugger_step_over` | Step over next call |
| 7 | `debugger_step_out` | Step out of current function |
| 8 | `breakpoint_set` | Set a breakpoint |
| 9 | `breakpoint_remove` | Remove a breakpoint |
| 10 | `breakpoint_list` | List all breakpoints |
| 11 | `get_call_stack` | Get current call stack |
| 12 | `debugger_evaluate` | Evaluate expression at paused frame |
| 13 | `debugger_evaluate_global` | Evaluate in global context |
| 14 | `debugger_wait_for_paused` | Wait for debugger pause |
| 15 | `debugger_get_paused_state` | Get current paused state |
| 16 | `breakpoint_set_on_exception` | Break on exceptions |
| 17 | `get_object_properties` | Get object properties |
| 18 | `get_scope_variables_enhanced` | Deep scope variable inspection |
| 19 | `debugger_save_session` | Save debug session to file |
| 20 | `debugger_load_session` | Restore a saved session |
| 21 | `debugger_export_session` | Export session as JSON |
| 22 | `debugger_list_sessions` | List saved sessions |
| 23 | `watch_add` | Add a watch expression |
| 24 | `watch_remove` | Remove a watch expression |
| 25 | `watch_list` | List all watch expressions |
| 26 | `watch_evaluate_all` | Evaluate all watch expressions |
| 27 | `watch_clear_all` | Clear all watch expressions |
| 28 | `xhr_breakpoint_set` | Set XHR breakpoint |
| 29 | `xhr_breakpoint_remove` | Remove XHR breakpoint |
| 30 | `xhr_breakpoint_list` | List XHR breakpoints |
| 31 | `event_breakpoint_set` | Set event breakpoint |
| 32 | `event_breakpoint_set_category` | Set category event breakpoints |
| 33 | `event_breakpoint_remove` | Remove event breakpoint |
| 34 | `event_breakpoint_list` | List event breakpoints |
| 35 | `blackbox_add` | Add script to blackbox |
| 36 | `blackbox_add_common` | Add common scripts to blackbox |
| 37 | `blackbox_list` | List blackboxed scripts |

### Network (15 tools)

| # | Tool | Description |
|---|------|-------------|
| 1 | `network_enable` | Enable network monitoring |
| 2 | `network_disable` | Disable network monitoring |
| 3 | `network_get_status` | Get network monitor status |
| 4 | `network_get_requests` | List captured requests |
| 5 | `network_get_response_body` | Get response body by request ID |
| 6 | `network_get_stats` | Aggregated request statistics |
| 7 | `performance_get_metrics` | Page performance metrics |
| 8 | `performance_start_coverage` | Start code coverage recording |
| 9 | `performance_stop_coverage` | Stop coverage recording |
| 10 | `performance_take_heap_snapshot` | Take heap snapshot |
| 11 | `console_get_exceptions` | Get console exceptions |
| 12 | `console_inject_script_monitor` | Inject script monitor |
| 13 | `console_inject_xhr_interceptor` | Inject XHR interceptor |
| 14 | `console_inject_fetch_interceptor` | Inject fetch interceptor |
| 15 | `console_inject_function_tracer` | Inject function tracer |

### Hooks (7 tools)

| # | Tool | Description |
|---|------|-------------|
| 1 | `ai_hook_generate` | Generate a hook for a URL/function pattern |
| 2 | `ai_hook_inject` | Inject a generated hook into the page |
| 3 | `ai_hook_get_data` | Retrieve captured hook data |
| 4 | `ai_hook_list` | List all active hooks |
| 5 | `ai_hook_clear` | Clear all hooks |
| 6 | `ai_hook_toggle` | Enable or disable a hook |
| 7 | `ai_hook_export` | Export hook data as JSON or HAR |

### Preset Hooks (1 tool)

| # | Tool | Description |
|---|------|-------------|
| 1 | `hook_preset` | Install a built-in preset hook |

**Built-in presets:** `eval`, `function-constructor`, `atob-btoa`, `crypto-subtle`, `json-stringify`, `object-defineproperty`, `settimeout`, `setinterval`, `addeventlistener`, `postmessage`, `webassembly`, `proxy`, `reflect`, `history-pushstate`, `location-href`, `navigator-useragent`, `eventsource`, `window-open`, `mutationobserver`, `formdata`

### Maintenance (6 tools)

| # | Tool | Description |
|---|------|-------------|
| 1 | `get_token_budget_stats` | Token usage statistics |
| 2 | `manual_token_cleanup` | Trim token budget |
| 3 | `reset_token_budget` | Reset token budget |
| 4 | `get_cache_stats` | Cache usage statistics |
| 5 | `smart_cache_cleanup` | Evict stale cache entries |
| 6 | `clear_all_caches` | Purge all caches |

### Process (24 tools)

| # | Tool | Description |
|---|------|-------------|
| 1 | `process_find` | Find processes by name pattern |
| 2 | `process_list` | List all processes |
| 3 | `process_get` | Get process info by PID |
| 4 | `process_windows` | Get windows for a process |
| 5 | `process_find_chromium` | Disabled (no host browser process scan) |
| 6 | `process_check_debug_port` | Check if process has debug port |
| 7 | `process_launch_debug` | Launch executable with debug port |
| 8 | `process_kill` | Kill a process by PID |
| 9 | `memory_read` | Read process memory |
| 10 | `memory_write` | Write to process memory |
| 11 | `memory_scan` | Scan process memory for pattern |
| 12 | `memory_check_protection` | Check memory protection |
| 13 | `memory_protect` | Change memory protection |
| 14 | `memory_scan_filtered` | Filtered memory scan |
| 15 | `memory_batch_write` | Batch write to memory |
| 16 | `memory_dump_region` | Dump memory region |
| 17 | `memory_list_regions` | List memory regions |
| 18 | `inject_dll` | Inject DLL into process |
| 19 | `module_inject_dll` | Alias for inject_dll |
| 20 | `inject_shellcode` | Inject shellcode into process |
| 21 | `module_inject_shellcode` | Alias for inject_shellcode |
| 22 | `check_debug_port` | Check debug port availability |
| 23 | `enumerate_modules` | Enumerate process modules |
| 24 | `module_list` | Alias for enumerate_modules |

### Electron (1 tool)

| # | Tool | Description |
|---|------|-------------|
| 1 | `electron_attach` | Attach to Electron app |

## Tool Testing Checklist

See [TOOL_TEST_CHECKLIST.md](./TOOL_TEST_CHECKLIST.md) for full test status.

## License

MIT
