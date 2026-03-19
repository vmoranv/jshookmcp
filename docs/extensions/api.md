# 扩展 API 与运行时边界

本文档定界 `jshookmcp` SDK 中所有向外暴露的 API 端点及其内存生命周期。

## SDK 顶层暴露面统计

底层通过三域分离模式输出能力：

- `@jshookmcp/extension-sdk/plugin`
- `@jshookmcp/extension-sdk/workflow`
- `@jshookmcp/extension-sdk/bridges`

### API 内存驻留快照

| 引导模块       | 类型声明总量 | 工厂构造器/静态方法 | 上下文动态代理 (Context) | 说明                          |
| -------------- | -----------: | ------------------: | -----------------------: | ----------------------------- |
| `plugin`       |            9 |                   1 |                        6 | Plugin 构造体与生命期资源代理 |
| `workflow`     |           14 |                   4 |                        4 | 执行图抽象语法树构造工厂      |
| `bridges`      |           15 |                  11 |                        0 | OS 层与网络级安全桥架         |
| **安全域总计** |       **38** |              **16** |                   **10** | **合法截获调用槽位: 26**      |

## Plugin SDK 接口白皮书

### 基准模块 `@jshookmcp/extension-sdk/plugin`

#### 核心强类型约束

- `ToolProfileId`: 控制沙箱可见性的级联隔离阀值。
- `PluginLifecycleContext`: 被注入的运行时代理，承载所有合法的副作能力。
- `ExtensionBuilder`: Fluent API 实例。

#### 构造工厂

| 初始化钩子                     | 最小调用范式                               | 内存行为                         |
| ------------------------------ | ------------------------------------------ | -------------------------------- |
| `createExtension(id, version)` | `createExtension('example.demo', '1.0.0')` | 分配并持有 ExtensionBuilder 句柄 |

### `PluginLifecycleContext` 动态代理面

禁止通过 `globalThis` 或模块缓存穿透访问引擎，所有的特权操纵被强制收敛于 `ctx` 对象：

| 代理方法                     | 最小调用范式                                                            | 安全级别限制                              |
| ---------------------------- | ----------------------------------------------------------------------- | ----------------------------------------- |
| `registerMetric(metricName)` | `ctx.registerMetric('demo.requests')`                                   | 观测侧白名单注册                          |
| `invokeTool(name, args?)`    | `await ctx.invokeTool('page_navigate', { url: 'https://example.com' })` | 强受制于 `allowTools` 与 `active profile` |
| `hasPermission(capability)`  | `ctx.hasPermission('toolExecution')`                                    | 基于 manifest 断言                        |
| `getConfig(path, fallback)`  | `ctx.getConfig('plugins.demo.timeout', 5000)`                           | 运行时只读映射                            |
| `setRuntimeData(key, value)` | `ctx.setRuntimeData('loadedAt', Date.now())`                            | 短生命周期内存槽写入                      |
| `getRuntimeData(key)`        | `ctx.getRuntimeData<number>('loadedAt')`                                | 短生命周期内存槽提取                      |

#### 最小内存装载闭环范式

```ts
ctx.registerMetric('demo.metric');
await ctx.invokeTool('page_navigate', { url: 'https://example.com' });
```

## Workflow SDK 接口白皮书

### 基准模块 `@jshookmcp/extension-sdk/workflow`

#### 核心强类型约束

- `WorkflowContract`: 强置约的执行树静态描述文件。
- `WorkflowExecutionContext`: 贯穿协程层级的执行态代理。

#### 图抽象工厂 (AST Builders)

| 工厂签名                                                          | 拓扑功能                 |
| ----------------------------------------------------------------- | ------------------------ |
| `toolNode(id, toolName, options?)`                                | 同步阻塞单一 RPC 调用    |
| `sequenceNode(id, steps)`                                         | 同步串行链重组           |
| `parallelNode(id, steps, maxConcurrency?, failFast?)`             | 异步并发行程池调度       |
| `branchNode(id, predicateId, whenTrue, whenFalse?, predicateFn?)` | 静态执行网络中的条件路由 |

### `WorkflowExecutionContext` 动态代理面

| 代理方法                                | 安全级别限制                            |
| --------------------------------------- | --------------------------------------- |
| `invokeTool(toolName, args)`            | MCP RPC 副作用下发，隔离级别低于 Plugin |
| `emitSpan(name, attrs?)`                | APM 分布式追踪注入                      |
| `emitMetric(name, value, type, attrs?)` | APM 指标重构汇聚                        |
| `getConfig(path, fallback)`             | Schema 只读覆盖                         |

#### 最小内存装载闭环范式

```ts
sequenceNode('main', [
  toolNode('nav', 'page_navigate', { input: { url: 'https://example.com' } }),
  toolNode('dump', 'page_get_local_storage'),
]);
```

## Bridge SDK 接口白皮书

### 基准模块 `@jshookmcp/extension-sdk/bridges`

用于防御未初始化的 OS 系统调用和不安全的网络栈外发请求。

#### 特权桥架方法 (Privileged Helpers)

| 桥接路由签名                                              | 隔离与防御用途                                          |
| --------------------------------------------------------- | ------------------------------------------------------- |
| `toTextResponse / toErrorResponse`                        | 强制对齐 MCP 序列化标准格式                             |
| `parseStringArg(args, key, required?)`                    | 收敛反射调用的 Payload 投毒攻击                         |
| `resolveOutputDirectory(toolName, target, requestedDir?)` | 发起对 `filesystem.writeRoots` 范围的鉴权并生成相对句柄 |
| `checkExternalCommand(...)`                               | 断言特权进程的二进制可调用性                            |
| `runProcess(command, args, options?)`                     | 托管子系统的标准管道（Stdout/Stderr），切断僵尸进程树   |
| `assertLoopbackUrl(value, label?)`                        | 拦截向公网发出的非法 HTTP 探活                          |
| `requestJson(url, method?, bodyObj?, timeoutMs?)`         | 封装高鲁棒性的超时中断请求机制                          |

#### 最小内存装载闭环范式

```ts
const value = parseStringArg(args, 'url', true);
const checked = assertLoopbackUrl(value);
const result = await requestJson(checked);
return toTextResponse({ success: true, data: result.data });
```

## 刚性运行边界断言 (Invariants)

- `invokeTool()` **不提供任何越权后门**。必须通过预验证白名单。
- **配置防沉缩** (`configDefaults`) 仅提供静态缺省值，无法覆盖主控文件的覆写链路。
- `loadPluginEnv()` 执行时**强制阻断反向植入**主进程环境拓扑变量的行为。
