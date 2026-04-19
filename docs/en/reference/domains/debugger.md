# Debugger

Domain: `debugger`

CDP-based debugging domain covering breakpoints, stepping, call stacks, watches, and debugger sessions.

## Profiles

- workflow
- full

## Typical scenarios

- Set and hit breakpoints
- Evaluate expressions in frames
- Save and restore debugger sessions

## Common combinations

- debugger + hooks
- debugger + antidebug

## Representative tools

- `debugger_enable` — Enable the debugger (must be called before setting breakpoints)
- `debugger_disable` — Disable the debugger and clear all breakpoints
- `debugger_pause` — Pause execution at the next statement
- `debugger_resume` — Resume execution (continue)
- `debugger_step` — Step execution: into (enter next call), over (skip next call), out (exit current function).
- `breakpoint` — Manage breakpoints: code (line/script), XHR (URL pattern), event listener, event category, and exception breakpoints.
- `get_call_stack` — Get the current call stack (only available when paused at a breakpoint)
- `debugger_evaluate` — Evaluate a JavaScript expression. context="frame" evaluates in the current call frame (requires paused state); context="global" evaluates in the global context (no pause required).
- `debugger_wait_for_paused` — Wait for the debugger to pause (useful after setting breakpoints and triggering code)
- `debugger_get_paused_state` — Get the current paused state (check if debugger is paused and why)

## Full tool list (17)

| Tool | Description |
| --- | --- |
| `debugger_enable` | Enable the debugger (must be called before setting breakpoints) |
| `debugger_disable` | Disable the debugger and clear all breakpoints |
| `debugger_pause` | Pause execution at the next statement |
| `debugger_resume` | Resume execution (continue) |
| `debugger_step` | Step execution: into (enter next call), over (skip next call), out (exit current function). |
| `breakpoint` | Manage breakpoints: code (line/script), XHR (URL pattern), event listener, event category, and exception breakpoints. |
| `get_call_stack` | Get the current call stack (only available when paused at a breakpoint) |
| `debugger_evaluate` | Evaluate a JavaScript expression. context="frame" evaluates in the current call frame (requires paused state); context="global" evaluates in the global context (no pause required). |
| `debugger_wait_for_paused` | Wait for the debugger to pause (useful after setting breakpoints and triggering code) |
| `debugger_get_paused_state` | Get the current paused state (check if debugger is paused and why) |
| `get_object_properties` | Get all properties of an object (when paused, use objectId from variables) |
| `get_scope_variables_enhanced` | Enhanced scope variable inspection with deep object traversal. |
| `debugger_session` | Manage debugger sessions. Actions: save (persist current session to file), load (restore session from file/JSON), export (export session as JSON string), list (list saved sessions in ./debugger-sessions/). |
| `watch` | Manage watch expressions for monitoring variable values during debugging. |
| `blackbox_add` | Blackbox scripts (skip during debugging) |
| `blackbox_add_common` | Blackbox all common libraries (one-click) |
| `blackbox_list` | List all blackboxed patterns |
