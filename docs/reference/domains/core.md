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

- `collect_code` — 从目标网站采集 JavaScript 代码，支持摘要、优先、增量和全量模式。
- `search_in_scripts` — 按关键词或正则模式检索已采集的脚本内容。
- `extract_function_tree` — 从已采集脚本中提取指定函数及其依赖树。
- `deobfuscate` — 基于 webcrack 的 JavaScript 反混淆，支持 bundle 解包。
- `understand_code` — 对代码结构、行为与风险进行语义分析。
- `detect_crypto` — 识别源码中的加密算法及其使用模式。
- `manage_hooks` — 创建、查看和清理 JavaScript 运行时 Hook。
- `detect_obfuscation` — 检测 JavaScript 源码中的混淆技术。
- `advanced_deobfuscate` — 高级反混淆（webcrack 后端，已废弃的旧标志忽略）。
- `webcrack_unpack` — 直接调用 webcrack 解包，返回模块图详情。

## 工具清单（15）

| 工具 | 说明 |
| --- | --- |
| `collect_code` | 从目标网站采集 JavaScript 代码，支持摘要、优先、增量和全量模式。 |
| `search_in_scripts` | 按关键词或正则模式检索已采集的脚本内容。 |
| `extract_function_tree` | 从已采集脚本中提取指定函数及其依赖树。 |
| `deobfuscate` | 基于 webcrack 的 JavaScript 反混淆，支持 bundle 解包。 |
| `understand_code` | 对代码结构、行为与风险进行语义分析。 |
| `detect_crypto` | 识别源码中的加密算法及其使用模式。 |
| `manage_hooks` | 创建、查看和清理 JavaScript 运行时 Hook。 |
| `detect_obfuscation` | 检测 JavaScript 源码中的混淆技术。 |
| `advanced_deobfuscate` | 高级反混淆（webcrack 后端，已废弃的旧标志忽略）。 |
| `webcrack_unpack` | 直接调用 webcrack 解包，返回模块图详情。 |
| `clear_collected_data` | 清理已采集的脚本数据、缓存和内存索引。 |
| `get_collection_stats` | 获取采集、缓存和压缩相关统计信息。 |
| `webpack_enumerate` | 枚举当前页面中的全部 Webpack 模块，并可按关键词搜索。 |
| `source_map_extract` | 查找并解析 JavaScript Source Map，以恢复原始源码。 |
| `llm_suggest_names` | 待补充中文：Use client LLM (via MCP sampling) to suggest meaningful names for obfuscated identifiers. Requires the connected client to support sampling/createMessage. Returns null suggestions gracefully if sampling is unavailable. |
