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
- `debugger_step_into` — Step into the next function call
- `debugger_step_over` — Step over the next function call
- `debugger_step_out` — Step out of the current function
- `breakpoint_set` — Set a breakpoint at a specific location. Supports URL-based and scriptId-based breakpoints with optional conditions.
- `breakpoint_remove` — Remove a breakpoint by its ID
- `breakpoint_list` — List all active breakpoints

## Full tool list (37)

| Tool | Description |
| --- | --- |
| `debugger_enable` | Enable the debugger (must be called before setting breakpoints) |
| `debugger_disable` | Disable the debugger and clear all breakpoints |
| `debugger_pause` | Pause execution at the next statement |
| `debugger_resume` | Resume execution (continue) |
| `debugger_step_into` | Step into the next function call |
| `debugger_step_over` | Step over the next function call |
| `debugger_step_out` | Step out of the current function |
| `breakpoint_set` | Set a breakpoint at a specific location. Supports URL-based and scriptId-based breakpoints with optional conditions. |
| `breakpoint_remove` | Remove a breakpoint by its ID |
| `breakpoint_list` | List all active breakpoints |
| `get_call_stack` | Get the current call stack (only available when paused at a breakpoint) |
| `debugger_evaluate` | Evaluate an expression in the context of the current call frame (only when paused) |
| `debugger_evaluate_global` | Evaluate an expression in the global context (does not require paused state) |
| `debugger_wait_for_paused` | Wait for the debugger to pause (useful after setting breakpoints and triggering code) |
| `debugger_get_paused_state` | Get the current paused state (check if debugger is paused and why) |
| `breakpoint_set_on_exception` | Pause on exceptions (all exceptions or only uncaught) |
| `get_object_properties` | Get all properties of an object (when paused, use objectId from variables) |
| `get_scope_variables_enhanced` | Enhanced scope variable inspection with deep object traversal. |
| `debugger_save_session` | Save the current debugging session to a JSON file for later restoration. |
| `debugger_load_session` | Load a previously saved debugging session to restore breakpoints and watches. |
| `debugger_export_session` | Export the current debugging session as a JSON string for sharing or backup. |
| `debugger_list_sessions` | List all saved debugging sessions in the ./debugger-sessions/ directory. |
| `watch_add` |  Add a watch expression to monitor variable values |
| `watch_remove` | Remove a watch expression by ID |
| `watch_list` | List all watch expressions |
| `watch_evaluate_all` | Evaluate all enabled watch expressions |
| `watch_clear_all` | Clear all watch expressions |
| `xhr_breakpoint_set` |  Set XHR/Fetch breakpoint (pause before network requests) |
| `xhr_breakpoint_remove` | Remove XHR breakpoint by ID |
| `xhr_breakpoint_list` | List all XHR breakpoints |
| `event_breakpoint_set` |  Set event listener breakpoint (pause on event) |
| `event_breakpoint_set_category` | Set breakpoints for entire event category |
| `event_breakpoint_remove` | Remove event breakpoint by ID |
| `event_breakpoint_list` | List all event breakpoints |
| `blackbox_add` |  Blackbox scripts (skip during debugging) |
| `blackbox_add_common` | Blackbox all common libraries (one-click) |
| `blackbox_list` | List all blackboxed patterns |
