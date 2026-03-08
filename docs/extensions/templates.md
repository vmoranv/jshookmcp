# 模板仓与路径

## 已准备好的模板仓

### 插件模板仓

- 仓库：`https://github.com/vmoranv/jshook_plugin_template`
- 用途：新增工具、桥接外部服务、复用 built-in tools

模板里已经包含：

- `manifest.ts` / `workflow.ts` 源码入口
- `dist/*.js` 本地构建产物（默认不入 Git）
- `PluginContract` MVP
- 最小权限声明
- `Promise.all` 并行读取示例
- `api_probe_batch` 调用示例
- 默认使用已发布的 `@jshookmcp/extension-sdk`
- agent 侧 recipes

### 工作流模板仓

- 仓库：`https://github.com/vmoranv/jshook_workflow_template`
- 用途：把既有工具链路固化为可复用流程

模板里已经包含：

- `manifest.ts` / `workflow.ts` 源码入口
- `dist/*.js` 本地构建产物（默认不入 Git）
- `WorkflowContract` MVP
- `sequenceNode + parallelNode` 示例
- `network_enable -> page_navigate -> parallel collect -> extract auth` 链路
- 默认使用已发布的 `@jshookmcp/extension-sdk`
- agent 侧 recipes

## 加载方式

> 注意：这里描述的是“扩展开发者”的本地流程，不是主程序 `jshook` 的安装方式。主程序本身优先用 `npx @jshookmcp/jshook` 运行；只有在你要自己开发 plugin / workflow 时，才需要 clone 模板仓并执行 `pnpm install / build / check`。

### 加载 plugin

先在模板仓目录执行：

```bash
pnpm install
pnpm run build
pnpm run check
```

```bash
MCP_PLUGIN_ROOTS=<path-to-cloned-jshook_plugin_template>
```

然后调用：

1. `extensions_reload`
2. `extensions_list`
3. `search_tools`

### 加载 workflow

先在模板仓目录执行：

```bash
pnpm install
pnpm run build
pnpm run check
```

```bash
MCP_WORKFLOW_ROOTS=<path-to-cloned-jshook_workflow_template>
```

然后调用：

1. `extensions_reload`
2. `list_extension_workflows`
3. `run_extension_workflow`

## 什么时候选哪一个

- 只是固定一串 built-in tools：选 workflow
- 需要新的工具名或更精细权限：选 plugin

## TS-first 约定

- 两个模板仓都以 TypeScript 源码为准：编辑 `manifest.ts` 或 `workflow.ts`
- `pnpm run build` 会在本地生成 `dist/manifest.js` 或 `dist/workflow.js`
- `dist/` 默认应忽略，不要提交到模板仓
- `jshook` 运行时会发现 `.ts` 与 `.js` 入口；当同一候选同时存在时，优先加载生成后的 `.js`
- 推荐日常流程：改 TS → 本地 build → `extensions_reload`

## 提交到扩展生态

如果你希望自己的 plugin / workflow 被官方扩展 registry 收录，建议到 `jshookmcpextension` 仓库提 issue：

- 仓库：`https://github.com/vmoranv/jshookmcpextension`
- Issues：`https://github.com/vmoranv/jshookmcpextension/issues`

建议在 issue 中附上：

- 仓库链接
- plugin / workflow 的用途
- 依赖的外部环境与权限声明
- 最小使用示例
- 是否适合被 `browse_extension_registry` / `install_extension` 收录

## 继续阅读

- [扩展总览](/extensions/)
- [Plugin 开发流程](/extensions/plugin-development)
- [Workflow 开发流程](/extensions/workflow-development)
- [扩展 API 与运行时边界](/extensions/api)
