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

- `antidebug_bypass_all` — Inject all anti-anti-debug bypass scripts via dual injection
- `antidebug_bypass_debugger_statement` — Bypass debugger-statement protection by patching Function constructor
- `antidebug_bypass_timing` — Bypass timing-based anti-debug by stabilizing performance.now / Date.now
- `antidebug_bypass_stack_trace` — Bypass Error.stack anti-debug by filtering suspicious frames and hardening toString
- `antidebug_bypass_console_detect` — Bypass console-based devtools detection by wrapping console methods
- `antidebug_detect_protections` — Detect anti-debug protections in current page with bypass recommendations

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `antidebug_bypass_all` | Inject all anti-anti-debug bypass scripts via dual injection |
| `antidebug_bypass_debugger_statement` | Bypass debugger-statement protection by patching Function constructor |
| `antidebug_bypass_timing` | Bypass timing-based anti-debug by stabilizing performance.now / Date.now |
| `antidebug_bypass_stack_trace` | Bypass Error.stack anti-debug by filtering suspicious frames and hardening toString |
| `antidebug_bypass_console_detect` | Bypass console-based devtools detection by wrapping console methods |
| `antidebug_detect_protections` | Detect anti-debug protections in current page with bypass recommendations |
