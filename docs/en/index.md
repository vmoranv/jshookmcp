---
layout: home

hero:
  name: JSHookMCP
  text: Search-First Cross-Domain Reverse Engineering Workspace
  tagline: "735 tools across 36 domains for AI agents: unifying network packets, DOM, V8/WASM, native memory, headless Unicorn JNI emulation, and kernel syscalls with a 3K-token profile ladder."
  image:
    src: /favicon.png
    alt: JSHookMCP
  actions:
    - theme: brand
      text: Getting Started
      link: /en/guide/getting-started
    - theme: alt
      text: 36 Domains Reference
      link: /en/reference/

features:
  - title: Search-First 3K Ladder
    icon: ⚡
    details: "Eliminates LLM context bloat. Instead of loading 735 tool schemas (~50K tokens), a ~3K token discovery core uses BM25 + ONNX micro-embeddings + RRF to activate tools lazily."
  - title: Cross-Domain Causal Evidence
    icon: 🌐
    details: "First-of-its-kind 7-layer causality graph correlating HTTP/2 network packets <-> DOM <-> JS AST & Turbofan JIT <-> WASM <-> Native Memory <-> Unicorn JNI <-> Syscalls."
  - title: Headless Android JNI Emulation
    icon: 📱
    details: "Built-in Unicorn ARM/ARM64 CPU engine (nemu). Loads and executes Android .so binaries in-process with automated Java JNI mocking — zero phones or emulators required."
  - title: Flutter & Dart AOT Introspection
    icon: 🎯
    details: "Solves modern Flutter reverse engineering by parsing Dart AOT snapshot headers, dumping object pools, scanning SMIs, and reconstructing function call graphs."
  - title: Chromium Mojo IPC Sniffing
    icon: 🔬
    details: "Direct access to Chromium internal multi-process communication channels (Mojo IPC) to sniff, decode, and mock internal browser messages."
  - title: In-Memory Forensics
    icon: 🛡️
    details: "Cheat Engine / ReClass grade native memory inspection: AOB byte-pattern scanning, multi-level pointer map convergence, RTTI/VTable recovery, and hardware breakpoints."
---

## ⚡ Quick Start

Add this single configuration snippet to your MCP client (Claude Desktop, Cursor, Claude Code, Windsurf, or Antigravity):

```json
{
  "mcpServers": {
    "jshook": {
      "command": "npx",
      "args": ["-y", "@jshookmcp/jshook"]
    }
  }
}
```

::: tip Production Profile Tiering
By default, the server runs under `MCP_TOOL_PROFILE=search`, consuming only ~3,000 tokens of initial context. The agent automatically discovers and activates domains and specific tools on demand via `search_tools` / `route_tool` / `activate_tools`.
:::

---

## Architecture & Core Differentiators

Modern security challenges (Web SPAs, Electron desktop apps, hybrid Android apps) distribute critical logic across network protocols, V8 JIT optimizations, WebAssembly runtimes, native C/C++ `.so` dynamic libraries, and kernel syscalls.

Single-purpose tools leave AI agents blind across system boundaries. JSHookMCP provides a **unified, cross-domain causal evidence graph**:

```text
[Network: HTTP/2 / gRPC / Protobuf / TLS Keylog]
       ↓
[DOM / UI: Camoufox CDP / Canvas / WebGL Interception]
       ↓
[JS Runtime: AST Deflat / V8 Turbofan JIT / Heap Diffing]
       ↓
[WASM Virtual Machine: Wasm2C Decompilation / VMP Tracing]
       ↓
[Internal IPC: Chromium Mojo IPC Sniffing & Mocking]
       ↓
[Native Memory: AOB Signature Scan / Multi-level Pointer Maps]
       ↓
[Headless JNI Emulation: Unicorn ARM64 / Automatic JNI Environment Mocking]
       ↓
[OS Kernel: POSIX Syscalls / Mach Traps / Win32 VEH / eBPF Tracing]
```

### Comparison with Traditional Tools

| Feature | Browser MCPs (Playwright/Puppeteer) | Binary MCPs (Ghidra/IDA) | Traditional Dynamic Tools (Frida/CheatEngine) | **JSHookMCP** |
| :--- | :---: | :---: | :---: | :---: |
| **Tool Count & Scope** | ~10-20 tools | ~10-30 tools | Standalone scripts | **735 tools across 36 domains** |
| **LLM Context Footprint**| Few thousand tokens | Tens of thousands (bloat) | No native agent interface | **Search-First 3K Ladder (Dynamic Activation)** |
| **Cross-Domain Causality**| ❌ DOM / Network only | ❌ Single binary only | ❌ Manual human synthesis | **✅ Automatic causal correlation & evidence export** |
| **Headless Android JNI** | ❌ None | ❌ None | ❌ Requires device/emulator | **✅ In-process Unicorn ARM64 emulation** |
| **Flutter / Dart AOT** | ❌ None | ❌ Poor | ❌ Very difficult | **✅ Snapshot header dump, SMI scan, call graphs** |
| **Chromium Mojo IPC** | ❌ None | ❌ None | ❌ None | **✅ Full message interception & mocking** |
| **AOB Scan & Pointer Maps**| ❌ None | ❌ Static only | ⚠️ GUI client only | **✅ Fully exposed to AI agents** |

---

## 36 Capability Domains Overview

| Domain Category | Domains Included | Key Capabilities |
| :--- | :--- | :--- |
| **Causal Correlation** | `cross-domain`, `core`, `trace`, `session` | Evidence graphs, execution trace recording, dynamic tool routing |
| **Headless Emulation** | `native-emulator` (`nemu`), `dart-inspector`, `adb-bridge` | Unicorn ARM64 JNI execution, Flutter AOT introspection, ADB cold trace |
| **Browser & Runtime** | `browser`, `v8-inspector`, `mojo-ipc`, `canvas`, `webgpu` | Camoufox stealth CDP, V8 Turbofan JIT inspection, Mojo IPC sniffing |
| **Instrumentation & Memory** | `memory`, `process`, `binary-instrument`, `native-bridge` | AOB scanning, pointer map convergence, Frida dynamic hooks, IDA/Ghidra sync |
| **Decompilation & Syntax** | `wasm`, `transform`, `sourcemap`, `platform` | Wasm2C decompilation, AST de-flattening, SourceMap tree recovery |
| **Network & Cryptography** | `network`, `tls-inspector`, `proxy`, `streaming`, `protocol-analysis`, `graphql` | NSS TLS keylogs, gRPC/Protobuf decoding, MITM proxy, WebSocket monitoring |
| **Exploitation & Kernel** | `syscall-hook`, `exploit-dev`, `encoding` | Syscall/eBPF monitoring, automated ROP chain discovery, raw Protobuf parsing |
| **Orchestration & DevOps**| `workflow`, `coordination`, `extension-registry`, `tasks`, `maintenance`, `instrumentation` | Multi-agent coordination board, background tasks, hot-reload plugins |

Read the full tool parameters in the [36 Domains Reference](/en/reference/).

---

## Operating System Support

- **Windows**: Win32 API modules, VEH hardware breakpoints, and deep PE inspection.
- **macOS**: Mach trap ports, disassembly, and universal Apple Silicon / Intel support.
- **Linux**: Direct POSIX syscall tracking and eBPF kernel probes.

---

## Documentation Links

- [Getting Started](/en/guide/getting-started) — Installation, startup, and first capture
- [Tool Selection Guide](/en/guide/tool-selection) — Navigate 735 tools by task
- [Best Practices](/en/guide/best-practices) — Search-first patterns and token economy
- [Configuration](/en/guide/configuration) — `.env` variables and profile options
- [Operations & Diagnostics](/en/operations/doctor-and-artifacts) — Health checks and artifacts
- [Contributing](/en/contributing) — Development, testing, and PR guidelines
