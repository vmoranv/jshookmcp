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

## Full tool list (7)

| Tool | Description |
| --- | --- |
| `sourcemap_discover` | Discover source maps on the current page. |
| `sourcemap_fetch_and_parse` | Fetch a source map from URL and parse to original sources. |
| `sourcemap_coverage` | Summarize mapped and unmapped source coverage. |
| `sourcemap_lookup` | Resolve generated code position to original source (default), or — when originalSource is supplied — resolve original source:line:column back to the generated position. Supports indexed (sectioned) source maps transparently. |
| `sourcemap_reconstruct_tree` | Reconstruct source files from a source map. When a vendor stripped sourcesContent, set inferMissing=true to emit a best-effort name+position skeleton (from mapping segments) instead of a placeholder. Set emitScopes=true to also decode the ECMA-426 v4 scopes field and write a `.scopes.json` sidecar (per-source variables, function kind, hidden ranges) next to each reconstructed file. |
| `sourcemap_parse_v4` | Parse source map with ECMA-426 v4 scope/debug-id support; falls back to v3. |
| `sourcemap_diff` | Compare two source map revisions: which sources were added/removed, per-source mapping segment deltas, and generated-position shifts beyond a configurable threshold (default 1 line). |
