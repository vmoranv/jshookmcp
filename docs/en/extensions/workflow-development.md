# Workflow Development Flow

## When to build a workflow

Build a workflow when your goal is to codify a repeated tool chain into a reusable execution graph instead of creating a new tool surface.

Typical signals:

- repeated navigation to the same class of pages
- repeated collection of localStorage, cookies, requests, or links
- repeated auth extraction, HAR export, or report generation
- a need to fix ordering, concurrency, and parameters in one reusable contract

## Recommended development flow

### 1. Start from the template repository

- Template repo: `https://github.com/vmoranv/jshook_workflow_template`
- After cloning, set: `MCP_WORKFLOW_ROOTS=<path-to-cloned-jshook_workflow_template>`

### 2. Install and verify

```bash
pnpm install
pnpm run build
pnpm run check
```

The template is now **TS-first**: `workflow.ts` is the source entrypoint, and local build generates `dist/workflow.js`, which runtime prefers when both are present.

### 3. Replace workflow identity fields

Replace these first:

- `workflowId`
- `displayName`
- `description`
- `tags`
- the shared config prefix, such as `workflows.templateCapture.*`

Also confirm that:

- the repository keeps `workflow.ts` as source
- `dist/workflow.js` is only a local build artifact and should not be committed

### 4. Design the graph before filling details

Think in nodes first:

- which steps must remain sequential
- which steps are read-only and safe to parallelize
- which nodes need retry or timeout
- where branching is required

## Import surface for workflow authors

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

## What you implement in `WorkflowContract`

### Metadata fields

- `kind: 'workflow-contract'`
- `version: 1`
- `id`
- `displayName`
- `description`
- `tags`
- `timeoutMs`
- `defaultMaxConcurrency`

### `build(ctx)`

Return a declarative execution graph rather than executing logic directly.

## Node types and builders

### `toolNode(id, toolName, options?)`

Use for one MCP tool call.

Optional fields:

- `input`
- `retry`
- `timeoutMs`

### `sequenceNode(id, steps)`

Run steps in order.

Use for:

- setup before navigation
- page operations that depend on prior side effects
- teardown and reporting

### `parallelNode(id, steps, maxConcurrency?, failFast?)`

Run steps concurrently.

Use for:

- read-only collection
- multiple independent probes

Prefer parallelism only for steps that do not mutate shared page state.

### `branchNode(id, predicateId, whenTrue, whenFalse?, predicateFn?)`

Use for conditional routing.

Notes:

- `predicateId` should refer to a whitelisted predicate name, not an arbitrary script string
- when both `predicateId` and `predicateFn` exist, `predicateFn` typically takes precedence

## What `WorkflowExecutionContext` actually gives you

### `ctx.invokeTool(toolName, args)`

Invoke MCP tools during workflow execution.

### `ctx.getConfig(path, fallback)`

Read workflow configuration.

### `ctx.emitSpan(...)` / `ctx.emitMetric(...)`

Emit tracing and observability signals.

## Recommended concurrency rule

### Safe to parallelize

- `page_get_local_storage`
- `page_get_cookies`
- `network_get_requests`
- `page_get_all_links`
- `console_get_logs`

### Keep sequential

- navigation
- click
- type
- any page action that mutates shared state or depends on previous side effects

## Recommended verification path

Inside `jshook`, run:

1. `extensions_reload`
2. `extensions_list`
3. `list_extension_workflows`
4. `run_extension_workflow`

Before each reload or execution, rebuild locally:

```bash
pnpm run build
```

The current runtime prefers generated `.js` files when both `.ts` and `.js` exist for the same candidate.

## Common mistakes

- forcing new tool behavior into a workflow when it should be a plugin
- parallelizing page mutations that affect each other
- omitting timeout or retry on critical nodes
- using inconsistent config prefixes that break `ctx.getConfig(...)`
- committing `dist/workflow.js` into the template repository
