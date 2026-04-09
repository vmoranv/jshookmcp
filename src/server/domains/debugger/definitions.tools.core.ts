import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const DEBUGGER_CORE_TOOLS: Tool[] = [
  tool('debugger_enable', (t) =>
    t.desc('Enable the debugger (must be called before setting breakpoints)').idempotent(),
  ),
  tool('debugger_disable', (t) =>
    t.desc('Disable the debugger and clear all breakpoints').destructive(),
  ),
  tool('debugger_pause', (t) => t.desc('Pause execution at the next statement')),
  tool('debugger_resume', (t) => t.desc('Resume execution (continue)')),
  tool('debugger_step_into', (t) => t.desc('Step into the next function call')),
  tool('debugger_step_over', (t) => t.desc('Step over the next function call')),
  tool('debugger_step_out', (t) => t.desc('Step out of the current function')),
  tool('breakpoint_set', (t) =>
    t
      .desc(
        'Set a breakpoint at a specific location. Supports URL-based and scriptId-based breakpoints with optional conditions.',
      )
      .string('url', 'URL of the script (e.g., "app.js", "https://cdn.example.com/app.js")')
      .string('scriptId', 'Script ID (alternative to URL, get from get_all_scripts)')
      .number('lineNumber', 'Line number (0-based)')
      .number('columnNumber', 'Column number (0-based, optional)')
      .string('condition', 'Conditional breakpoint expression (e.g., "x > 100")')
      .required('lineNumber')
      .idempotent(),
  ),
  tool('breakpoint_remove', (t) =>
    t
      .desc('Remove a breakpoint by its ID')
      .string('breakpointId', 'Breakpoint ID (from breakpoint_set or breakpoint_list)')
      .required('breakpointId')
      .idempotent(),
  ),
  tool('breakpoint_list', (t) => t.desc('List all active breakpoints').query()),
  tool('get_call_stack', (t) =>
    t.desc('Get the current call stack (only available when paused at a breakpoint)').query(),
  ),
  tool('debugger_evaluate', (t) =>
    t
      .desc('Evaluate an expression in the context of the current call frame (only when paused)')
      .string('expression', 'JavaScript expression to evaluate (e.g., "x + y", "user.name")')
      .string('callFrameId', 'Call frame ID (from get_call_stack, defaults to current frame)')
      .requiredOpenWorld('expression'),
  ),
  tool('debugger_evaluate_global', (t) =>
    t
      .desc('Evaluate an expression in the global context (does not require paused state)')
      .string('expression', 'JavaScript expression to evaluate')
      .requiredOpenWorld('expression'),
  ),
  tool('debugger_wait_for_paused', (t) =>
    t
      .desc('Wait for the debugger to pause (useful after setting breakpoints and triggering code)')
      .number('timeout', 'Timeout in milliseconds (default: 30000)', { default: 30000 })
      .query(),
  ),
  tool('debugger_get_paused_state', (t) =>
    t.desc('Get the current paused state (check if debugger is paused and why)').query(),
  ),
  tool('breakpoint_set_on_exception', (t) =>
    t
      .desc('Pause on exceptions (all exceptions or only uncaught)')
      .enum('state', ['none', 'uncaught', 'all'], 'Exception pause state', { default: 'none' })
      .required('state')
      .idempotent(),
  ),
  tool('get_object_properties', (t) =>
    t
      .desc('Get all properties of an object (when paused, use objectId from variables)')
      .string('objectId', 'Object ID (from get_scope_variables)')
      .required('objectId')
      .query(),
  ),
  tool('get_scope_variables_enhanced', (t) =>
    t
      .desc(`Enhanced scope variable inspection with deep object traversal.

Improvements over get_scope_variables:
1. Graceful error handling for "Could not find object" errors (retries with fallback)
2. Configurable object property expansion
3. Adjustable traversal depth
4. Selective error skipping

Use cases:
- Inspect complex nested objects
- Debug variable state in async/closure scopes
- Examine prototype chains

Examples:
get_scope_variables_enhanced()
get_scope_variables_enhanced(callFrameId="xxx", includeObjectProperties=true)`)
      .string('callFrameId', 'Call frame ID (from get_call_stack, defaults to current frame)')
      .boolean('includeObjectProperties', 'Expand object properties recursively (default: false)', {
        default: false,
      })
      .number('maxDepth', 'Maximum traversal depth for nested objects (default: 1)', { default: 1 })
      .boolean('skipErrors', 'Skip properties that throw errors during access (default: true)', {
        default: true,
      })
      .query(),
  ),
  tool('debugger_save_session', (t) =>
    t
      .desc(`Save the current debugging session to a JSON file for later restoration.

Captures:
- All active breakpoints (location, condition, action)
- Watch expressions
- Blackboxed script patterns

Saved to:
- Default: ./debugger-sessions/<timestamp>.json
- Custom: specified filePath

Examples:
debugger_save_session()
debugger_save_session(filePath="my-debug-session.json", metadata={description: "Login flow debugging"})`)
      .string('filePath', 'Output file path (defaults to ./debugger-sessions/<timestamp>.json)')
      .object('metadata', {}, 'Optional metadata to attach (e.g., description, tags)')
      .idempotent(),
  ),
  tool('debugger_load_session', (t) =>
    t
      .desc(`Load a previously saved debugging session to restore breakpoints and watches.

Two input modes:
1. File path: provide filePath to load from disk
2. Inline JSON: provide sessionData as JSON string

Restores:
- Breakpoints with original conditions
- Watch expressions
- Blackboxed patterns

Examples:
debugger_load_session(filePath="my-debug-session.json")
debugger_load_session(sessionData="{...}")`)
      .string('filePath', 'Path to the saved session file')
      .string('sessionData', 'Session JSON string (alternative to filePath)')
      .idempotent(),
  ),
  tool('debugger_export_session', (t) =>
    t
      .desc(`Export the current debugging session as a JSON string for sharing or backup.

Returns session data as JSON, including:
- Active breakpoints
- Watch expressions
- Blackboxed patterns

Examples:
debugger_export_session()
debugger_export_session(metadata={description: "API debugging session"})`)
      .object('metadata', {}, 'Optional metadata to include in the export')
      .query(),
  ),
  tool('debugger_list_sessions', (t) =>
    t
      .desc(`List all saved debugging sessions in the ./debugger-sessions/ directory.

Returns for each session:
- File name and path
- Creation timestamp
- Attached metadata (if any)

Use cases:
- Browse available sessions to restore
- Clean up old sessions

Examples:
debugger_list_sessions()`)
      .query(),
  ),
];
