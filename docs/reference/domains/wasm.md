# WASM

域名：`wasm`

WebAssembly dump、反汇编、反编译、优化与离线执行域。

## Profile

- full

## 典型场景

- WASM 模块提取
- WAT/伪代码恢复
- 离线运行导出函数

## 常见组合

- browser + wasm
- core + wasm

## 工具清单（17）

| 工具 | 说明 |
| --- | --- |
| `wasm_capabilities` | 查看当前页面 WASM 捕获和外部工具是否可用。 |
| `wasm_dump` | 从当前页面导出已捕获的 WASM 模块。 |
| `wasm_disassemble` | 用 wasm2wat 把 .wasm 转成 WAT。 |
| `wasm_decompile` | 用 wasm-decompile 把 .wasm 转成类 C 伪代码。 |
| `wasm_inspect_sections` | 用 wasm-objdump 查看 .wasm 的节区和元数据。 |
| `wasm_offline_run` | 用 wasmtime 或 wasmer 离线运行 .wasm 导出函数。 |
| `wasm_optimize` | 用 wasm-opt 优化 .wasm 文件。 |
| `wasm_vmp_trace` | 读取当前页面已捕获的 WASM 导入调用轨迹。 |
| `wasm_memory_inspect` | 检查当前页面导出的 WebAssembly.Memory。 |
| `wasm_to_c` | 将 .wasm 文件转换为 C 源码和头文件（wasm2c/WABT）。 |
| `wasm_detect_obfuscation` | 检测 .wasm 文件中的混淆模式（控制流平坦、死代码、不透明谓词、常量编码）。 |
| `wasm_instrument_trace` | 为 .wasm 模块生成 JS 插桩包装，追踪调用、内存和控制流。 |
| `wasm_string_extract` | 从 .wasm 二进制中提取可打印字符串，按 section 分组，支持 name section 函数名恢复与分类（url/base64/hex-hash/file-path）。是通用二进制字符串工具的 wasm 专用替代。 |
| `wasm_diff` | 对两个 .wasm 二进制（原版 vs 补丁版）做 patch-diff 用于漏洞研究：通过 wasm2wat 反汇编两者，输出结构化的函数级差异（新增/删除/变更）+ 每函数 WAT 行级 unified diff。完整 diff 写入工件，响应携带摘要与预览。 |
| `wasm_instrument_binary` | 真正的 wasm 级二进制插桩：通过 wasm2wat 反汇编，在每个函数入口插入对导入 trace 函数的调用，再通过 wat2wasm 重新汇编。与 wasm_instrument_trace（仅代理 JS 可见导出）不同，它重写 code section 使每个函数入口可观测。诚实边界：函数入口级追踪，非基本块——宿主需在实例化时提供 trace_fn 导入。 |
| `wasm_instrument_block` | 真正的 wasm 级 basic-block 插桩：通过 wasm2wat 反汇编，在每个 block/loop/if 体入口（及函数入口）插入对导入 trace 函数的调用，再用 wat2wasm 重组。与 wasm_instrument_binary（仅函数入口）和 wasm_instrument_trace（仅 JS 代理）不同，本工具观测结构化控制流入口——分支目标（br/br_if/br_table）均被覆盖，因为 Wasm 将其解析为 block/loop/if 标签。宿主须在实例化时提供 trace_block 导入。 |
| `wasm_inspect` | 纯 TS wasm 二进制结构检查器（无 wabt 依赖）。直接从二进制解析模块结构面——类型、导入、函数（含 name section 恢复）、表、内存、全局、导出、start、元素/数据/code 段计数、以及自定义 section（name/producers/target_features）——输出结构化 JSON。作为 wabt 不可用时的独立结构路径，与 wasm_inspect_sections（依赖 wasm-objdump）互为补充（参见 wasm_capabilities）。诚实边界：仅结构信息，不做 code body 反汇编；元素/数据/global-init 有效载荷仅报告计数。 |
