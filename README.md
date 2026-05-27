# @jshookmcp/jshook

[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-red.svg)](LICENSE)
[![Node.js 22.12+](https://img.shields.io/badge/node-22.12%2B-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-current-8A2BE2.svg)](https://modelcontextprotocol.io/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220.svg)](https://pnpm.io/)

English | [中文](./README.zh.md)

An MCP server that gives AI agents **402 tools across 36 domains** for JavaScript analysis and security research — browser automation, CDP debugging, network interception, JS hooks, LLM-powered code analysis, process/memory forensics, WASM reverse engineering, source-map reconstruction, AST transforms, and composite workflows in a single server.

## Quick Links

- **[📖 Documentation](https://vmoranv.github.io/jshookmcp/)** · **[🚀 Getting Started](https://vmoranv.github.io/jshookmcp/guide/getting-started.html)** · **[⚙️ Configuration](https://vmoranv.github.io/jshookmcp/guide/configuration.html)** · **[📚 Tool Reference](https://vmoranv.github.io/jshookmcp/reference/)**

## 🚀 Quick Start

No global install needed — add to your MCP client config and you're ready:

**Claude Desktop / Cursor (`claude_desktop_config.json`)**:

```json
{
  "mcpServers": {
    "jshook": {
      "command": "npx",
      "args": ["-y", "@jshookmcp/jshook@latest"],
      "env": { "JSHOOK_BASE_PROFILE": "search" }
    }
  }
}
```

*(Windows: use `npx.cmd` absolute path if `npx` is not found)*

## 🌟 Highlights

- 🤖 **AI-Driven Analysis** — LLM-powered deobfuscation, crypto detection, AST comprehension
- ⚡ **Search-First Context Efficiency** — `search` profile ≈ 3K tokens vs `full` ≈ 40K+ tokens
- 🎯 **Progressive Tiers** — `search` → `workflow` → `full`, activate on demand
- 🌐 **Full-Stack Browser Automation** — Chromium/Camoufox + CDP + anti-detection + CAPTCHA handling
- 🔁 **Runtime Recovery and Session Isolation** — HTTP sessions restore activated domains, browser attach state, coverage state, and isolate browser-side session state per client
- 🧭 **Schema-First Meta Tools** — `describe_tool`, validated `call_tool`, and `coverage_report` reduce parameter errors and make tool coverage visible
- 📡 **Network Interception** — HTTP/2 frame building, MiTM capture, GraphQL, Burp Suite bridge
- 🛠️ **Reverse Engineering Toolchain** — WASM disassembly, binary analysis, Frida, Ghidra/IDA bridges
- 🧰 **Process & Memory Forensics** — Native FFI scanning, hardware breakpoints, PE introspection
- 🧩 **Dynamic Extensibility** — Hot-reload plugins, declarative workflows, auto-discovered domains

## Recent Runtime Notes

- HTTP transport now multiplexes independent MCP sessions and restores runtime state after reconnects.
- `proxy_start` auto-generates a local HTTPS interception CA when needed.
- Browser CAPTCHA solving is now explicit-input driven: pass `taskKind`, `siteKey`, `imageBase64`, `callbackName`, and `responseSelector` as needed. Built-in widget/page signature probing is intentionally not used.

## Architecture

- **Runtime Registry** — Domains auto-discovered via `manifest.ts`; add a domain by creating one file
- **Lazy Initialization** — Handlers instantiated on first call, not at startup
- **BM25 + Vector Search** — `search_tools` meta-tool with hybrid ranking and adaptive weights
- **MCP ToolAnnotations** — Every tool carries `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`

## Registry Snapshot

The built-in surface below is generated from the runtime registry and checked in CI.

<!-- metadata-sync:start -->
- Package version: `0.3.1`
- Built-in Tools: `415`
- Domains: `adb-bridge`, `antidebug`, `apk-packer`, `binary-instrument`, `boringssl-inspector`, `browser`, `canvas`, `coordination`, `core`, `cross-domain`, `dart-inspector`, `debugger`, `encoding`, `evidence`, `extension-registry`, `graphql`, `hooks`, `instrumentation`, `macro`, `maintenance`, `memory`, `mojo-ipc`, `network`, `platform`, `process`, `protocol-analysis`, `proxy`, `sandbox`, `shared-state-board`, `skia-capture`, `sourcemap`, `streaming`, `syscall-hook`, `trace`, `transform`, `v8-inspector`, `wasm`, `workflow`
- Note: this snapshot is generated from the runtime registry; do not edit the counts by hand.
<!-- metadata-sync:end -->

> **[View the complete Tool Reference ↗](https://vmoranv.github.io/jshookmcp/reference/)**

## Project Stats

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
