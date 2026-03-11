# AntiDebug

域名：`antidebug`

反反调试域，集中提供检测与绕过浏览器端反调试脚本的工具。

## Profile

- full

## 典型场景

- 调试器绕过
- 计时检测缓解
- 控制台/devtools 探测对抗

## 常见组合

- browser + antidebug + debugger

## 代表工具

- `antidebug_bypass_all` — 向当前页面注入完整的反反调试绕过脚本。
- `antidebug_bypass_debugger_statement` — 绕过基于 debugger 语句的反调试保护。
- `antidebug_bypass_timing` — 绕过基于时间检测的反调试检查。
- `antidebug_bypass_stack_trace` — 绕过基于 Error.stack 的反调试检查。
- `antidebug_bypass_console_detect` — 绕过基于控制台检测的开发者工具识别。
- `antidebug_detect_protections` — 检测当前页面的反调试机制并给出绕过建议。

## 工具清单（6）

| 工具 | 说明 |
| --- | --- |
| `antidebug_bypass_all` | 向当前页面注入完整的反反调试绕过脚本。 |
| `antidebug_bypass_debugger_statement` | 绕过基于 debugger 语句的反调试保护。 |
| `antidebug_bypass_timing` | 绕过基于时间检测的反调试检查。 |
| `antidebug_bypass_stack_trace` | 绕过基于 Error.stack 的反调试检查。 |
| `antidebug_bypass_console_detect` | 绕过基于控制台检测的开发者工具识别。 |
| `antidebug_detect_protections` | 检测当前页面的反调试机制并给出绕过建议。 |
