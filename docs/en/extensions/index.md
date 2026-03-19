# Extension Architecture and SDK Guide

This chapter defines the runtime extension interface boundaries of `jshookmcp`. The architecture utilizes a hard-isolated dual-channel strategy: Workflow (Declarative Execution Graph Orchestration) and Plugin (Native Runtime Extension Slot).

## Documentation Index

1. [Extension Template Repositories and Environment Topology](/en/extensions/templates)
2. [Plugin Development Lifecycle](/en/extensions/plugin-development)
3. [Workflow Execution Graph Orchestration](/en/extensions/workflow-development)
4. [API Reference and Sandbox Boundaries](/en/extensions/api)

## Architectural Topology Routing Decisions

### Workflow Engagement Baseline

Applicable for restructuring built-in tool invocation chains that possess strict topological timing. Examples include:

- Injecting network interception (`network_enable`)
- Headless page navigation and blocking DOM mounting
- Concurrent telemetry and log abstraction
- Authorization state (Auth-State) credential capture and persistence

### Plugin Engagement Baseline

Applicable for breaching sandbox security barriers or registering new RPC Tools. Specific characteristics include:

- Abstracting and exposing new tool invocation surfaces (Tools Schema)
- Inlining main process lifecycles, bridging underlying OS features or external isolated services
- Enforcing finer-grained dynamic permission abstraction against `toolExecution`
- Dynamically triggering Domain / Workflow / Observability Metric probe registration

## SDK Hierarchical Structure and Export Contracts

The extension tier must strictly depend on the distributed `@jshookmcp/extension-sdk`. Direct cross-tier importing of core engine code via module resolution algorithms is strictly prohibited.

- `@jshookmcp/extension-sdk/plugin`: Defines the security sandbox Context, Extension Builder, and lifecycle mounting contracts.
- `@jshookmcp/extension-sdk/workflow`: Provides Node Factories (Sequence/Parallel/Branch) and their Abstract Syntax Tree (AST) bindings relevant to the Directed Acyclic Graph (DAG) execution engine.
- `@jshookmcp/extension-sdk/bridges`: Built-in OS and network layer security abstraction helpers (Loopback validation, cross-process derivation, and persistent I/O pipelines).
- `ctx.invokeTool(...)`: Reflexively executes built-in sub-domain tools within the permission allowlist and target Profile memory-resident set.

## Runtime Sandbox Boundaries

The underlying engine enforces a strict isolation verification mechanism on all extensions:

- **Plugin Privilege Escalation Blocking**: Intercepts all parallel cross-domain invocations unauthorized by `invokeTool()`. Plugins are forbidden from reflexively invoking other external plugins.
- **Workflow Timing Blocking**: Strictly abstracted into a declarative execution tree (DAG Schema), preventing penetration into the engine to acquire CDP instances or DOM handles.
- **Dynamic Permission Verification**: The `toolExecution.allowTools` allowlist executes hard verification; regardless of whether the plugin exists in the current Profile, unauthorized operations will throw a permission exception, blocking the execution flow.

Depending on specific scenario requirements, proceed to review the [Plugin Development Lifecycle](/en/extensions/plugin-development) and [Workflow Execution Graph Orchestration](/en/extensions/workflow-development).
