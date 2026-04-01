# Best Practices

Practical workflows and extension recommendations distilled from real reverse-engineering scenarios.

## Recommended Extension Workflows

The following workflows are organized by reverse-engineering task and can be invoked directly via `run_extension_workflow`:

### Signature Algorithm Location

**`signature_hunter`** — Starting from a single page action, automatically:
1. Enable network monitoring and navigate to the target page
2. Capture requests and identify signature-bearing parameters
3. Search scripts, detect crypto/obfuscation, and read Cookie/Storage in parallel
4. Extract the function dependency tree
5. Hook the signing path to capture plaintext/ciphertext
6. Extract auth surface and write findings to the evidence graph

```json
{
  "name": "run_extension_workflow",
  "arguments": {
    "workflowId": "signature_hunter",
    "input": {
      "url": "https://example.com/login",
      "targetParam": "sign",
      "enableHook": true
    }
  }
}
```

### WebSocket Protocol Reverse Engineering

**`ws_protocol_lifter`** — Automatically cluster WebSocket messages, attempt decoding (JSON/base64/protobuf/msgpack), correlate handler functions, and produce a protocol summary.

### Bundle Recovery

**`bundle_recovery`** — Collect scripts → detect webpack/source maps → recover module structure → optionally unpack with webcrack → extract function tree.

### Anti-Detection Diagnostics

**`anti_bot_diagnoser`** — Compare fingerprint differences between normal and stealth execution modes, identifying webdriver/CDP/canvas/WebRTC detection points.

### Evidence Packaging

**`evidence_pack`** — Collect requests, cookies, storage, local snapshots, and HAR exports in one step, producing a replayable evidence package.

---

## Recommended Extension Plugins

| Plugin | Purpose | Install |
|--------|---------|---------|
| `pl-qwen-mail-open-latest` | Open latest QQ Mail and extract body | `install_extension("plugin:pl-qwen-mail-open-latest")` |
| `pl-temp-mail-open-latest` | Open latest temp-mail message | same pattern |
| `pl-auth-extract` | Extract token/device-id auth elements from page | same pattern |

---

## Typical Reverse-Engineering Workflows

### Scenario 1: Login Flow Signature Location

```
1. run_extension_workflow("signature_hunter", { url, targetParam: "sign" })
   → Returns signing function path + hook points + evidence node IDs

2. manage_hooks({ action: "list" })
   → Confirm hooks are injected

3. network_extract_auth({ requestId: "..." })
   → Extract the full auth parameter chain

4. evidence_export({ format: "json" })
   → Export evidence graph for post-analysis
```

### Scenario 2: Bulk Private API Probing

```
1. api_probe_batch({ baseUrl, patterns: ["swagger", "openapi", "graphql"] })
   → Returns discovered endpoint list

2. web_api_capture_session({ url, actions: [...] })
   → Execute preset actions and capture all requests

3. search_in_scripts({ keyword: "Authorization" })
   → Locate header injection points
```

### Scenario 3: Electron App Bridge Surface Mapping

```
1. electron_bridge_mapper({ appPath: "/path/to/app" })
   → Scan preload/asar/IPC endpoints

2. manage_hooks({ action: "inject", preset: "electron-ipc" })
   → Inject IPC interceptors

3. page_navigate({ url: "file:///path/to/index.html" })
   → Trigger IPC calls and capture
```

---

## Performance and Stability Tips

### 1. Use Profile Tiers to Control Tool Visibility

- **Default startup** = `search` profile (~12 tools), minimal token overhead
- For runtime analysis, call `activate_tools(["debugger", "hooks"])`
- For deep reverse engineering, call `boost_profile("workflow")` or `boost_profile("full")`

### 2. Use Instrumentation Sessions to Manage Hook Lifecycle

```javascript
// Recommended pattern inside workflows
onStart: async (ctx) => {
  const sessionId = await ctx.invokeTool('instrumentation_session_create', {
    name: 'signature-capture-session',
  });
  ctx.setSessionData('sessionId', sessionId);
}

onFinish: async (ctx) => {
  const sessionId = ctx.getSessionData('sessionId');
  await ctx.invokeTool('instrumentation_session_close', { id: sessionId });
  await ctx.invokeTool('instrumentation_artifact_record', { sessionId });
}
```

### 3. Avoid Redundant Data Collection

- Read cached data first via `page_get_cookies` / `page_get_local_storage`
- Only call `page_navigate` + `collect_code` when a refresh is required
- After collecting large scripts, persist with `save_page_snapshot` and reuse

### 4. Timeout and Retry Strategy

- Set `timeoutMs: 30000` for individual tool calls (default 30s)
- Add `retry: { maxAttempts: 3, backoffMs: 500 }` for network-related tools
- Set workflow-level timeout: `.timeoutMs(10 * 60_000)` (10 minutes)

---

## Troubleshooting

### Extension workflows not found

**Check**:
```javascript
list_extension_workflows()
// Returns empty array?
```

**Fix**:
1. Verify `workflows/*/workflow.js` or `*/workflow.ts` exist in the workflows directory
2. Run `pnpm install` to ensure the extension registry is synced
3. Check `EXTENSION_REGISTRY_BASE_URL` in your server configuration

### Hook injected but no data captured

**Possible causes**:
- Target function runs inside an iframe/worker — context switch needed
- Hook path incorrect (e.g., `window.fetch` vs `globalThis.fetch`)
- Page has CSP enabled, blocking injected scripts

**Debug steps**:
1. `manage_hooks({ action: "list" })` — confirm hook status
2. `console_execute({ expression: "document.querySelectorAll('iframe')" })` — check iframes
3. Try `page_inject_script({ content: "...", persistent: true })` for manual injection test

---

## Next Steps

- [Domain Matrix](/en/reference/) — Full tool inventory across all domains
- [Workflow Development](/en/extensions/workflow-development) — Build your own mission workflows
- [Environment Diagnostics](/en/operations/doctor-and-artifacts) — Check bridge health status
