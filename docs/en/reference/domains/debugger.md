# Debugger

Domain: `debugger`

CDP-based debugging domain covering breakpoints, stepping, call stacks, watches, debugger sessions, and anti-anti-debug.

## Profiles

- workflow
- full

## Typical scenarios

- Set and hit breakpoints
- Evaluate expressions in frames
- Save and restore debugger sessions
- Bypass anti-debugging protections

## Common combinations

- debugger + browser
- debugger + instrumentation

## Full tool list (21)

| Tool | Description |
| --- | --- |
| `debugger_lifecycle` | Enable or disable the CDP debugger session. |
| `debugger_pause` | Pause execution at the next statement. |
| `debugger_resume` | Resume execution. |
| `debugger_run_to_location` | Run execution until a source location by setting a temporary code breakpoint, resuming, waiting for pause, and removing the breakpoint. |
| `debugger_step` | Step execution: into (enter next call), over (skip next call), out (exit current function). |
| `breakpoint` | Manage breakpoints: code (line/script), function-name, XHR (URL pattern), event listener, event category, and exception breakpoints. |
| `get_call_stack` | Get the current call stack. |
| `debugger_disassemble` | Disassemble V8 bytecode / instructions at the current paused location (or a given scriptId). Resolves the target scriptId automatically from the current paused call frame — useful when paused inside obfuscated/VM code to decide whether to step in. Native bytecode requires V8 natives syntax; set includeSourceFallback to derive a pseudo-bytecode from source when native extraction is unavailable. |
| `debugger_evaluate` | Evaluate a JavaScript expression. context="frame" evaluates in the current call frame (requires paused state); context="global" evaluates in the global context (no pause required). |
| `debugger_wait_for_paused` | Wait for debugger pause after setting breakpoints. |
| `debugger_capture_hit` | Wait for the next debugger pause and capture call stack plus optional top-frame scope variables. |
| `debugger_get_paused_state` | Get current paused state and reason. |
| `get_object_properties` | Get properties of an object by objectId. |
| `get_scope_variables_enhanced` | Enhanced scope variable inspection with deep object traversal. |
| `debugger_session` | Manage debugger sessions. Actions: save (persist current session to file), load (restore session from file/JSON), export (export session as JSON string), list (list saved sessions in ./debugger-sessions/). |
| `watch` | Manage watch expressions for monitoring variable values during debugging. |
| `blackbox_add` | Blackbox scripts (skip during debugging) |
| `blackbox_add_common` | Blackbox all common libraries (one-click) |
| `blackbox_list` | List script blackbox patterns. |
| `antidebug_bypass` | Bypass one or more anti-debug protection types. Specify types to apply; omit or use ["all"] to apply all bypasses. Types: all, debugger_statement, timing, stack_trace, console_detect. |
| `antidebug_detect_protections` | Detect anti-debug protections in current page with bypass recommendations. |
