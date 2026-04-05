# Workflow Execution Graph Orchestration

## Workflow Engagement Baseline

Prioritize Workflow deployments over Plugin implementations when the operational objective is to codify repetitive tool chains into a reproducible execution graph, rather than exposing novel capability footprints.

Typical structural signals necessitating a Workflow:

- Iterative chronological navigation targeting identical DOM architectures.
- Aggregated parallel telemetry extraction (e.g., localStorage, cookies, network dumps, URL indexing).
- Standardized security state capture pipelines (Authorization extraction -> HAR export -> Audit trace generation).
- Rigid enforcement of execution order, concurrency constraints, and uniform parameter baselines within a shared declarative contract.

## Standard Development Iteration Bus

### 1. Mount the Environment Topology

- Source Template: [jshook_workflow_template](https://github.com/vmoranv/jshook_workflow_template)
- Mount Main Process Pointer: `export MCP_WORKFLOW_ROOTS=<path-to-cloned-jshook_workflow_template>`

### 2. Pre-compilation Constraint Verification

```bash
pnpm install
pnpm run build
pnpm run check
```

**Engineering Protocol**: The project remains **TS-first** and keeps `workflow.ts` as the source entrypoint; repositories should not commit `dist/workflow.js`. During installation, however, the local build step is expected to produce `dist/workflow.js`, and the installer should persist that compiled file as the runtime entry to avoid importing TypeScript directly from `node_modules`.

### 3. Graph Identity Allocation

Mutate the core identifier fields prior to architectural design:

- `workflowId` (Use reverse-domain syntax if applicable)
- `displayName`
- `description`
- `tags`
- Configuration prefix matching (e.g., `workflows.templateCapture.*`)

**Repository Constraints**:

- `workflow.ts` must be maintained as the versionized source.
- `dist/workflow.js` remains an ephemeral artifact and must be appended to `.gitignore`.

### 4. DAG (Directed Acyclic Graph) Design Synthesis

Conceptualize nodes structurally prior to logic population:

- Identify critically sequential bottleneck stages.
- Isolate read-only telemetry probes safe for parallel execution mapping.
- Mandate explicit retry policies and timeout bounds on unstable nodes.
- Map conditional routing vectors (Branching).

## Abstract Syntax Tree (AST) API Resolution

```ts
import type {
  WorkflowContract,
  WorkflowExecutionContext,
  WorkflowNode,
} from '@jshookmcp/extension-sdk/workflow';
import {
  toolNode,
  sequenceNode,
  parallelNode,
  branchNode,
} from '@jshookmcp/extension-sdk/workflow';
```

## `WorkflowContract` Declaration Hierarchy

### Static Identity Schema

- `kind: 'workflow-contract'`
- `version: 1`
- `id`
- `displayName`
- `description`
- `tags`
- `timeoutMs`
- `defaultMaxConcurrency`

### `build(ctx)` Execution Pipeline

Mandatory closure returning a declarative DAG matrix. Procedural side-effects within the builder scope are strictly prohibited.

## Node Factory APIs

### `toolNode(id, toolName, options?)`

Instantiates an atomic MCP tool execution constraint.

Optional capability vectors:

- `input`
- `retry`
- `timeoutMs`

### `sequenceNode(id, steps)`

Enforces strict synchronous chronological execution.

Applicable structural usage:

- Pre-flight setup proceeding critical page navigation.
- Sequential mutation operations dependent on preceding DOM side-effects.
- Deterministic teardown and state extraction phases.

### `parallelNode(id, steps, maxConcurrency?, failFast?)`

Abstracts concurrent execution queues without deterministic ordering.

Applicable structural usage:

- Immutable read-only telemetry scraping.
- Firing isolated network metric probes.

**Strict Limitation**: Parallel projection is solely applicable when node executions do not inflict mutating side-effects upon a shared target context.

### `branchNode(id, predicateId, whenTrue, whenFalse?, predicateFn?)`

Deploys conditional logic routing gates.

Technical dependencies:

- `predicateId` strictly maps to an internal registered predicate string, prohibiting arbitrary string evaluation layers.
- Upon dual residency of `predicateId` and `predicateFn`, the programmatic `predicateFn` closure executes with highest priority.

## Capabilities Provided by `WorkflowExecutionContext`

### `ctx.invokeTool(toolName, args)`

Direct execution passthrough mapped to the MCP tool layer during node execution logic.

### `ctx.getConfig(path, fallback)`

Injects configuration invariants retrieved from the upstream mapping tier.

### `ctx.emitSpan(...)` / `ctx.emitMetric(...)`

Telemetric observation channels for distributed trace tracking and metric analysis.

## Structural Concurrency Constraints

### Safe Parallel Matrix (Non-Mutating)

- `page_get_local_storage`
- `page_get_cookies`
- `network_get_requests`
- `page_get_all_links`
- `console_get_logs`

### Strict Sequential Matrix (Mutating)

- Page Navigation constraints
- DOM Clicks and Key input simulations
- Any atomic operation capable of displacing internal process state or resulting in cascaded mutations.

## Context Reentry Affirmation

Assert the lifecycle integrity via the service terminal sequence:

1. `extensions_reload`
2. `extensions_list`
3. `list_extension_workflows`
4. `run_extension_workflow`

Pre-execution compilation loop baseline:

```bash
pnpm run build
```

Prioritize transpiled `.js` footprints over `.ts` sources upon overlapping candidate declarations.

## Conventional Transgressions

- Abstracting explicit novel capabilities via convoluted Workflows instead of utilizing Plugin extensions.
- Assigning parallel execution topology across nodes inflicting cross-mutation upon shared states.
- Evading structural safety mappings (Omission of Retry/Timeout definitions) on highly volatile nodes.
- Discrepancies in configuration prefix strings deteriorating the `ctx.getConfig(...)` retrieval channel.
- Disseminating localized compilation artifacts (`dist/workflow.js`) upstream.
