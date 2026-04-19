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

- `collect_code` — Collect JavaScript from a target website in summary, priority, incremental, o...
- `search_in_scripts` — Search collected scripts by keyword or regex pattern
- `extract_function_tree` — Extract a function and its dependency tree from collected scripts
- `deobfuscate` — Run webcrack-powered JavaScript deobfuscation with bundle unpacking. Use engine="webcrack" for aggressive VM/advanced options.
- `understand_code` — Run semantic code analysis for structure, behavior, and risks
- `detect_crypto` — Detect cryptographic algorithms and usage patterns in source code
- `manage_hooks` — Create, inspect, and clear JavaScript runtime hooks
- `detect_obfuscation` — Detect obfuscation techniques in JavaScript source
- `webcrack_unpack` — Run webcrack bundle unpacking and return extracted module graph
- `clear_collected_data` — Clear collected script data, caches, and in-memory indexes

## Full tool list (13)

| Tool | Description |
| --- | --- |
| `collect_code` | Collect JavaScript from a target website in summary, priority, incremental, o... |
| `search_in_scripts` | Search collected scripts by keyword or regex pattern |
| `extract_function_tree` | Extract a function and its dependency tree from collected scripts |
| `deobfuscate` | Run webcrack-powered JavaScript deobfuscation with bundle unpacking. Use engine="webcrack" for aggressive VM/advanced options. |
| `understand_code` | Run semantic code analysis for structure, behavior, and risks |
| `detect_crypto` | Detect cryptographic algorithms and usage patterns in source code |
| `manage_hooks` | Create, inspect, and clear JavaScript runtime hooks |
| `detect_obfuscation` | Detect obfuscation techniques in JavaScript source |
| `webcrack_unpack` | Run webcrack bundle unpacking and return extracted module graph |
| `clear_collected_data` | Clear collected script data, caches, and in-memory indexes |
| `get_collection_stats` | Get collection, cache, and compression statistics |
| `webpack_enumerate` | Enumerate webpack modules in current page and search for keywords |
| `llm_suggest_names` | Use client LLM (via MCP sampling) to suggest meaningful names for obfuscated ... |
