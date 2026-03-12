# Extension API and Runtime Boundaries

This page answers two practical questions:

1. **How many APIs can an extension author actually call?**
2. **What is the minimum working example for each method?**

## Quick answer: how much is publicly exposed

This page separates shape declarations from things you can actually call.

### Public entrypoints

- `@jshookmcp/extension-sdk/plugin`
- `@jshookmcp/extension-sdk/workflow`
- `@jshookmcp/extension-sdk/bridges`

### Totals

| Entrypoint | Total exports | Top-level callable functions | Runtime context methods | Notes                                     |
| ---------- | ------------: | ---------------------------: | ----------------------: | ----------------------------------------- |
| `plugin`   |             9 |                            1 |                       6 | core extension builder, lifecycle context |
| `workflow` |            14 |                            4 |                       4 | workflow contract and graph builders      |
| `bridges`  |            15 |                           11 |                       0 | generic bridge helpers                    |
| **Total**  |        **38** |                       **16** |                  **10** | **26 callable APIs in practice**          |

> “Callable APIs” here means:
>
> - exported functions / builders
> - runtime `ctx.*` methods
>
> It does not count type aliases, interfaces, or readonly properties.

## Plugin API

### Top-level exports from `@jshookmcp/extension-sdk/plugin`

#### Contracts and types

- `ToolProfileId`
- `ToolArgs`
- `ToolResponse`
- `PluginState`
- `PluginLifecycleContext`
- `ExtensionToolHandler`
- `ExtensionToolDefinition`
- `ExtensionBuilder`

#### Top-level helpers, 1 total

| Method                         | Minimal example                            | Purpose                              |
| ------------------------------ | ------------------------------------------ | ------------------------------------ |
| `createExtension(id, version)` | `createExtension('example.demo', '1.0.0')` | Initialize a fluent ExtensionBuilder |

### `PluginLifecycleContext` runtime methods, 6 total

These are not top-level exports. They are methods on the runtime `ctx` object you receive.

| Method                       | Minimal example                                                         | Purpose                                |
| ---------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| `registerMetric(metricName)` | `ctx.registerMetric('demo.requests')`                                   | Register a plugin metric name          |
| `invokeTool(name, args?)`    | `await ctx.invokeTool('page_navigate', { url: 'https://example.com' })` | Call a built-in tool                   |
| `hasPermission(capability)`  | `ctx.hasPermission('toolExecution')`                                    | Check whether a permission was granted |
| `getConfig(path, fallback)`  | `ctx.getConfig('plugins.io.github.demo.timeoutMs', 5000)`               | Read runtime config                    |
| `setRuntimeData(key, value)` | `ctx.setRuntimeData('loadedAt', Date.now())`                            | Store plugin runtime state             |
| `getRuntimeData(key)`        | `ctx.getRuntimeData<number>('loadedAt')`                                | Read plugin runtime state              |

### `PluginLifecycleContext` readonly properties

- `pluginId`
- `pluginRoot`
- `config`
- `state`

Minimal read example:

```ts
const pluginId = ctx.pluginId;
const root = ctx.pluginRoot;
const state = ctx.state;
```

### Minimal plugin skeleton

Using the pure fluent builder syntax directly without nesting braces:

```ts
import { createExtension } from '@jshookmcp/extension-sdk';

export default createExtension('io.github.demo.plugin', '0.1.0')
  .name('Demo Plugin')
  .description('A minimal demo plugin using the fluent builder pattern')
  .compatibleCore('^0.1.0')
  .allowTool(['page_navigate'])
  .metric(['demo.loaded'])
  .onLoad((ctx) => {
    ctx.setRuntimeData('loaded', true);
  })
  .onActivate(async (ctx) => {
    ctx.registerMetric('demo.loaded');
    await ctx.invokeTool('page_navigate', { url: 'https://example.com' });
  });
```

## Workflow API

### Top-level exports from `@jshookmcp/extension-sdk/workflow`

#### Contracts and types

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

#### Top-level builders, 4 total

| Method                                                            | Minimal example                                                               | Purpose                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------- |
| `toolNode(id, toolName, options?)`                                | `toolNode('nav', 'page_navigate', { input: { url: 'https://example.com' } })` | Declare a single tool step   |
| `sequenceNode(id, steps)`                                         | `sequenceNode('main', [stepA, stepB])`                                        | Run steps sequentially       |
| `parallelNode(id, steps, maxConcurrency?, failFast?)`             | `parallelNode('collect', [a, b], 2, false)`                                   | Run steps in parallel        |
| `branchNode(id, predicateId, whenTrue, whenFalse?, predicateFn?)` | `branchNode('gate', 'hasAuth', yesNode, noNode)`                              | Declare a conditional branch |

### `WorkflowExecutionContext` runtime methods, 4 total

| Method                                  | Minimal example                                    | Purpose                             |
| --------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| `invokeTool(toolName, args)`            | `await ctx.invokeTool('network_get_requests', {})` | Call a tool from workflow execution |
| `emitSpan(name, attrs?)`                | `ctx.emitSpan('demo.start', { phase: 'collect' })` | Emit a span                         |
| `emitMetric(name, value, type, attrs?)` | `ctx.emitMetric('demo.count', 1, 'counter')`       | Emit a metric                       |
| `getConfig(path, fallback)`             | `ctx.getConfig('workflows.demo.enabled', true)`    | Read workflow config                |

### `WorkflowExecutionContext` readonly properties

- `workflowRunId`
- `profile`

Minimal read example:

```ts
const runId = ctx.workflowRunId;
const profile = ctx.profile;
```

### Minimal workflow skeleton

```ts
import type { WorkflowContract, WorkflowExecutionContext } from '@jshookmcp/extension-sdk/workflow';
import { toolNode, sequenceNode } from '@jshookmcp/extension-sdk/workflow';

export const workflow: WorkflowContract = {
  kind: 'workflow-contract',
  version: 1,
  id: 'demo.capture',
  displayName: 'Demo Capture',

  build(_ctx: WorkflowExecutionContext) {
    return sequenceNode('main', [
      toolNode('navigate', 'page_navigate', {
        input: { url: 'https://example.com' },
      }),
      toolNode('links', 'page_get_all_links'),
    ]);
  },
};

export default workflow;
```

## Bridge helper API

From `@jshookmcp/extension-sdk/bridges`.

### Type exports

| Type               | Description                                                    |
| ------------------ | -------------------------------------------------------------- |
| `JsonObject`       | Alias for `Record<string, unknown>`                            |
| `TextToolResponse` | Standard MCP text response structure                           |
| `ProcessRunResult` | Return type of `runProcess()` (exitCode, stdout, stderr, etc.) |
| `HttpJsonResult`   | Return type of `requestJson()` (status, data, text)            |

### Top-level helpers, 11 total

| Method                                                            | Minimal example                                                 | Purpose                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| `toTextResponse(payload)`                                         | `return toTextResponse({ success: true })`                      | Return a standard text MCP response                   |
| `toErrorResponse(tool, error, extra?)`                            | `return toErrorResponse('demo_tool', err)`                      | Return a standard error response                      |
| `parseStringArg(args, key, required?)`                            | `const url = parseStringArg(args, 'url', true)`                 | Read a non-empty string from `args`                   |
| `toDisplayPath(absolutePath)`                                     | `toDisplayPath('D:/work/file.txt')`                             | Convert an absolute path into a display-friendly path |
| `resolveOutputDirectory(toolName, target, requestedDir?)`         | `await resolveOutputDirectory('demo', 'example.com')`           | Resolve and create an output directory                |
| `checkExternalCommand(command, versionArgs, label, installHint?)` | `await checkExternalCommand('python', ['--version'], 'python')` | Check whether an external command exists              |
| `runProcess(command, args, options?)`                             | `await runProcess('node', ['-v'])`                              | Run an external process and capture stdout/stderr     |
| `assertLoopbackUrl(value, label?)`                                | `assertLoopbackUrl('http://127.0.0.1:9222')`                    | Enforce a loopback-only URL                           |
| `normalizeBaseUrl(value)`                                         | `normalizeBaseUrl('http://127.0.0.1:9222/api')`                 | Normalize a base URL                                  |
| `buildUrl(baseUrl, path, query?)`                                 | `buildUrl('http://127.0.0.1:9222', '/json/list')`               | Build a URL plus query string                         |
| `requestJson(url, method?, bodyObj?, timeoutMs?)`                 | `await requestJson('http://127.0.0.1:9222/json/version')`       | Perform an HTTP request and parse JSON when possible  |

### Minimal bridge example

```ts
import {
  assertLoopbackUrl,
  buildUrl,
  requestJson,
  toTextResponse,
} from '@jshookmcp/extension-sdk/bridges';

const base = assertLoopbackUrl('http://127.0.0.1:9222');
const url = buildUrl(base, '/json/version');
const result = await requestJson(url);

return toTextResponse({
  success: true,
  status: result.status,
  data: result.data,
});
```

## The minimum combinations people actually use

If you only want the shortest possible memory aid, it is usually these:

### Minimal plugin loop

```ts
ctx.registerMetric('demo.metric');
await ctx.invokeTool('page_navigate', { url: 'https://example.com' });
```

### Minimal workflow loop

```ts
sequenceNode('main', [
  toolNode('nav', 'page_navigate', { input: { url: 'https://example.com' } }),
  toolNode('dump', 'page_get_local_storage'),
]);
```

### Minimal bridge loop

```ts
const value = parseStringArg(args, 'url', true);
const checked = assertLoopbackUrl(value);
const result = await requestJson(checked);
return toTextResponse({ success: true, data: result.data });
```

## Runtime boundaries

- `invokeTool()` can only call built-in tools
- success depends on both permissions and the active profile
- workflows get graph-building capability, not direct page handles
- `configDefaults` only fills missing values
- `loadPluginEnv()` does not overwrite already-existing process env
