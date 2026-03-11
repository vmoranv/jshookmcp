# WASM

Domain: `wasm`

WebAssembly dump, disassembly, decompilation, optimization, and offline execution domain.

## Profiles

- full

## Typical scenarios

- Dump WASM modules
- Recover WAT or pseudo-C
- Run exported functions offline

## Common combinations

- browser + wasm
- core + wasm

## Representative tools

- `wasm_dump` — Dump a WebAssembly module from the current browser page.
- `wasm_disassemble` — Disassemble a .wasm file to WebAssembly Text Format (WAT) using wasm2wat.
- `wasm_decompile` — Decompile a .wasm file to C-like pseudo-code using wasm-decompile.
- `wasm_inspect_sections` — Inspect sections and metadata of a .wasm file using wasm-objdump.
- `wasm_offline_run` — Execute a specific exported function from a .wasm file offline using wasmtime or wasmer.
- `wasm_optimize` — Optimize a .wasm file using binaryen wasm-opt.
- `wasm_vmp_trace` — Trace WASM VMP (Virtual Machine Protection) opcode execution.
- `wasm_memory_inspect` — Inspect WebAssembly.Memory contents from the browser.

## Full tool list (8)

| Tool | Description |
| --- | --- |
| `wasm_dump` | Dump a WebAssembly module from the current browser page. |
| `wasm_disassemble` | Disassemble a .wasm file to WebAssembly Text Format (WAT) using wasm2wat. |
| `wasm_decompile` | Decompile a .wasm file to C-like pseudo-code using wasm-decompile. |
| `wasm_inspect_sections` | Inspect sections and metadata of a .wasm file using wasm-objdump. |
| `wasm_offline_run` | Execute a specific exported function from a .wasm file offline using wasmtime or wasmer. |
| `wasm_optimize` | Optimize a .wasm file using binaryen wasm-opt. |
| `wasm_vmp_trace` | Trace WASM VMP (Virtual Machine Protection) opcode execution. |
| `wasm_memory_inspect` | Inspect WebAssembly.Memory contents from the browser. |
