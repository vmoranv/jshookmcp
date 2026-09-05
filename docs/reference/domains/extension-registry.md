# 扩展注册

域名：`extension-registry`

扩展注册域，管理和发现社区扩展。

## Profile

- full

## 典型场景

- 扩展浏览
- 扩展安装
- 扩展版本管理

## 常见组合

- extension-registry + workflow
- extension-registry + maintenance

## 工具清单（7）

| 工具 | 说明 |
| --- | --- |
| `extension_install` | 从内联清单、本地包目录、本地模块文件或远程模块 URL 安装/注册扩展。 |
| `extension_list_installed` | 列出已安装的 Chrome 扩展。 |
| `extension_info` | 读取已安装扩展的清单详情，不导入或执行插件代码。 |
| `extension_execute_in_context` | 在指定 Chrome 扩展的后台上下文中执行代码。 |
| `extension_reload` | 重新加载已安装的扩展（先卸载再加载）。 |
| `extension_uninstall` | 从本地扩展注册表中卸载扩展。 |
| `webhook` | 管理 Webhook 端点用于外部回调。操作：create（创建）、list（列表）、delete（删除）、commands（命令）。 |
