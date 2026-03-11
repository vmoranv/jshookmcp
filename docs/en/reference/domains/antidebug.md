# AntiDebug

Domain: `antidebug`

Anti-anti-debug domain focused on detecting and bypassing browser-side anti-debugging protections.

## Profiles

- full

## Typical scenarios

- Bypass debugger traps
- Mitigate timing checks
- Counter console/devtools detection

## Common combinations

- browser + antidebug + debugger

## Representative tools

- `antidebug_bypass_all` — Inject all anti-anti-debug bypass scripts into the current page. Uses evaluateOnNewDocument + evaluate dual injection.
- `antidebug_bypass_debugger_statement` — Bypass debugger-statement based protection by patching Function constructor and monitoring dynamic script insertion.
- `antidebug_bypass_timing` — Bypass timing-based anti-debug checks by stabilizing performance.now / Date.now and console.time APIs.
- `antidebug_bypass_stack_trace` — Bypass Error.stack based anti-debug checks by filtering suspicious stack frames and hardening function toString.
- `antidebug_bypass_console_detect` — Bypass console-based devtools detection by wrapping console methods and sanitizing getter-based payloads.
- `antidebug_detect_protections` — Detect anti-debug protections in the current page and return detected techniques with bypass recommendations.

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `antidebug_bypass_all` | Inject all anti-anti-debug bypass scripts into the current page. Uses evaluateOnNewDocument + evaluate dual injection. |
| `antidebug_bypass_debugger_statement` | Bypass debugger-statement based protection by patching Function constructor and monitoring dynamic script insertion. |
| `antidebug_bypass_timing` | Bypass timing-based anti-debug checks by stabilizing performance.now / Date.now and console.time APIs. |
| `antidebug_bypass_stack_trace` | Bypass Error.stack based anti-debug checks by filtering suspicious stack frames and hardening function toString. |
| `antidebug_bypass_console_detect` | Bypass console-based devtools detection by wrapping console methods and sanitizing getter-based payloads. |
| `antidebug_detect_protections` | Detect anti-debug protections in the current page and return detected techniques with bypass recommendations. |
