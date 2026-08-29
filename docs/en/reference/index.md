# Reference Overview

The following tool domains are available:

## Recommended reading order

1. Start with `browser / network / workflow` to understand the day-to-day path.
2. Continue with `debugger / instrumentation / streaming` for runtime analysis.
3. Finish with `core / sourcemap / transform / wasm / process / platform` for deeper reverse-engineering coverage.

## Domain matrix

| Domain | Title | Profiles | Typical use |
| --- | --- | --- | --- |
| `adb-bridge` | ADB Bridge | full | Android Debug Bridge integration domain for device management, application analysis, and remote debugging. |
| `binary-instrument` | Binary Instrument | full | Binary instrumentation domain providing binary analysis, runtime instrumentation, APK packer identification, and hardcoded key candidate scanning. |
| `boringssl-inspector` | BoringSSL Inspector | workflow, full | BoringSSL/TLS inspection domain supporting TLS traffic analysis and certificate inspection. |
| `browser` | Browser | workflow, full | Primary browser control and DOM interaction domain; the usual entry point for most workflows. |
| `canvas` | Canvas | workflow, full | Canvas game engine reverse analysis domain plus Skia rendering capture, supporting Laya, Pixi, Phaser, Cocos, and Unity engines for fingerprinting, scene tree dumping, object picking, and Skia GPU backend detection and scene extraction. |
| `coordination` | Coordination | workflow, full | Coordination domain for session insights, MCP Task Handoff, and cross-agent shared state board, bridging the planning and execution boundaries of LLMs. |
| `core` | Core | workflow, full | Core static and semi-static analysis domain for script collection, deobfuscation, semantic inspection, webpack analysis, source map recovery, and crypto detection. |
| `cross-domain` | Cross-Domain | full | Cross-domain correlation domain that bridges analysis results across multiple domains, supporting workflow orchestration and evidence graph integration. |
| `dart-inspector` | Dart Inspector | full | Extract and classify strings, recover Smi integer constants, and resolve obfuscated identifiers from Flutter AOT libapp.so using a developer-supplied obfuscation map. |
| `debugger` | Debugger | workflow, full | CDP-based debugging domain covering breakpoints, stepping, call stacks, watches, debugger sessions, and anti-anti-debug. |
| `encoding` | Encoding | workflow, full | Binary format detection, encoding conversion, entropy analysis, and raw protobuf decoding. |
| `exploit-dev` | Exploit Development | full | Binary exploit development domain providing ROP/JOP gadget search, shellcode encoding, mitigation detection, and offset calculation. |
| `extension-registry` | Extension Registry | full | Extension registry domain for managing and discovering community extensions. |
| `graphql` | GraphQL | workflow, full | GraphQL discovery, extraction, replay, and introspection tooling. |
| `instrumentation` | Instrumentation | full | Unified instrumentation-session domain that groups hooks, intercepts, traces, evidence graphs, and artifacts into a queryable session. |
| `maintenance` | Maintenance | workflow, full | Operations and maintenance domain covering cache hygiene, token budget, environment diagnostics, artifact cleanup, extension management, and secure sandbox execution. |
| `memory` | Memory | full | Memory analysis domain for native scans, pointer-chain discovery, structure inference, and breakpoint-based observation. |
| `mojo-ipc` | Mojo IPC | full | Mojo IPC monitoring domain for Chromium inter-process communication analysis. |
| `native-bridge` | Native Bridge | full | Native analysis bridge domain for local loopback HTTP bridges to Ghidra, IDA, Rizin/r2, and Binary Ninja, covering function listing, decompilation/disassembly, string search, xrefs, and symbol sync. |
| `native-emulator` | Native Emulator | workflow, full | In-process, dependency-free self-built ARM64 interpreter for emulating Android `.so` libraries: load a shared object, register mock Java methods, and invoke exported or `Java_*` JNI functions to recover signing/crypto algorithms — no device, JVM, or Frida. Sessions are isolated and explicitly managed (create → … → destroy) with idle auto-expiry. libapp.so (Flutter Dart AOT) is not executable here and routes to the Dart layer. |
| `network` | Network | workflow, full | Request capture, response extraction, HAR export, safe replay, and performance tracing. |
| `platform` | Platform | full | Platform and package analysis domain covering miniapps, ASAR archives, and Electron apps. |
| `process` | Process | full | Process, module, memory diagnostics, and controlled injection domain for host-level inspection, troubleshooting, and Windows process experimentation workflows. |
| `protocol-analysis` | Protocol Analysis | full | Custom protocol analysis domain supporting protocol pattern definition, automatic field detection from hex payloads, state machine inference from captured messages, and Mermaid diagram visualization. |
| `proxy` | Proxy | full | Full-stack HTTP/HTTPS MITM proxy domain for system-level traffic interception, modification, and application configuration. |
| `sourcemap` | SourceMap | full | Source map discovery, fetching, parsing, and source tree reconstruction. |
| `streaming` | Streaming | workflow, full | WebSocket and SSE monitoring domain. |
| `syscall-hook` | Syscall Hook | full | System call hooking domain providing system call monitoring and mapping capabilities. |
| `tasks` | Background Tasks | workflow, full | MCP 2.0 Tasks protocol domain for querying, polling and cancelling background tasks created by long-running tools. |
| `trace` | Trace | full | Time-travel debugging domain that records CDP events into SQLite for SQL-based querying and heap snapshot comparison. |
| `transform` | Transform | full | AST/string transform domain plus crypto extraction, harnessing, and comparison tooling. |
| `v8-inspector` | V8 Inspector | workflow, full | V8 inspector domain providing heap snapshot analysis, CPU profiling, and memory inspection. |
| `wasm` | WASM | full | WebAssembly dump, disassembly, decompilation, optimization, and offline execution domain. |
| `webgpu` | WebGPU | workflow, full | WebGPU reverse analysis domain supporting GPU adapter info, shader compile/disassembly, timing side-channel analysis, and memory layout inspection. |
| `workflow` | Workflow | workflow, full | Composite workflow, script-library, and macro-orchestration domain; the main built-in orchestration layer. |

## Key high-level entry points

- `api_probe_batch` — batch-probe OpenAPI / Swagger / API paths
- `js_bundle_search` — fetch a bundle remotely and search it with multiple patterns
- `page_script_register` / `page_script_run` — register reusable page-side snippets and execute them on demand
- `doctor_environment` — diagnose dependencies and local bridge health
- `cleanup_artifacts` — clean retained artifacts by age or size
- `list_extension_workflows` / `run_extension_workflow` — discover and execute external extension workflows
