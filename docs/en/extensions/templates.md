# Templates and Paths

## Ready-made template repositories

### Plugin template repository

- Repo: `https://github.com/vmoranv/jshook_plugin_template`
- Use it for new tools, external bridges, or high-level wrappers around built-in tools

Included out of the box:

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

- a `WorkflowContract` MVP
- a `sequenceNode + parallelNode` example
- a capture pipeline from `network_enable` to auth extraction
- published `@jshookmcp/extension-sdk` by default
- agent recipes

## Loading paths

### Load a plugin template

```bash
MCP_PLUGIN_ROOTS=<path-to-cloned-jshook_plugin_template>
```

Then run:

1. `extensions_reload`
2. `extensions_list`
3. `search_tools`

### Load a workflow template

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

## Continue reading

- [Extensions Overview](/en/extensions/)
- [Plugin Development Flow](/en/extensions/plugin-development)
- [Workflow Development Flow](/en/extensions/workflow-development)
- [Extension API and Runtime Boundaries](/en/extensions/api)
