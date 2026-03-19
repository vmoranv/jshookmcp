# Plugin 开发生命周期与沙箱契约

## Plugin 介入基线准则

严禁滥用 Plugin 代替 Workflow 执行图。Plugin 的授权范围与安全审计成本远高于常规的并发采集流。仅在出现以下需求时，才允许启动 Plugin 开发流：

- 抽象并暴露底层未支持的 MCP 接口层 (Tool Schema)
- 桥接进程外 (Out-of-Process) 系统或 Native 本地二进制套件
- 动态注册次生扩展拓扑 (Domains / Workflows / Metrics)
- 收紧安全沙箱的 API 过冲，实施刚性的 `toolExecution` 白名单裁剪

## 最小化契约拓扑 (Minimal Viable Plugin)

基于声明式的 fluent builder 模式，所有的能力编排必须遵守无大括号的链模式调用约定。
参考代码库 `jshook_plugin_template` 下的核心文件 `src/manifest.ts`：

```ts
import { createExtension, jsonResponse } from '@jshookmcp/extension-sdk/plugin';

export default createExtension('io.github.example.my-first-plugin', '1.0.0')
  .compatibleCore('^0.1.0')
  .allowTool(['browser_click', 'network_get_requests'])
  .metric(['my_plugin.loaded'])
  .tool(
    'my_custom_tool',
    'Execute DOM mutation and fetch side-effect traces.',
    { message: { type: 'string', description: 'Mutation payload selector' } },
    async (args, ctx) => {
      const clickRes = await ctx.invokeTool('browser_click', { text: args.message });
      return jsonResponse({ success: true, result: clickRes });
    }
  )
  .onLoad((ctx) => {
    ctx.setRuntimeData('init_stamp', Date.now());
  })
  .onActivate(async (ctx) => {
    ctx.registerMetric('my_plugin.loaded');
  });
```

**契约图解：**

- `createExtension` 获取构建句柄，拦截恶意初始化尝试。
- `.allowTool([...])` 声明硬性内存调用面，越界调用将引发致命异常（等同遗留配置的 `permissions.toolExecution.allowTools`）。
- `.tool(name, ...)` 向主 MCP 注册新型能力端点。
- `ctx.invokeTool(...)` 在受控上下文中发起内置原子调用。

## 标准开发迭代总线

### 1. 挂载环境拓扑

- 代码库克隆: `https://github.com/vmoranv/jshook_plugin_template`
- 初始化主进程指针: `export MCP_PLUGIN_ROOTS=<path-to-cloned-jshook_plugin_template>`

### 2. 预编译约束验证

```bash
pnpm install
pnpm run build
pnpm run check
```

**工程约定**：本地环境采用 **TS-first** 校验策略，源码硬锁定 `manifest.ts`，主引擎按规约检测 `dist/manifest.js` 并按时间戳触发 AST 加载优化。

### 3. Namespace 隔离标识替换

挂载前，必须替换掉模板仓的全局冲突引用：

- `PLUGIN_ID` (强需遵循 x.y.z 反向域名格式，如 `io.github.example.my-plugin`)
- 扩展元数据 (`manifest.name` / `manifest.pluginVersion` / `manifest.description`)

### 4. 权限沙箱白名单收紧

Plugin 引擎基于白名单机制验证副作用能力。生命周期必须限定于声明栈中：

- `toolExecution.allowTools`：限制子模块通过 `ctx.invokeTool()` 渗透调用的范围。
- `network.allowHosts`：管控套接字发起目标的白名单。
- `process.allowCommands`：卡死所有外部子进程派生能力。
- `filesystem.readRoots` / `filesystem.writeRoots`：强制 I/O 笼管。

**纪律要求**：

- 在初始生命周期即采用最小化原则。
- 严禁在预发验证阶层使用通配泛型 `*` 。

## API 解析: ExtensionBuilder 与上下文总线

### 构建器编排核心方法

- `.compatibleCore(range)` — 限定运行时引擎底线要求。
- `.allowTool(tools)` — 注入内置 Domain 黑客行为验证集合。
- `.allowHost(hosts)` — 写入沙箱网络白名单标头。
- `.allowCommand(cmds)` — 绑定外挂执行态权限。
- `.profile(profiles)` — 注册可见层级，如 `['workflow', 'full']`。

### 运行时上下文 (Context Lifecycle)

引擎赋予的四层回调钩子：

1. **`onLoad(ctx)`**: 读取本地挂载目录 `.env` 配置文件，注册静态缓存，禁止发起异步外部请求。
2. **`onValidate(ctx)`**: 执行边界条件拦截（如检测外置端口存活、校验必要 Token、审核 Loopback 端点有效性）。
3. **`onRegister(ctx)`**: 动态释放内部工具子集，例如 `ctx.registerDomain(...)` / `ctx.registerWorkflow(...)`。
4. **`onActivate(ctx)` / `onDeactivate(ctx)` / `onUnload(ctx)`**: 接管资源申请、句柄剥离、内存清理与活跃 IPC 连接中止。

### `PluginLifecycleContext` (运行时能力句柄)

- **`ctx.invokeTool(name, args?)`**:
  在主沙箱触发内置动作。除了须通过 `allowTools` 拦截校验外，只有当前 `MCP_TOOL_PROFILE` 下存在的能力方能被调用。
- **`ctx.getConfig(path, fallback)`**:
  从主进程映射专属节点的只读配置缓存。
- **`ctx.setRuntimeData(key, value)` / `ctx.getRuntimeData(key)`**:
  管理本插件闭包内的短暂状态位（如长耗时缓存、认证时间戳）。

## Helper 支持域

扩展层由隔离的 `@jshookmcp/extension-sdk` 供应基础生态。

- **`loadPluginEnv(import.meta.url)`**:
  沙箱感知读取局域配置文件并注入插件实例，不向全局环境渗透。
- **`getPluginBooleanConfig(ctx, pluginId, key, fallback)`**:
  跨节点读取布尔值策略（顺位检索 ENV 环境变量与 `plugins.<pluginId>.<key>` 参数覆盖树）。

## 上下文重入验证

部署阶段的主服务断言步骤：

1. 终端触达 `extensions_reload`
2. 使用 `extensions_list` 断言插件激活记录
3. 唤起 `search_tools` 检查 API 端点生效
4. 建议提交前重跑 `pnpm run build` 以刷新构建产物依赖树
