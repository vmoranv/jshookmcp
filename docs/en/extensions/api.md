# SDK API Reference and Runtime Boundaries

This architectural specification details the quantifiable and strict exposure boundaries enforced by the extension framework. It explicitly maps verifiable public constraints and delineates minimal implementation patterns per API surface.

## Exposure Footprint Analysis

This section classifies the structural definitions exported versus explicitly actionable runtime constraints.

### Core Export Vectors

- `@jshookmcp/extension-sdk/plugin`
- `@jshookmcp/extension-sdk/workflow`
- `@jshookmcp/extension-sdk/bridges`

### Interface Yield Summary

| Architecture Sector | Total Exports | Actionable Top-Level Fns | Available Runtime Methods | Description                               |
| ------------------- | ------------: | -----------------------: | ------------------------: | ----------------------------------------- |
| `plugin`            |             9 |                        1 |                         6 | Sandbox instantiation, lifecycle tracking |
| `workflow`          |            14 |                        4 |                         4 | DAG modeling capabilities                 |
| `bridges`           |            15 |                       11 |                         0 | Process abstraction handlers              |
| **Total**           |        **38** |                   **16** |                    **10** | **26 executable APIs exposed**            |

> **Execution Definition**: Actionable endpoints here consist of exported functional build patterns and context-resident (`ctx.*`) methods, excluding static Type definitions, Interfaces, and read-only property mappings.

## Plugin SDK Capabilities

### `@jshookmcp/extension-sdk/plugin` Export Hierarchy

#### Interfaces and Structural Types

- `ToolProfileId`
- `ToolArgs`
- `ToolResponse`
- `PluginState`
- `PluginLifecycleContext`
- `ExtensionToolHandler`
- `ExtensionToolDefinition`
- `ExtensionBuilder`

#### Actionable Top-Level Generators (1)

| Functional Signature           | Minimal Integration Syntax                 | Architectural Purpose                          |
| ------------------------------ | ------------------------------------------ | ---------------------------------------------- |
| `createExtension(id, version)` | `createExtension('example.demo', '1.0.0')` | Synthesizes a fluent declarative build channel |

### `PluginLifecycleContext` Injected Execution Vectors (6)

These methods operate exclusively within the sandbox closure instantiated during lifecycle hooks.

| Execution Vector             | Implementation Signature                                                | Contract Adherence                     |
| ---------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| `registerMetric(metricName)` | `ctx.registerMetric('demo.requests')`                                   | Maps bounded metrics for observability |
| `invokeTool(name, args?)`    | `await ctx.invokeTool('page_navigate', { url: 'https://example.com' })` | Initiates verified Subsystem RPC calls |
| `hasPermission(capability)`  | `ctx.hasPermission('toolExecution')`                                    | Asserts rigid privilege constraints    |
| `getConfig(path, fallback)`  | `ctx.getConfig('plugins.io.github.demo.timeoutMs', 5000)`               | Queries read-only Configuration        |
| `setRuntimeData(key, value)` | `ctx.setRuntimeData('init_stamp', Date.now())`                          | Allocates short-cycle Plugin states    |
| `getRuntimeData(key)`        | `ctx.getRuntimeData<number>('init_stamp')`                              | Resolves short-cycle Plugin states     |

### `PluginLifecycleContext` Static Attributes

- `pluginId`
- `pluginRoot`
- `config`
- `state`

_Resolution Protocol:_

```ts
const targetId = ctx.pluginId;
const rootDir = ctx.pluginRoot;
const activeState = ctx.state;
```

### Reference Implementation Model: MVP Architecture

Executing strict fluent composition mapping:

```ts
import { createExtension } from '@jshookmcp/extension-sdk';

export default createExtension('io.github.demo.plugin', '0.1.0')
  .compatibleCore('^0.1.0')
  .allowTool(['page_navigate'])
  .metric(['demo.loaded'])
  .onLoad((ctx) => {
    ctx.setRuntimeData('init_success', true);
  })
  .onActivate(async (ctx) => {
    ctx.registerMetric('demo.loaded');
    await ctx.invokeTool('page_navigate', { url: 'https://example.com' });
  });
```

## Workflow SDK Capabilities

### `@jshookmcp/extension-sdk/workflow` Export Hierarchy

#### Interfaces and Structural Types

- `RetryPolicy`
- `WorkflowNodeType`
- `ToolNode`
- `SequenceNode`
- `ParallelNode`
- `BranchNode`
- `WorkflowNode`
- `WorkflowExecutionContext`
- `WorkflowContract`
- `ToolNodeOptions`

#### Actionable Top-Level Generators (4)

| Functional Signature                                              | Minimal Integration Syntax                                                    | Architectural Purpose                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| `toolNode(id, toolName, options?)`                                | `toolNode('nav', 'page_navigate', { input: { url: 'https://example.com' } })` | Declares atomic capability execution triggers |
| `sequenceNode(id, steps)`                                         | `sequenceNode('main', [stepA, stepB])`                                        | Models sequential dependency constraints      |
| `parallelNode(id, steps, maxConcurrency?, failFast?)`             | `parallelNode('collect', [graphA, graphB], 2, false)`                         | Generates un-ordered parallel batch vectors   |
| `branchNode(id, predicateId, whenTrue, whenFalse?, predicateFn?)` | `branchNode('gate', 'hasAuth', trueBranch, falseBranch)`                      | Allocates conditional logic pipelines         |

### `WorkflowExecutionContext` Injected Execution Vectors (4)

| Execution Vector                        | Implementation Signature                           | Contract Adherence                      |
| --------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| `invokeTool(toolName, args)`            | `await ctx.invokeTool('network_get_requests', {})` | Invokes specific Node side-effects      |
| `emitSpan(name, attrs?)`                | `ctx.emitSpan('trace.start', { segment: 'init' })` | Emits distinct execution track elements |
| `emitMetric(name, value, type, attrs?)` | `ctx.emitMetric('probe.count', 1, 'counter')`      | Maps specific telemetry parameters      |
| `getConfig(path, fallback)`             | `ctx.getConfig('workflows.capture.trace', true)`   | Evaluates Workflow-bound mappings       |

### `WorkflowExecutionContext` Static Attributes

- `workflowRunId`
- `profile`

_Resolution Protocol:_

```ts
const executeId = ctx.workflowRunId;
const profileConfig = ctx.profile;
```

### Reference Implementation Model: Protocol Graph

```ts
import type { WorkflowContract, WorkflowExecutionContext } from '@jshookmcp/extension-sdk/workflow';
import { toolNode, sequenceNode } from '@jshookmcp/extension-sdk/workflow';

export const workflow: WorkflowContract = {
  kind: 'workflow-contract',
  version: 1,
  id: 'demo.capture',
  displayName: 'Telemetry Synthesis',

  build(_ctx: WorkflowExecutionContext) {
    return sequenceNode('core_sequence', [
      toolNode('navigate', 'page_navigate', {
        input: { url: 'https://example.com' },
      }),
      toolNode('links', 'page_get_all_links'),
    ]);
  },
};

export default workflow;
```

## Process Abstraction Bridges SDK

Sourced via `@jshookmcp/extension-sdk/bridges`.

### Core Mapping Exports

| Interface Class    | Evaluation Scope                                                               |
| ------------------ | ------------------------------------------------------------------------------ |
| `JsonObject`       | Normalization alias bridging `Record<string, unknown>`                         |
| `TextToolResponse` | Canonical Text standard format implementation response                         |
| `ProcessRunResult` | Execution dump matrix mapping `exitCode`, standard Output, and standard Error  |
| `HttpJsonResult`   | Endpoint response container abstracting `status`, JSON output, and `text` dump |

### Implementation Top-Level Helpers (11)

| Invocation Call                                                   | Concrete Implementation Reference                          | Objective Map                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| `toTextResponse(payload)`                                         | `return toTextResponse({ success: true })`                 | Encapsulates payload under uniform Text MCP response           |
| `toErrorResponse(tool, error, extra?)`                            | `return toErrorResponse('diagnostic_tool', err)`           | Encapsulates stack errors underneath uniform schema            |
| `parseStringArg(args, key, required?)`                            | `const url = parseStringArg(args, 'url', true)`            | Filters bounded variables explicitly defining typed parameters |
| `toDisplayPath(absolutePath)`                                     | `toDisplayPath('D:/workspace/stream.txt')`                 | Formats path pointers mapping standardized rendering variants  |
| `resolveOutputDirectory(toolName, target, requestedDir?)`         | `await resolveOutputDirectory('diagnostic', 'local.host')` | Allocates local I/O directory outputs                          |
| `checkExternalCommand(command, versionArgs, label, installHint?)` | `await checkExternalCommand('python', ['-V'], 'python')`   | Synthesizes pre-flight assertions for host-derived CLI links   |
| `runProcess(command, args, options?)`                             | `await runProcess('node', ['-v'])`                         | Orchestrates and limits spawned host sub-process pipelines     |
| `assertLoopbackUrl(value, label?)`                                | `assertLoopbackUrl('http://127.0.0.1:9222')`               | Subjugates network streams exclusively across local interfaces |
| `normalizeBaseUrl(value)`                                         | `normalizeBaseUrl('http://127.0.0.1:9222/api')`            | Canonical URL string unification process                       |
| `buildUrl(baseUrl, path, query?)`                                 | `buildUrl('http://127.0.0.1:9222', '/json/list')`          | Protocol standard path assembler                               |
| `requestJson(url, method?, bodyObj?, timeoutMs?)`                 | `await requestJson('http://127.0.0.1:9222/json/version')`  | High-speed JSON retrieval interface                            |

### Abstracted Invocation Topology

```ts
import {
  assertLoopbackUrl,
  buildUrl,
  requestJson,
  toTextResponse,
} from '@jshookmcp/extension-sdk/bridges';

const endpoint = assertLoopbackUrl('http://127.0.0.1:9222');
const fetchUrl = buildUrl(endpoint, '/json/version');
const payloadInfo = await requestJson(fetchUrl);

return toTextResponse({
  success: true,
  status: payloadInfo.status,
  data: payloadInfo.data,
});
```

## Canonical Operational Sub-routines

Minimal abstraction layers defining the barest procedural viability:

### Declarative Plugin Segment

```ts
ctx.registerMetric('baseline.telemetry');
await ctx.invokeTool('page_navigate', { url: 'https://example.com' });
```

### Sequential Workflow Layer

```ts
sequenceNode('capture_chain', [
  toolNode('nav_trigger', 'page_navigate', { input: { url: 'https://example.com' } }),
  toolNode('dump_trigger', 'page_get_local_storage'),
]);
```

### Abstraction Bridge Invocation

```ts
const targetValue = parseStringArg(args, 'url', true);
const strictEndpoint = assertLoopbackUrl(targetValue);
const executionRes = await requestJson(strictEndpoint);
return toTextResponse({ success: true, data: executionRes.data });
```

## Firm Architecture Enforcement Constraints

- `invokeTool()` resolves strictly alongside internal primitive capability APIs.
- Operability demands synchronization intersecting explicitly defined capability grants (`permissions`) alongside global tier profiles (`ToolProfile`).
- `Workflow` paradigms govern graph tree compositions; raw browser DOM instances remain isolated from direct AST node tampering.
- `configDefaults` guarantees non-destructive hydration against null-values without overriding pre-established attributes.
- `loadPluginEnv()` confines mutations within the module schema avoiding process-level `process.env` degradation.
