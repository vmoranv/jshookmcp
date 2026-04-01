# Best Practices

A hands-on guide for first-time jshookmcp users — get running quickly and avoid common pitfalls.

## Recommended `.env` Configuration

### Minimal Startup

```bash
# .env — minimal working config
PUPPETEER_HEADLESS=true
MCP_TOOL_PROFILE=workflow        # recommended default, covers 90% of RE tasks
DYNAMIC_BOOST_ENABLED=true       # auto-upgrade missing domains on demand
```

### When You Need AI-Assisted Analysis

```bash
# LLM config (required for deobfuscation, smart hook generation, etc.)
DEFAULT_LLM_PROVIDER=openai
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4-turbo-preview
OPENAI_BASE_URL=https://api.openai.com/v1
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

With `DYNAMIC_BOOST_ENABLED=true`, even the `search` profile will auto-upgrade to needed domains on demand — no need to manually switch to `full`.

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

# Debug port (connect to an already-running browser)
DEFAULT_DEBUG_PORT=9222
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

1. Enable auto-upgrade: `DYNAMIC_BOOST_ENABLED=true`
2. Or switch to a higher profile: `MCP_TOOL_PROFILE=workflow`
3. Or activate at runtime: `activate_tools(["debugger", "hooks"])`

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
3. Check if port is in use: `DEFAULT_DEBUG_PORT=9222`

---

## Next Steps

- [.env and Configuration](/en/guide/configuration) — Full configuration reference
- [Tool Routing](/en/guide/tool-selection) — Profile and routing mechanism details
- [Domain Matrix](/en/reference/) — Full tool inventory across all domains
- [Workflow Development](/en/extensions/workflow-development) — Build your own workflows
- [Environment Diagnostics](/en/operations/doctor-and-artifacts) — Check bridge health status
