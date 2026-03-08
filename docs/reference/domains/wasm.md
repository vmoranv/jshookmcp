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

- `wasm_dump` — Dump a WebAssembly module from the current browser page.
- `wasm_disassemble` — Disassemble a .wasm file to WebAssembly Text Format (WAT) using wasm2wat.
- `wasm_decompile` — Decompile a .wasm file to C-like pseudo-code using wasm-decompile.
- `wasm_inspect_sections` — Inspect sections and metadata of a .wasm file using wasm-objdump.
- `wasm_offline_run` — Execute a specific exported function from a .wasm file offline using wasmtime or wasmer.
- `wasm_optimize` — Optimize a .wasm file using binaryen wasm-opt.
- `wasm_vmp_trace` — Trace WASM VMP (Virtual Machine Protection) opcode execution.
- `wasm_memory_inspect` — Inspect WebAssembly.Memory contents from the browser.

## 工具清单（8）

| 工具                    | 说明                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `wasm_dump`             | Dump a WebAssembly module from the current browser page.                                 |
| `wasm_disassemble`      | Disassemble a .wasm file to WebAssembly Text Format (WAT) using wasm2wat.                |
| `wasm_decompile`        | Decompile a .wasm file to C-like pseudo-code using wasm-decompile.                       |
| `wasm_inspect_sections` | Inspect sections and metadata of a .wasm file using wasm-objdump.                        |
| `wasm_offline_run`      | Execute a specific exported function from a .wasm file offline using wasmtime or wasmer. |
| `wasm_optimize`         | Optimize a .wasm file using binaryen wasm-opt.                                           |
| `wasm_vmp_trace`        | Trace WASM VMP (Virtual Machine Protection) opcode execution.                            |
| `wasm_memory_inspect`   | Inspect WebAssembly.Memory contents from the browser.                                    |
