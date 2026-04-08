# SourceMap

Domain: `sourcemap`

Source map discovery, fetching, parsing, and source tree reconstruction.

## Profiles

- workflow
- full

## Typical scenarios

- Discover source maps automatically
- Reconstruct source trees

## Common combinations

- core + sourcemap

## Representative tools

- `sourcemap_discover` — 自动发现页面中的 SourceMap（CDP scriptParsed + 脚本尾部注释回退）
- `sourcemap_fetch_and_parse` — 获取并解析 SourceMap v3（纯 TypeScript VLQ 解码），还原映射统计
- `sourcemap_reconstruct_tree` — 从 SourceMap 重建原始项目文件树并写出到目录

## Full tool list (3)

| Tool | Description |
| --- | --- |
| `sourcemap_discover` | 自动发现页面中的 SourceMap（CDP scriptParsed + 脚本尾部注释回退） |
| `sourcemap_fetch_and_parse` | 获取并解析 SourceMap v3（纯 TypeScript VLQ 解码），还原映射统计 |
| `sourcemap_reconstruct_tree` | 从 SourceMap 重建原始项目文件树并写出到目录 |
