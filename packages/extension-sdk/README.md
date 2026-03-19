# @jshookmcp/extension-sdk

SDK for developing `@jshookmcp/jshook` extensions (plugins and workflows).

## Design Goal

- Provide only generic extension development contracts and helper utilities.
- Do not embed task-specific platform logic (for example Frida/Jadx/Ghidra/IDA business handlers).
- Keep concrete bridge behavior inside extension repository plugins.

## What It Exposes

### Plugin development (fluent builder API)

```ts
import { createExtension, jsonResponse, errorResponse } from '@jshookmcp/extension-sdk/plugin';
import type { ExtensionBuilder, ToolArgs, PluginLifecycleContext } from '@jshookmcp/extension-sdk/plugin';
```

- `createExtension(id, version)` — entry point, returns a fluent `ExtensionBuilder`
- `jsonResponse(data)` / `errorResponse(tool, error, extra?)` — tool response helpers
- `ExtensionBuilder` — chainable builder with `.name()`, `.description()`, `.compatibleCore()`, `.profile()`, `.allowHost()`, `.allowTool()`, `.tool()`, `.onLoad()`, `.onValidate()`

### Workflow development (fluent builder API)

```ts
import { createWorkflow, toolNode, sequenceNode, parallelNode, branchNode } from '@jshookmcp/extension-sdk/workflow';
```

- `createWorkflow(id, displayName)` — entry point, returns a fluent `WorkflowBuilder`
- `toolNode(id, toolName)` — create a tool execution node
- `sequenceNode(id)` — create a sequential execution group
- `parallelNode(id)` — create a parallel execution group
- `branchNode(id, predicateId)` — create a conditional branch

### Generic bridge helpers

```ts
import { requestJson, toTextResponse, toErrorResponse, assertLoopbackUrl } from '@jshookmcp/extension-sdk/bridges';
```

- `toTextResponse` / `toErrorResponse` — standard MCP text responses
- `parseStringArg` / `checkExternalCommand` / `runProcess`
- `resolveOutputDirectory` / `assertLoopbackUrl` / `normalizeBaseUrl` / `buildUrl` / `requestJson`

## Install

```bash
pnpm add @jshookmcp/extension-sdk
```

Within the monorepo, use the `workspace:` protocol:

```json
{
  "dependencies": {
    "@jshookmcp/extension-sdk": "workspace:*"
  }
}
```

## Quick Start

```ts
import { createExtension, jsonResponse, errorResponse } from '@jshookmcp/extension-sdk/plugin';
import { requestJson, assertLoopbackUrl } from '@jshookmcp/extension-sdk/bridges';

export default createExtension('my-plugin', '1.0.0')
  .name('My Plugin')
  .description('A minimal plugin example.')
  .compatibleCore('>=0.1.0')
  .allowHost('127.0.0.1')
  .allowTool('my_tool')
  .tool(
    'my_tool',
    'Does something useful.',
    { action: { type: 'string' } },
    async (args) => {
      const endpoint = assertLoopbackUrl(process.env.MY_URL ?? 'http://127.0.0.1:8080', 'MY_URL');
      const { status, data } = await requestJson(`${endpoint}/api`, 'GET');
      return jsonResponse({ success: status < 300, data });
    },
  )
  .onLoad((ctx) => {
    ctx.setRuntimeData('loadedAt', new Date().toISOString());
  });
```
