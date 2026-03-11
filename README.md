# @jshookmcp/jshook

[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-red.svg)](LICENSE)
[![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-current-8A2BE2.svg)](https://modelcontextprotocol.io/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220.svg)](https://pnpm.io/)

English | [中文](./README.zh.md)

An MCP (Model Context Protocol) server providing **245 built-in tools** — **238 domain tools across 16 domains** plus **8 built-in meta-tools** — with runtime extension loading from `plugins/` and `workflows/` for AI-assisted JavaScript analysis and security analysis. Combines browser automation, Chrome DevTools Protocol debugging, network monitoring, intelligent JavaScript hooks, LLM-powered code analysis, process/memory inspection, WASM toolchain, binary encoding, anti-anti-debug, GraphQL discovery, source map reconstruction, AST transforms, crypto reconstruction, platform package analysis, Burp Suite / native analysis tool bridges, human behavior simulation, CAPTCHA solving, batch account workflows, and high-level composite workflow orchestration in a single server.

## Documentation / Quick Links

- **[📖 Read the Documentation](https://vmoranv.github.io/jshookmcp/)**
- **[🚀 Getting Started](https://vmoranv.github.io/jshookmcp/guide/getting-started.html)**
- **[⚙️ Configuration](https://vmoranv.github.io/jshookmcp/guide/configuration.html)**
- **[📚 Tool Reference](https://vmoranv.github.io/jshookmcp/reference/)**

## 🌟 Key Highlights

- 🤖 **AI-Driven Analysis**: Leverage LLMs for intelligent JavaScript deobfuscation, cryptographic algorithm detection, and AST-level code comprehension.
- ⚡ **Search-First Context Efficiency**: BM25-powered `search_tools` with dynamic boost reduces init context from ~18K tokens to ~800 tokens in search profiles.
- 🎯 **Progressive Capability Tiers**: Four built-in profiles (`search`/`minimal`/`workflow`/`full`) for on-demand capability scaling.
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
- **Lazy Domain Initialization**: Handler classes instantiated via Proxy on first invocation, not during startup
- **Domain Self-Discovery**: Runtime manifest scanning (`domains/*/manifest.ts`) replaces hardcoded imports; add new domains by creating a single manifest file
- **B-Skeleton Contracts**: Extensibility contracts for plugins (`PluginContract`), workflows (`WorkflowContract`), and observability (`InstrumentationContract`)
- **Context Efficiency Benchmark**: Measured ~3k tokens for `search` profile vs ~40K for `full` profile (245 tools, dynamic based on loaded extensions)

## Tool Domains

The server provides **245 built-in tools** across **16 domains** (Browser, Debugger, Network, Hooks, Maintenance, Core Analysis, Process/Memory, Workflows, WASM, Streaming, Encoding, Anti-Debug, GraphQL, Platform, Burp Suite, and Native Analysis).

> **[View the complete Tool Reference ↗](https://vmoranv.github.io/jshookmcp/reference/)**

## Project Stats

<div align="center">

## Star History

<a href="https://www.star-history.com/?repos=vmoranv%2Fjshookmcp&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=vmoranv/jshookmcp&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=vmoranv/jshookmcp&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=vmoranv/jshookmcp&type=date&legend=top-left" />
 </picture>
</a>

![Activity](https://repobeats.axiom.co/api/embed/83c000c790b1c665ff2686d2d02605412a0b8805.svg 'Repobeats analytics image')

</div>
