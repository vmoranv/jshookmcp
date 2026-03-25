# @jshookmcp/jshook

[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-red.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-current-8A2BE2.svg)](https://modelcontextprotocol.io/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220.svg)](https://pnpm.io/)

English | [中文](./README.zh.md)

An MCP (Model Context Protocol) server with a runtime-registry-driven catalog of built-in tools for AI-assisted JavaScript analysis and security analysis. It combines browser automation, Chrome DevTools Protocol debugging, network monitoring, intelligent JavaScript hooks, LLM-powered code analysis, process and memory inspection, WASM tooling, source-map reconstruction, AST transforms, and composite workflows in a single server.

## Documentation / Quick Links

- **[📖 Read the Documentation](https://vmoranv.github.io/jshookmcp/)**
- **[🚀 Getting Started](https://vmoranv.github.io/jshookmcp/guide/getting-started.html)**
- **[⚙️ Configuration](https://vmoranv.github.io/jshookmcp/guide/configuration.html)**
- **[📚 Tool Reference](https://vmoranv.github.io/jshookmcp/reference/)**

## 🌟 Key Highlights

- 🤖 **AI-Driven Analysis**: Leverage LLMs for intelligent JavaScript deobfuscation, cryptographic algorithm detection, and AST-level code comprehension.
- ⚡ **Search-First Context Efficiency**: BM25-powered `search_tools` + dynamic boosts cut jshook's tool-schema init delta from ~40.0K+ tokens (`full`) to ~3.0K (`search`) (Claude server-side count; excludes Claude Code base prompt).
- 🎯 **Progressive Capability Tiers**: Three built-in profiles (`search`/`workflow`/`full`), with `search` as the default base tier for on-demand capability scaling.
- 🌐 **Full-Stack Automation**: Seamlessly orchestrate Chromium/Camoufox browsers, CDP debugging, and network interception as atomic actions.
- 🛡️ **Advanced Anti-Debug**: Built-in evasion for debugger statements, timing checks, and strict headless bot fingerprinting techniques.
- 🧩 **Dynamic Extensibility**: Hot-reload plugins and workflows from local directories without recompiling the core server.
- 🔧 **Zero-Wiring Extensibility**: Auto-discovered domains via `manifest.ts`, lazy handler instantiation, and B-Skeleton contracts for plugins/workflows.
- 🛠️ **Reverse Engineering Toolchain**: Integrated WASM disassembly, binary entropy analysis, in-memory scanning, and bridges for Burp Suite/Ghidra/IDA Pro.

## Features

Provides a comprehensive suite of tools for AI-assisted JavaScript analysis, browser automation, CDP debugging, network interception, memory analysis, and more.

> **[View the full feature list in the documentation ↗](https://vmoranv.github.io/jshookmcp/guide/getting-started.html)**

## Architecture & Performance

- **Progressive Tool Discovery**: `search_tools` meta-tool (BM25 ranking) + `activate_tools` / `activate_domain` + profile-based tier upgrades (`boost_profile`)
- **Search-tier behavior**: `search_tools` only searches and ranks results; it does not auto-run `activate_tools`, and it does not auto-run `boost_profile`. Preferred chain: `search_tools -> activate_tools / activate_domain -> boost_profile only when needed`
- **Do not boost for one tool**: `activate_tools` can register exact tools across tiers from the current base tier; `boost_profile` is better when you expect to reuse a broad family of related tools repeatedly
- **Lazy Domain Initialization**: Handler classes instantiated via Proxy on first invocation, not during startup
- **Domain Self-Discovery**: Runtime manifest scanning (`domains/*/manifest.ts`) replaces hardcoded imports; add new domains by creating a single manifest file
- **B-Skeleton Contracts**: Extensibility contracts for plugins (`PluginContract`), workflows (`WorkflowContract`), and observability (`InstrumentationContract`)
- **MCP ToolAnnotations**: Every tool carries semantic annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) enabling AI orchestrators to reason about tool safety and side-effects before invocation
- **Context Efficiency Benchmark**: Built-in tool-schema init delta (Claude server-side count): `search` ≈ 3K tokens vs `full` ≈ 40K+ tokens; values change as tools/descriptions evolve

## Registry Snapshot

The built-in surface below is generated from the runtime registry and checked in CI.

<!-- metadata-sync:start -->
- Package version: `0.2.4`
- Built-in domains: `23`
- Built-in tools: `328`
- Domains: `antidebug`, `browser`, `coordination`, `core`, `debugger`, `encoding`, `evidence`, `graphql`, `hooks`, `instrumentation`, `macro`, `maintenance`, `memory`, `network`, `platform`, `process`, `sandbox`, `sourcemap`, `streaming`, `trace`, `transform`, `wasm`, `workflow`
- Note: this snapshot is generated from the runtime registry; do not edit the counts by hand.
<!-- metadata-sync:end -->

> **[View the complete Tool Reference ↗](https://vmoranv.github.io/jshookmcp/reference/)**

## Project Stats

<div align="center">

## Star History

<a href="https://www.star-history.com/?repos=vmoranv%2Fjshookmcp&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=vmoranv/jshookmcp&type=date&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=vmoranv/jshookmcp&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=vmoranv/jshookmcp&type=date&legend=top-left" />
 </picture>
</a>

![Activity](https://repobeats.axiom.co/api/embed/83c000c790b1c665ff2686d2d02605412a0b8805.svg 'Repobeats analytics image')

</div>
