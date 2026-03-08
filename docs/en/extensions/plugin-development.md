# Plugin Development Flow

## When to build a plugin

Build a plugin instead of stacking more workflows when you need to:

- expose a new tool name
- wrap built-in tools into a higher-level capability
- integrate an external system, bridge, or local command
- dynamically register domains, workflows, or metrics
- declare and audit permissions explicitly

## Recommended development flow

### 1. Start from the template repository

- Template repo: `https://github.com/vmoranv/jshook_plugin_template`
- After cloning, set: `MCP_PLUGIN_ROOTS=<path-to-cloned-jshook_plugin_template>`

### 2. Install and run the minimal check

```bash
pnpm install
pnpm run check
```

### 3. Replace the template identity fields

Replace these first:

- `PLUGIN_ID`
- `PLUGIN_SLUG`
- `DOMAIN`
- `manifest.name`
- `manifest.pluginVersion`
- `manifest.description`

Use a reverse-domain `id`, for example: `io.github.example.my-plugin`.

### 4. Tighten permissions before adding logic

The most important manifest section is `permissions`:

- `toolExecution.allowTools`: which built-in tools `ctx.invokeTool()` may call
- `network.allowHosts`
- `process.allowCommands`
- `filesystem.readRoots` / `filesystem.writeRoots`

Recommended practice:

- start with only the built-in tools you really call
- do not start broad and tighten later
- keep command and filesystem allowlists minimal

## Import surface for plugin authors

Use the public SDK entrypoint instead of internal repository paths:

```ts
import type {
  PluginContract,
  PluginLifecycleContext,
  DomainManifest,
  ToolArgs,
  ToolHandlerDeps,
} from '@jshookmcp/extension-sdk/plugin';
import {
  loadPluginEnv,
  getPluginBooleanConfig,
  getPluginBoostTier,
} from '@jshookmcp/extension-sdk/plugin';
```

## What you implement in `PluginContract`

### `manifest`

You should keep these fields stable and explicit:

- `kind: 'plugin-manifest'`
- `version: 1`
- `id`
- `name`
- `pluginVersion`
- `entry`
- `compatibleCore`
- `permissions`
- `activation`
- `contributes`

### Lifecycle hooks

#### `onLoad(ctx)`

Keep initialization light:

- load local `.env`
- initialize handlers
- set runtime data

#### `onValidate(ctx)`

Validate environment and configuration:

- required config exists
- external dependencies are available
- baseUrl or loopback endpoints are valid

#### `onRegister(ctx)`

Use this when you want dynamic registration instead of relying only on `manifest.contributes.*`:

- `ctx.registerDomain(...)`
- `ctx.registerWorkflow(...)`
- `ctx.registerMetric(...)`

#### `onActivate(ctx)` / `onDeactivate(ctx)` / `onUnload(ctx)`

Use them for:

- resource setup on activation
- graceful teardown on deactivation
- full cleanup on unload

## What `PluginLifecycleContext` actually gives you

### `ctx.invokeTool(name, args?)`

This is the most important runtime capability, but also the hardest boundary:

- only built-in tools may be called
- the tool must be declared in `permissions.toolExecution.allowTools`
- the tool must also be available in the current active profile

So an allowlist match is necessary, but not sufficient; profile mismatch still fails.

### `ctx.getConfig(path, fallback)`

Read runtime config without exposing the full internal config object.

### `ctx.setRuntimeData(key, value)` / `ctx.getRuntimeData(key)`

Store plugin-local runtime state, for example:

- load timestamps
- cached initialization results
- probe status

### `ctx.hasPermission(capability)`

Check whether the manifest declared a capability.

### `ctx.registerDomain(...)` / `ctx.registerWorkflow(...)` / `ctx.registerMetric(...)`

Register dynamic contributions at runtime.

## `manifest.contributes.*` vs `ctx.register*()`

Both paths can contribute runtime objects:

- `manifest.contributes.*`: static and easier to review
- `ctx.register*()`: dynamic and better when registration depends on config or environment

In both cases, the core runtime still checks `toolExecution` declarations for key registration paths.

## Helper usage patterns

### `loadPluginEnv(import.meta.url)`

- loads a plugin-local `.env`
- does not overwrite process-level env that already exists

### `getPluginBooleanConfig(ctx, pluginId, key, fallback)`

Boolean config resolution checks env first, then falls back to:

- `plugins.<pluginId>.<key>`

### `getPluginBoostTier(pluginId)`

Resolve the minimum tier used for plugin auto-registration behavior.

## Recommended verification path

Inside `jshook`, run:

1. `extensions_reload`
2. `extensions_list`
3. `search_tools`
4. if the plugin also contributes workflows, `list_extension_workflows`

## Common mistakes

- treating a plugin as direct access to arbitrary internal modules
- forgetting to declare `toolExecution.allowTools`
- assuming allowlisted tools ignore active profile boundaries
- building a plugin when the problem is really just a repeatable workflow
