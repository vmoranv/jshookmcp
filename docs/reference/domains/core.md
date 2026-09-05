# 核心

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

## 工具清单（25）

| 工具 | 说明 |
| --- | --- |
| `collect_code` | 从目标网站采集 JavaScript 代码，支持摘要、优先、增量和全量模式。 |
| `search_in_scripts` | 按关键词或正则模式检索已采集的脚本内容。 |
| `extract_function_tree` | 从已采集脚本中提取指定函数及其依赖树。 |
| `deobfuscate` | 基于 webcrack 的 JavaScript 反混淆，支持 bundle 解包；传入 engine='webcrack' 启用 VM 级深度反混淆。 |
| `understand_code` | 对代码结构、行为与风险进行语义分析。 |
| `detect_crypto` | 识别源码中的加密算法及其使用模式。 |
| `manage_hooks` | 创建、查看和清理 JavaScript 运行时 Hook。 |
| `detect_obfuscation` | 检测 JavaScript 源码中的混淆技术。 |
| `webcrack_unpack` | 直接调用 webcrack 解包，返回模块图详情。 |
| `clear_collected_data` | 清理已采集的脚本数据、缓存和内存索引。 |
| `get_collection_stats` | 获取采集、缓存和压缩相关统计信息。 |
| `webpack_enumerate` | 枚举当前页面中的全部 Webpack 模块，并可按关键词搜索。 |
| `llm_suggest_names` | 利用 AI 为混淆的变量名和函数名建议有意义的名称。 |
| `js_deobfuscate_jsvmp` | 反混淆 JSVMP/VM 保护的 JavaScript：提取 VM 字节码并还原原始逻辑。 |
| `js_deobfuscate_pipeline` | 三阶段反混淆管线：预处理 → 去混淆 → 可读化。 |
| `js_analyze_vm` | 分析 JSVMP/VM 解释器结构：调度类型、handler 表、操作码映射。 |
| `js_solve_constraints` | 求解混淆代码中的不透明谓词和常量表达式。 |
| `analysis_ast_match` | 按 AST 节点类型和属性过滤器匹配代码中的节点，如查找所有 CallExpression。 |
| `analysis_deflat_control_flow` | 将 switch-dispatcher 控制流平坦化还原为顺序执行的代码。 |
| `analysis_decode_string_array` | 解码字面量字符串数组访问模式，将间接引用替换回内联字符串。 |
| `js_symbolic_execute` | JavaScript 符号执行：探索所有可行执行路径，收集路径约束并求解。适用于控制流平坦化后的复杂分支代码分析。 |
| `js_symbolic_execute_jsvmp` | JSVMP 字节码符号执行：逐步对指令进行符号执行，推断原始逻辑、约束和置信度。需先使用 js_analyze_vm 获取指令序列。 |
| `ai_suggest_exploits` | 使用 LLM 为给定漏洞建议利用原语和攻击链。返回理论利用步骤、参考资料和所需条件。重要提示：不生成可执行的 payload 或恶意代码。 |
| `analysis_data_flow` | 追踪 JavaScript 中的数据流：识别污点源（用户输入、网络、存储）、污点汇（XSS、eval、SQL 注入、命令执行）、净化器透传点和污点变量传播路径。用于发现注入漏洞。 |
| `analysis_security_scan` | JavaScript 静态安全扫描：检测硬编码密钥（API key、token）、危险函数（eval、Function 构造器）、XSS 汇（innerHTML、document.write）、SQL 注入模式和弱加密（Math.random）。返回带严重度和修复建议的结构化风险。 |
