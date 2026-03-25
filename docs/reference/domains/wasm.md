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

## 代表工具

- `wasm_dump` — 从当前浏览器页面导出 WebAssembly 模块。
- `wasm_disassemble` — 使用 wasm2wat 将 .wasm 反汇编为 WAT 文本格式。
- `wasm_decompile` — 使用 wasm-decompile 将 .wasm 反编译为类 C 伪代码。
- `wasm_inspect_sections` — 使用 wasm-objdump 检查 .wasm 的节区和元数据。
- `wasm_offline_run` — 使用 wasmtime 或 wasmer 离线执行 .wasm 的指定导出函数。
- `wasm_optimize` — 使用 binaryen 的 wasm-opt 优化 .wasm 文件。
- `wasm_vmp_trace` — 跟踪 WASM 虚拟机保护指令的执行过程。
- `wasm_memory_inspect` — 检查浏览器中 WebAssembly.Memory 的内存内容。

## 工具清单（8）

| 工具 | 说明 |
| --- | --- |
| `wasm_dump` | 从当前浏览器页面导出 WebAssembly 模块。 |
| `wasm_disassemble` | 使用 wasm2wat 将 .wasm 反汇编为 WAT 文本格式。 |
| `wasm_decompile` | 使用 wasm-decompile 将 .wasm 反编译为类 C 伪代码。 |
| `wasm_inspect_sections` | 使用 wasm-objdump 检查 .wasm 的节区和元数据。 |
| `wasm_offline_run` | 使用 wasmtime 或 wasmer 离线执行 .wasm 的指定导出函数。 |
| `wasm_optimize` | 使用 binaryen 的 wasm-opt 优化 .wasm 文件。 |
| `wasm_vmp_trace` | 跟踪 WASM 虚拟机保护指令的执行过程。 |
| `wasm_memory_inspect` | 检查浏览器中 WebAssembly.Memory 的内存内容。 |
