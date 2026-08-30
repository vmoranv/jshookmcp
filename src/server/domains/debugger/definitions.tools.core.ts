import type { Tool } from '@modelcontextprotocol/server';
import { DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS } from '@src/constants/analysis';
import { tool } from '@server/registry/tool-builder';

export const DEBUGGER_CORE_TOOLS: Tool[] = [
  tool('debugger_lifecycle', (t) =>
    t
      .desc('Enable or disable the CDP debugger session.')
      .enum('action', ['enable', 'disable'], 'Action to perform')
      .required('action')
      .idempotent(),
  ),
  tool('debugger_pause', (t) => t.desc('Pause execution at the next statement.')),
  tool('debugger_resume', (t) => t.desc('Resume execution.')),
  tool('debugger_run_to_location', (t) =>
    t
      .desc(
        'Run execution until a source location by setting a temporary code breakpoint, resuming, waiting for pause, and removing the breakpoint.',
      )
      .string('url', 'Script URL (alternative to scriptId)')
      .string('scriptId', 'Script ID (alternative to url)')
      .number('lineNumber', 'Line number 0-based', { minimum: 0 })
      .number('columnNumber', 'Column number 0-based', { minimum: 0 })
      .string('condition', 'Optional conditional expression for the temporary breakpoint')
      .number(
        'timeout',
        `Timeout in milliseconds (default: ${DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS})`,
        {
          default: DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS,
          minimum: 1000,
          maximum: 120000,
        },
      )
      .required('lineNumber'),
  ),
  tool('debugger_step', (t) =>
    t
      .desc(
        'Step execution: into (enter next call), over (skip next call), out (exit current function).',
      )
      .enum('direction', ['into', 'over', 'out'], 'Step direction')
      .required('direction'),
  ),
  tool('breakpoint', (t) =>
    t
      .desc(
        `Manage breakpoints: code (line/script), function-name, XHR (URL pattern), event listener, event category, and exception breakpoints.

Actions:
- set: Create a breakpoint. Type determines required params.
- remove: Remove a breakpoint by ID.
- list: List active breakpoints of the given type.

Types & params:
- code: lineNumber (required), scriptId?, columnNumber?, condition?, logMessage? (logpoint: logs without pausing)
- function: functionName (required for set) — resolves via globalThis lookup and breaks whenever that function is called
- xhr: urlPattern (required for set)
- event: eventName (required for set), targetName?
- event_category: category (required for set)
- exception: state (required for set)`,
      )
      .enum('action', ['set', 'remove', 'list'], 'Breakpoint operation')
      .enum(
        'type',
        ['code', 'function', 'xhr', 'event', 'event_category', 'exception'],
        'Breakpoint type (default: code)',
        { default: 'code' },
      )
      .string('url', 'Script URL (type=code, alternative to scriptId)')
      .string('scriptId', 'Script ID (type=code)')
      .number('lineNumber', 'Line number 0-based (type=code, action=set)')
      .number('columnNumber', 'Column number 0-based (type=code)')
      .string('condition', 'Conditional expression (type=code)')
      .string(
        'logMessage',
        'Log message template for logpoints e.g. "x={x}" (type=code, logs without pausing)',
      )
      .string(
        'functionName',
        'Function name to break on (used with type=function). Resolved via globalThis lookup, breaks on every call to that function.',
      )
      .string('urlPattern', 'URL pattern with wildcards (type=xhr, action=set)')
      .string('eventName', 'Event name e.g. "click" (type=event, action=set)')
      .string('targetName', 'Target name e.g. "WebSocket" (type=event)')
      .enum(
        'category',
        ['mouse', 'keyboard', 'timer', 'websocket'],
        'Event category (type=event_category)',
      )
      .enum('state', ['none', 'uncaught', 'all'], 'Exception pause state (type=exception)')
      .string('breakpointId', 'Breakpoint ID (action=remove)')
      .required('action')
      .idempotent(),
  ),
  tool('get_call_stack', (t) => t.desc('Get the current call stack.').query()),
  tool('debugger_evaluate', (t) =>
    t
      .desc(
        'Evaluate a JavaScript expression. context="frame" evaluates in the current call frame (requires paused ' +
          'state); context="global" evaluates in the global context (no pause required).',
      )
      .enum('context', ['frame', 'global'], 'Evaluation context', { default: 'frame' })
      .string('expression', 'JavaScript expression to evaluate')
      .string(
        'callFrameId',
        'Call frame ID (for context=frame; from get_call_stack, defaults to current frame)',
      )
      .requiredOpenWorld('expression'),
  ),
  tool('debugger_wait_for_paused', (t) =>
    t
      .desc('Wait for debugger pause after setting breakpoints.')
      .number(
        'timeout',
        `Timeout in milliseconds (default: ${DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS})`,
        {
          default: DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS,
          minimum: 1000,
          maximum: 120000,
        },
      )
      .query(),
  ),
  tool('debugger_capture_hit', (t) =>
    t
      .desc(
        'Wait for the next debugger pause and capture call stack plus optional top-frame scope variables.',
      )
      .number(
        'timeout',
        `Timeout in milliseconds (default: ${DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS})`,
        {
          default: DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS,
          minimum: 1000,
          maximum: 120000,
        },
      )
      .boolean('includeScope', 'Include top-frame scope variables in the capture.', {
        default: true,
      })
      .boolean('includeObjectProperties', 'Expand object properties in captured scope variables.', {
        default: false,
      })
      .number('maxDepth', 'Maximum object traversal depth for captured scope variables.', {
        default: 1,
        minimum: 1,
        maximum: 10,
      })
      .boolean('skipErrors', 'Skip scope properties that throw during access.', {
        default: true,
      })
      .query(),
  ),
  tool('debugger_get_paused_state', (t) => t.desc('Get current paused state and reason.').query()),
  tool('debugger_disassemble', (t) =>
    t
      .desc(
        'Disassemble V8 bytecode / instructions at the current paused location (or a given scriptId). ' +
          'Resolves the target scriptId automatically from the current paused call frame — useful when paused ' +
          'inside obfuscated/VM code to decide whether to step in. Native bytecode requires V8 natives syntax; ' +
          'set includeSourceFallback to derive a pseudo-bytecode from source when native extraction is unavailable.',
      )
      .string('scriptId', 'Script ID (defaults to the current paused top frame)')
      .string('callFrameId', 'Call frame ID (defaults to the current paused top frame)')
      .number('functionOffset', 'Function offset within the script')
      .boolean(
        'includeSourceFallback',
        'Derive pseudo-bytecode from source when native extraction unavailable',
        {
          default: false,
        },
      )
      .query(),
  ),
  tool('get_object_properties', (t) =>
    t
      .desc('Get properties of an object by objectId.')
      .string('objectId', 'Object ID (from get_scope_variables)')
      .required('objectId')
      .query(),
  ),
  tool('get_scope_variables_enhanced', (t) =>
    t
      .desc(`Enhanced scope variable inspection with deep object traversal.`)
      .string('callFrameId', 'Call frame ID (from get_call_stack, defaults to current frame)')
      .boolean('includeObjectProperties', 'Expand object properties recursively (default: false)', {
        default: false,
      })
      .number('maxDepth', 'Maximum traversal depth for nested objects (default: 1)', {
        default: 1,
        minimum: 1,
        maximum: 10,
      })
      .boolean('skipErrors', 'Skip properties that throw errors during access (default: true)', {
        default: true,
      })
      .query(),
  ),
  tool('debugger_session', (t) =>
    t
      .desc(
        'Manage debugger sessions. Actions: save (persist current session to file), load (restore session from ' +
          'file/JSON), export (export session as JSON string), list (list saved sessions in ./debugger-sessions/).',
      )
      .enum('action', ['save', 'load', 'export', 'list'], 'Session operation')
      .string('filePath', 'File path for save/load actions')
      .string('sessionData', 'Session JSON string for load action (alternative to filePath)')
      .object('metadata', {}, 'Optional metadata for save/export actions')
      .required('action'),
  ),
];
