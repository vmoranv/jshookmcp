# Workflow 开发流程

## 什么时候应该做 workflow

当你的目标是把一条重复步骤固化成可复用执行图，而不是创造新的工具面时，优先做 workflow。

典型信号：

- 重复导航同一类页面
- 重复采集 localStorage / cookies / requests / links
- 重复提取 auth / 导出 HAR / 输出报告
- 只是想把顺序、并发和参数固化下来

## 推荐开发流程

### 1. 从模板仓开始

- 模板仓：`https://github.com/vmoranv/jshook_workflow_template`
- 克隆后设置：`MCP_WORKFLOW_ROOTS=<path-to-cloned-jshook_workflow_template>`

### 2. 安装并检查

```bash
pnpm install
pnpm run build
pnpm run check
```

模板仓现在是 **TS-first**：源码入口是 `workflow.ts`，本地 build 后会生成 `dist/workflow.js` 供运行时优先加载。

### 3. 改掉 workflow 身份字段

优先改：

- `workflowId`
- `displayName`
- `description`
- `tags`
- 统一的配置前缀，例如 `workflows.templateCapture.*`

同时确认：

- 版本库里提交的是 `workflow.ts`
- `dist/workflow.js` 只是本地构建产物，不应提交

### 4. 先画执行图，再写细节

workflow 最好先按节点思维设计：

- 哪些步骤必须串行
- 哪些步骤是只读、可并行
- 哪些节点要 retry / timeout
- 哪些地方需要条件分支

## Workflow 作者的导入面

```ts
import type {
  WorkflowContract,
  WorkflowExecutionContext,
  WorkflowNode,
} from '@jshookmcp/extension-sdk/workflow';
import {
  toolNode,
  sequenceNode,
  parallelNode,
  branchNode,
} from '@jshookmcp/extension-sdk/workflow';
```

## WorkflowContract 你要实现什么

### 元数据字段

- `kind: 'workflow-contract'`
- `version: 1`
- `id`
- `displayName`
- `description`
- `tags`
- `timeoutMs`
- `defaultMaxConcurrency`

### `build(ctx)`

这里返回声明式执行图，而不是直接跑逻辑。

## 节点类型与 builder

### `toolNode(id, toolName, options?)`

适合单步调用一个 MCP 工具。

可带：

- `input`
- `retry`
- `timeoutMs`

### `sequenceNode(id, steps)`

步骤按顺序执行。

适合：

- 导航前的准备
- 页面状态会互相影响的操作
- 收尾与清理步骤

### `parallelNode(id, steps, maxConcurrency?, failFast?)`

步骤并行执行。

适合：

- 只读采集
- 多个互不影响的探测动作

推荐只把“不会修改共享页面状态”的步骤并行化。

### `branchNode(id, predicateId, whenTrue, whenFalse?, predicateFn?)`

用于条件分支。

注意：

- `predicateId` 应该是白名单里的 predicate 名称，不要把它当脚本注入入口
- 如果同时提供 `predicateFn`，通常以 `predicateFn` 为准

## WorkflowExecutionContext 实际给你的能力

### `ctx.invokeTool(toolName, args)`

让 workflow 在运行时调用 MCP 工具。

### `ctx.getConfig(path, fallback)`

读取 workflow 的配置项。

### `ctx.emitSpan(...)` / `ctx.emitMetric(...)`

用于埋点、统计和可观测性输出。

## 推荐的并发原则

### 可以并行的

- `page_get_local_storage`
- `page_get_cookies`
- `network_get_requests`
- `page_get_all_links`
- `console_get_logs`

### 不建议并行的

- 导航
- 点击
- 输入
- 会改变页面状态或依赖前一步副作用的动作

## 推荐验证路径

在 `jshook` 侧依次做：

1. `extensions_reload`
2. `extensions_list`
3. `list_extension_workflows`
4. `run_extension_workflow`

在每次 reload 或运行前，建议先在模板仓本地执行：

```bash
pnpm run build
```

因为当前运行时在同一候选同时存在 `.ts` 和 `.js` 时，会优先加载生成后的 `.js` 文件。

## 常见误区

- workflow 里塞进本应做成 plugin 的新工具能力
- 把会互相影响的页面动作并行化
- 不给关键节点设置 timeout / retry
- 配置前缀不统一，导致 `ctx.getConfig(...)` 读不出来
- 把 `dist/workflow.js` 提交进模板仓
