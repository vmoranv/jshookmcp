# Workflow 执行图编排契约

## 执行图接管原则

当交互范式表现为无状态突变、固定路由序列与采集步骤的堆叠组合时，强制将逻辑下放给 `WorkflowContract` 实施抽象语法树隔离。

**适用触发点：**

- 刚性状态机：重复性同一类型页面的定向拦截
- 无碰撞采集流：并发挂载监听本地缓存 (LocalStorage, Cookies, XHR Requests)
- 取证管道：自动化萃取 Auth 会话并导出溯源归档 (HAR export)

## 开发拓扑指引

### 1. 克隆隔离模板仓

- 远端镜像: [jshook_workflow_template](https://github.com/vmoranv/jshook_workflow_template)
- 初始化主进程指针: `export MCP_WORKFLOW_ROOTS=<path-to-cloned-jshook_workflow_template>`

### 2. 管道编译验证

```bash
pnpm install
pnpm run build
pnpm run check
```

**TS-first 编译规约**：源码入口保持为 `workflow.ts`，仓库不提交 `dist/workflow.js`。但安装流程会在本地执行 `build`，并优先将已生成的 `dist/workflow.js` 记录为运行时入口，以避免在 `node_modules` 路径下直接加载 TypeScript。

### 3. Namespace 冲突剥离

重置所有模板常量与唯一标识符映射：

- `workflowId` (必须保证系统级单库唯一)
- `displayName` 与 `description` (映射至 Schema 声明接口)
- 提取统一的命名空间前缀映射：`workflows.*`

## 节点执行逻辑构建

引擎剥夺了过程式编程能力，强制通过抽象层工厂进行拓扑重组。

### 导出基准

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

### 工厂抽象类型

#### 1. 单边步进节点 `toolNode(id, toolName, options?)`

向底层透传单个内联 RPC 调用。
配置项支持：`input`，`retry` 抖动重发拦截，以及 `timeoutMs`。

#### 2. 同步串行链 `sequenceNode(id, steps)`

声明同步等待机制，实施前置依赖隔离。
适用于有状态影响的生命周期变更节点（例如导航就绪后等待 DOM 重排）。

#### 3. 并发派生簇 `parallelNode(id, steps, maxConcurrency?, failFast?)`

向协程引擎派发无副作用采集流，支持并发数裁剪 (`maxConcurrency`) 及快速终止 (`failFast`)。
**强规范约束**：严禁在此执行任何引发 Headless 环境的页面状态重置行为（导航、点击、注入）。

#### 4. 分支路由阀 `branchNode(id, predicateId, whenTrue, whenFalse?, predicateFn?)`

静态执行有向无环图内部的二路路由分支。
`predicateId` 必须严格约束至预注册逻辑网关中；存在重叠声明时，优先使用 `predicateFn` 绑定函数。

## 编排上下文能力接入

### `WorkflowExecutionContext` 方法集

- **`ctx.invokeTool(toolName, args)`**: 在工作流生命期直接映射底层 MCP 工具代理。
- **`ctx.getConfig(path, fallback)`**: 获取注册的工作流运行期配置集合。
- **`ctx.emitSpan(...)` / `ctx.emitMetric(...)`**: 向观测层注册执行链路可观测指标，支撑异常耗时拓扑分析与事件归档聚合。

## 防重入拓扑规范

- **安全并行读池**：`page_get_local_storage`, `page_get_cookies`, `network_get_requests`, `page_get_all_links`, `console_get_logs`。
- **并发锁屏黑名单**：页面导航请求、坐标重定向、表单投毒注入以及一切涉及 Shared State 的关联副作用。必须回归由 `sequenceNode` 挂接的同步等待闭包中。

## 重新加载机制

更新编译后，进入主程序管控环境发起注册探针：

1. `extensions_reload`
2. `extensions_list`
3. `list_extension_workflows`
4. `run_extension_workflow` 驱动并激活执行图。
