# 扩展开发

这一节面向两类作者：

- 想把一串既有 built-in tools 固化成可复用流程的人
- 想在 built-in tools 之上再暴露更高层工具名、桥接外部系统或声明更细权限的人

## 建议阅读顺序

1. [模板仓与路径](/extensions/templates)
2. [Plugin 开发流程](/extensions/plugin-development)
3. [Workflow 开发流程](/extensions/workflow-development)
4. [扩展 API 与运行时边界](/extensions/api)（包含 API 总数统计与每个方法的最小调用例子）

## 先选 workflow 还是 plugin

### 选 workflow 的信号

如果你只是反复在做同一条 built-in tool 链路，例如：

- `network_enable`
- `page_navigate`
- 点击 / 输入 / 等待
- `network_get_requests`
- `network_extract_auth`

那就应该先做 workflow。

### 选 plugin 的信号

如果你需要下面任意一项，就应该做 plugin：

- 新的工具名
- 对接外部桥接系统
- 复用 built-in tools 但向外暴露更高层能力
- 更明确的 `toolExecution` 权限声明
- 动态注册 domain / workflow / metric

## jshook 本体实际给扩展作者什么

对扩展作者来说，核心不是“直接拿到浏览器句柄或内部模块”，而是这几层能力：

- `@jshookmcp/extension-sdk/plugin`：插件契约、生命周期与 helper
- `@jshookmcp/extension-sdk/workflow`：工作流契约、节点类型与 builder
- `@jshookmcp/extension-sdk/bridges`：外部进程、回环 URL、输出目录、JSON 请求等通用 helper
- `ctx.invokeTool(...)`：通过 allowlist 调用 built-in tools
- `ctx.getConfig(...)` / runtime data / metrics / spans：读取配置与记录运行信息

## 核心边界

- plugin 只能通过 `invokeTool()` 调 built-in tools，不能直接调其他 plugin 工具
- workflow 只能声明执行图，不直接拿内部 router、页面对象或底层模块
- `toolExecution.allowTools` 是实际生效的硬边界
- 工具是否可调用，还受当前 active profile 影响

## 下一步

- 如果你要定义新的工具面，继续看 [Plugin 开发流程](/extensions/plugin-development)
- 如果你要把步骤固化成图，继续看 [Workflow 开发流程](/extensions/workflow-development)
- 如果你要对照字段、helper、API 总数和最小调用例子，看 [扩展 API 与运行时边界](/extensions/api)
