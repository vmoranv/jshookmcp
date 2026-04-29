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

- `wasm_capabilities` — Report WASM capture and tool availability.
- `wasm_dump` — Dump a captured WebAssembly module from the current page.
- `wasm_disassemble` — Disassemble a .wasm file to WAT with wasm2wat.
- `wasm_decompile` — Decompile a .wasm file to C-like pseudo-code with wasm-decompile.
- `wasm_inspect_sections` — Inspect sections and metadata of a .wasm file with wasm-objdump.
- `wasm_offline_run` — Run an exported .wasm function with wasmtime or wasmer.
- `wasm_optimize` — Optimize a .wasm file with wasm-opt.
- `wasm_vmp_trace` — Read captured WASM VMP import-call traces from the current page.
- `wasm_memory_inspect` — Inspect exported WebAssembly.Memory from the current page.
- `wasm_to_c` — Convert a .wasm file to C source and header with wasm2c (WABT).

## Full tool list (12)

| Tool | Description |
| --- | --- |
| `wasm_capabilities` | Report WASM capture and tool availability. |
| `wasm_dump` | Dump a captured WebAssembly module from the current page. |
| `wasm_disassemble` | Disassemble a .wasm file to WAT with wasm2wat. |
| `wasm_decompile` | Decompile a .wasm file to C-like pseudo-code with wasm-decompile. |
| `wasm_inspect_sections` | Inspect sections and metadata of a .wasm file with wasm-objdump. |
| `wasm_offline_run` | Run an exported .wasm function with wasmtime or wasmer. |
| `wasm_optimize` | Optimize a .wasm file with wasm-opt. |
| `wasm_vmp_trace` | Read captured WASM VMP import-call traces from the current page. |
| `wasm_memory_inspect` | Inspect exported WebAssembly.Memory from the current page. |
| `wasm_to_c` | Convert a .wasm file to C source and header with wasm2c (WABT). |
| `wasm_detect_obfuscation` | Detect obfuscation patterns in a .wasm file (CFG flattening, dead code, opaque predicates, constant encoding). |
| `wasm_instrument_trace` | Generate JS instrumentation wrapper for a .wasm module to trace calls, memory, and control flow. |
