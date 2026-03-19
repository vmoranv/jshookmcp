# Extension Template Repositories and Environment Topology

## Standard Template Repositories

### Plugin Extension Stack

- **Repository**: [jshook_plugin_template](https://github.com/vmoranv/jshook_plugin_template)
- **Application Scenario**: Declaring custom tool signatures, expanding the security sandbox boundary, and bridging external systems in-process.

**Built-in Project Configuration:**

- `manifest.ts` (Declarative entrypoint built upon `PluginContract`)
- Local build pipeline (`dist/*.js` compilation output structure)
- ToolExecution explicit allowlist adhering to the Principle of Least Privilege
- MVP reference for `ctx.invokeTool` parallel execution paradigm
- Integration of the core `@jshookmcp/extension-sdk`

### Workflow Extension Stack

- **Repository**: [jshook_workflow_template](https://github.com/vmoranv/jshook_workflow_template)
- **Application Scenario**: Orchestrating headless chronological execution graphs, codifying automated hijack pipelines.

**Built-in Project Configuration:**

- `workflow.ts` (Graph declaration entrypoint built upon `WorkflowContract`)
- `SequenceNode` and `ParallelNode` sub-graph nesting paradigm
- Contains a standard closed-loop interception pipeline (`network_enable` -> `navigate` -> concurrent signal telemetry -> credential extraction)
- Integration of the core `@jshookmcp/extension-sdk`

## Compilation and Loading Specifications

> **Isolation Disclaimer**: This section exclusively targets Extension developers. Main service consumers must adhere to the baseline `npx -y @jshookmcp/jshook` bootstrap sequence without executing cross-compilation flows.

### Unified Build Pipeline

After pulling the template branch, the following prerequisite compilation steps must be strictly executed:

```bash
pnpm install
pnpm run build
pnpm run check
```

### Loading Plugins

Mount the local plugin to the main process isolation zone:

```bash
export MCP_PLUGIN_ROOTS=<path-to-cloned-jshook_plugin_template>
```

**Hot-Reload Sequence:**

1. Execute `extensions_reload`
2. Execute `extensions_list`
3. Execute `search_tools` to assert the exposure state

### Loading Workflows

Mount the local workflow to the main process isolation zone:

```bash
export MCP_WORKFLOW_ROOTS=<path-to-cloned-jshook_workflow_template>
```

**Hot-Reload Sequence:**

1. Execute `extensions_reload`
2. Execute `list_extension_workflows`
3. Execute `run_extension_workflow`

## TypeScript-First Development Contract

- The engineering configuration strictly recognizes `manifest.ts` or `workflow.ts` source references only.
- Local build outputs, specifically `dist/manifest.js` and `dist/workflow.js`, are categorized as derivative artifacts and must not be committed to the repository by convention.
- The core MCP loader supports concurrent `.ts` and `.js` detection; in conflict scenarios, it enforces a hard prioritization of `.js` to optimize execution tier performance.
- **Recommended Iteration Loop**: Modify TS source -> Compile Locally -> Trigger `extensions_reload`.

## Official Registry Inclusion Criteria

If you require pushing your built Plugin/Workflow to the official Registry image, submit a ticket via [jshookmcpextension Issues](https://github.com/vmoranv/jshookmcpextension/issues), attaching the following archival materials:

- Repository snapshot link
- Capability vector declaration
- Security allowlist impact assessment (`toolExecution.allowTools` / `network.allowHosts`)
- Invocation benchmark payload

## Prerequisite Dependency Navigation

- [Extensions Overview](/en/extensions/)
- [Plugin Development Lifecycle](/en/extensions/plugin-development)
- [Workflow Execution Graph Orchestration](/en/extensions/workflow-development)
- [API Reference and Sandbox Boundaries](/en/extensions/api)
