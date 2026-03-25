# Core

Domain: `core`

Core static and semi-static analysis domain for script collection, deobfuscation, semantic inspection, webpack analysis, source map recovery, and crypto detection.

## Profiles

- workflow
- full

## Typical scenarios

- Collect and inspect scripts
- Understand obfuscated code
- Recover code from bundles and source maps

## Common combinations

- browser + network + core
- core + sourcemap + transform

## Representative tools

- `collect_code` — Collect JavaScript code from a target website. Supports summary, priority, incremental, and full collection modes.
- `search_in_scripts` — Search collected scripts by keyword or regex pattern.
- `extract_function_tree` — Extract a function and its dependency tree from collected scripts.
- `deobfuscate` — Run webcrack-powered JavaScript deobfuscation with bundle unpacking support.
- `understand_code` — Run semantic code analysis for structure, behavior, and risks.
- `detect_crypto` — Detect cryptographic algorithms and usage patterns in source code.
- `manage_hooks` — Create, inspect, and clear JavaScript runtime hooks.
- `detect_obfuscation` — Detect obfuscation techniques in JavaScript source.
- `advanced_deobfuscate` — Run advanced deobfuscation with webcrack backend (deprecated legacy flags ignored).
- `webcrack_unpack` — Run webcrack bundle unpacking directly and return extracted module graph details.

## Full tool list (14)

| Tool | Description |
| --- | --- |
| `collect_code` | Collect JavaScript code from a target website. Supports summary, priority, incremental, and full collection modes. |
| `search_in_scripts` | Search collected scripts by keyword or regex pattern. |
| `extract_function_tree` | Extract a function and its dependency tree from collected scripts. |
| `deobfuscate` | Run webcrack-powered JavaScript deobfuscation with bundle unpacking support. |
| `understand_code` | Run semantic code analysis for structure, behavior, and risks. |
| `detect_crypto` | Detect cryptographic algorithms and usage patterns in source code. |
| `manage_hooks` | Create, inspect, and clear JavaScript runtime hooks. |
| `detect_obfuscation` | Detect obfuscation techniques in JavaScript source. |
| `advanced_deobfuscate` | Run advanced deobfuscation with webcrack backend (deprecated legacy flags ignored). |
| `webcrack_unpack` | Run webcrack bundle unpacking directly and return extracted module graph details. |
| `clear_collected_data` | Clear collected script data, caches, and in-memory indexes. |
| `get_collection_stats` | Get collection, cache, and compression statistics. |
| `webpack_enumerate` | Enumerate all webpack modules in the current page and optionally search for keywords. Useful for finding hidden APIs, flags, or internal logic in bundled applications. |
| `source_map_extract` | Find and parse JavaScript source maps to recover original source code. Useful for analyzing minified or bundled applications. |
