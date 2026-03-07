# @jshookmcp/extension-sdk

SDK for developing `@jshookmcp/jshook` extensions (plugins and workflows).

## Design Goal

- Provide only generic extension development contracts and helper utilities.
- Do not embed task-specific platform logic (for example Frida/Jadx/Ghidra/IDA business handlers).
- Keep concrete bridge behavior inside extension repository plugins.

## What It Exposes

- Plugin development contracts and helpers:
  - `PluginContract`
  - `DomainManifest`
  - `PluginLifecycleContext`
  - `ToolArgs`
  - `loadPluginEnv`
  - `getPluginBooleanConfig`
  - `getPluginBoostTier`
- Workflow development contracts and builders:
  - `WorkflowContract`
  - `toolNode`
  - `sequenceNode`
  - `parallelNode`
  - `branchNode`
- Generic bridge helpers:
  - `toTextResponse` / `toErrorResponse`
  - `parseStringArg`
  - `checkExternalCommand`
  - `runProcess`
  - `resolveOutputDirectory`
  - `assertLoopbackUrl`
  - `normalizeBaseUrl`
  - `buildUrl`
  - `requestJson`

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

## Usage

```ts
import type { PluginContract, DomainManifest } from '@jshookmcp/extension-sdk/plugin';
import { loadPluginEnv, getPluginBooleanConfig } from '@jshookmcp/extension-sdk/plugin';

import type { WorkflowContract } from '@jshookmcp/extension-sdk/workflow';
import { toolNode, sequenceNode } from '@jshookmcp/extension-sdk/workflow';

import { checkExternalCommand, runProcess, requestJson } from '@jshookmcp/extension-sdk/bridges';
```
