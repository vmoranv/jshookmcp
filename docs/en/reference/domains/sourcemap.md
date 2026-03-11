# SourceMap

Domain: `sourcemap`

Source map discovery, fetching, parsing, and source tree reconstruction.

## Profiles

- full

## Typical scenarios

- Discover source maps automatically
- Reconstruct source trees

## Common combinations

- core + sourcemap

## Representative tools

- `sourcemap_discover` — 自动发现页面中的 SourceMap。通过 CDP Debugger.scriptParsed 事件收集 sourceMapURL，并回退检查脚本尾部 //# sourceMappingURL= 注释。
- `sourcemap_fetch_and_parse` — 获取并解析 SourceMap v3（纯 TypeScript VLQ 解码，不依赖 source-map 包），还原 generated → original 映射统计。
- `sourcemap_reconstruct_tree` — 从 SourceMap 重建原始项目文件树，将 sources + sourcesContent 写出到目录（通过 resolveArtifactPath 生成输出目录）。
- `extension_list_installed` — 列出已安装的 Chrome 扩展。通过 CDP Target.getTargets 检测 type='service_worker' 或 'background_page' 的 chrome-extension:// targets。
- `extension_execute_in_context` — 在指定 Chrome 扩展的 background context 中执行代码。通过 Target.attachToTarget 附加后调用 Runtime.evaluate。

## Full tool list (5)

| Tool | Description |
| --- | --- |
| `sourcemap_discover` | 自动发现页面中的 SourceMap。通过 CDP Debugger.scriptParsed 事件收集 sourceMapURL，并回退检查脚本尾部 //# sourceMappingURL= 注释。 |
| `sourcemap_fetch_and_parse` | 获取并解析 SourceMap v3（纯 TypeScript VLQ 解码，不依赖 source-map 包），还原 generated → original 映射统计。 |
| `sourcemap_reconstruct_tree` | 从 SourceMap 重建原始项目文件树，将 sources + sourcesContent 写出到目录（通过 resolveArtifactPath 生成输出目录）。 |
| `extension_list_installed` | 列出已安装的 Chrome 扩展。通过 CDP Target.getTargets 检测 type='service_worker' 或 'background_page' 的 chrome-extension:// targets。 |
| `extension_execute_in_context` | 在指定 Chrome 扩展的 background context 中执行代码。通过 Target.attachToTarget 附加后调用 Runtime.evaluate。 |
