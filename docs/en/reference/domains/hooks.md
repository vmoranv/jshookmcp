# Hooks

Domain: `hooks`

AI hook generation, injection, export, and built-in/custom preset management.

## Profiles

- full

## Typical scenarios

- Capture function calls
- Persist runtime evidence
- Install team-specific inline presets

## Common combinations

- browser + hooks + debugger

## Representative tools

- `ai_hook` — Manage AI hooks. Actions: inject (inject code into page), get_data (retrieve captured hook data), list (all active hooks), clear (remove hook data by id or all), toggle (enable/disable a hook), export (export data as JSON/CSV).
- `hook_preset` — Install a pre-built JavaScript hook from 20+ built-in presets (eval, atob/btoa, Proxy, Reflect, Object.defineProperty, etc.), or provide customTemplate/customTemplates to install your own reusable hook bodies. Use listPresets=true to see all available preset descriptions.

## Full tool list (2)

| Tool | Description |
| --- | --- |
| `ai_hook` | Manage AI hooks. Actions: inject (inject code into page), get_data (retrieve captured hook data), list (all active hooks), clear (remove hook data by id or all), toggle (enable/disable a hook), export (export data as JSON/CSV). |
| `hook_preset` | Install a pre-built JavaScript hook from 20+ built-in presets (eval, atob/btoa, Proxy, Reflect, Object.defineProperty, etc.), or provide customTemplate/customTemplates to install your own reusable hook bodies. Use listPresets=true to see all available preset descriptions. |
