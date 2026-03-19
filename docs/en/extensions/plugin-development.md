# Plugin Development Lifecycle and Sandbox Contracts

## Plugin Engagement Baseline Protocol

Strictly prohibit the abuse of Plugins as a replacement for Workflow execution graphs. The authorization scope and security audit overhead of Plugins are exponentially higher than generic concurrent telemetry streams. The Plugin development flow may only be initiated upon encountering the following requisites:

- Abstracting and exposing an MCP interface tier (Tool Schema) unsupported natively
- Bridging Out-of-Process systems or Native local binary suites
- Dynamically registering secondary extension topologies (Domains / Workflows / Metrics)
- Clamping the API overshoot of the security sandbox, enforcing rigid `toolExecution` allowlist pruning

## Minimal Viable Plugin (MVP) Topology

Built upon a declarative fluent builder pattern, all capability orchestration must adhere to an inline, brace-free chaining invocation convention.
Reference the core file `src/manifest.ts` within the `jshook_plugin_template` repository:

```ts
import type { PluginContract, PluginLifecycleContext } from '@jshookmcp/extension-sdk/plugin';

// Core plugin implementation
const myPlugin: PluginContract = {
  kind: 'plugin-manifest',
  version: 1,

  // Core identity fields
  id: 'io.github.example.my-first-plugin',
  name: 'My First Hook Plugin',
  pluginVersion: '1.0.0',
  entry: 'manifest.ts',

  // Security permissions: declare hard memory boundaries
  permissions: {
    toolExecution: {
      allowTools: ['browser_click', 'network_get_requests'],
    },
  },

  // Contributions: automatically register new tool RPC points
  contributes: {
    domains: [
      {
        name: 'my_plugin_domain',
        tools: [
          {
            name: 'my_custom_tool',
            description: 'Execute DOM mutation and fetch side-effect traces.',
            handler: async (args, ctx) => {
              // Direct invocation of native atomic capabilities inside a controlled sandbox
              const clickRes = await ctx.invokeTool('browser_click', { text: 'Login' });
              return `Clicked! Result: ${clickRes}`;
            },
          },
        ],
      },
    ],
  },

  // Lifecycle hooks: perform sandbox isolation initialization
  async onLoad(ctx: PluginLifecycleContext) {
    ctx.setRuntimeData('init_stamp', Date.now());
  },
};

export default myPlugin;
```

**Contract Breakdown:**

- `id` / `name`: Distinct identity of the plugin isolated within the core registry.
- `permissions`: A mandatory security assertion. You **must explicitly declare** accessible built-in tools; illicit boundary traversing via `invokeTool` will trigger a fatal system exception.
- `contributes.domains`: Projects new MCP tools into the user-facing RPC gateway.
- `invokeTool`: Invokes internal atomic actions strictly within the verified `ctx` sandbox context.
- `onLoad`: The initial bootstrap hook, reserved for dependency allocation and logging prior to state mutation.

## Standard Development Iteration Bus

### 1. Mount the Environment Topology

- Source Template: `https://github.com/vmoranv/jshook_plugin_template`
- Mount Main Process Pointer: `export MCP_PLUGIN_ROOTS=<path-to-cloned-jshook_plugin_template>`

### 2. Pre-compilation Constraint Verification

```bash
pnpm install
pnpm run build
pnpm run check
```

**Engineering Protocol**: The local environment utilizes a **TS-first** verification strategy, hard-locking the source to `manifest.ts`. The main engine probes `dist/manifest.js` conforming to timestamp validations to trigger AST load optimization.

### 3. Namespace Isolation Identifier Replacement

Prior to mounting, you must supersede the globally conflicting references originating from the template:

- `PLUGIN_ID` (Strictly requires the x.y.z reverse-domain format, e.g., `io.github.example.my-plugin`)
- Extension Metadata (`manifest.name` / `manifest.pluginVersion` / `manifest.description`)

### 4. Privilege Sandbox Allowlist Clamping

The Plugin engine relies on an allowlist mechanism to validate side-effect capabilities. The lifecycle must be confined to the declaration stack:

- `toolExecution.allowTools`: Restricts the scope of penetrating invocations executed via `ctx.invokeTool()`.
- `network.allowHosts`: Governs the whitelist headers for target sockets.
- `process.allowCommands`: Blocks extraneous derivation of external sub-processes.
- `filesystem.readRoots` / `filesystem.writeRoots`: Enforces mandatory I/O caging.

**Disciplinary Requirements**:

- Adhere to the principle of least privilege immediately at the initial lifecycle setup.
- The use of generalized wildcards (`*`) is strictly forbidden during pre-production validation tiers.

## API Resolution: `PluginContract` Lifecycle

### Core Schema Definition (`manifest`)

Static fields must remain immutable post-initialization:

- `kind: 'plugin-manifest'`
- `version: 1`
- `id` / `name` / `pluginVersion` / `entry`
- `compatibleCore` / `permissions` / `activation` / `contributes`

### Runtime Context Hooks

The engine attributes structured sequential callbacks:

#### `onLoad(ctx)`

Reserved for minimal bootstrap sequences:

- Load `.env` from local mounted directory.
- Register static caches and handler signatures.
- Inject short-lived runtime data.

#### `onValidate(ctx)`

Execute boundary condition interceptors:

- Verify essential configuration parity.
- Probe dependencies for health availability.
- Audit baseUrl / Loopback endpoint legitimacy.

#### `onRegister(ctx)`

Dynamic release of secondary internal tooling subsets (as an alternative to static `manifest.contributes.*` schemas):

- `ctx.registerDomain(...)`
- `ctx.registerWorkflow(...)`
- `ctx.registerMetric(...)`

#### `onActivate(ctx)` / `onDeactivate(ctx)` / `onUnload(ctx)`

Takeover controls for memory and network bounds:

- Procure hardware resource allocations on activation.
- Terminate active IPC connections during deactivation.
- Execute complete teardown phase on unload.

## Capabilities Provided by `PluginLifecycleContext`

### `ctx.invokeTool(name, args?)`

The foremost runtime capability governed by rigid isolation guards:

- May solely invoke built-in tools.
- Must undergo pre-verification through `permissions.toolExecution.allowTools`.
- Required to be present within the currently active profile tier.

An allowlist verification is a requirement, not an exception; mismatches in Profile capability vectors result in denial.

### `ctx.getConfig(path, fallback)`

Extract read-only environment variables mapped explicitly to the designated Plugin instance, prohibiting overall configuration exposure.

### `ctx.setRuntimeData(key, value)` / `ctx.getRuntimeData(key)`

Handle fleeting state bits confined functionally to the Plugin closure context:

- Boot synchronization timestamps.
- Long-haul initialization caching sets.
- Network interception states.

### `ctx.hasPermission(capability)`

Asserts compliance queries concerning capability declarations mapped against the manifest constraints.

## `manifest.contributes.*` vs `ctx.register*()`

Both architectures facilitate runtime object contributions:

- `manifest.contributes.*`: Employs static definition vectors; prioritized for auditing and declarative tracking.
- `ctx.register*()`: Employs dynamic injection vectors; prioritized for environment-conditional capability toggles.

Irrespective of formulation, the core OS enforces execution limits via `toolExecution` capability checks.

## Helper Implementation Vectors

### `loadPluginEnv(import.meta.url)`

- Sandbox-aware configuration fetching, ingesting `.env` into local Plugin boundaries.
- Refrains implicitly from permeating or mutating the global process tree environment.

### `getPluginBooleanConfig(ctx, pluginId, key, fallback)`

Strategy pattern deployment resolving across configuration levels (Prioritizing specific `.env` keys over mapped configurations in `plugins.<pluginId>.<key>`).

### `getPluginBoostTier(pluginId)`

Evaluates the minimal tier mandatory for Plugin auto-registration behavior in unison with the designated active profile.

## Context Reentry Affirmation

Assert the lifecycle integrity via the service terminal sequence:

1. Reinitialize context via `extensions_reload`.
2. Map capability via `extensions_list`.
3. Force endpoint resolution utilizing `search_tools`.
4. Run `list_extension_workflows` (If Workflow topologies are concurrently injected).

Rerun standard TS-to-JS transpilation chains via `pnpm run build` prior to invoking the subsystem reload probe.

## Conventional Transgressions

- Operating a plugin as an unmanaged proxy mapping layer toward generic internal OS elements.
- Omission of explicit declarations surrounding `toolExecution.allowTools`.
- Ignoring boundaries of the active capability Profile assuming prior validation holds precedence.
- Misallocating parallel procedural pipelines as Plugins rather than proper syntax orchestration Workflows.
- Distributing `.js` intermediary compilation artifacts into production code mirrors.
