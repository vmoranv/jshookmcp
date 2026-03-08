# Contributing

感谢你为 `jshookmcp` 做贡献。

## 开发前建议

- 先阅读 `README.md` / `README.zh.md`
- 优先从 `docs/index.md`、`docs/guide/getting-started.md` 和 `docs/guide/tool-selection.md` 理解当前入口
- 如果你要新增扩展能力，优先参考：
  - `https://github.com/vmoranv/jshook_plugin_template`
  - `https://github.com/vmoranv/jshook_workflow_template`

## 文档栈防腐原则

- 文档站优先使用 **VitePress 官方能力**，例如 locales、sidebar、local search、默认主题配置。
- 文档格式化优先使用 **Prettier 官方 CLI**，不为了小收益引入额外 Markdown/VitePress 格式化插件。
- 第三方 VitePress 插件只有在官方能力明显无法覆盖需求时才考虑引入，并且必须在 PR 中说明：
  - 为什么官方能力不够
  - 插件维护状态与兼容风险
  - 回退路径是什么

## 本地验证

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

## 扩展开发建议

- **只是固化工具链路**：优先做 workflow
- **需要新增工具或桥接外部系统**：再做 plugin
- **最小权限原则**：插件只声明真实需要的 `toolExecution.allowTools`
- **Git hygiene**：不要提交 `artifacts/`、`screenshots/`、`debugger-sessions/`、临时抓包与本地秘钥

## 测试建议

- 新增维护工具时，补 `tests/server/domains/maintenance/*.test.ts`
- 修改扩展加载安全逻辑时，补 `tests/server/ExtensionManager.test.ts`
- 修改 Hook preset 时，补 `tests/server/domains/hooks/*.test.ts`
- 修改复合 workflow handler 时，补 `tests/server/domains/workflow/handlers.test.ts`
