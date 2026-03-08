# Templates and Paths

## Ready-made template repositories

### Plugin template repository

- Repo: `https://github.com/vmoranv/jshook_plugin_template`
- Use it for new tools, external bridges, or high-level wrappers around built-in tools

Included out of the box:

- `manifest.ts` / `workflow.ts` source entrypoints
- local `dist/*.js` build outputs (ignored by Git by default)
- a `PluginContract` MVP
- minimal permission declarations
- a `Promise.all` parallel-read example
- an `api_probe_batch` example
- published `@jshookmcp/extension-sdk` by default
- agent recipes

### Workflow template repository

- Repo: `https://github.com/vmoranv/jshook_workflow_template`
- Use it to codify repeated built-in flows without introducing new tool names

Included out of the box:

- `manifest.ts` / `workflow.ts` source entrypoints
- local `dist/*.js` build outputs (ignored by Git by default)
- a `WorkflowContract` MVP
- a `sequenceNode + parallelNode` example
- a capture pipeline from `network_enable` to auth extraction
- published `@jshookmcp/extension-sdk` by default
- agent recipes

## Loading paths

> Note: this is the local workflow for extension authors, not the installation path for the main `jshook` server. To use the server itself, prefer `npx @jshookmcp/jshook`. Clone and build these template repositories only when you are developing your own plugin or workflow.

### Load a plugin template

First run inside the template repository:

```bash
pnpm install
pnpm run build
pnpm run check
```

```bash
MCP_PLUGIN_ROOTS=<path-to-cloned-jshook_plugin_template>
```

Then run:

1. `extensions_reload`
2. `extensions_list`
3. `search_tools`

### Load a workflow template

First run inside the template repository:

```bash
pnpm install
pnpm run build
pnpm run check
```

```bash
MCP_WORKFLOW_ROOTS=<path-to-cloned-jshook_workflow_template>
```

Then run:

1. `extensions_reload`
2. `list_extension_workflows`
3. `run_extension_workflow`

## How to choose

- If you only need to codify a sequence of existing tools, choose a workflow.
- If you need a new tool surface or tighter permission control, choose a plugin.

## TS-first convention

- both template repositories treat TypeScript source as the source of truth: edit `manifest.ts` or `workflow.ts`
- `pnpm run build` generates local `dist/manifest.js` or `dist/workflow.js`
- `dist/` should stay ignored and should not be committed to the template repositories
- the `jshook` runtime discovers both `.ts` and `.js` extension entrypoints; when both exist for the same candidate, it prefers the generated `.js`
- recommended loop: edit TS → build locally → `extensions_reload`

## Submit to the extension ecosystem

If you want your plugin or workflow to be considered for the official extension registry, open an issue in `jshookmcpextension`:

- Repo: `https://github.com/vmoranv/jshookmcpextension`
- Issues: `https://github.com/vmoranv/jshookmcpextension/issues`

Recommended issue contents:

- repository URL
- plugin or workflow purpose
- required external environment and permissions
- minimal usage example
- whether it should be listed by `browse_extension_registry` / `install_extension`

## Continue reading

- [Extensions Overview](/en/extensions/)
- [Plugin Development Flow](/en/extensions/plugin-development)
- [Workflow Development Flow](/en/extensions/workflow-development)
- [Extension API and Runtime Boundaries](/en/extensions/api)
