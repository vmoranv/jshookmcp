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

- `antidebug_bypass` — Bypass one or more anti-debug protection types. Specify types to apply; omit or use ["all"] to apply all bypasses. Types: all, debugger_statement, timing, stack_trace, console_detect.
- `antidebug_detect_protections` — Detect anti-debug protections in current page with bypass recommendations

## Full tool list (2)

| Tool | Description |
| --- | --- |
| `antidebug_bypass` | Bypass one or more anti-debug protection types. Specify types to apply; omit or use ["all"] to apply all bypasses. Types: all, debugger_statement, timing, stack_trace, console_detect. |
| `antidebug_detect_protections` | Detect anti-debug protections in current page with bypass recommendations |
