# Extension Development

This section is for two kinds of authors:

- people who want to codify a repeated built-in tool chain into a reusable flow
- people who want to expose a new tool surface, bridge external systems, or declare tighter permissions

## Recommended reading order

1. [Templates and Paths](/en/extensions/templates)
2. [Plugin Development Flow](/en/extensions/plugin-development)
3. [Workflow Development Flow](/en/extensions/workflow-development)
4. [Extension API and Runtime Boundaries](/en/extensions/api) (includes API totals and minimal call examples)

## Choose workflow or plugin first

### Signals to choose a workflow

If you are repeatedly doing the same built-in chain, such as:

- `network_enable`
- `page_navigate`
- click / type / wait
- `network_get_requests`
- `network_extract_auth`

start with a workflow.

### Signals to choose a plugin

Choose a plugin when you need any of these:

- a new tool name
- an external bridge or integration
- a higher-level capability built on top of built-in tools
- explicit `toolExecution` permission control
- dynamic domain / workflow / metric registration

## What jshook actually exposes to extension authors

Extension authors do **not** get direct access to browser handles or internal modules. The real public surface is:

- `@jshookmcp/extension-sdk/plugin`: plugin contracts, lifecycle, and helpers
- `@jshookmcp/extension-sdk/workflow`: workflow contracts, node types, and builders
- `@jshookmcp/extension-sdk/bridges`: generic process, loopback URL, output directory, and JSON request helpers
- `ctx.invokeTool(...)`: built-in tool invocation through an allowlist
- `ctx.getConfig(...)`, runtime data, metrics, and spans

## Core boundaries

- a plugin can only call built-in tools through `invokeTool()`
- a workflow only builds a declarative execution graph; it does not get direct access to internal routers or page objects
- `toolExecution.allowTools` is a real runtime boundary
- tool availability is also gated by the current active profile

## Next step

- If you need a new tool surface, continue with [Plugin Development Flow](/en/extensions/plugin-development)
- If you need to codify repeated steps, continue with [Workflow Development Flow](/en/extensions/workflow-development)
- If you need field-level details, API totals, and minimal call examples, continue with [Extension API and Runtime Boundaries](/en/extensions/api)
