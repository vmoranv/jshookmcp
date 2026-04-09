# `.env` and Configuration

`.env.example` is only a template and is not auto-loaded at runtime. The process reads the repository-root `.env` file.

`.env.example` is intentionally sparse now: it only keeps common overrides instead of repeating every variable that already has a built-in default. Any key omitted from `.env` falls back to the defaults in `src/utils/config.ts`.

## Full configuration reference

Runtime configuration is defined by `src/utils/config.ts`. The current runtime does not read `DEFAULT_LLM_PROVIDER`, `OPENAI_*`, or `ANTHROPIC_*` variables that appeared in older documentation.

### 1. Browser and Puppeteer

| Variable                     | Purpose                                             | Default / Typical value                           |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| `PUPPETEER_HEADLESS`         | Controls whether browsers launch in headless mode.  | code default `false` |
| `PUPPETEER_TIMEOUT`          | Default Puppeteer timeout in milliseconds.          | `30000`                                           |
| `PUPPETEER_EXECUTABLE_PATH`  | Explicit browser executable path.                   | no default                                        |
| `CHROME_PATH`                | Alternate browser executable path variable.         | no default                                        |
| `BROWSER_EXECUTABLE_PATH`    | Another alternate browser executable path variable. | no default                                        |
| `CAPTCHA_SCREENSHOT_DIR`     | Fallback directory for CAPTCHA screenshots.         | `./screenshots/captcha`                           |
| `MCP_SCREENSHOT_DIR`         | Root directory for regular screenshots.             | `./screenshots`                                   |
| `MCP_DEBUGGER_SESSIONS_DIR`  | Directory used for persisted debugger sessions.     | `./debugger-sessions`                             |
| `MCP_EXTENSION_REGISTRY_DIR` | Persistent directory for extension registry state.  | `./artifacts/extension-registry`                  |
| `MCP_TLS_KEYLOG_DIR`         | Directory used for generated TLS key log files.     | `./artifacts/tmp`                                 |
| `MCP_REGISTRY_CACHE_DIR`     | Local cache directory for remote extension indexes. | `~/.jshookmcp/cache`                              |
| `CAPTCHA_PROVIDER`           | Default CAPTCHA solving provider.                   | `manual`                                          |
| `CAPTCHA_API_KEY`            | API key for automatic CAPTCHA solving providers.    | no default                                        |
| `CAPTCHA_SOLVER_BASE_URL`    | Base URL for the external CAPTCHA solver service.   | no default                                        |
| `CAPTCHA_DEFAULT_TIMEOUT_MS` | Default CAPTCHA wait timeout.                       | `180000`                                          |

### 2. Server identity and logging

| Variable                  | Purpose                                                      | Default / Typical value |
| ------------------------- | ------------------------------------------------------------ | ----------------------- |
| `MCP_SERVER_NAME`         | Public server name announced by the process.                 | `jshookmcp`             |
| `MCP_SERVER_VERSION`      | Public server version announced by the process.              | `0.1.8` (example value) |
| `LOG_LEVEL`               | Logging verbosity.                                           | `info`                  |
| `RUNTIME_ERROR_WINDOW_MS` | Recovery window length for runtime error counting.           | `60000`                 |
| `RUNTIME_ERROR_THRESHOLD` | Recoverable error threshold inside the runtime error window. | `5`                     |

### 3. Profiles, search, and tool selection

| Variable                                  | Purpose                                                           | Default / Typical value          |
| ----------------------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| `MCP_TOOL_PROFILE`                        | Selects the tool profile: `search`, `workflow`, or `full`.        | default: `search`                |
| `MCP_TOOL_DOMAINS`                        | Explicit domain allowlist; overrides `MCP_TOOL_PROFILE` when set. | no default                       |
| `SEARCH_INTENT_TOOL_BOOST_RULES_JSON`     | JSON override for explicit intent-to-tool ranking boosts.         | no default                       |
| `MCP_DEFAULT_PLUGIN_BOOST_TIER`           | Default tier for plugin auto-registration during boost.           | `full`                           |

### 4. Transport, HTTP, and security

| Variable                          | Purpose                                                 | Default / Typical value |
| --------------------------------- | ------------------------------------------------------- | ----------------------- |
| `MCP_TRANSPORT`                   | Selects transport mode: `stdio` or `http`.              | `stdio`                 |
| `MCP_HOST`                        | HTTP bind host.                                         | `127.0.0.1`             |
| `MCP_PORT`                        | HTTP bind port.                                         | `3000`                  |
| `MCP_AUTH_TOKEN`                  | Enables Bearer token auth.                              | no default              |
| `MCP_ALLOW_INSECURE`              | Allows insecure HTTP binding behavior on non-localhost. | disabled by default     |
| `MCP_MAX_BODY_BYTES`              | Maximum HTTP JSON request body size.                    | `10 * 1024 * 1024`      |
| `MCP_RATE_LIMIT_WINDOW_MS`        | HTTP rate limit window size.                            | `60000`                 |
| `MCP_RATE_LIMIT_MAX`              | Maximum requests per rate limit window.                 | `60`                    |
| `MCP_HTTP_REQUEST_TIMEOUT_MS`     | HTTP request timeout.                                   | `30000`                 |
| `MCP_HTTP_HEADERS_TIMEOUT_MS`     | HTTP headers timeout.                                   | `10000`                 |
| `MCP_HTTP_KEEPALIVE_TIMEOUT_MS`   | HTTP keep-alive timeout.                                | `60000`                 |
| `MCP_HTTP_FORCE_CLOSE_TIMEOUT_MS` | Force-close grace timeout.                              | `5000`                  |

### 5. Extension roots, signatures, and registry

| Variable                        | Purpose                                                           | Default / Typical value                                                        |
| ------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `MCP_PLUGIN_ROOTS`              | Comma-separated plugin roots.                                     | typical example: `./plugins,./dist/plugins`                                    |
| `MCP_WORKFLOW_ROOTS`            | Comma-separated workflow roots.                                   | typical example: `./workflows`                                                 |
| `MCP_PLUGIN_ALLOWED_DIGESTS`    | Pre-import SHA-256 allowlist for plugin files.                    | no default                                                                     |
| `MCP_PLUGIN_SIGNATURE_REQUIRED` | Requires plugin signatures.                                       | stricter by default in production                                              |
| `MCP_PLUGIN_SIGNATURE_SECRET`   | HMAC secret used for plugin signature verification.               | no default                                                                     |
| `MCP_PLUGIN_STRICT_LOAD`        | Enables strict extension loading behavior.                        | stricter by default in production                                              |
| `EXTENSION_REGISTRY_BASE_URL`   | Base URL for `browse_extension_registry` and `install_extension`. | `https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry` |

### 6. Bridges and platform endpoints

| Variable                | Purpose                                                               | Default / Typical value                    |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| `BURP_MCP_SSE_URL`      | Burp official MCP SSE bridge URL.                                     | typical value: `http://127.0.0.1:9876/sse` |
| `DEFAULT_DEBUG_PORT`    | Default debug port used for remote-debugging launches.                | `9222`                                     |

### 7. Cache, token budget, and performance

| Variable                              | Purpose                                       | Default / Typical value                              |
| ------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| `ENABLE_CACHE`                        | Enables disk-backed caching.                  | code default `false` |
| `CACHE_DIR`                           | Cache directory.                              | `.cache`                                             |
| `CACHE_TTL`                           | Cache TTL in seconds.                         | `3600`                                               |
| `CACHE_GLOBAL_MAX_SIZE_BYTES`         | Maximum total cache size.                     | `524288000`                                          |
| `TOKEN_BUDGET_MAX_TOKENS`             | Maximum token budget.                         | `200000`                                             |
| `DETAILED_DATA_DEFAULT_TTL_MS`        | Default TTL for detailed data entries.        | `1800000`                                            |
| `DETAILED_DATA_MAX_TTL_MS`            | Maximum TTL for detailed data entries.        | `3600000`                                            |
| `DETAILED_DATA_SMART_THRESHOLD_BYTES` | Threshold for auto-summarizing detailed data. | `51200`                                              |
| `MAX_CONCURRENT_ANALYSIS`             | Max concurrent analysis jobs.                 | `3`                                                  |
| `MAX_CODE_SIZE_MB`                    | Max code payload size for analysis.           | `10`                                                 |
| `jshook_IO_CONCURRENCY`               | I/O concurrency limit.                        | `4`                                                  |
| `jshook_CPU_CONCURRENCY`              | CPU concurrency limit.                        | `2`                                                  |
| `jshook_CDP_CONCURRENCY`              | CDP concurrency limit.                        | `2`                                                  |

### 8. Worker pool and parallel scheduling

| Variable                         | Purpose                               | Default / Typical value |
| -------------------------------- | ------------------------------------- | ----------------------- |
| `WORKER_POOL_MIN_WORKERS`        | Minimum worker count.                 | `2`                     |
| `WORKER_POOL_MAX_WORKERS`        | Maximum worker count.                 | `4`                     |
| `WORKER_POOL_IDLE_TIMEOUT_MS`    | Worker idle timeout.                  | `30000`                 |
| `WORKER_POOL_JOB_TIMEOUT_MS`     | Worker job timeout.                   | `15000`                 |
| `PARALLEL_DEFAULT_CONCURRENCY`   | Default parallel execution width.     | `3`                     |
| `PARALLEL_DEFAULT_TIMEOUT_MS`    | Default parallel timeout.             | `60000`                 |
| `PARALLEL_DEFAULT_MAX_RETRIES`   | Default parallel retry count.         | `2`                     |
| `PARALLEL_RETRY_BACKOFF_BASE_MS` | Base retry backoff for parallel jobs. | `1000`                  |

### 9. External tools, sandboxing, and symbolic execution

| Variable                            | Purpose                                             | Default / Typical value |
| ----------------------------------- | --------------------------------------------------- | ----------------------- |
| `EXTERNAL_TOOL_TIMEOUT_MS`          | Total external tool timeout.                        | `30000`                 |
| `EXTERNAL_TOOL_PROBE_TIMEOUT_MS`    | External tool probe timeout.                        | `5000`                  |
| `EXTERNAL_TOOL_PROBE_CACHE_TTL_MS`  | Probe cache TTL for external tools.                 | `60000`                 |
| `EXTERNAL_TOOL_FORCE_KILL_GRACE_MS` | Grace period before force-killing an external tool. | `2000`                  |
| `EXTERNAL_TOOL_MAX_STDOUT_BYTES`    | Max stdout bytes captured from external tools.      | `10485760`              |
| `EXTERNAL_TOOL_MAX_STDERR_BYTES`    | Max stderr bytes captured from external tools.      | `1048576`               |
| `SANDBOX_EXEC_TIMEOUT_MS`           | Sandbox execution timeout.                          | `5000`                  |
| `SANDBOX_MEMORY_LIMIT_MB`           | Sandbox memory limit.                               | `128`                   |
| `SANDBOX_STACK_SIZE_MB`             | Sandbox stack size.                                 | `4`                     |
| `SANDBOX_TERMINATE_GRACE_MS`        | Sandbox termination grace timeout.                  | `2000`                  |
| `SYMBOLIC_EXEC_MAX_PATHS`           | Maximum symbolic execution path count.              | `100`                   |
| `SYMBOLIC_EXEC_MAX_DEPTH`           | Maximum symbolic execution depth.                   | `50`                    |
| `SYMBOLIC_EXEC_TIMEOUT_MS`          | Symbolic execution timeout.                         | `30000`                 |
| `PACKER_SANDBOX_TIMEOUT_MS`         | Packer sandbox timeout.                             | `3000`                  |

### 10. LLM token budgets for analysis routines

| Variable                       | Purpose                                        | Default / Typical value |
| ------------------------------ | ---------------------------------------------- | ----------------------- |
| `ADV_DEOBF_LLM_MAX_TOKENS`     | Max tokens for advanced deobfuscation prompts. | `3000`                  |
| `VM_DEOBF_LLM_MAX_TOKENS`      | Max tokens for VM deobfuscation prompts.       | `4000`                  |
| `DEOBF_LLM_MAX_TOKENS`         | Max tokens for general deobfuscation prompts.  | `2000`                  |
| `CRYPTO_DETECT_LLM_MAX_TOKENS` | Max tokens for crypto detection prompts.       | `2000`                  |

### 11. Workflow batch and bundle cache tuning

| Variable                          | Purpose                                            | Default / Typical value |
| --------------------------------- | -------------------------------------------------- | ----------------------- |
| `WORKFLOW_BATCH_MAX_RETRIES`      | Default max retries for workflow batch operations. | `3`                     |
| `WORKFLOW_BATCH_MAX_TIMEOUT_MS`   | Default max timeout for workflow batch operations. | `300000`                |
| `WORKFLOW_BUNDLE_CACHE_TTL_MS`    | Workflow bundle cache TTL.                         | `300000`                |
| `WORKFLOW_BUNDLE_CACHE_MAX_BYTES` | Workflow bundle cache size cap.                    | `104857600`             |

### 12. Memory operations

| Variable                             | Purpose                                     | Default / Typical value |
| ------------------------------------ | ------------------------------------------- | ----------------------- |
| `MEMORY_READ_TIMEOUT_MS`             | Memory read timeout.                        | `10000`                 |
| `MEMORY_MAX_READ_BYTES`              | Max bytes for one memory read.              | `16777216`              |
| `MEMORY_WRITE_TIMEOUT_MS`            | Memory write timeout.                       | `10000`                 |
| `MEMORY_MAX_WRITE_BYTES`             | Max bytes for one memory write.             | `16384`                 |
| `MEMORY_DUMP_TIMEOUT_MS`             | Memory dump timeout.                        | `60000`                 |
| `MEMORY_SCAN_TIMEOUT_MS`             | Memory scan timeout.                        | `120000`                |
| `MEMORY_SCAN_MAX_BUFFER_BYTES`       | Max buffer bytes used during memory scan.   | `52428800`              |
| `MEMORY_SCAN_MAX_RESULTS`            | Max memory scan results.                    | `10000`                 |
| `MEMORY_SCAN_MAX_REGIONS`            | Max scanned memory regions.                 | `50000`                 |
| `MEMORY_SCAN_REGION_MAX_BYTES`       | Max bytes per scanned region.               | `16777216`              |
| `MEMORY_INJECT_TIMEOUT_MS`           | Injection timeout.                          | `30000`                 |
| `MEMORY_MONITOR_INTERVAL_MS`         | Memory monitor polling interval.            | `1000`                  |
| `MEMORY_VMMAP_TIMEOUT_MS`            | Memory map query timeout.                   | `15000`                 |
| `MEMORY_PROTECTION_QUERY_TIMEOUT_MS` | Memory protection query timeout.            | `15000`                 |
| `MEMORY_PROTECTION_PWSH_TIMEOUT_MS`  | PowerShell memory protection query timeout. | `30000`                 |
| `NATIVE_ADMIN_CHECK_TIMEOUT_MS`      | Native admin privilege check timeout.       | `5000`                  |
| `NATIVE_SCAN_MAX_RESULTS`            | Max native scan results.                    | `10000`                 |
| `PROCESS_LAUNCH_WAIT_MS`             | Wait after launching a debug process.       | `2000`                  |
| `WIN_DEBUG_PORT_POLL_ATTEMPTS`       | Windows debug-port poll attempts.           | `20`                    |
| `WIN_DEBUG_PORT_POLL_INTERVAL_MS`    | Windows debug-port poll interval.           | `500`                   |
