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

- `ai_hook_generate` — Generate hook code for a target function, API, or object method.
- `ai_hook_inject` — Inject a generated hook into the page.
- `ai_hook_get_data` — Retrieve captured data from an active hook (arguments, return values, timestamps, call count)
- `ai_hook_list` — List all active hooks with their IDs, types, creation time, and call counts
- `ai_hook_clear` — Remove one hook by ID or clear all hooks and their captured data
- `ai_hook_toggle` — Enable or disable a hook without removing it
- `ai_hook_export` — Export captured hook data in JSON or CSV format
- `hook_preset` — Install a pre-built JavaScript hook from 20+ built-in presets (eval, atob/btoa, Proxy, Reflect, Object.defineProperty, etc.), or provide customTemplate/customTemplates to install your own reusable hook bodies. Use listPresets=true to see all available preset descriptions.

## 工具清单（8）

| 工具               | 说明                                                                                                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_hook_generate` | Generate hook code for a target function, API, or object method.                                                                                                                                                                                                                 |
| `ai_hook_inject`   | Inject a generated hook into the page.                                                                                                                                                                                                                                           |
| `ai_hook_get_data` | Retrieve captured data from an active hook (arguments, return values, timestamps, call count)                                                                                                                                                                                    |
| `ai_hook_list`     | List all active hooks with their IDs, types, creation time, and call counts                                                                                                                                                                                                      |
| `ai_hook_clear`    | Remove one hook by ID or clear all hooks and their captured data                                                                                                                                                                                                                 |
| `ai_hook_toggle`   | Enable or disable a hook without removing it                                                                                                                                                                                                                                     |
| `ai_hook_export`   | Export captured hook data in JSON or CSV format                                                                                                                                                                                                                                  |
| `hook_preset`      | Install a pre-built JavaScript hook from 20+ built-in presets (eval, atob/btoa, Proxy, Reflect, Object.defineProperty, etc.), or provide customTemplate/customTemplates to install your own reusable hook bodies. Use listPresets=true to see all available preset descriptions. |
