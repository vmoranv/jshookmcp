# Plugin 开发流程

## 什么时候应该做 plugin

优先做 plugin，而不是继续堆 workflow，当你需要：

- 暴露新的工具名
- 在 built-in tools 之上再包一层高层能力
- 对接外部系统、bridge 或本地命令
- 动态注册 domain / workflow / metric
- 明确声明并审计权限

## 最小实例 (Minimal Working Example)

在深入各种理论与生命周期之前，我们来看一个最小的插件实例。
这就是你在 `jshook_plugin_template` 模板库中 `src/manifest.ts` 最常见到的样子：

```ts
import { createExtension, jsonResponse } from '@jshookmcp/extension-sdk/plugin';

export default createExtension('io.github.example.my-first-plugin', '1.0.0')
  .name('My First Hook Plugin')
  .description('A minimal demo plugin using the fluent builder pattern')
  .compatibleCore('^0.1.0')
  .allowTool(['browser_click', 'network_get_requests'])
  .metric(['my_plugin.loaded'])
  .tool(
    'my_custom_tool',
    'My custom high-level tool that clicks and gets requests.',
    { message: { type: 'string', description: 'Button text to click' } },
    async (args, ctx) => {
      const clickRes = await ctx.invokeTool('browser_click', { text: args.message });
      return jsonResponse({ success: true, result: clickRes });
    },
  )
  .onLoad((ctx) => {
    ctx.setRuntimeData('loadedAt', Date.now());
  })
  .onActivate(async (ctx) => {
    ctx.registerMetric('my_plugin.loaded');
  });
```

**简单解释：**

- `createExtension(id, version)` 返回流畅构建器，所有配置均为链式方法调用。
- `.allowTool([...])` 声明允许调用的基础工具（等同于旧版 `permissions.toolExecution.allowTools`）。
- `.tool(name, description, schema, handler)` 注册新的 MCP 工具。
- `ctx.invokeTool(...)` 在运行时调用内部原子能力。
- `.onLoad(...)` / `.onActivate(...)` 是生命周期钩子。

---

## 推荐开发流程

### 1. 从模板仓开始

- 模板仓：`https://github.com/vmoranv/jshook_plugin_template`
- 克隆后设置：`MCP_PLUGIN_ROOTS=<path-to-cloned-jshook_plugin_template>`

### 2. 安装并跑最小检查

```bash
pnpm install
pnpm run build
pnpm run check
```

这里的推荐顺序不是装饰性步骤：模板仓现在是 **TS-first**，源码入口是 `manifest.ts`，本地 build 后会生成 `dist/manifest.js` 供运行时优先加载。

### 3. 改掉模板身份字段

优先替换这些常量和 manifest 字段：

- `PLUGIN_ID`
- `PLUGIN_SLUG`
- `DOMAIN`
- `manifest.name`
- `manifest.pluginVersion`
- `manifest.description`

推荐 `id` 使用 reverse-domain 形式，例如：`io.github.example.my-plugin`。

同时确认：

- `manifest.entry` 指向 `manifest.ts`
- Git 里提交的是 TS 源码，不是 `dist/manifest.js`

### 4. 先收紧权限，再写逻辑

plugin manifest 里最重要的是 `permissions`：

- `toolExecution.allowTools`：你允许 `ctx.invokeTool()` 调哪些 built-in tools
- `network.allowHosts`
- `process.allowCommands`
- `filesystem.readRoots` / `filesystem.writeRoots`

实践上建议：

- 一开始只保留你真正调用的 built-in tools
- 不要先写 `*` 再回头收口
- 对外部命令与文件路径保持最小 allowlist

## 插件作者的导入面

推荐从公开 SDK 入口导入，而不是引用主仓内部路径：

```ts
import {
  createExtension,
  jsonResponse,
  errorResponse,
  type PluginLifecycleContext,
  type ExtensionToolHandler,
  type ToolArgs,
} from '@jshookmcp/extension-sdk/plugin';
```

## API 深度拆解: ExtensionBuilder

### 核心方法

ExtensionBuilder 通过链式调用配置插件：

- `.name(n)` — 设置显示名
- `.description(d)` — 设置描述
- `.compatibleCore(range)` — 设置兼容的核心版本范围（默认 `>=0.1.0`）
- `.allowTool(tools)` — 声明允许调用的 built-in tools
- `.allowHost(hosts)` — 声明允许访问的网络主机
- `.allowCommand(cmds)` — 声明允许执行的外部命令
- `.metric(names)` — 声明插件指标名
- `.configDefault(key, value)` — 设置配置默认值
- `.profile(profiles)` — 设置工具可见的 profile 层级
- `.tool(name, desc, schema, handler)` — 注册新的 MCP 工具

### 生命周期

#### `onLoad(ctx)`

做最轻的初始化：

- 读取本地 `.env`
- 初始化 handler
- 写入 runtime data

#### `onValidate(ctx)`

做环境和配置校验：

- 必填配置是否存在
- 外部依赖是否可用
- baseUrl / loopback endpoint 是否合法

#### `onRegister(ctx)`

如果你不想完全依赖 `manifest.contributes.*`，可以在这里动态注册：

- `ctx.registerDomain(...)`
- `ctx.registerWorkflow(...)`
- `ctx.registerMetric(...)`

#### `onActivate(ctx)` / `onDeactivate(ctx)` / `onUnload(ctx)`

分别处理：

- 激活时资源接入
- 停用时清理活跃连接
- 卸载时彻底释放资源

## PluginLifecycleContext 实际给你的能力

### `ctx.invokeTool(name, args?)`

这是最重要的运行时能力，但边界也最硬：

- 只能调用 built-in tools
- 必须在 `permissions.toolExecution.allowTools` 里显式声明
- 当前 active profile 里不可见的工具也不能调

也就是说，`allowTools` 通过了，不等于运行时一定可调；profile 不匹配仍会失败。

### `ctx.getConfig(path, fallback)`

读运行时配置，不暴露整个内部配置对象。

### `ctx.setRuntimeData(key, value)` / `ctx.getRuntimeData(key)`

存插件自己的运行时状态，适合：

- 记录 load 时间
- 缓存初始化结果
- 记录探测状态

### `ctx.hasPermission(capability)`

用于判断 manifest 里有没有声明某个 capability。

### `ctx.registerDomain(...)` / `ctx.registerWorkflow(...)` / `ctx.registerMetric(...)`

用于动态注册贡献项。

## `manifest.contributes.*` 与 `ctx.register*()` 的区别

两者都能把内容挂进运行时：

- `manifest.contributes.*`：静态、可读性更高，适合默认推荐路径
- `ctx.register*()`：动态、适合按配置或环境条件决定是否注册

无论走哪条路径，`toolExecution` 权限声明都要到位；主仓运行时会检查这件事。

## Helper 的典型用法

### `loadPluginEnv(import.meta.url)`

- 从插件目录加载 `.env`
- 不会覆盖主进程里已经存在的环境变量

### `getPluginBooleanConfig(ctx, pluginId, key, fallback)`

读取布尔配置时会优先看环境变量，再回落到：

- `plugins.<pluginId>.<key>`

### `getPluginBoostTier(pluginId)`

用于解析 plugin auto-registration 的最低 tier，适合和 profile 策略联动。

## 推荐验证路径

在 `jshook` 侧依次做：

1. `extensions_reload`
2. `extensions_list`
3. `search_tools`
4. 如果你还贡献了 workflow，再看 `list_extension_workflows`

在每次 `extensions_reload` 之前，建议先在模板仓本地执行一次：

```bash
pnpm run build
```

原因是当前运行时在同一候选同时存在 `.ts` 和 `.js` 时，会优先加载生成后的 `.js` 文件。

## 常见误区

- 把 plugin 当作“可直接调用任意内部模块”的入口
- 忘记声明 `toolExecution.allowTools`
- 以为 `allowTools` 放行后，就和 profile 无关
- 把适合 workflow 的重复步骤硬做成 plugin
- 把 `dist/manifest.js` 当作应提交的源码文件
