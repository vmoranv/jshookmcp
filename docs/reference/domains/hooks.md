# Hooks

域名：`hooks`

AI Hook 生成、注入、数据导出，以及内置/自定义 preset 管理。

## Profile

- full

## 典型场景

- 函数调用采集
- 运行时证据留存
- 团队专用 inline preset

## 常见组合

- browser + hooks + debugger

## 代表工具

- `ai_hook_generate` — 为目标函数、API 或对象方法生成 Hook 代码。
- `ai_hook_inject` — 将生成的 Hook 注入当前页面。
- `ai_hook_get_data` — 获取活动 Hook 捕获的数据，如参数、返回值和调用次数。
- `ai_hook_list` — 列出全部活动 Hook 及其状态信息。
- `ai_hook_clear` — 按 ID 移除 Hook，或清空全部 Hook 与捕获数据。
- `ai_hook_toggle` — 启用或禁用指定 Hook，无需移除。
- `ai_hook_export` — 将 Hook 捕获数据导出为 JSON 或 CSV。
- `hook_preset` — 安装内置或自定义的 JavaScript Hook 预设模板。

## 工具清单（8）

| 工具 | 说明 |
| --- | --- |
| `ai_hook_generate` | 为目标函数、API 或对象方法生成 Hook 代码。 |
| `ai_hook_inject` | 将生成的 Hook 注入当前页面。 |
| `ai_hook_get_data` | 获取活动 Hook 捕获的数据，如参数、返回值和调用次数。 |
| `ai_hook_list` | 列出全部活动 Hook 及其状态信息。 |
| `ai_hook_clear` | 按 ID 移除 Hook，或清空全部 Hook 与捕获数据。 |
| `ai_hook_toggle` | 启用或禁用指定 Hook，无需移除。 |
| `ai_hook_export` | 将 Hook 捕获数据导出为 JSON 或 CSV。 |
| `hook_preset` | 安装内置或自定义的 JavaScript Hook 预设模板。 |
