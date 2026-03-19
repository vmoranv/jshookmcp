# 扩展模板仓与环境拓扑

## 标准模板仓库

### Plugin 扩展栈

- **代码库**: [jshook_plugin_template](https://github.com/vmoranv/jshook_plugin_template)
- **应用场景**: 声明自定义工具签名、扩展安全沙箱边界、进程内桥接外部系统。

**内置工程配置:**

- `manifest.ts` (基于 `PluginContract` 构建的声明式入口)
- 本地构建流水线 (`dist/*.js` 编译产出结构)
- 遵循最小权限原则 (Least Privilege) 的 ToolExecution 白名单声明
- `ctx.invokeTool` 并行读取范式的 MVP 参考
- 集成 `@jshookmcp/extension-sdk` 核心库

### Workflow 扩展栈

- **代码库**: [jshook_workflow_template](https://github.com/vmoranv/jshook_workflow_template)
- **应用场景**: 编排无界面时序图、固化自动化劫持流水线。

**内置工程配置:**

- `workflow.ts` (基于 `WorkflowContract` 构建的图声明入口)
- `SequenceNode` 与 `ParallelNode` 子图嵌套范式
- 包含标准导航至取证的闭环拦截链路 (`network_enable` -> `navigate` -> 并发特征采集 -> 凭证剥离)
- 集成 `@jshookmcp/extension-sdk` 核心库

## 编译与加载规范

> **隔离声明**: 此处仅针对 Extension 层开发者。主服务消费者应遵循基线 `npx -y @jshookmcp/jshook` 引导，无需执行交叉编译流程。

### 统一构建流水线

拉取模板分支后，需严格执行以下前置编译步骤：

```bash
pnpm install
pnpm run build
pnpm run check
```

### 挂载 Plugin

挂载本地插件至主进程隔离区：

```bash
export MCP_PLUGIN_ROOTS=<path-to-cloned-jshook_plugin_template>
```

**热加载序列:**

1. 执行 `extensions_reload`
2. 执行 `extensions_list`
3. 执行 `search_tools` 确认暴露状态

### 挂载 Workflow

挂载本地工作流至主进程隔离区：

```bash
export MCP_WORKFLOW_ROOTS=<path-to-cloned-jshook_workflow_template>
```

**热加载序列:**

1. 执行 `extensions_reload`
2. 执行 `list_extension_workflows`
3. 执行 `run_extension_workflow`

## TypeScript-First 开发契约

- 工程配置仅识别 `manifest.ts` 或 `workflow.ts` 源码引用。
- 编译流水线生成的 `dist/manifest.js` 与 `dist/workflow.js` 属于次生构件，按规约不提交入库。
- MCP 核心加载器支持 `.ts` 与 `.js` 并存侦测；当冲突发生时，硬性优先寻址 `.js` 以提升执行层性能。
- **推荐迭代流**: 变更 TS 源码 -> 本地编译转译 -> 触发 `extensions_reload`。

## 官方 Registry 收录标准

如需将构建的 Plugin/Workflow 推送至官方 Registry 镜像，请通过 [jshookmcpextension Issues](https://github.com/vmoranv/jshookmcpextension/issues) 提交工单，并附带以下归档材料：

- 代码库快照链接
- 能力向量声明
- `toolExecution.allowTools` / `network.allowHosts` 安全白名单影响评估
- 调用范例基准测试

## 前置依赖导航

- [扩展开发总览](/extensions/)
- [Plugin 开发生命周期](/extensions/plugin-development)
- [Workflow 执行图编排](/extensions/workflow-development)
- [API 参考与沙箱边界](/extensions/api)
