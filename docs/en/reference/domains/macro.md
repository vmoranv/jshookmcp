# Macro

Domain: `macro`

Sub-agent macro orchestration domain that chains multiple tool calls into reusable macro workflows.

## Profiles

- full

## Typical scenarios

- Multi-step deobfuscation
- Automated analysis pipelines
- User-defined macros

## Common combinations

- macro + core + transform

## Representative tools

- `run_macro` — Execute a registered macro by ID with inline progress and atomic bailout
- `list_macros` — List all available macros (built-in + user-defined)

## Full tool list (2)

| Tool | Description |
| --- | --- |
| `run_macro` | Execute a registered macro by ID with inline progress and atomic bailout |
| `list_macros` | List all available macros (built-in + user-defined) |
