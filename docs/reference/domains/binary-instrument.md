# Binary Instrument

域名：`binary-instrument`

二进制插桩域，提供二进制分析和运行时插桩能力。

## Profile

- workflow
- full

## 典型场景

- 二进制分析
- 运行时插桩
- 内存模式检测

## 常见组合

- binary-instrument + memory
- binary-instrument + process

## 代表工具

- `frida_attach` — 待补充中文：Attach Frida to a local process, PID, or binary path and create a binary instrumentation session.
- `frida_enumerate_modules` — 待补充中文：Enumerate modules for an attached Frida session.
- `ghidra_analyze` — 待补充中文：Run binary metadata analysis with Ghidra headless when available, with structured fallback output when unavailable.
- `generate_hooks` — 待补充中文：Generate a Frida interceptor script for a list of symbols.
- `unidbg_emulate` — 待补充中文：Attempt to emulate a native function with unidbg, or return structured mock output when unavailable.
- `frida_run_script` — 待补充中文：Execute a Frida JavaScript snippet inside an attached Frida session.
- `frida_detach` — 待补充中文：Detach from a Frida session and clean up resources.
- `frida_list_sessions` — 待补充中文：List all active Frida sessions.
- `frida_generate_script` — 待补充中文：Generate a Frida interceptor script from templates (trace, intercept, replace, log).
- `get_available_plugins` — 待补充中文：List all available binary analysis plugins (frida, ghidra, ida, jadx).

## 工具清单（19）

| 工具 | 说明 |
| --- | --- |
| `frida_attach` | 待补充中文：Attach Frida to a local process, PID, or binary path and create a binary instrumentation session. |
| `frida_enumerate_modules` | 待补充中文：Enumerate modules for an attached Frida session. |
| `ghidra_analyze` | 待补充中文：Run binary metadata analysis with Ghidra headless when available, with structured fallback output when unavailable. |
| `generate_hooks` | 待补充中文：Generate a Frida interceptor script for a list of symbols. |
| `unidbg_emulate` | 待补充中文：Attempt to emulate a native function with unidbg, or return structured mock output when unavailable. |
| `frida_run_script` | 待补充中文：Execute a Frida JavaScript snippet inside an attached Frida session. |
| `frida_detach` | 待补充中文：Detach from a Frida session and clean up resources. |
| `frida_list_sessions` | 待补充中文：List all active Frida sessions. |
| `frida_generate_script` | 待补充中文：Generate a Frida interceptor script from templates (trace, intercept, replace, log). |
| `get_available_plugins` | 待补充中文：List all available binary analysis plugins (frida, ghidra, ida, jadx). |
| `ghidra_decompile` | 待补充中文：Decompile a specific function using Ghidra headless analysis. |
| `ida_decompile` | 待补充中文：Decompile a function using IDA Pro via plugin bridge. |
| `jadx_decompile` | 待补充中文：Decompile an APK class or method using JADX via plugin bridge. |
| `unidbg_launch` | 待补充中文：Launch an ARM/ARM64 .so library in the Unidbg emulator. First call ~3-5s warmup. |
| `unidbg_call` | 待补充中文：Call a JNI function in a running Unidbg emulator session. |
| `unidbg_trace` | 待补充中文：Get an execution trace from an Unidbg session (full/basic/instruction modes). |
| `export_hook_script` | 待补充中文：Export generated hook templates as a complete, runnable Frida script. |
| `frida_enumerate_functions` | 待补充中文：Enumerate exported functions for a specific module in a Frida session. |
| `frida_find_symbols` | 待补充中文：Search for symbols matching a pattern in a Frida session using ApiResolver. |
