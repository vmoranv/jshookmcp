# SourceMap

域名：`sourcemap`

SourceMap 发现、抓取、解析与源码树重建。

## Profile

- full

## 典型场景

- 自动发现 sourcemap
- 恢复源码树

## 常见组合

- core + sourcemap

## 代表工具

- `sourcemap_discover` — 自动发现页面中的 Source Map 引用。
- `sourcemap_fetch_and_parse` — 获取并解析 Source Map v3，恢复生成代码到原始源码的映射统计。
- `sourcemap_reconstruct_tree` — 根据 Source Map 重建原始项目文件树并写出 sources 内容。
- `extension_list_installed` — 列出已安装的 Chrome 扩展。
- `extension_execute_in_context` — 在指定 Chrome 扩展的后台上下文中执行代码。

## 工具清单（5）

| 工具 | 说明 |
| --- | --- |
| `sourcemap_discover` | 自动发现页面中的 Source Map 引用。 |
| `sourcemap_fetch_and_parse` | 获取并解析 Source Map v3，恢复生成代码到原始源码的映射统计。 |
| `sourcemap_reconstruct_tree` | 根据 Source Map 重建原始项目文件树并写出 sources 内容。 |
| `extension_list_installed` | 列出已安装的 Chrome 扩展。 |
| `extension_execute_in_context` | 在指定 Chrome 扩展的后台上下文中执行代码。 |
