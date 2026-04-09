# Best Practices

A hands-on guide for first-time jshookmcp users — get running quickly and avoid common pitfalls.

## Recommended `.env` Configuration

### Minimal Startup

```bash
# .env — minimal working config
PUPPETEER_HEADLESS=true
MCP_TOOL_PROFILE=workflow        # recommended default, covers 90% of RE tasks
```

### When You Need the Extension Ecosystem

```bash
# Extension registry (required to install official workflows/plugins)
EXTENSION_REGISTRY_BASE_URL=https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry
```

---

## Profile Selection Guide

| Scenario | Recommended Profile | Why |
|----------|-------------------|-----|
| Day-to-day reverse engineering | `workflow` | Browser, network, debugger, hooks always resident; moderate token cost |
| Search/exploration only | `search` | Minimal mode, only meta-tools exposed, lowest token cost |
| Deep analysis (WASM/process/memory) | `full` | All domains pre-loaded, designed for heavy tasks |

```bash
# Set in .env
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

### Browser Configuration

```bash
# Specify Chrome path (when auto-detection fails)
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
# or on Windows
CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe

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
2. Or activate at runtime: `activate_tools(["debugger", "hooks"])`

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

- [.env and Configuration](/en/guide/configuration) — Full configuration reference
- [Tool Routing](/en/guide/tool-selection) — Profile and routing mechanism details
- [Domain Matrix](/en/reference/) — Full tool inventory across all domains
- [Workflow Development](/en/extensions/workflow-development) — Build your own workflows
- [Environment Diagnostics](/en/operations/doctor-and-artifacts) — Check bridge health status
