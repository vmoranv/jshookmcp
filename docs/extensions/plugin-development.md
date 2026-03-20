# Plugin 开发生命周期

## Plugin 适用场景

建议优先使用 Workflow 进行流程编排。Plugin 的开发成本相对较高，仅在出现以下需求时推荐开发 Plugin：

- 需要对外暴露 MCP 标准接口 (Tool Schema)
- 需要桥接外部系统或 Native 本地二进制套件
- 动态注册或生成子级能力 (Domains / Workflows / Metrics)
- 需要极其严格的运行时权限隔离与白名单控制

## 基础插件示例

所有插件的初始化基于声明式的 fluent builder 模式链式调用。
参考代码库 `jshook_plugin_template` 下的 `src/manifest.ts`：

```ts
import { createExtension, jsonResponse } from '@jshookmcp/extension-sdk/plugin';

export default createExtension('io.github.example.my-first-plugin', '1.0.0')
  .compatibleCore('^0.1.0')
  .allowTool(['browser_click', 'network_get_requests'])
  .metric(['my_plugin.loaded'])
  .tool(
    'my_custom_tool',
    'Execute DOM mutation and fetch traces.',
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

**说明：**

- `createExtension`：创建插件实例，需提供具备唯一性的 ID 与版本号。
- `.allowTool([...])`：声明允许调用的工具白名单，越权调用将抛出异常。
- `.tool(name, ...)`：向外部 MCP 客户端注册一个新的工具端点。
- `ctx.invokeTool(...)`：在插件沙箱内安全调用其他系统内置工具。

## 插件开发流程

### 1. 准备开发环境

- 使用基础模板库: `https://github.com/vmoranv/jshook_plugin_template`
- 初始化主进程环境变量: `export MCP_PLUGIN_ROOTS=<path-to-cloned-jshook_plugin_template>`

### 2. 构建与校验

```bash
pnpm install
pnpm run build
pnpm run check
```

**工程约定**：本地开发建议使用 TypeScript 编写。源代码通过 `manifest.ts` 暴露入口，主程序将自动加载编译后的 `dist/manifest.js` 并执行逻辑。

### 3. 修改标识符

部署前，请替换模板工程中以下全局标识：

- 插件 ID (`PLUGIN_ID`)：推荐使用 x.y.z 反向域名格式，如 `io.github.example.my-plugin`。
- 元数据 (`manifest.name` / `manifest.pluginVersion` / `manifest.description`) 等向外展示的信息。

### 4. 权限白名单配置

出于核心安全机制考量，所有可能产生影响的操作必须显式声明白名单权限：

- `toolExecution.allowTools`：限制子模块通过 `ctx.invokeTool()` 可调用的工具集合。
- `network.allowHosts`：管控允许发起的网络套接字请求的目标地址。
- `process.allowCommands`：限制允许派生的外部系统命令名称。
- `filesystem.readRoots` / `filesystem.writeRoots`：限制文件系统的安全读写路径。

**注意事项**：

- 请始终采用最小可用原则分配权限。
- 严禁在生产环境验证阶段使用通配符 `*`。

## API 解析

### 核心构建方法

- `.compatibleCore(range)` — 声明插件所依赖的核心引擎版本范围。
- `.allowTool(tools)` — 声明允许插件运行时调用的内置工具白名单。
- `.allowHost(hosts)` — 配置网络请求白名单。
- `.allowCommand(cmds)` — 配置系统命令执行白名单。
- `.profile(profiles)` — 声明适用的工具层级，如 `['workflow', 'full']`。

### 生命周期方法

引擎提供的核心回调生命周期如下：

1. **`onLoad(ctx)`**: 读取本地目录下的配置文件并进行依赖缓存准备。
2. **`onValidate(ctx)`**: 执行运行前的前置条件检测（如校验必要 Token、检测外置端口存活、审核连通性）。
3. **`onActivate(ctx)` / `onDeactivate(ctx)`**: 负责业务运行期的资源申请、内存清理与长连接中止。

### PluginLifecycleContext

- **`ctx.invokeTool(name, args?)`**:
  调用内置工具。调用须受 `allowTool` 声明的白名单限制，且受当前 `MCP_TOOL_PROFILE` 环境配置管控约束。
- **`ctx.getConfig(path, fallback)`**:
  从主进程映射读取此插件相关的只读配置缓存。
- **`ctx.setRuntimeData(key, value)` / `ctx.getRuntimeData(key)`**:
  管理本插件运行时的内存状态（如缓存数据、认证失效时间等）。

## 工具函数库

`@jshookmcp/extension-sdk` 内置了以下常用辅助函数：

- **`loadPluginEnv(import.meta.url)`**:
  读取当前插件目录下的 `.env` 配置文件。
- **`getPluginBooleanConfig(ctx, pluginId, key, fallback)`**:
  读取布尔类型的配置项，优先读取环境变量。

## 验证与发布

插件加载后的建议验证步骤：

1. 客户端发送 `extensions_reload`
2. 运行 `extensions_list` 确认您的插件已挂载激活
3. 调用 `search_tools` 检查所分配的 API 端点是否正常加载
4. 如果代码有改动，必须重新执行 `pnpm run build` 以刷新 JS 包依赖
