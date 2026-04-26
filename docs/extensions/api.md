# 扩展 API

本文档列出了 `jshookmcp` SDK 中所有对外暴露的 API 及使用说明。

## SDK 模块概览

提供以下三个基础模块：

- `@jshookmcp/extension-sdk/plugin`
- `@jshookmcp/extension-sdk/workflow`
- `@jshookmcp/extension-sdk/bridges`

### API 模块统计

| 模块       | 类型声明数量 | 工厂/普通方法 | 上下文对象 (Context) | 说明                        |
| ---------- | -----------: | ------------: | -------------------: | --------------------------- |
| `plugin`   |            9 |             1 |                    6 | Plugin 实例与生命周期上下文 |
| `workflow` |           14 |             4 |                    4 | 工作流节点构造方法          |
| `bridges`  |           15 |            11 |                    0 | 系统层与网络层辅助函数      |

## Plugin SDK 接口说明

### 核心模块 `@jshookmcp/extension-sdk/plugin`

#### 核心类型

- `ToolProfileId`: 控制工具可见性的环境层级。
- `PluginLifecycleContext`: 插件运行时的上下文对象，包含所有允许调用的方法。
- `ExtensionBuilder`: 流式构建器实例。

#### 构造方法

| 初始化方法                     | 示例                                       | 作用                       |
| ------------------------------ | ------------------------------------------ | -------------------------- |
| `createExtension(id, version)` | `createExtension('example.demo', '1.0.0')` | 创建 ExtensionBuilder 实例 |

### PluginLifecycleContext 方法

所有的操作必须通过注入的 `ctx` 对象来进行：

| 方法                         | 示例                                                                    | 权限限制                        |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------- |
| `registerMetric(metricName)` | `ctx.registerMetric('demo.requests')`                                   | 需提前注册对应指标              |
| `invokeTool(name, args?)`    | `await ctx.invokeTool('page_navigate', { url: 'https://example.com' })` | 受限于 `allowTool` 白名单与配置 |
| `hasPermission(capability)`  | `ctx.hasPermission('toolExecution')`                                    | 基于配置进行校验                |
| `getConfig(path, fallback)`  | `ctx.getConfig('plugins.demo.timeout', 5000)`                           | 只读配置读取                    |
| `setRuntimeData(key, value)` | `ctx.setRuntimeData('loadedAt', Date.now())`                            | 写入运行时内存数据              |
| `getRuntimeData(key)`        | `ctx.getRuntimeData<number>('loadedAt')`                                | 读取运行时内存数据              |

#### 最小调用示例

```ts
ctx.registerMetric('demo.metric');
await ctx.invokeTool('page_navigate', { url: 'https://example.com' });
```

## Workflow SDK 接口说明

### 核心模块 `@jshookmcp/extension-sdk/workflow`

#### 核心类型

- `WorkflowContract`: 工作流执行树的静态描述。
- `WorkflowExecutionContext`: 工作流运行时的上下文对象。

#### 节点构造方法

| 方法签名                                                          | 功能         |
| ----------------------------------------------------------------- | ------------ |
| `toolNode(id, toolName, options?)`                                | 单步工具调用 |
| `sequenceNode(id, steps)`                                         | 顺序节点串联 |
| `parallelNode(id, steps, maxConcurrency?, failFast?)`             | 并发节点调度 |
| `branchNode(id, predicateId, whenTrue, whenFalse?, predicateFn?)` | 条件分支路由 |

### WorkflowExecutionContext 方法

| 方法                                    | 说明                |
| --------------------------------------- | ------------------- |
| `invokeTool(toolName, args)`            | 触发内置工具调用    |
| `emitSpan(name, attrs?)`                | 记录 Trace 追踪日志 |
| `emitMetric(name, value, type, attrs?)` | 记录数据指标        |
| `getConfig(path, fallback)`             | 读取只读配置        |

#### 最小调用示例

```ts
sequenceNode('main', [
  toolNode('nav', 'page_navigate', { input: { url: 'https://example.com' } }),
  toolNode('dump', 'page_local_storage', { input: { action: 'get' } }),
]);
```

## Bridge SDK 接口说明

### 核心模块 `@jshookmcp/extension-sdk/bridges`

提供基础操作系统调用和网络请求的安全辅助封装。

#### 辅助方法

| 方法签名                                                  | 用途                                   |
| --------------------------------------------------------- | -------------------------------------- |
| `toTextResponse / toErrorResponse`                        | 格式化为标准 MCP 响应                  |
| `parseStringArg(args, key, required?)`                    | 安全解析参数字符串                     |
| `resolveOutputDirectory(toolName, target, requestedDir?)` | 安全的路径拼接与校验                   |
| `checkExternalCommand(...)`                               | 检查系统命令是否存在                   |
| `runProcess(command, args, options?)`                     | 安全执行子进程命令，包含超时与管道控制 |
| `assertLoopbackUrl(value, label?)`                        | 校验 URL 是否为本地环回地址            |
| `requestJson(url, method?, bodyObj?, timeoutMs?)`         | 封装支持超时的 JSON 请求               |

#### 最小调用示例

```ts
const value = parseStringArg(args, 'url', true);
const checked = assertLoopbackUrl(value);
const result = await requestJson(checked);
return toTextResponse({ success: true, data: result.data });
```

## 核心运行边界限制

- `invokeTool()` **没有任何后门**。调用必须经过预先声明的白名单验证。
- `configDefaults` 仅提供默认值，用户的配置文件优先级最高。
- `loadPluginEnv()` 读取的变量仅在插件内部生效，不会污染全局环境变量。
