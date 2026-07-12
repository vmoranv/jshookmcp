# Native Bridge

Domain: `native-bridge`

Native analysis bridge domain for local loopback HTTP bridges to Ghidra, IDA, Rizin/r2, and Binary Ninja, covering function listing, decompilation/disassembly, string search, xrefs, and symbol sync.

## Profiles

- full

## Typical scenarios

- Check local disassembler bridge health
- Open binaries and list functions, segments, and strings
- Decompile functions through Ghidra, IDA, or Binary Ninja
- Run analysis commands through Rizin/r2
- Synchronize native symbols across backends

## Common combinations

- native-bridge + binary-instrument
- native-bridge + process

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `native_bridge_status` | Check native bridge backend health. |
| `ghidra_bridge` | Send a command to a Ghidra headless analysis bridge. |
| `ida_bridge` | Send a command to an IDA Pro plugin bridge. |
| `rizin_bridge` | Send a command to a local Rizin/r2 analysis bridge. |
| `binary_ninja_bridge` | Send a command to a local Binary Ninja analysis bridge. |
| `native_symbol_sync` | Export native symbols to connected analysis backends. Supports json/csv/idc/sqlite output; an optional sinceHash requests an incremental export (only changed symbols) from backends that support it. |
