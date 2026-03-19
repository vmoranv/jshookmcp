# 扩展架构体系与 SDK 指南

本章定义 `jshookmcp` 的运行时扩展接口边界。架构采用硬隔离的双通道策略：Workflow（声明式执行图编排）与 Plugin（原生运行时扩展槽）。

## 文档索引

1. [扩展模板仓与环境拓扑](/extensions/templates)
2. [Plugin 开发生命周期](/extensions/plugin-development)
3. [Workflow 执行图编排](/extensions/workflow-development)
4. [API 参考与沙箱边界](/extensions/api)

## 架构拓扑路由决策

### Workflow 介入基准

适用于存在严格拓扑时序的内置工具调用链重组。例如：

- 注入网络监听 (`network_enable`)
- Headless 页面跳转与 DOM 阻塞挂载
- 并发探测与日志剥离
- 授权态 (Auth-State) 凭证捕获与持久化

### Plugin 介入基准

适用于突破沙箱安全屏障或注册新的 RPC Tools。具体特征：

- 抽象并暴露新型工具调用面（Tools Schema）
- 内联主进程生命周期，桥接操作系统底层或外部隔离服务
- 对 `toolExecution` 实施更细粒度的动态权限剥离
- 动态触发 Domain / Workflow / 观测探针 Metrics 注册

## SDK 层级结构与导出契约

扩展层必须严格依赖已分发的 `@jshookmcp/extension-sdk`，严禁通过模块解析算法直接跨层引入核心引擎代码。

- `@jshookmcp/extension-sdk/plugin`：定义安全沙箱上下文 (Context)、扩展构造器 (Builder) 及生命周期装载契约。
- `@jshookmcp/extension-sdk/workflow`：提供 DAG（有向无环图）执行引擎相关的节点工厂 (Sequence/Parallel/Branch) 及其抽象语法树绑定。
- `@jshookmcp/extension-sdk/bridges`：内置操作系统底层与网络层安全抽象辅助（Loopback 校验、跨进程派生与 I/O 持久化管道）。
- `ctx.invokeTool(...)`：在权限白名单和目标 Profile 内存驻留集合内，反射执行内置子域工具。

## 沙箱运行边界 (Runtime Boundaries)

底层引擎对所有扩展强制实施严格的隔离验证机制：

- **Plugin 越权阻断**：拦截所有未经 `invokeTool()` 授权的平行跨域调用。Plugin 禁止反射调用其他外部 Plugin。
- **Workflow 时序阻断**：严格抽象为声明式执行树 (DAG Schema)，禁止穿透引擎获取 CDP 实例或 DOM 句柄。
- **动态权限检验**：`toolExecution.allowTools` 白名单执行硬性验证，无论当前 Profile 中该插件是否存在，越权操作均抛出权限异常阻止执行流程。

请依据具体的场景需求，查阅后续 [Plugin 开发生命周期](/extensions/plugin-development) 与 [Workflow 执行图编排](/extensions/workflow-development)。
