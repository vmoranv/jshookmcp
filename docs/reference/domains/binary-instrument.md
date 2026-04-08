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

- `frida_attach` — 附加 Frida 到本地进程、PID 或二进制路径，并创建二进制插桩会话。
- `frida_enumerate_modules` — 枚举已附加 Frida 会话中的模块。
- `ghidra_analyze` — 在 Ghidra headless 可用时运行二进制元数据分析，不可用时返回结构化降级输出。
- `generate_hooks` — 为一组符号生成 Frida interceptor 脚本。
- `unidbg_emulate` — 尝试用 unidbg 模拟原生函数，不可用时返回结构化模拟输出。
- `frida_run_script` — 在已附加的 Frida 会话中执行一段 JavaScript 代码。
- `frida_detach` — 从 Frida 会话分离并清理资源。
- `frida_list_sessions` — 列出所有活跃的 Frida 会话。
- `frida_generate_script` — 从模板（trace、intercept、replace、log）生成 Frida 拦截脚本。
- `get_available_plugins` — 列出所有可用的二进制分析插件（frida、ghidra、ida、jadx）。

## 工具清单（19）

| 工具 | 说明 |
| --- | --- |
| `frida_attach` | 附加 Frida 到本地进程、PID 或二进制路径，并创建二进制插桩会话。 |
| `frida_enumerate_modules` | 枚举已附加 Frida 会话中的模块。 |
| `ghidra_analyze` | 在 Ghidra headless 可用时运行二进制元数据分析，不可用时返回结构化降级输出。 |
| `generate_hooks` | 为一组符号生成 Frida interceptor 脚本。 |
| `unidbg_emulate` | 尝试用 unidbg 模拟原生函数，不可用时返回结构化模拟输出。 |
| `frida_run_script` | 在已附加的 Frida 会话中执行一段 JavaScript 代码。 |
| `frida_detach` | 从 Frida 会话分离并清理资源。 |
| `frida_list_sessions` | 列出所有活跃的 Frida 会话。 |
| `frida_generate_script` | 从模板（trace、intercept、replace、log）生成 Frida 拦截脚本。 |
| `get_available_plugins` | 列出所有可用的二进制分析插件（frida、ghidra、ida、jadx）。 |
| `ghidra_decompile` | 使用 Ghidra headless 分析反编译指定函数。 |
| `ida_decompile` | 通过插件桥接使用 IDA Pro 反编译指定函数。 |
| `jadx_decompile` | 通过插件桥接使用 JADX 反编译 APK 类或方法。 |
| `unidbg_launch` | 在 Unidbg 模拟器中启动 ARM/ARM64 .so 库，首次调用约 3-5 秒预热。 |
| `unidbg_call` | 在运行中的 Unidbg 模拟器会话中调用 JNI 函数。 |
| `unidbg_trace` | 获取 Unidbg 会话的执行追踪（full/basic/instruction 模式）。 |
| `export_hook_script` | 将生成的 hook 模板导出为完整可运行的 Frida 脚本。 |
| `frida_enumerate_functions` | 枚举 Frida 会话中指定模块的导出函数。 |
| `frida_find_symbols` | 使用 ApiResolver 在 Frida 会话中搜索匹配模式的符号。 |
