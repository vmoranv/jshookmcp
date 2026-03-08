# Extension API and Runtime Boundaries

This page answers one question: **what does the jshook core actually expose to plugin and workflow authors?**

## Recommended import entrypoints

Extension authors should import from public SDK entrypoints instead of internal repository paths:

- `@jshookmcp/extension-sdk/plugin`
- `@jshookmcp/extension-sdk/workflow`
- `@jshookmcp/extension-sdk/bridges`

## Plugin API

### Contracts and types

Core exports from `@jshookmcp/extension-sdk/plugin` include:

- `PluginContract`
- `PluginManifest`
- `PluginContributes`
- `DomainManifest`
- `PluginLifecycleContext`
- `PluginValidationResult`
- `PluginPermission`
- `ToolArgs`
- `ToolHandlerDeps`

### Helpers

- `loadPluginEnv(manifestUrl)`
- `getPluginBooleanConfig(ctx, pluginId, key, fallback)`
- `getPluginBoostTier(pluginId)`

### Runtime context surface

`PluginLifecycleContext` exposes:

- `pluginId`
- `pluginRoot`
- `config`
- `state`
- `registerDomain(manifest)`
- `registerWorkflow(workflow)`
- `registerMetric(metricName)`
- `invokeTool(name, args?)`
- `hasPermission(capability)`
- `getConfig(path, fallback)`
- `setRuntimeData(key, value)`
- `getRuntimeData(key)`

## Workflow API

### Contracts and types

Core exports from `@jshookmcp/extension-sdk/workflow` include:

- `WorkflowContract`
- `WorkflowExecutionContext`
- `WorkflowNode`
- `ToolNode`
- `SequenceNode`
- `ParallelNode`
- `BranchNode`
- `RetryPolicy`

### Builders

- `toolNode(...)`
- `sequenceNode(...)`
- `parallelNode(...)`
- `branchNode(...)`

### Runtime context surface

`WorkflowExecutionContext` exposes:

- `workflowRunId`
- `profile`
- `invokeTool(toolName, args)`
- `emitSpan(name, attrs?)`
- `emitMetric(name, value, type, attrs?)`
- `getConfig(path, fallback)`

## Bridge helper API

Generic helpers from `@jshookmcp/extension-sdk/bridges` include:

- `toTextResponse(payload)`
- `toErrorResponse(tool, error, extra?)`
- `parseStringArg(args, key, required?)`
- `resolveOutputDirectory(toolName, target, requestedDir?)`
- `checkExternalCommand(command, versionArgs, label, installHint?)`
- `runProcess(command, args, options?)`
- `assertLoopbackUrl(value, label?)`
- `normalizeBaseUrl(value)`
- `buildUrl(baseUrl, path, query?)`
- `requestJson(url, method?, bodyObj?, timeoutMs?)`

These helpers solve generic extension needs rather than embedding business-specific bridge logic.

## Runtime boundaries enforced by jshook core

### 1. `invokeTool()` can only call built-in tools

The core runtime checks:

- the tool name is non-empty
- `toolExecution` permission was declared
- the tool name is present in `allowTools`
- the target tool is a built-in tool
- the target tool is available in the current active profile

So a plugin cannot use `invokeTool()` to call another plugin tool.

### 2. Both `manifest.contributes.*` and `ctx.register*()` are permission-checked

Whether you contribute runtime objects through:

- static `manifest.contributes.domains/workflows/metrics`
- dynamic `ctx.registerDomain()` / `ctx.registerWorkflow()` / `ctx.registerMetric()`

core still performs permission audits for key registration paths.

### 3. `configDefaults` only fills missing keys

`manifest.contributes.configDefaults` is merged into runtime config only when the target key is not already present.

### 4. `loadPluginEnv()` does not overwrite existing process env

The SDK helper loads a plugin-local `.env` non-destructively; it does not overwrite env values that already exist in the main process.

### 5. Workflows get graph-building capability, not internal module handles

Workflow authors can:

- compose nodes
- invoke tools
- emit spans and metrics
- read config

They do not receive direct access to internal routers, page handles, or internal registries.

## Recommended usage model

- use plugins for a new tool surface, external bridges, and explicit permissions
- use workflows for declarative orchestration
- parallelize read-only collection
- keep shared page state mutations sequential
- prefer public SDK entrypoints instead of internal repository paths

## Source map for deeper inspection

If you want to inspect the implementation in detail, start here:

- `packages/extension-sdk/src/plugin.ts`
- `packages/extension-sdk/src/workflow.ts`
- `packages/extension-sdk/src/bridges/shared.ts`
- `src/server/plugins/PluginContract.ts`
- `src/server/workflows/WorkflowContract.ts`
- `src/server/extensions/ExtensionManager.ts`
- `src/server/extensions/plugin-config.ts`
- `src/server/extensions/plugin-env.ts`
