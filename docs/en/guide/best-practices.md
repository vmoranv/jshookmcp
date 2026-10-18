# Best Practices

A hands-on guide for first-time jshookmcp users — get running quickly and avoid common pitfalls.

## Configuration

All jshookmcp parameters have built-in defaults — **most users can start without any configuration**. To override defaults, choose the method that matches your installation:

### npx / MCP Users (Recommended)

Users installing via `npx` or an MCP client pass environment variables in the MCP config's `env` field — **no `.env` file needed**:

```json
{
  "mcpServers": {
    "jshook": {
      "command": "npx",
      "args": ["-y", "@jshookmcp/jshook@latest"],
      "env": {
        "MCP_TOOL_PROFILE": "workflow",
        "npm_config_omit": "optional"
      }
    }
  }
}
```

Add more parameters as needed in the `env` object:

```json
"env": {
  "MCP_TOOL_PROFILE": "workflow",
  "npm_config_omit": "optional",
  "PUPPETEER_HEADLESS": "true",
  "ENABLE_CACHE": "true",
  "EXTENSION_REGISTRY_BASE_URL": "https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry"
}
```

### Source Developers

Users who clone the repo for development can create a `.env` file in the project root (see `.env.example` for a template). Runtime reads from `src/utils/config.ts`; unset variables fall back to code defaults.

```bash
# .env — project root
PUPPETEER_HEADLESS=true
MCP_TOOL_PROFILE=workflow
```

> **Note**: Variable names and effects are identical regardless of method — only the delivery channel differs. See the [Configuration Reference](/en/guide/configuration) for all available variables.

---

## Profile Selection Guide

| Scenario | Recommended Profile | Why |
|----------|-------------------|-----|
| Day-to-day reverse engineering | `workflow` | Browser, network, and debugger stay resident; activate instrumentation when needed, with moderate token cost |
| Search/exploration only | `search` | Registers only 8 meta-tools at startup; other domains stay lazy-activatable, with the lowest token cost |
| Deep analysis (WASM/process/memory) | `full` | All domains pre-loaded, designed for heavy tasks |

Switch profile (choose one):

```bash
# Option 1: MCP config env field
"MCP_TOOL_PROFILE": "workflow"

# Option 2: .env file (source developers only)
MCP_TOOL_PROFILE=workflow
```

---

## Recommended Extensions to Install

Install official extensions via the `install_extension` tool:

### Workflows (Task Pipelines)

| Workflow | Purpose | Install |
|----------|---------|---------|
| `signature_hunter` | Signature algorithm locator: auto-capture requests, identify crypto params, hook signing paths | `install_extension("workflow:signature_hunter")` |
| `ws_protocol_lifter` | WebSocket protocol RE: message clustering, encoding detection, handler correlation | `install_extension("workflow:ws_protocol_lifter")` |
| `bundle_recovery` | Bundle recovery: webpack enumeration, source map recovery, module structure restoration | `install_extension("workflow:bundle_recovery")` |
| `anti_bot_diagnoser` | Anti-detection diagnostics: compare stealth/normal fingerprint differences | `install_extension("workflow:anti_bot_diagnoser")` |
| `evidence_pack` | Evidence packaging: one-click collect requests, cookies, snapshots into replayable bundle | `install_extension("workflow:evidence_pack")` |

### Plugins (Tool Extensions)

| Plugin | Purpose | Install |
|--------|---------|---------|
| `pl-auth-extract` | Extract token/device-id auth elements from page | `install_extension("plugin:pl-auth-extract")` |
| `pl-qwen-mail-open-latest` | Open latest QQ Mail and extract body | `install_extension("plugin:pl-qwen-mail-open-latest")` |
| `pl-temp-mail-open-latest` | Open latest temp-mail message | `install_extension("plugin:pl-temp-mail-open-latest")` |

After installing, use `list_extension_workflows()` / `run_extension_workflow()` to invoke them.

---

## Environment Tuning

> Examples below use `.env` syntax. npx users should convert to JSON key-value pairs in the MCP config `env` field.

### Browser Configuration

```bash
# Specify Chrome path (when auto-detection fails)
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
# or on Windows
CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe

# Reclaim a launched browser after five idle minutes; 0 disables reclamation
BROWSER_IDLE_TIMEOUT_MS=300000

```

### Performance Tuning

```bash
# Token budget (prevent context explosion)
TOKEN_BUDGET_MAX_TOKENS=200000

# Concurrency controls
jshook_IO_CONCURRENCY=4       # I/O concurrency cap
jshook_CDP_CONCURRENCY=2       # CDP operation concurrency cap
MAX_CONCURRENT_ANALYSIS=3      # Analysis task concurrency cap

# Cache (recommended — reduces redundant collection)
ENABLE_CACHE=true
CACHE_TTL=3600

# Bound retained network response bodies
NETWORK_BODY_CACHE_MAX_TOTAL_BYTES=67108864

# Vector search is on for every transport by default (static model, catalog
# embeddings cached on disk). Set false for lexical-only search.
SEARCH_VECTOR_ENABLED=true

# Warn on duplicate stdio processes; optionally hard-cap them
JSHOOK_INSTANCE_WARN_AT=2
JSHOOK_MAX_INSTANCES=0
```

### Timeout Settings

```bash
# Browser operation timeout
PUPPETEER_TIMEOUT=30000

# External tool timeout
EXTERNAL_TOOL_TIMEOUT_MS=30000

# Workflow batch timeout
WORKFLOW_BATCH_MAX_TIMEOUT_MS=300000
```

---

## Common Issues

### Can't Find Tools

**Cause**: Current profile doesn't include the target domain.

**Fix**:

1. Switch to a higher profile: `MCP_TOOL_PROFILE=workflow`
2. Or activate at runtime: `activate_domain({ domain: "debugger" })` and `activate_domain({ domain: "instrumentation" })`

### Extension Installation Fails

**Check**:

1. Verify registry URL is configured: `EXTENSION_REGISTRY_BASE_URL=https://...`
2. Verify network connectivity (requires access to GitHub raw content)
3. Run `doctor_environment()` for diagnostics

### Hook Injected But No Data Captured

**Possible causes**:

- Target function runs inside an iframe/worker — context switch needed
- Page has CSP enabled, blocking injected scripts
- Hook path incorrect (e.g., `window.fetch` vs `globalThis.fetch`)

**Debug**: Call `manage_hooks({ action: "list" })` to check status.

### Browser Won't Start

**Check in order**:

1. Run `doctor_environment()` to check dependencies
2. Explicitly set browser path: `PUPPETEER_EXECUTABLE_PATH=...`
3. Check whether the browser remote-debugging port is already in use

---

## Next Steps

- [Configuration Reference](/en/guide/configuration) — Full configuration reference
- [Tool Routing](/en/guide/tool-selection) — Profile and routing mechanism details
- [Domain Matrix](/en/reference/) — Full tool inventory across all domains
- [Workflow Development](/en/extensions/workflow-development) — Build your own workflows
- [Environment Diagnostics](/en/operations/doctor-and-artifacts) — Check bridge health status
