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

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `sourcemap_discover` | Discover source maps on the current page. |
| `sourcemap_fetch_and_parse` | Fetch a source map from URL and parse to original sources. |
| `sourcemap_coverage` | Summarize mapped and unmapped source coverage. |
| `sourcemap_lookup` | Resolve generated code position to original source (default), or — when originalSource is supplied — resolve original source:line:column back to the generated position. Supports indexed (sectioned) source maps transparently. |
| `sourcemap_reconstruct_tree` | Reconstruct source files from a source map. When a vendor stripped sourcesContent, set inferMissing=true to emit a best-effort name+position skeleton (from mapping segments) instead of a placeholder. |
| `sourcemap_parse_v4` | Parse source map with ECMA-426 v4 scope/debug-id support; falls back to v3. |
