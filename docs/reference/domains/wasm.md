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

- `wasm_capabilities` — 查看当前页面 WASM 捕获和外部工具是否可用。
- `wasm_dump` — 从当前页面导出已捕获的 WASM 模块。
- `wasm_disassemble` — 用 wasm2wat 把 .wasm 转成 WAT。
- `wasm_decompile` — 用 wasm-decompile 把 .wasm 转成类 C 伪代码。
- `wasm_inspect_sections` — 用 wasm-objdump 查看 .wasm 的节区和元数据。
- `wasm_offline_run` — 用 wasmtime 或 wasmer 离线运行 .wasm 导出函数。
- `wasm_optimize` — 用 wasm-opt 优化 .wasm 文件。
- `wasm_vmp_trace` — 读取当前页面已捕获的 WASM 导入调用轨迹。
- `wasm_memory_inspect` — 检查当前页面导出的 WebAssembly.Memory。
- `wasm_to_c` — 将 .wasm 文件转换为 C 源码和头文件（wasm2c/WABT）。

## 工具清单（12）

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
