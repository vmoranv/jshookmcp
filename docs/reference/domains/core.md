# Core

域名：`core`

核心静态/半静态分析域，覆盖脚本采集、反混淆、语义理解、webpack/source map 与加密识别。

## Profile

- workflow
- full

## 典型场景

- 脚本采集与静态检索
- 混淆代码理解
- 从 bundle/source map 恢复源码

## 常见组合

- browser + network + core
- core + sourcemap + transform

## 代表工具

- `collect_code` — Collect JavaScript code from a target website. Supports summary, priority, incremental, and full collection modes.
- `search_in_scripts` — Search collected scripts by keyword or regex pattern.
- `extract_function_tree` — Extract a function and its dependency tree from collected scripts.
- `deobfuscate` — Run LLM-assisted JavaScript deobfuscation.
- `understand_code` — Run semantic code analysis for structure, behavior, and risks.
- `detect_crypto` — Detect cryptographic algorithms and usage patterns in source code.
- `manage_hooks` — Create, inspect, and clear JavaScript runtime hooks.
- `detect_obfuscation` — Detect obfuscation techniques in JavaScript source.
- `advanced_deobfuscate` — Run advanced deobfuscation with VM-oriented strategies.
- `clear_collected_data` — Clear collected script data, caches, and in-memory indexes.

## 工具清单（13）

| 工具                    | 说明                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collect_code`          | Collect JavaScript code from a target website. Supports summary, priority, incremental, and full collection modes.                                                      |
| `search_in_scripts`     | Search collected scripts by keyword or regex pattern.                                                                                                                   |
| `extract_function_tree` | Extract a function and its dependency tree from collected scripts.                                                                                                      |
| `deobfuscate`           | Run LLM-assisted JavaScript deobfuscation.                                                                                                                              |
| `understand_code`       | Run semantic code analysis for structure, behavior, and risks.                                                                                                          |
| `detect_crypto`         | Detect cryptographic algorithms and usage patterns in source code.                                                                                                      |
| `manage_hooks`          | Create, inspect, and clear JavaScript runtime hooks.                                                                                                                    |
| `detect_obfuscation`    | Detect obfuscation techniques in JavaScript source.                                                                                                                     |
| `advanced_deobfuscate`  | Run advanced deobfuscation with VM-oriented strategies.                                                                                                                 |
| `clear_collected_data`  | Clear collected script data, caches, and in-memory indexes.                                                                                                             |
| `get_collection_stats`  | Get collection, cache, and compression statistics.                                                                                                                      |
| `webpack_enumerate`     | Enumerate all webpack modules in the current page and optionally search for keywords. Useful for finding hidden APIs, flags, or internal logic in bundled applications. |
| `source_map_extract`    | Find and parse JavaScript source maps to recover original source code. Useful for analyzing minified or bundled applications.                                           |
