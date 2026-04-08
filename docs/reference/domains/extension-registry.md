# Extension Registry

域名：`extension-registry`

扩展注册域，管理和发现社区扩展。

## Profile

- workflow
- full

## 典型场景

- 扩展浏览
- 扩展安装
- 扩展版本管理

## 常见组合

- extension-registry + workflow
- extension-registry + maintenance

## 代表工具

- `extension_list_installed` — 列出已安装的 Chrome 扩展。
- `extension_execute_in_context` — 在指定 Chrome 扩展的后台上下文中执行代码。
- `extension_install` — 从本地或远程 manifest/模块 URL 安装扩展。
- `extension_reload` — 重新加载已安装的扩展（先卸载再加载）。
- `extension_uninstall` — 从本地扩展注册表中卸载扩展。
- `webhook_create` — 创建新的 Webhook 端点用于外部回调。
- `webhook_list` — 列出所有已注册的 Webhook 端点。
- `webhook_delete` — 按 ID 删除 Webhook 端点。
- `webhook_commands` — 获取或设置 Webhook 端点队列中的命令。

## 工具清单（9）

| 工具 | 说明 |
| --- | --- |
| `extension_list_installed` | 列出已安装的 Chrome 扩展。 |
| `extension_execute_in_context` | 在指定 Chrome 扩展的后台上下文中执行代码。 |
| `extension_install` | 从本地或远程 manifest/模块 URL 安装扩展。 |
| `extension_reload` | 重新加载已安装的扩展（先卸载再加载）。 |
| `extension_uninstall` | 从本地扩展注册表中卸载扩展。 |
| `webhook_create` | 创建新的 Webhook 端点用于外部回调。 |
| `webhook_list` | 列出所有已注册的 Webhook 端点。 |
| `webhook_delete` | 按 ID 删除 Webhook 端点。 |
| `webhook_commands` | 获取或设置 Webhook 端点队列中的命令。 |
