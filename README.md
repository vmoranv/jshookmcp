<div align="center">

<img src="docs/public/favicon.png" width="96" alt="@jshookmcp/jshook" />

# @jshookmcp/jshook

[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-red.svg)](LICENSE)
[![Node.js 22.22.2+](https://img.shields.io/badge/node-22.22.2%2B%20%7C%7C%2024.15%2B-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-current-8A2BE2.svg)](https://modelcontextprotocol.io/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220.svg)](https://pnpm.io/)

### A search-first, profile-aware reverse-engineering workspace for AI agents.

**Hook the page, capture the network, deobfuscate the bundle, disassemble the WASM, instrument the process — and let one MCP server keep the whole attack surface in reach without drowning the model in schemas.**

English · [中文](./README.zh.md)

<p align="center">
  <a href="https://github.com/vmoranv/jshookmcp/stargazers">
    <img src="https://img.shields.io/github/stars/vmoranv/jshookmcp?style=for-the-badge" alt="Stars" />
  </a>
  <a href="https://github.com/vmoranv/jshookmcp/network/members">
    <img src="https://img.shields.io/github/forks/vmoranv/jshookmcp?style=for-the-badge" alt="Forks" />
  </a>
  <a href="https://github.com/vmoranv/jshookmcp/releases/tag/v0.3.5">
    <img src="https://img.shields.io/github/v/tag/vmoranv/jshookmcp?style=for-the-badge&sort=semver" alt="Latest Release" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-AGPLv3-red?style=for-the-badge" alt="License" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@jshookmcp/jshook">
    <img src="https://img.shields.io/npm/v/@jshookmcp/jshook?style=for-the-badge&logo=npm" alt="npm version" />
  </a>
  <a href="https://nodejs.org/">
    <img src="https://img.shields.io/badge/node-22.12%2B-brightgreen?style=for-the-badge&logo=node.js" alt="Node.js 22.12+" />
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript strict" />
  </a>
  <a href="https://modelcontextprotocol.io/">
    <img src="https://img.shields.io/badge/MCP-current-8A2BE2?style=for-the-badge" alt="MCP current" />
  </a>
</p>

<p align="center">
  <a href="#what-makes-jshook-different">What's different</a> ·
  <a href="#capability-overview">Capabilities</a> ·
  <a href="#use-cases">Use cases</a> ·
  <a href="#highlights">Highlights</a> ·
  <a href="#transport-and-deployment">Transport</a> ·
  <a href="#registry-snapshot">Registry</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#build-from-source">Build</a>
</p>

<p align="center">
  <a href="https://vmoranv.github.io/jshookmcp/">Documentation</a> ·
  <a href="https://vmoranv.github.io/jshookmcp/guide/getting-started.html">Getting Started</a> ·
  <a href="https://vmoranv.github.io/jshookmcp/guide/configuration.html">Configuration</a> ·
  <a href="https://vmoranv.github.io/jshookmcp/reference/">Tool Reference</a>
</p>

<p align="center">
  <a href="https://www.swiftproxy.net/?code=R6KSMPQZ5">
    <img src="docs/public/swiftproxy_sponsor.png" alt="Sponsored by Swiftproxy" width="640" />
  </a>
</p>

<p align="center">
  <a href="https://www.swiftproxy.net/?code=R6KSMPQZ5">
    <b>Sponsored by Swiftproxy</b>
  </a> — Premium Residential Proxies for Web Automation · 10% off code: <code>PROXY90</code>
</p>

---

</div>

## What makes jshook different

Most MCP servers for JS analysis expose a handful of hand-rolled tools or wrap a single browser engine. jshook is closer to an **operating system for front-end reverse engineering** — 34 self-discovered domains, a search-first meta-tool that keeps token cost under control, and runtime recovery that survives broken pages and dropped sessions:

- **Search-first, profile-aware.** The `search` profile loads about 3K tokens of tool metadata; the `full` profile exposes all 716 tools at around 40K tokens. Agents move between them as the task grows — `search` → `workflow` → `full` — instead of drowning in schemas from the first turn.
- **Runtime recovery and session isolation.** Streamable HTTP sessions restore activated domains, browser attach state, and coverage state after reconnects; per-client browser-side state stays isolated so two agents cannot trample each other's CDP sessions.
- **Full-stack browser automation.** Chromium and Camoufox via CDP with anti-detection, an explicit-input CAPTCHA solver (no built-in page/feature probing), a self-signed HTTPS interception CA on demand, and HTTP/2 frame building.
- **Real reverse engineering, not string searches.** WASM disassembly via Binaryen, Frida/Ghidra/IDA bridges, native FFI scanning, hardware breakpoints, PE introspection, GraphQL/Burp Suite proxy bridges, and AST transforms — not a single regex call wrapped as a tool.
- **Dynamic extensibility.** Hot-reload plugins, declarative workflows, and auto-discovery keep the server growing without a redeploy.

---

## Capability overview

A scan of what's in the box. Each row links to the detailed [Feature map](#full-feature-map) below.

| Area | Highlights |
| --- | --- |
| **Tool profiles** | `search` (~3K tokens, BM25 + hybrid vector ranking) · `workflow` (composite scripts) · `full` (all 716 tools) |
| **Browser automation** | Chromium and Camoufox · CDP attach to existing targets · anti-detection presets · explicit-input CAPTCHA solver · popup, download, permission, and protocol interceptors |
| **Network interception** | HTTP/1.1 + HTTP/2 frame building · MITM proxy with auto-generated CA · WebSocket capture · GraphQL introspection helpers · Burp Suite bridge |
| **JS hooks and analysis** | LLM-powered deobfuscation · crypto routine detection · AST comprehension · source-map reconstruction · script/scriptlet extraction and replay |
| **WASM reverse engineering** | Binaryen disassembly · module inspection · import/export analysis · cross-reference graphs · runtime instrumentation |
| **Process and memory forensics** | Native FFI scanning · hardware breakpoints · PE introspection · live process attach · memory read/write with region guards |
| **Binary instrumentation** | Frida bridge · Ghidra and IDA bridges · syscall hooking · BoringSSL inspector · BoringSSL/Mojo IPC analysis |
| **Native runtime** | Native emulator for foreign-architecture samples · platform introspection · Mojo IPC · Dart Inspector · ADB bridge for on-device traffic |
| **Encoding and transform** | URL/Base64/Hex/JWT/Protobuf encoders · AST transforms · streaming decode pipelines |
| **Coordination** | Background task queue with progress, cancellation, and async modes · multi-agent coordination · coverage reports |
| **Schema-first meta tools** | `describe_tool` · `call_tool` with argument validation · `coverage_report` · `search_tools` |
| **Pluggable extension registry** | Hot-reload plugins · declarative workflows · auto-discovered domains |

---

## Use cases

| Scenario | What you do | Domains involved |
| --- | --- | --- |
| Skim a minified bundle | `search_tools` → `deobfuscate` → `format` → `extract-endpoints` | `transform`, `core` |
| Reverse a CAPTCHA challenge | Drive a Camoufox page → screenshot → solve with explicit input → replay | `browser`, `canvas` |
| Capture and replay an OAuth flow | `proxy_start` (auto CA) → `network_capture` → `graph_dump` → replay | `proxy`, `network`, `graphql` |
| Reverse a WASM crypto routine | `wasm_load` → `wasm_disassemble` → `binary-instrument.hook` → memory trace | `wasm`, `binary-instrument`, `memory` |
| Recover a dropped browser session | Reconnect Streamable HTTP → restore activated domains and browser state | `browser`, `coordination` |
| Audit a Node process for credentials | `process.list` → `memory.scan` for sensitive patterns → export | `process`, `memory`, `encoding` |
| Build a custom workflow | `workflow.register` with YAML steps → `workflow.run` | `workflow`, `extension-registry` |
| Hook a function in a live process | Frida script → `binary-instrument.attach` → breakpoint → log calls | `binary-instrument`, `syscall-hook` |

---

## Quick start

No global install needed — add to your MCP client config and you're ready.

**Claude Desktop / Cursor (`claude_desktop_config.json`):**

```json
{
  "mcpServers": {
    "jshook": {
      "command": "npx",
      "args": ["-y", "@jshookmcp/jshook@latest"],
      "env": {
        "MCP_TOOL_PROFILE": "search",
        "npm_config_omit": "optional"
      }
    }
  }
}
```

*(Windows: use `npx.cmd` absolute path if `npx` is not found.)*

This lightweight configuration skips optional ONNX, Z3, Binaryen, Camoufox, and Playwright
packages. Remove `npm_config_omit` when those full-profile runtimes are required.

### Share one daemon across multiple agents

The default stdio configuration starts one full jshook process per MCP host. To share the
embedding model, browser runtime, and caches, start one local Streamable HTTP daemon:

```bash
pnpm build
pnpm daemon
```

Vector search defaults to off for per-client stdio processes and on (lazy-loaded) for the shared
HTTP daemon. Set `SEARCH_VECTOR_ENABLED=false` when lexical search is sufficient.

Then point every MCP client at `http://127.0.0.1:3000/mcp` using its HTTP/URL server
configuration. Each client receives its own MCP session and response route while heavyweight
runtime resources remain in one process. Keep the default loopback bind; set `MCP_AUTH_TOKEN`
before exposing the endpoint beyond localhost.

### Promote a profile as the task grows

```jsonc
{
  "env": {
    "MCP_TOOL_PROFILE": "search"     // start here, ~3K tokens of metadata
  }
}
```

Switch `MCP_TOOL_PROFILE` to `workflow` once you start chaining composite scripts, or to `full`
when you need every tool. `coverage_report` shows the active set on demand.

---

## Highlights

- **Profile ladder.** Start in `search` (~3K tokens of metadata); promote to `workflow` when chaining composite scripts; escalate to `full` only when every tool is actually needed. `coverage_report` shows what's active on demand.
- **Meta tools.** `describe_tool` returns the JSON Schema; `call_tool` validates arguments before invocation; every tool ships with `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`.
- **Browser automation.** Chromium and Camoufox via CDP, attach to existing targets, anti-detection presets, popup/download/permission interceptors, explicit-input CAPTCHA solver, JS/CSS injection at three document phases, persisted coverage across reconnects.
- **Network interception.** Auto-generated HTTPS interception CA, HTTP/1.1 + HTTP/2 frame building, WebSocket capture, GraphQL helpers, Burp Suite bridge — all on the same MCP tool surface.
- **Reverse engineering.** Binaryen WASM disassembly, Frida/Ghidra/IDA bridges, hardware breakpoints, native FFI scanning, PE introspection, syscall hooking, AST transforms, source-map reconstruction.
- **Session recovery.** Streamable HTTP transport restores activated domains, browser attach state, and coverage state after reconnects; browser-side state is isolated per client.
- **Plugins and workflows.** Drop a directory, get a domain. Write a YAML pipeline, run it as one tool. The registry self-discovers.

---

## Transport and deployment

The server supports two transports out of the box.

| Transport | When to use | Notes |
| --- | --- | --- |
| **stdio** | Default for Claude Desktop, Cursor, and other single-host clients | One full process per MCP host; lightweight profile recommended |
| **Streamable HTTP** | Multiple agents sharing the embedding model, browser runtime, and caches | Loopback bind by default; set `MCP_AUTH_TOKEN` before exposing externally |

Both transports expose the same tool surface. `coverage_report` shows which domains are
activated in each session — long-running sessions restore browser attach state, coverage state,
and tool activations across reconnects.

For production deployments see the [Security and Production guide](https://vmoranv.github.io/jshookmcp/operations/security-and-production.html).

---

## Recent runtime notes

- HTTP transport now multiplexes independent MCP sessions and restores runtime state after reconnects.
- `proxy_start` auto-generates a local HTTPS interception CA when needed.
- Browser CAPTCHA solving is now explicit-input driven: pass `taskKind`, `siteKey`, `imageBase64`, `callbackName`, and `responseSelector` as needed. Built-in widget/page signature probing is intentionally not used.

---

## Registry snapshot

The built-in surface below is generated from the runtime registry and checked in CI.

<!-- metadata-sync:start -->
- Package version: `0.3.5`
- Built-in tools: `723`
- Domains: `adb-bridge`, `binary-instrument`, `boringssl-inspector`, `browser`, `canvas`, `coordination`, `core`, `cross-domain`, `dart-inspector`, `debugger`, `encoding`, `exploit-dev`, `extension-registry`, `graphql`, `instrumentation`, `maintenance`, `memory`, `mojo-ipc`, `native-bridge`, `native-emulator`, `network`, `platform`, `process`, `protocol-analysis`, `proxy`, `sourcemap`, `streaming`, `syscall-hook`, `tasks`, `trace`, `transform`, `v8-inspector`, `wasm`, `webgpu`, `workflow`
- Note: this snapshot is generated from the runtime registry; do not edit the counts by hand.
<!-- metadata-sync:end -->

> **[View the complete Tool Reference ↗](https://vmoranv.github.io/jshookmcp/reference/)**

---

## Architecture

- **Runtime registry** — domains auto-discovered via `manifest.ts`; add a domain by creating one file.
- **Lazy initialization** — handlers instantiated on first call, not at startup.
- **BM25 + vector search** — `search_tools` meta-tool with hybrid ranking and adaptive weights.
- **MCP `ToolAnnotations`** — every tool carries `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`.
- **Profile ladder** — `search` (~3K tokens) → `workflow` (composite scripts) → `full` (all 716 tools).
- **Transport symmetry** — stdio and Streamable HTTP expose the same surface; sessions are isolated per client.

See the [Architecture guide](https://vmoranv.github.io/jshookmcp/guide/best-practices.html) and [Configuration reference](https://vmoranv.github.io/jshookmcp/guide/configuration.html) for the canonical details.

---

## Build from source

Requirements: Node.js 22.12+, pnpm 10.x.

```bash
pnpm install
pnpm build
pnpm start           # run the built server from dist/
pnpm dev             # run from source under tsx watch
pnpm check           # metadata check + lint + format check + typecheck + unit tests
pnpm test            # Vitest unit suites
pnpm test:e2e        # end-to-end browser/tooling suites
pnpm daemon          # run the Streamable HTTP daemon after build
```

Native helpers are bundled via `pnpm build`; on first run the server may download optional
runtimes (ONNX, Z3, Binaryen, Camoufox, Playwright) depending on the profile.

---

## Project stats

<div align="center">

<a href="https://www.star-history.com/?repos=vmoranv%2Fjshookmcp&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=vmoranv/jshookmcp&type=date&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=vmoranv/jshookmcp&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/image?repos=vmoranv/jshookmcp&type=date&legend=top-left" />
  </picture>
</a>

![Activity](https://repobeats.axiom.co/api/embed/83c000c790b1c665ff2686d2d02605412a0b8805.svg 'Repobeats analytics image')

</div>

---

## License

[AGPLv3](./LICENSE).
