# Workflow

域名：`workflow`

复合工作流与脚本库域，是 built-in 高层编排入口。

## Profile

- workflow
- full

## 典型场景

- 一键 API 采集
- 注册与验证流程
- 批量探测与 bundle 搜索

## 常见组合

- workflow + browser + network

## 代表工具

- `web_api_capture_session` — 一键执行完整 Web API 捕获流程：导航、注入拦截、执行动作、收集请求、提取认证，并可导出 HAR 与 Markdown 报告。
- `register_account_flow` — 自动执行账号注册流程，并处理邮箱验证。
- `page_script_register` — 在脚本库中注册可复用的命名 JavaScript 片段。
- `page_script_run` — 在当前页面上下文中执行脚本库里的命名脚本。
- `api_probe_batch` — 在浏览器上下文中批量探测多个 API 端点。
- `js_bundle_search` — 抓取远程 JavaScript Bundle，并在一次调用中按多个命名正则模式搜索。
- `batch_register` — 批量执行账号注册，支持并发控制、重试策略与幂等处理。
- `list_extension_workflows` — 列出运行时已加载的扩展工作流及其执行所需元数据。
- `run_extension_workflow` — 按 workflowId 执行运行时扩展工作流，并支持配置覆盖、节点输入覆盖与超时控制。

## 工具清单（9）

| 工具 | 说明 |
| --- | --- |
| `web_api_capture_session` | 一键执行完整 Web API 捕获流程：导航、注入拦截、执行动作、收集请求、提取认证，并可导出 HAR 与 Markdown 报告。 |
| `register_account_flow` | 自动执行账号注册流程，并处理邮箱验证。 |
| `page_script_register` | 在脚本库中注册可复用的命名 JavaScript 片段。 |
| `page_script_run` | 在当前页面上下文中执行脚本库里的命名脚本。 |
| `api_probe_batch` | 在浏览器上下文中批量探测多个 API 端点。 |
| `js_bundle_search` | 抓取远程 JavaScript Bundle，并在一次调用中按多个命名正则模式搜索。 |
| `batch_register` | 批量执行账号注册，支持并发控制、重试策略与幂等处理。 |
| `list_extension_workflows` | 列出运行时已加载的扩展工作流及其执行所需元数据。 |
| `run_extension_workflow` | 按 workflowId 执行运行时扩展工作流，并支持配置覆盖、节点输入覆盖与超时控制。 |
