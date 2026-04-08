# Reference Overview

There are **35** built-in domains and **424** domain tools in the current build.

## Recommended reading order

1. Start with `browser / network / workflow` to understand the day-to-day path.
2. Continue with `debugger / hooks / streaming` for runtime analysis.
3. Finish with `core / sourcemap / transform / wasm / process / platform` for deeper reverse-engineering coverage.

## Domain matrix

| Domain | Title | Tool count | Profiles | Typical use |
| --- | --- | ---: | --- | --- |
| `adb-bridge` | ADB Bridge | 6 | workflow, full | Android Debug Bridge integration domain for device management, application analysis, and remote debugging. |
| `antidebug` | AntiDebug | 6 | full | Anti-anti-debug domain focused on detecting and bypassing browser-side anti-debugging protections. |
| `binary-instrument` | Binary Instrument | 19 | workflow, full | Binary instrumentation domain providing binary analysis and runtime instrumentation capabilities. |
| `boringssl-inspector` | BoringSSL Inspector | 17 | workflow, full | BoringSSL/TLS inspection domain supporting TLS traffic analysis and certificate inspection. |
| `browser` | Browser | 63 | workflow, full | Primary browser control and DOM interaction domain; the usual entry point for most workflows. |
| `canvas` | Canvas | 4 | workflow, full | Canvas game engine reverse analysis domain supporting Laya, Pixi, Phaser, Cocos, and Unity engines for fingerprinting, scene tree dumping, and object picking. |
| `coordination` | Coordination | 7 | workflow, full | Coordination domain for session insights and MCP Task Handoff, bridging the planning and execution boundaries of LLMs. |
| `core` | Core | 14 | workflow, full | Core static and semi-static analysis domain for script collection, deobfuscation, semantic inspection, webpack analysis, source map recovery, and crypto detection. |
| `cross-domain` | Cross-Domain | 6 | workflow, full | Cross-domain correlation domain that bridges analysis results across multiple domains, supporting workflow orchestration and evidence graph integration. |
| `debugger` | Debugger | 37 | workflow, full | CDP-based debugging domain covering breakpoints, stepping, call stacks, watches, and debugger sessions. |
| `encoding` | Encoding | 5 | workflow, full | Binary format detection, encoding conversion, entropy analysis, and raw protobuf decoding. |
| `evidence` | Evidence | 6 | workflow, full | Evidence-graph domain that models provenance between URLs, scripts, functions, hooks, and captured artifacts. |
| `extension-registry` | Extension Registry | 9 | workflow, full | Extension registry domain for managing and discovering community extensions. |
| `graphql` | GraphQL | 5 | workflow, full | GraphQL discovery, extraction, replay, and introspection tooling. |
| `hooks` | Hooks | 7 | workflow, full | AI hook generation, injection, export, and built-in/custom preset management. |
| `instrumentation` | Instrumentation | 10 | workflow, full | Unified instrumentation-session domain that groups hooks, intercepts, traces, and artifacts into a queryable session. |
| `macro` | Macro | 2 | full | Sub-agent macro orchestration domain that chains multiple tool calls into reusable macro workflows. |
| `maintenance` | Maintenance | 12 | search, workflow, full | Operations and maintenance domain covering cache hygiene, token budget, environment diagnostics, artifact cleanup, and extension management. |
| `memory` | Memory | 41 | workflow, full | Memory analysis domain for native scans, pointer-chain discovery, structure inference, and breakpoint-based observation. |
| `mojo-ipc` | Mojo IPC | 5 | workflow, full | Mojo IPC monitoring domain for Chromium inter-process communication analysis. |
| `network` | Network | 29 | workflow, full | Request capture, response extraction, HAR export, safe replay, and performance tracing. |
| `platform` | Platform | 15 | full | Platform and package analysis domain covering miniapps, ASAR archives, and Electron apps. |
| `process` | Process | 26 | full | Process, module, memory diagnostics, and controlled injection domain for host-level inspection, troubleshooting, and Windows process experimentation workflows. |
| `protocol-analysis` | Protocol Analysis | 6 | workflow, full | Custom protocol analysis domain supporting protocol pattern definition, automatic field detection from hex payloads, state machine inference from captured messages, and Mermaid diagram visualization. |
| `sandbox` | Sandbox | 1 | full | WASM-isolated QuickJS sandbox domain for secure custom script execution with MCP tool access. |
| `shared-state-board` | Shared State Board | 10 | workflow, full | Cross-agent state synchronization domain providing a global shared state board for multi-agent collaboration. |
| `skia-capture` | Skia Capture | 3 | workflow, full | Skia rendering engine capture domain for UI rendering analysis and visualization. |
| `sourcemap` | SourceMap | 3 | workflow, full | Source map discovery, fetching, parsing, and source tree reconstruction. |
| `streaming` | Streaming | 6 | workflow, full | WebSocket and SSE monitoring domain. |
| `syscall-hook` | Syscall Hook | 6 | workflow, full | System call hooking domain providing system call monitoring and mapping capabilities. |
| `trace` | Trace | 7 | workflow, full | Time-travel debugging domain that records CDP events into SQLite for SQL-based querying and heap snapshot comparison. |
| `transform` | Transform | 6 | workflow, full | AST/string transform domain plus crypto extraction, harnessing, and comparison tooling. |
| `v8-inspector` | V8 Inspector | 8 | workflow, full | V8 inspector domain providing heap snapshot analysis, CPU profiling, and memory inspection. |
| `wasm` | WASM | 8 | full | WebAssembly dump, disassembly, decompilation, optimization, and offline execution domain. |
| `workflow` | Workflow | 9 | workflow, full | Composite workflow and script-library domain; the main built-in orchestration layer. |

## Key high-level entry points

- `web_api_capture_session` — capture APIs, extract auth, and export HAR/report
- `register_account_flow` — registration plus email verification flow
- `api_probe_batch` — batch-probe OpenAPI / Swagger / API paths
- `js_bundle_search` — fetch a bundle remotely and search it with multiple patterns
- `doctor_environment` — diagnose dependencies and local bridge health
- `cleanup_artifacts` — clean retained artifacts by age or size
