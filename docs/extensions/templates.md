# 模板仓与路径

## 已准备好的模板仓

### 插件模板仓

- 路径：`D:\coding\reverse\jshook_plugin_template`
- 用途：新增工具、桥接外部服务、复用 built-in tools

模板里已经包含：

- `PluginContract` MVP
- 最小权限声明
- `Promise.all` 并行读取示例
- `api_probe_batch` 调用示例
- agent 侧 recipes

### 工作流模板仓

- 路径：`D:\coding\reverse\jshook_workflow_template`
- 用途：把既有工具链路固化为可复用流程

模板里已经包含：

- `WorkflowContract` MVP
- `sequenceNode + parallelNode` 示例
- `network_enable -> page_navigate -> parallel collect -> extract auth` 链路
- agent 侧 recipes

## 加载方式

### 加载 plugin

```bash
MCP_PLUGIN_ROOTS=D:\coding\reverse\jshook_plugin_template
```

然后调用：

1. `extensions_reload`
2. `extensions_list`
3. `search_tools`

### 加载 workflow

```bash
MCP_WORKFLOW_ROOTS=D:\coding\reverse\jshook_workflow_template
```

然后调用：

1. `extensions_reload`
2. `list_extension_workflows`
3. `run_extension_workflow`

## 什么时候选哪一个

- 只是固定一串 built-in tools：选 workflow
- 需要新的工具名或更精细权限：选 plugin
