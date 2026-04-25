# Binary Instrument

Domain: `binary-instrument`

Binary instrumentation domain providing binary analysis and runtime instrumentation capabilities.

## Profiles

- full

## Typical scenarios

- Binary analysis
- Runtime instrumentation
- Memory pattern detection

## Common combinations

- binary-instrument + memory
- binary-instrument + process

## Representative tools

- `binary_instrument_capabilities` — Report binary instrumentation backend availability.
- `frida_attach` — Attach Frida to a local target and open a session.
- `frida_enumerate_modules` — Enumerate modules for an attached Frida session.
- `ghidra_analyze` — Analyze a binary and return metadata.
- `generate_hooks` — Generate a Frida interceptor script for a list of symbols.
- `unidbg_emulate` — Emulate a native function with Unidbg when available.
- `frida_run_script` — Execute a Frida JavaScript snippet inside an attached Frida session.
- `frida_detach` — Detach from a Frida session and clean up resources.
- `frida_list_sessions` — List all active Frida sessions.
- `frida_generate_script` — Generate a Frida hook script from a template.

## Full tool list (20)

| Tool | Description |
| --- | --- |
| `binary_instrument_capabilities` | Report binary instrumentation backend availability. |
| `frida_attach` | Attach Frida to a local target and open a session. |
| `frida_enumerate_modules` | Enumerate modules for an attached Frida session. |
| `ghidra_analyze` | Analyze a binary and return metadata. |
| `generate_hooks` | Generate a Frida interceptor script for a list of symbols. |
| `unidbg_emulate` | Emulate a native function with Unidbg when available. |
| `frida_run_script` | Execute a Frida JavaScript snippet inside an attached Frida session. |
| `frida_detach` | Detach from a Frida session and clean up resources. |
| `frida_list_sessions` | List all active Frida sessions. |
| `frida_generate_script` | Generate a Frida hook script from a template. |
| `get_available_plugins` | List installed binary analysis plugins. |
| `ghidra_decompile` | Decompile a specific function using Ghidra headless analysis. |
| `ida_decompile` | Decompile a function using IDA Pro via plugin bridge. |
| `jadx_decompile` | Decompile an APK class or method using JADX via plugin bridge. |
| `unidbg_launch` | Launch a shared library in Unidbg. |
| `unidbg_call` | Call a JNI function in a running Unidbg emulator session. |
| `unidbg_trace` | Get an execution trace from an Unidbg session (full/basic/instruction modes). |
| `export_hook_script` | Export generated hook templates as a complete, runnable Frida script. |
| `frida_enumerate_functions` | Enumerate exported functions for a specific module in a Frida session. |
| `frida_find_symbols` | Search for symbols matching a pattern in a Frida session using ApiResolver. |
