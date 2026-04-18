# Workflow

域名：`workflow`

复合工作流与脚本库域，是 built-in 高层编排入口。

## Profile

- full

## 典型场景

- 一键 API 采集
- 注册与验证流程
- 批量探测与 bundle 搜索

## 常见组合

- workflow + browser + network

## 代表工具

- `page_script_register` — 在脚本库中注册可复用的命名 JavaScript 片段。
- `page_script_run` — 在当前页面上下文中执行脚本库里的命名脚本。
- `api_probe_batch` — 在浏览器上下文中批量探测多个 API 端点。
- `js_bundle_search` — 抓取远程 JavaScript Bundle，并在一次调用中按多个命名正则模式搜索。
- `list_extension_workflows` — 列出运行时已加载的扩展工作流及其执行所需元数据。
- `run_extension_workflow` — 按 workflowId 执行运行时扩展工作流，并支持配置覆盖、节点输入覆盖与超时控制。

## 工具清单（6）

| 工具 | 说明 |
| --- | --- |
| `page_script_register` | 在脚本库中注册可复用的命名 JavaScript 片段。 |
| `page_script_run` | 在当前页面上下文中执行脚本库里的命名脚本。 |
| `api_probe_batch` | 在浏览器上下文中批量探测多个 API 端点。 |
| `js_bundle_search` | 抓取远程 JavaScript Bundle，并在一次调用中按多个命名正则模式搜索。 |
| `list_extension_workflows` | 列出运行时已加载的扩展工作流及其执行所需元数据。 |
| `run_extension_workflow` | 按 workflowId 执行运行时扩展工作流，并支持配置覆盖、节点输入覆盖与超时控制。 |
