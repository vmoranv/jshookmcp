# 扩展 API 与运行时边界

这一页回答两个最常见的问题：

1. **开发 extension 到底有多少 API 可以调用？**
2. **每个方法最小怎么调用？**

## 一眼看懂：公开 SDK 一共有多少东西

这里把“类型声明”和“真的能调用的方法”分开统计。

### 公开入口

- `@jshookmcp/extension-sdk/plugin`
- `@jshookmcp/extension-sdk/workflow`
- `@jshookmcp/extension-sdk/bridges`

### 总数统计

| 入口       | 顶层导出总数 | 顶层可调用函数 | 运行时上下文方法 | 说明                            |
| ---------- | -----------: | -------------: | ---------------: | ------------------------------- |
| `plugin`   |           17 |              3 |                8 | 插件契约、生命周期、配置 helper |
| `workflow` |           14 |              4 |                4 | 工作流契约、执行图 builder      |
| `bridges`  |           15 |             11 |                0 | 通用桥接 helper                 |
| **合计**   |       **46** |         **18** |           **12** | **总计 30 个可调用 API**        |

> 这里的“可调用 API”指：
>
> - 顶层导出的函数 / builder
> - 运行时 `ctx.*` 方法
>
> 不包括 type alias、interface、只读属性。

## Plugin API

### 来自 `@jshookmcp/extension-sdk/plugin` 的顶层导出

#### 契约 / 类型

- `ToolProfileId`
- `ToolArgs`
- `ToolResponse`
- `ToolHandlerDeps`
- `ToolRegistration`
- `DomainManifest`
- `PluginState`
- `PluginPermission`
- `PluginActivationPolicy`
- `PluginContributes`
- `PluginManifest`
- `PluginValidationResult`
- `PluginLifecycleContext`
- `PluginContract`

#### 顶层 helper，共 3 个

| 方法                                                   | 最小调用例子                                                            | 作用                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------- |
| `loadPluginEnv(manifestUrl)`                           | `loadPluginEnv(import.meta.url)`                                        | 从插件目录加载 `.env`，不会覆盖主进程已有 env  |
| `getPluginBooleanConfig(ctx, pluginId, key, fallback)` | `getPluginBooleanConfig(ctx, 'io.github.demo.plugin', 'enabled', true)` | 优先从环境变量读取布尔配置，再回落到运行时配置 |
| `getPluginBoostTier(pluginId)`                         | `getPluginBoostTier('io.github.demo.plugin')`                           | 读取插件 boost tier，默认回落到 `full`         |

### `PluginLifecycleContext` 运行时方法，共 8 个

这些方法不是顶层导出函数，而是运行时传给你的 `ctx` 能力。

| 方法                         | 最小调用例子                                                            | 作用                             |
| ---------------------------- | ----------------------------------------------------------------------- | -------------------------------- |
| `registerDomain(manifest)`   | `ctx.registerDomain(myDomainManifest)`                                  | 动态注册一个 domain manifest     |
| `registerWorkflow(workflow)` | `ctx.registerWorkflow(myWorkflow)`                                      | 动态注册一个 workflow            |
| `registerMetric(metricName)` | `ctx.registerMetric('demo.requests')`                                   | 声明一个插件指标名               |
| `invokeTool(name, args?)`    | `await ctx.invokeTool('page_navigate', { url: 'https://example.com' })` | 调用 built-in tool               |
| `hasPermission(capability)`  | `ctx.hasPermission('toolExecution')`                                    | 检查 manifest 里是否声明某类权限 |
| `getConfig(path, fallback)`  | `ctx.getConfig('plugins.io.github.demo.timeoutMs', 5000)`               | 读取运行时配置                   |
| `setRuntimeData(key, value)` | `ctx.setRuntimeData('loadedAt', Date.now())`                            | 记录插件运行时状态               |
| `getRuntimeData(key)`        | `ctx.getRuntimeData<number>('loadedAt')`                                | 读取插件运行时状态               |

### `PluginLifecycleContext` 只读属性

- `pluginId`
- `pluginRoot`
- `config`
- `state`

最小读取例子：

```ts
const pluginId = ctx.pluginId;
const root = ctx.pluginRoot;
const state = ctx.state;
```

### 最小 plugin 骨架

```ts
import type { PluginContract, PluginLifecycleContext } from '@jshookmcp/extension-sdk/plugin';
import { loadPluginEnv } from '@jshookmcp/extension-sdk/plugin';

export const plugin: PluginContract = {
  manifest: {
    kind: 'plugin-manifest',
    version: 1,
    id: 'io.github.demo.plugin',
    name: 'Demo Plugin',
    pluginVersion: '0.1.0',
    entry: 'manifest.ts',
    compatibleCore: '^0.1.0',
    permissions: {
      toolExecution: {
        allowTools: ['page_navigate'],
      },
    },
  },

  onLoad(ctx: PluginLifecycleContext) {
    loadPluginEnv(import.meta.url);
    ctx.setRuntimeData('loaded', true);
  },

  async onActivate(ctx: PluginLifecycleContext) {
    await ctx.invokeTool('page_navigate', { url: 'https://example.com' });
  },
};

export default plugin;
```

## Workflow API

### 来自 `@jshookmcp/extension-sdk/workflow` 的顶层导出

#### 契约 / 类型

- `RetryPolicy`
- `WorkflowNodeType`
- `ToolNode`
- `SequenceNode`
- `ParallelNode`
- `BranchNode`
- `WorkflowNode`
- `WorkflowExecutionContext`
- `WorkflowContract`
- `ToolNodeOptions`

#### 顶层 builder，共 4 个

| 方法                                                              | 最小调用例子                                                                  | 作用             |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------- |
| `toolNode(id, toolName, options?)`                                | `toolNode('nav', 'page_navigate', { input: { url: 'https://example.com' } })` | 声明一个工具节点 |
| `sequenceNode(id, steps)`                                         | `sequenceNode('main', [stepA, stepB])`                                        | 串行执行一组节点 |
| `parallelNode(id, steps, maxConcurrency?, failFast?)`             | `parallelNode('collect', [a, b], 2, false)`                                   | 并行执行一组节点 |
| `branchNode(id, predicateId, whenTrue, whenFalse?, predicateFn?)` | `branchNode('gate', 'hasAuth', yesNode, noNode)`                              | 声明条件分支     |

### `WorkflowExecutionContext` 运行时方法，共 4 个

| 方法                                    | 最小调用例子                                       | 作用                   |
| --------------------------------------- | -------------------------------------------------- | ---------------------- |
| `invokeTool(toolName, args)`            | `await ctx.invokeTool('network_get_requests', {})` | 在 workflow 中调用工具 |
| `emitSpan(name, attrs?)`                | `ctx.emitSpan('demo.start', { phase: 'collect' })` | 记录 span              |
| `emitMetric(name, value, type, attrs?)` | `ctx.emitMetric('demo.count', 1, 'counter')`       | 记录 metric            |
| `getConfig(path, fallback)`             | `ctx.getConfig('workflows.demo.enabled', true)`    | 读取 workflow 配置     |

### `WorkflowExecutionContext` 只读属性

- `workflowRunId`
- `profile`

最小读取例子：

```ts
const runId = ctx.workflowRunId;
const profile = ctx.profile;
```

### 最小 workflow 骨架

```ts
import type { WorkflowContract, WorkflowExecutionContext } from '@jshookmcp/extension-sdk/workflow';
import { toolNode, sequenceNode } from '@jshookmcp/extension-sdk/workflow';

export const workflow: WorkflowContract = {
  kind: 'workflow-contract',
  version: 1,
  id: 'demo.capture',
  displayName: 'Demo Capture',

  build(_ctx: WorkflowExecutionContext) {
    return sequenceNode('main', [
      toolNode('navigate', 'page_navigate', {
        input: { url: 'https://example.com' },
      }),
      toolNode('links', 'page_get_all_links'),
    ]);
  },
};

export default workflow;
```

## Bridge helper API

来自 `@jshookmcp/extension-sdk/bridges` 的顶层 helper，共 11 个。

| 方法                                                              | 最小调用例子                                                    | 作用                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------- |
| `toTextResponse(payload)`                                         | `return toTextResponse({ success: true })`                      | 返回标准 text MCP 响应           |
| `toErrorResponse(tool, error, extra?)`                            | `return toErrorResponse('demo_tool', err)`                      | 返回标准错误响应                 |
| `parseStringArg(args, key, required?)`                            | `const url = parseStringArg(args, 'url', true)`                 | 从 `args` 中读取非空字符串       |
| `toDisplayPath(absolutePath)`                                     | `toDisplayPath('D:/work/file.txt')`                             | 把绝对路径转成更适合展示的路径   |
| `resolveOutputDirectory(toolName, target, requestedDir?)`         | `await resolveOutputDirectory('demo', 'example.com')`           | 解析并创建输出目录               |
| `checkExternalCommand(command, versionArgs, label, installHint?)` | `await checkExternalCommand('python', ['--version'], 'python')` | 检查外部命令是否存在             |
| `runProcess(command, args, options?)`                             | `await runProcess('node', ['-v'])`                              | 运行外部进程并收集 stdout/stderr |
| `assertLoopbackUrl(value, label?)`                                | `assertLoopbackUrl('http://127.0.0.1:9222')`                    | 只允许 loopback URL              |
| `normalizeBaseUrl(value)`                                         | `normalizeBaseUrl('http://127.0.0.1:9222/api')`                 | 规范化 base URL                  |
| `buildUrl(baseUrl, path, query?)`                                 | `buildUrl('http://127.0.0.1:9222', '/json/list')`               | 拼接 URL 和 query                |
| `requestJson(url, method?, bodyObj?, timeoutMs?)`                 | `await requestJson('http://127.0.0.1:9222/json/version')`       | 发 HTTP 请求并尽量解析 JSON      |

### 最小 bridge 例子

```ts
import {
  assertLoopbackUrl,
  buildUrl,
  requestJson,
  toTextResponse,
} from '@jshookmcp/extension-sdk/bridges';

const base = assertLoopbackUrl('http://127.0.0.1:9222');
const url = buildUrl(base, '/json/version');
const result = await requestJson(url);

return toTextResponse({
  success: true,
  status: result.status,
  data: result.data,
});
```

## 真正常被调用的最小组合

如果你只想记住最小闭环，通常就是这几个：

### Plugin 最小闭环

```ts
loadPluginEnv(import.meta.url);
ctx.registerMetric('demo.metric');
await ctx.invokeTool('page_navigate', { url: 'https://example.com' });
```

### Workflow 最小闭环

```ts
sequenceNode('main', [
  toolNode('nav', 'page_navigate', { input: { url: 'https://example.com' } }),
  toolNode('dump', 'page_get_local_storage'),
]);
```

### Bridge 最小闭环

```ts
const value = parseStringArg(args, 'url', true);
const checked = assertLoopbackUrl(value);
const result = await requestJson(checked);
return toTextResponse({ success: true, data: result.data });
```

## 运行时边界

- `invokeTool()` 只能调用 built-in tools
- 是否能调成功，除了权限，还受 active profile 影响
- workflow 拿到的是执行图能力，不是浏览器页面句柄
- `configDefaults` 只补缺省，不覆盖已有值
- `loadPluginEnv()` 不覆盖主进程已有环境变量

## 源码落点

- `packages/extension-sdk/src/plugin.ts`
- `packages/extension-sdk/src/workflow.ts`
- `packages/extension-sdk/src/bridges/shared.ts`
- `src/server/plugins/PluginContract.ts`
- `src/server/workflows/WorkflowContract.ts`
- `src/server/extensions/ExtensionManager.ts`
