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

## Full tool list (25)

| Tool | Description |
| --- | --- |
| `collect_code` | Collect JavaScript from a target website with configurable strategy. |
| `search_in_scripts` | Search collected scripts by keyword or regex pattern. |
| `extract_function_tree` | Extract a function and its dependency tree from collected scripts. |
| `deobfuscate` | Run webcrack-powered JavaScript deobfuscation with bundle unpacking. |
| `understand_code` | Run semantic code analysis for structure, behavior, and risks. |
| `detect_crypto` | Detect cryptographic algorithms and usage patterns in source code. |
| `manage_hooks` | Create, inspect, and clear JavaScript runtime hooks. |
| `detect_obfuscation` | Detect obfuscation techniques in JavaScript source. |
| `webcrack_unpack` | Run webcrack bundle unpacking and return extracted module graph. |
| `clear_collected_data` | Clear collected script data, caches, and in-memory indexes. |
| `get_collection_stats` | Get collection, cache, and compression statistics. |
| `webpack_enumerate` | Enumerate webpack modules in current page and search for keywords. |
| `llm_suggest_names` | Use LLM to suggest meaningful names for obfuscated identifiers. |
| `js_deobfuscate_jsvmp` | Deobfuscate JSVMP/VM-protected JavaScript: extract VM bytecode and restore original logic. |
| `js_deobfuscate_pipeline` | Three-stage deobfuscation pipeline: preprocess → deobfuscate → humanize. |
| `js_analyze_vm` | Analyze JSVMP/VM interpreter: dispatch type, handler table, opcode map. |
| `js_solve_constraints` | Solve opaque predicates and constant expressions in obfuscated code. |
| `analysis_ast_match` | Match AST nodes by type and optional property filter. |
| `analysis_deflat_control_flow` | Flatten switch-dispatch control flow back to straight-line code. |
| `analysis_decode_string_array` | Decode literal string-array access back to strings. |
| `js_symbolic_execute` | Symbolic execution of JavaScript: explore all feasible execution paths, collect path constraints, and solve them. Best for control-flow-flattened code with complex branching. |
| `js_symbolic_execute_jsvmp` | Symbolic execution of JSVMP bytecode: step through instructions symbolically to infer original logic, constraints, and confidence score. Use after js_analyze_vm to get instructions. |
| `ai_suggest_exploits` | Use LLM to suggest exploit primitives and attack chains for a given vulnerability. Returns theoretical exploitation steps, references, and required conditions. IMPORTANT: Does NOT generate executable payloads or malicious code. |
| `analysis_data_flow` | Trace data flow through JavaScript: identify sources (user input, network, storage), sinks (XSS, eval, SQL injection, command execution), sanitizer pass-through points, and tainted variable propagation paths. Useful for finding injection vulnerabilities. |
| `analysis_security_scan` | Static security scan of JavaScript: detect hardcoded secrets (API keys, tokens), dangerous functions (eval, Function constructor), XSS sinks (innerHTML, document.write), SQL injection patterns, and weak crypto (Math.random). Returns structured risks with severity and recommendations. |
