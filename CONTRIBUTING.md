# Contributing

## 中文

感谢你为 `jshookmcp` 做贡献。

### 对普通使用者的建议

如果你只是想使用主程序，优先：

```bash
npx -y @jshookmcp/jshook
```

只有在下面这些场景，才需要 clone 仓库或模板仓并本地 build：

- 你要从源码调试 `jshookmcp`
- 你要开发自己的 plugin
- 你要开发自己的 workflow

### 开发前建议

- 先阅读 `README.md` / `README.zh.md`
- 优先从 [docs/index.md](docs/index.md)、[快速开始](docs/guide/getting-started.md) 和 [工具选择](docs/guide/tool-selection.md) 理解当前入口
- 如果你要新增扩展能力，优先参考：
  - `https://github.com/vmoranv/jshook_plugin_template`
  - `https://github.com/vmoranv/jshook_workflow_template`
- 如果你希望自己的 plugin / workflow 被扩展 registry 收录，建议到：
  - `https://github.com/vmoranv/jshookmcpextension/issues`

### 文档栈防腐原则

- 文档站优先使用 **VitePress 官方能力**，例如 locales、sidebar、local search、默认主题配置。
- 文档格式化优先使用 **Prettier 官方 CLI**，不为了小收益引入额外 Markdown/VitePress 格式化插件。
- 第三方 VitePress 插件只有在官方能力明显无法覆盖需求时才考虑引入，并且必须在 PR 中说明：
  - 为什么官方能力不够
  - 插件维护状态与兼容风险
  - 回退路径是什么

### 本地验证

提交前至少运行：

```bash
pnpm run check:docs-format
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run docs:build
pnpm run audit:tools
```

如果你在处理依赖/桥接问题，可额外运行：

```bash
pnpm run doctor
pnpm run format:docs
```

### PR 质量门禁

- 仓库会对新 PR 运行自动质量门禁，明显的低质量、灌水或批量化 AI slop PR 会被直接关闭。
- PR 标题请尽量使用 conventional 风格，例如 `fix(server): ...`、`docs: ...`。
- 不要删除 PR 模板章节；请按模板补全 `Summary`、`What changed`、`Validation` 和 `Related issues`。
- 尽量保持 PR 小而聚焦。大范围无背景改动、空泛描述、缺失验证步骤的 PR 更容易被拦截。
- 如果被误判，补全模板、说明本地验证，并在收窄改动范围后重新打开 PR；必要时先开 issue 说明背景。

### 扩展开发建议

- **只是固化工具链路**：优先做 workflow
- **需要新增工具或桥接外部系统**：再做 plugin
- **最小权限原则**：插件只声明真实需要的 `toolExecution.allowTools`
- **Git hygiene**：不要提交 `artifacts/`、`screenshots/`、`debugger-sessions/`、临时抓包与本地秘钥

### 测试建议

- 新增维护工具时，补 `tests/server/domains/maintenance/*.test.ts`
- 修改扩展加载安全逻辑时，补 `tests/server/ExtensionManager.test.ts`
- 修改 Hook preset 时，补 `tests/server/domains/hooks/*.test.ts`
- 修改复合 workflow handler 时，补 `tests/server/domains/workflow/handlers.test.ts`

### 支持项目

如果这些文档或工具对你有帮助，欢迎支持项目维护：

#### 微信支付

<img src="docs/public/support/wechat.png" alt="微信支付收款码" width="280">

#### 支付宝

<img src="docs/public/support/alipay.png" alt="支付宝收款码" width="280">

---

## English

Thanks for contributing to `jshookmcp`.

### For regular users

If you only want to use the main server, prefer:

```bash
npx -y @jshookmcp/jshook
```

You only need to clone repositories and build locally when:

- you are debugging `jshookmcp` from source
- you are developing your own plugin
- you are developing your own workflow

### Before you start developing

- read `README.md` / `README.zh.md`
- start from [docs/index.md](docs/index.md), [Getting started](docs/guide/getting-started.md), and [Tool selection](docs/guide/tool-selection.md) for the current information architecture
- if you are adding extension capabilities, start from:
  - `https://github.com/vmoranv/jshook_plugin_template`
  - `https://github.com/vmoranv/jshook_workflow_template`
- if you want your plugin or workflow to be considered for the extension registry, open an issue at:
  - `https://github.com/vmoranv/jshookmcpextension/issues`

### Documentation hygiene rules

- Prefer official **VitePress** capabilities first: locales, sidebar, local search, and the default theme.
- Prefer the official **Prettier CLI** for docs formatting instead of adding extra formatting plugins for marginal gains.
- Only introduce third-party VitePress plugins when official capabilities are clearly insufficient, and explain in the PR:
  - why official capabilities are not enough
  - the plugin maintenance and compatibility risk
  - the rollback path

### Local verification

Run at least:

```bash
pnpm run check:docs-format
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run docs:build
pnpm run audit:tools
```

If you are working on dependency or bridge issues, also consider:

```bash
pnpm run doctor
pnpm run format:docs
```

### PR quality gate

- The repository runs an automated quality gate on new PRs and may immediately close low-quality, spammy, or obviously mass-generated AI slop submissions.
- Prefer conventional PR titles such as `fix(server): ...` or `docs: ...`.
- Do not remove sections from the PR template; fill in `Summary`, `What changed`, `Validation`, and `Related issues`.
- Keep PRs small and well-scoped. Broad drive-by changes, vague descriptions, and missing validation details are much more likely to be flagged.
- If a legitimate PR is flagged, restore the template, explain the local checks you ran, narrow the scope if needed, and reopen it. Open an issue first if extra context is required.

### Extension development guidance

- **If you are only codifying a repeated tool chain**: start with a workflow
- **If you need a new tool surface or an external bridge**: move to a plugin
- **Use least privilege**: only declare the `toolExecution.allowTools` entries you actually need
- **Git hygiene**: do not commit `artifacts/`, `screenshots/`, `debugger-sessions/`, temporary traffic captures, or local secrets

### Testing guidance

- add tests under `tests/server/domains/maintenance/*.test.ts` when you add maintenance tools
- update `tests/server/ExtensionManager.test.ts` when you change extension loading or security logic
- update `tests/server/domains/hooks/*.test.ts` when you change hook presets
- update `tests/server/domains/workflow/handlers.test.ts` when you change composite workflow handlers

### Support the project

If the docs or tools are useful to you, you can support project maintenance:

#### WeChat Pay

<img src="docs/public/support/wechat.png" alt="WeChat Pay QR code" width="280">

#### Alipay

<img src="docs/public/support/alipay.png" alt="Alipay QR code" width="280">
