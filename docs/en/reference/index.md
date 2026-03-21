# Reference Overview

There are **21** built-in domains and **295** domain tools in the current build.

## Recommended reading order

1. Start with `browser / network / workflow` to understand the day-to-day path.
2. Continue with `debugger / hooks / streaming` for runtime analysis.
3. Finish with `core / sourcemap / transform / wasm / process / platform` for deeper reverse-engineering coverage.

## Domain matrix

| Domain         | Title        | Tool count | Profiles               | Typical use                                                                                                                                                         |
| -------------- | ------------ | ---------: | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `antidebug`    | AntiDebug    |          6 | full                   | Anti-anti-debug domain focused on detecting and bypassing browser-side anti-debugging protections.                                                                  |
| `browser`      | Browser      |         63 | workflow, full         | Primary browser control and DOM interaction domain; the usual entry point for most workflows.                                                                       |
| `coordination` | Coordination |          4 | workflow, full         | Coordination domain for session insights and MCP Task Handoff, bridging the planning and execution boundaries of LLMs.                                              |
| `core`         | Core         |         14 | workflow, full         | Core static and semi-static analysis domain for script collection, deobfuscation, semantic inspection, webpack analysis, source map recovery, and crypto detection. |
| `debugger`     | Debugger     |         37 | workflow, full         | CDP-based debugging domain covering breakpoints, stepping, call stacks, watches, and debugger sessions.                                                             |
| `encoding`     | Encoding     |          5 | workflow, full         | Binary format detection, encoding conversion, entropy analysis, and raw protobuf decoding.                                                                          |
| `graphql`      | GraphQL      |          5 | workflow, full         | GraphQL discovery, extraction, replay, and introspection tooling.                                                                                                   |
| `hooks`        | Hooks        |          8 | full                   | AI hook generation, injection, export, and built-in/custom preset management.                                                                                       |
| `macro`        | Macro        |          2 | full                   | Sub-agent macro orchestration domain that chains multiple tool calls into reusable macro workflows.                                                                 |
| `maintenance`  | Maintenance  |         12 | search, workflow, full | Operations and maintenance domain covering cache hygiene, token budget, environment diagnostics, artifact cleanup, and extension management.                        |
| `memory`       | Memory       |         41 | workflow, full         | Memory analysis domain for native scans, pointer-chain discovery, structure inference, and breakpoint-based observation.                                            |
| `network`      | Network      |         26 | workflow, full         | Request capture, response extraction, HAR export, safe replay, and performance tracing.                                                                             |
| `platform`     | Platform     |          5 | full                   | Platform and package analysis domain covering miniapps, ASAR archives, and Electron apps.                                                                           |
| `process`      | Process      |         26 | full                   | Process, module, memory diagnostics, and controlled injection domain for host-level inspection, troubleshooting, and Windows process experimentation workflows.     |
| `sandbox`      | Sandbox      |          1 | full                   | WASM-isolated QuickJS sandbox domain for secure custom script execution with MCP tool access.                                                                       |
| `sourcemap`    | SourceMap    |          5 | full                   | Source map discovery, fetching, parsing, and source tree reconstruction.                                                                                            |
| `streaming`    | Streaming    |          6 | workflow, full         | WebSocket and SSE monitoring domain.                                                                                                                                |
| `trace`        | Trace        |          6 | workflow, full         | Time-travel debugging domain that records CDP events into SQLite for SQL-based querying and heap snapshot comparison.                                               |
| `transform`    | Transform    |          6 | full                   | AST/string transform domain plus crypto extraction, harnessing, and comparison tooling.                                                                             |
| `wasm`         | WASM         |          8 | full                   | WebAssembly dump, disassembly, decompilation, optimization, and offline execution domain.                                                                           |
| `workflow`     | Workflow     |          9 | workflow, full         | Composite workflow and script-library domain; the main built-in orchestration layer.                                                                                |

## Key high-level entry points

- `web_api_capture_session` — capture APIs, extract auth, and export HAR/report
- `register_account_flow` — registration plus email verification flow
- `api_probe_batch` — batch-probe OpenAPI / Swagger / API paths
- `js_bundle_search` — fetch a bundle remotely and search it with multiple patterns
- `doctor_environment` — diagnose dependencies and local bridge health
- `cleanup_artifacts` — clean retained artifacts by age or size
