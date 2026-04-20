import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const DEBUGGER_CORE_TOOLS: Tool[] = [
  tool('debugger_lifecycle', (t) =>
    t
      .desc('Manage the debugger lifecycle (enable or disable)')
      .enum('action', ['enable', 'disable'], 'Action to perform')
      .required('action')
      .idempotent(),
  ),
  tool('debugger_pause', (t) => t.desc('Pause execution at the next statement')),
  tool('debugger_resume', (t) => t.desc('Resume execution (continue)')),
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
        `Manage breakpoints: code (line/script), XHR (URL pattern), event listener, event category, and exception breakpoints.

Actions:
- set: Create a breakpoint. Type determines required params.
- remove: Remove a breakpoint by ID.
- list: List active breakpoints of the given type.

Types & params:
- code: lineNumber (required), scriptId?, columnNumber?, condition?
- xhr: urlPattern (required for set)
- event: eventName (required for set), targetName?
- event_category: category (required for set)
- exception: state (required for set)`,
      )
      .enum('action', ['set', 'remove', 'list'], 'Breakpoint operation')
      .enum(
        'type',
        ['code', 'xhr', 'event', 'event_category', 'exception'],
        'Breakpoint type (default: code)',
        { default: 'code' },
      )
      .string('scriptId', 'Script ID (type=code)')
      .number('lineNumber', 'Line number 0-based (type=code, action=set)')
      .number('columnNumber', 'Column number 0-based (type=code)')
      .string('condition', 'Conditional expression (type=code)')
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
  tool('get_call_stack', (t) =>
    t.desc('Get the current call stack (only available when paused at a breakpoint)').query(),
  ),
  tool('debugger_evaluate', (t) =>
    t
      .desc(
        'Evaluate a JavaScript expression. context="frame" evaluates in the current call frame (requires paused state); context="global" evaluates in the global context (no pause required).',
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
      .desc('Wait for the debugger to pause (useful after setting breakpoints and triggering code)')
      .number('timeout', 'Timeout in milliseconds (default: 30000)', { default: 30000 })
      .query(),
  ),
  tool('debugger_get_paused_state', (t) =>
    t.desc('Get the current paused state (check if debugger is paused and why)').query(),
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
      .desc(`Enhanced scope variable inspection with deep object traversal.`)
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
  tool('debugger_session', (t) =>
    t
      .desc(
        'Manage debugger sessions. Actions: save (persist current session to file), load (restore session from file/JSON), export (export session as JSON string), list (list saved sessions in ./debugger-sessions/).',
      )
      .enum('action', ['save', 'load', 'export', 'list'], 'Session operation')
      .string('filePath', 'File path for save/load actions')
      .string('sessionData', 'Session JSON string for load action (alternative to filePath)')
      .object('metadata', {}, 'Optional metadata for save/export actions')
      .required('action'),
  ),
];
