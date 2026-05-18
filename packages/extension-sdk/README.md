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
import {
  defineWorkflow,
  sequenceStep,
  parallelStep,
  branchStep,
  fallbackStep,
  toolStep,
} from '@jshookmcp/extension-sdk/workflow';
```

- `defineWorkflow(id, displayName, configure)` — declares a workflow contract
- `sequenceStep(id, config?)` — creates a sequential execution group
- `parallelStep(id, config?)` — creates a parallel execution group
- `branchStep(id, predicateId, config?)` — creates a conditional branch
- `fallbackStep(id, config?)` / `toolStep(id, toolName, config?)` — creates fallback or single-tool nodes

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

Declare a published npm version in extension repositories. Do not use local
`workspace:`, `link:`, or `file:` declarations.

## Plugin Quick Start

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

## Workflow Quick Start

```ts
import {
  defineWorkflow,
  sequenceStep,
  type WorkflowExecutionContext,
} from '@jshookmcp/extension-sdk/workflow';

export default defineWorkflow('workflow.capture.v1', 'Capture Workflow', (workflow) =>
  workflow
    .description('Navigate, collect page state in parallel, and extract auth material.')
    .tags(['capture', 'workflow'])
    .buildGraph((ctx: WorkflowExecutionContext) => {
      const url = String(ctx.getConfig('workflows.capture.url', 'https://example.com'));

      return sequenceStep('capture-root', (root) => {
        root.tool('enable-network', 'network_enable', {
          input: { enableExceptions: true },
        });
        root.tool('navigate', 'page_navigate', {
          input: { url, waitUntil: 'networkidle' },
        });
        root.parallel('collect-surface', (parallel) => {
          parallel
            .maxConcurrency(4)
            .failFast(false)
            .tool('collect-local-storage', 'page_local_storage', {
              input: { action: 'get' },
            })
            .tool('collect-cookies', 'page_cookies', {
              input: { action: 'get' },
            })
            .tool('collect-requests', 'network_get_requests', {
              input: { tail: 20 },
            })
            .tool('collect-links', 'page_get_all_links');
        });
        root.tool('extract-auth', 'network_extract_auth');
      });
    }),
);
```
