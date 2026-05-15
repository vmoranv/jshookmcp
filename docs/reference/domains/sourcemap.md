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

## 工具清单（6）

| 工具 | 说明 |
| --- | --- |
| `sourcemap_discover` | 自动发现页面中的 Source Map 引用。 |
| `sourcemap_fetch_and_parse` | 获取并解析 Source Map v3，恢复生成代码到原始源码的映射统计。 |
| `sourcemap_coverage` | 汇总 source map 的已映射与未映射源码覆盖范围。 |
| `sourcemap_lookup` | 将生成代码的位置（行号:列号）反向映射到原始源码位置。 |
| `sourcemap_reconstruct_tree` | 根据 Source Map 重建原始项目文件树并写出 sources 内容。 |
| `sourcemap_parse_v4` | 解析 Source Map，支持 ECMA-426 v4 scope/debug-id；无 v4 字段时回退 v3。 |
