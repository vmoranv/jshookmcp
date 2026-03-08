# 扩展 API 与运行时边界

这一页回答一个核心问题：**jshook 本体到底向 plugin / workflow 作者暴露了什么？**

## 推荐导入入口

扩展作者应优先从 SDK 公共入口导入，而不是引用主仓内部路径：

- `@jshookmcp/extension-sdk/plugin`
- `@jshookmcp/extension-sdk/workflow`
- `@jshookmcp/extension-sdk/bridges`

## Plugin API

### 类型与契约

来自 `@jshookmcp/extension-sdk/plugin` 的核心导出：

- `PluginContract`
- `PluginManifest`
- `PluginContributes`
- `DomainManifest`
- `PluginLifecycleContext`
- `PluginValidationResult`
- `PluginPermission`
- `ToolArgs`
- `ToolHandlerDeps`

### helper

- `loadPluginEnv(manifestUrl)`
- `getPluginBooleanConfig(ctx, pluginId, key, fallback)`
- `getPluginBoostTier(pluginId)`

### 运行时上下文能力

`PluginLifecycleContext` 实际暴露：

- `pluginId`
- `pluginRoot`
- `config`
- `state`
- `registerDomain(manifest)`
- `registerWorkflow(workflow)`
- `registerMetric(metricName)`
- `invokeTool(name, args?)`
- `hasPermission(capability)`
- `getConfig(path, fallback)`
- `setRuntimeData(key, value)`
- `getRuntimeData(key)`

## Workflow API

### 类型与契约

来自 `@jshookmcp/extension-sdk/workflow` 的核心导出：

- `WorkflowContract`
- `WorkflowExecutionContext`
- `WorkflowNode`
- `ToolNode`
- `SequenceNode`
- `ParallelNode`
- `BranchNode`
- `RetryPolicy`

### builder

- `toolNode(...)`
- `sequenceNode(...)`
- `parallelNode(...)`
- `branchNode(...)`

### 运行时上下文能力

`WorkflowExecutionContext` 暴露：

- `workflowRunId`
- `profile`
- `invokeTool(toolName, args)`
- `emitSpan(name, attrs?)`
- `emitMetric(name, value, type, attrs?)`
- `getConfig(path, fallback)`

## Bridge helper API

来自 `@jshookmcp/extension-sdk/bridges` 的通用 helper：

- `toTextResponse(payload)`
- `toErrorResponse(tool, error, extra?)`
- `parseStringArg(args, key, required?)`
- `resolveOutputDirectory(toolName, target, requestedDir?)`
- `checkExternalCommand(command, versionArgs, label, installHint?)`
- `runProcess(command, args, options?)`
- `assertLoopbackUrl(value, label?)`
- `normalizeBaseUrl(value)`
- `buildUrl(baseUrl, path, query?)`
- `requestJson(url, method?, bodyObj?, timeoutMs?)`

这些 helper 解决的是通用扩展问题，不负责具体的业务桥接逻辑。

## jshook 本体实际施加的边界

### 0. 扩展入口发现与优先级

当前运行时会发现这些入口名：

- plugin：`manifest.ts`、`manifest.js`
- workflow：`workflow.ts`、`workflow.js`、`*.workflow.ts`、`*.workflow.js`

当同一候选同时存在 `.ts` 与 `.js` 时，运行时优先选择 `.js`。

这也是模板仓采用“提交 TS 源码、`dist/` 本地生成但不入库”策略的原因：

- Git 中保留可维护的 TS 源文件
- 运行时优先消费本地构建后的 JS 产物

### 1. `invokeTool()` 只能调 built-in tools

主仓运行时会检查：

- 工具名非空
- `toolExecution` 权限是否声明
- 工具名是否在 `allowTools` allowlist 中
- 目标工具是否属于 built-in tools
- 目标工具是否在当前 active profile 中可见

所以 plugin 不能借 `invokeTool()` 去调用别的 plugin 工具。

### 2. `manifest.contributes.*` 与 `ctx.register*()` 都会被权限检查

无论你是：

- 在 `manifest.contributes.domains/workflows/metrics` 里静态声明
- 还是在生命周期里调用 `ctx.registerDomain()` / `ctx.registerWorkflow()` / `ctx.registerMetric()`

主仓都会对关键注册动作做权限审计。

### 3. `configDefaults` 是“只补缺省，不覆盖现值”

plugin manifest 里的 `contributes.configDefaults` 会在运行时合并进配置，但只会填补不存在的 key，不会覆盖已有配置值。

### 4. `loadPluginEnv()` 不会覆盖已有环境变量

SDK helper 读取插件目录本地 `.env` 时，默认是 non-destructive 的；主进程已经有的 env 不会被插件 `.env` 反向覆盖。

### 5. workflow 拿到的是“执行图能力”，不是“内部模块句柄”

workflow 作者可以：

- 组织节点
- 调工具
- 记 span / metric
- 读配置

但不会直接拿到底层 router、浏览器页面对象或内部 registry。

## 推荐使用习惯

- plugin 用于“新工具面 + 外部桥接 + 权限声明”
- workflow 用于“声明式步骤编排”
- 只读采集步骤优先并行
- 会改变共享页面状态的步骤保持串行
- 优先走 SDK 公共入口，不依赖主仓内部路径

## 源码落点

如果你要继续深挖实现，优先看这些文件：

- `packages/extension-sdk/src/plugin.ts`
- `packages/extension-sdk/src/workflow.ts`
- `packages/extension-sdk/src/bridges/shared.ts`
- `src/server/plugins/PluginContract.ts`
- `src/server/workflows/WorkflowContract.ts`
- `src/server/extensions/ExtensionManager.ts`
- `src/server/extensions/plugin-config.ts`
- `src/server/extensions/plugin-env.ts`
