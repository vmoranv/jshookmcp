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

- `antidebug_bypass_all` — Inject all anti-anti-debug bypass scripts into the current page. Uses evaluateOnNewDocument + evaluate dual injection.
- `antidebug_bypass_debugger_statement` — Bypass debugger-statement based protection by patching Function constructor and monitoring dynamic script insertion.
- `antidebug_bypass_timing` — Bypass timing-based anti-debug checks by stabilizing performance.now / Date.now and console.time APIs.
- `antidebug_bypass_stack_trace` — Bypass Error.stack based anti-debug checks by filtering suspicious stack frames and hardening function toString.
- `antidebug_bypass_console_detect` — Bypass console-based devtools detection by wrapping console methods and sanitizing getter-based payloads.
- `antidebug_detect_protections` — Detect anti-debug protections in the current page and return detected techniques with bypass recommendations.

## 工具清单（6）

| 工具                                  | 说明                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `antidebug_bypass_all`                | Inject all anti-anti-debug bypass scripts into the current page. Uses evaluateOnNewDocument + evaluate dual injection. |
| `antidebug_bypass_debugger_statement` | Bypass debugger-statement based protection by patching Function constructor and monitoring dynamic script insertion.   |
| `antidebug_bypass_timing`             | Bypass timing-based anti-debug checks by stabilizing performance.now / Date.now and console.time APIs.                 |
| `antidebug_bypass_stack_trace`        | Bypass Error.stack based anti-debug checks by filtering suspicious stack frames and hardening function toString.       |
| `antidebug_bypass_console_detect`     | Bypass console-based devtools detection by wrapping console methods and sanitizing getter-based payloads.              |
| `antidebug_detect_protections`        | Detect anti-debug protections in the current page and return detected techniques with bypass recommendations.          |
