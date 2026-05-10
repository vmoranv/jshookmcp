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

## Full tool list (12)

| Tool | Description |
| --- | --- |
| `wasm_capabilities` | Report WASM tool availability. |
| `wasm_dump` | Dump a captured WebAssembly module from the current page. |
| `wasm_disassemble` | Disassemble a .wasm binary to WAT text format. |
| `wasm_decompile` | Decompile .wasm bytecode to readable pseudo-code with type info. |
| `wasm_inspect_sections` | Parse .wasm section headers: imports, exports, memory, tables, code. |
| `wasm_offline_run` | Run an exported .wasm function. |
| `wasm_optimize` | Optimize a .wasm binary for size or speed. |
| `wasm_vmp_trace` | Read captured WASM VMP import-call traces from the current page. |
| `wasm_memory_inspect` | Inspect exported WebAssembly.Memory from the current page. |
| `wasm_to_c` | Transpile .wasm bytecode to C source and header files. |
| `wasm_detect_obfuscation` | Detect WASM obfuscation: opaque predicates, control-flow flattening, bogus ops. |
| `wasm_instrument_trace` | Generate a JS instrumentation wrapper for a .wasm module. |
