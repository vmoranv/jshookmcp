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
import type { PluginContract, PluginLifecycleContext } from '@jshookmcp/extension-sdk/plugin';

// 插件核心实现逻辑
const myPlugin: PluginContract = {
  kind: 'plugin-manifest',
  version: 1,

  // 核心身份字段
  id: 'io.github.example.my-first-plugin',
  name: 'My First Hook Plugin',
  pluginVersion: '1.0.0',
  entry: 'manifest.ts',

  // 安全权限：声明本插件可以调用哪些内置工具
  permissions: {
    toolExecution: {
      allowTools: ['browser_click', 'network_get_requests'],
    },
  },

  // 贡献：自动注册的新工具
  contributes: {
    domains: [
      {
        name: 'my_plugin_domain',
        tools: [
          {
            name: 'my_custom_tool',
            description: 'My custom high-level tool that clicks and gets requests.',
            handler: async (args, ctx) => {
              // 插件可以直接调用系统内置能力
              const clickRes = await ctx.invokeTool('browser_click', { text: 'Login' });
              return `Clicked! Result: ${clickRes}`;
            },
          },
        ],
      },
    ],
  },

  // 生命周期钩子：做初始化工作
  async onLoad(ctx: PluginLifecycleContext) {
    ctx.setRuntimeData('loadedAt', Date.now());
  },
};

export default myPlugin;
```

**简单解释：**

- `id` / `name`：插件的唯一身份标识。
- `permissions`：非常重要，**必须在这显式声明**允许调用的基础工具。若不写，`invokeTool` 会直接阻断调用。
- `contributes.domains`：用来暴露给用户的 MCP 新工具，在此注册了名为 `my_custom_tool` 的新工具。
- `invokeTool`：通过 `ctx.invokeTool(...)` 把内部原子能力组合为你自己的高层组合逻辑。
- `onLoad`：插件加载时的钩子，用于初始化或者打日志。

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
import type {
  PluginContract,
  PluginLifecycleContext,
  DomainManifest,
  ToolArgs,
  ToolHandlerDeps,
} from '@jshookmcp/extension-sdk/plugin';
import {
  loadPluginEnv,
  getPluginBooleanConfig,
  getPluginBoostTier,
} from '@jshookmcp/extension-sdk/plugin';
```

## API 深度拆解: PluginContract

### `manifest`

你至少要稳定维护这些字段：

- `kind: 'plugin-manifest'`
- `version: 1`
- `id`
- `name`
- `pluginVersion`
- `entry`
- `compatibleCore`
- `permissions`
- `activation`
- `contributes`

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
