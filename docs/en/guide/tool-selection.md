# Tool Routing & Lifecycle Management

`jshookmcp` implements a declarative, dynamically loaded routing architecture using strict namespace isolation and on-demand activation. Hardcoding tool signatures or assuming payload availability in dispatcher layers is prohibited; all dependencies must be resolved dynamically via the routing bus.

## Core Routing Protocols

### Standard Definition Routing

The first-order invocation for all un-cached tasks must be `route_tool`, completely bypassing manual meta-tool chaining.

```yaml
Tool: route_tool
Args: { task: 'Hijack and intercept POST payloads targeting /api/login on the current frame' }
```

The server abstracts the underlying execution: semantic footprinting → dependency tree resolution → domain sandbox hot-activation (TTL-managed) → payload response delivery injected with immediate best practices.

::: danger Anti-Pattern
Manually scheduling sequence flows like `search_tools` → `describe_tool` → `activate_tools` is severely unoptimized and incurs egregious Round-Trip Time (RTT) penalties and token bleed. Reserve exclusively for raw exploration or fallback state recovery.
:::

### Runtime Baselining (Run Profiles)

The global tool surface is gated by memory-resident strategies dictated by the `MCP_TOOL_PROFILE` environment variable.

| Profile Target       | Resident Domains                                                                           | Behavioral Characteristics                                                                                               | RTT Tax |
| -------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------- |
| `search`             | maintenance                                                                                | Stripped variant exposing only meta-tooling. All operational dependencies are lazily loaded via `route_tool`             | Maximum |
| `workflow` (Default) | analysis, browser, coordination, debugger, encoding, graphql, network, streaming, workflow | Covers 90% of Web/RE workflows. Core suites held memory-resident.                                                        | Low     |
| `full`               | Static Preload (all domains)                                                               | Mounts all tools natively, eliminating JIT loading delay. Designed for heavy static analysis and full-stack audits. | Zero    |

---

## Orchestration & Re-entrancy Invariants

When dispatching multiple tool executions natively, the following consistency boundaries must be strictly observed:

- **Concurrency Permitted (Side-Effect Free)**: State-agnostic read probes (`page_get_local_storage`, `page_get_cookies`, `network_get_requests`, `console_get_logs`) support highly concurrent payload delivery.
- **Mutex Required (Side-Effect Heavy)**: DOM mutations (`page_click`, `page_type`), auth state transitions (CAPTCHA slider solving, generic SSO redirects) introduce strong side-effects. Execution must be synchronously blocked to prevent phantom triggers and race conditions.
- **Persistent Context Serialization**: Long-polling traces like `web_api_capture_session` automatically serialize outbound requests into local HAR snapshots. Contexts can be destructed and reconstructed directly from archives, freeing up Headless lifecycle holds.

---

## Broker & Sub-agent Delegation Topologies

When executing RE workflows exhibiting massive computational complexity, the master node should implement data-plane decoupling, shedding business-logic pipelines to Sub-agents.

### Master Retentions (Strict Chronological Dependency)

- Headless CDP environment execution mapping and lifecycle binds
- Auth session mutations and anti-fingerprint evasion sweeps
- CAPTCHA response heuristics and synchronous human behavior delays

### Sub-agent Offloads (State-Agnostic Heavy Computation)

- Monolithic JS Bundle chunk localization and AST deobfuscation loops
- HAR/Pcap trace noise reduction, endpoint parameterization, and structure modeling
- Black-box fuzzy boundary mapping across OpenAPI targets using `api_probe_batch`
