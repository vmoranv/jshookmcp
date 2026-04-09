import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const DEBUGGER_ADVANCED_TOOLS: Tool[] = [
  tool('watch_add', (t) =>
    t
      .desc(` Add a watch expression to monitor variable values

Usage:
- Monitor key variables during debugging
- Automatically evaluate on each pause
- Track value changes over time

Example:
watch_add(expression="window.byted_acrawler", name="acrawler")`)
      .string('expression', 'JavaScript expression to watch (e.g., "window.obj", "arguments[0]")')
      .string('name', 'Optional friendly name for the watch expression')
      .required('expression'),
  ),
  tool('watch_remove', (t) =>
    t
      .desc('Remove a watch expression by ID')
      .string('watchId', 'Watch expression ID (from watch_add or watch_list)')
      .required('watchId')
      .idempotent(),
  ),
  tool('watch_list', (t) => t.desc('List all watch expressions').query()),
  tool('watch_evaluate_all', (t) =>
    t
      .desc(`Evaluate all enabled watch expressions

Returns:
- Current values of all watch expressions
- Value change indicators
- Error information if evaluation fails

Best used when paused at a breakpoint.`)
      .string('callFrameId', 'Optional call frame ID (from get_call_stack)')
      .query(),
  ),
  tool('watch_clear_all', (t) => t.desc('Clear all watch expressions').destructive()),
  tool('xhr_breakpoint_set', (t) =>
    t
      .desc(` Set XHR/Fetch breakpoint (pause before network requests)

Usage:
- Intercept API calls
- Debug request parameter generation
- Trace network request logic

Supports wildcard patterns:
- "*api*" - matches any URL containing "api"
- "*/aweme/v1/*" - matches specific API path
- "*" - matches all requests

Example:
xhr_breakpoint_set(urlPattern="*aweme/v1/*")`)
      .string('urlPattern', 'URL pattern (supports wildcards *)')
      .required('urlPattern')
      .idempotent(),
  ),
  tool('xhr_breakpoint_remove', (t) =>
    t
      .desc('Remove XHR breakpoint by ID')
      .string('breakpointId', 'XHR breakpoint ID')
      .required('breakpointId')
      .idempotent(),
  ),
  tool('xhr_breakpoint_list', (t) => t.desc('List all XHR breakpoints').query()),
  tool('event_breakpoint_set', (t) =>
    t
      .desc(` Set event listener breakpoint (pause on event)

Common event names:
- Mouse: click, dblclick, mousedown, mouseup, mousemove
- Keyboard: keydown, keyup, keypress
- Timer: setTimeout, setInterval, requestAnimationFrame
- WebSocket: message, open, close, error

Example:
event_breakpoint_set(eventName="click")
event_breakpoint_set(eventName="setTimeout")`)
      .string('eventName', 'Event name (e.g., "click", "setTimeout")')
      .string('targetName', 'Optional target name (e.g., "WebSocket")')
      .required('eventName')
      .idempotent(),
  ),
  tool('event_breakpoint_set_category', (t) =>
    t
      .desc(`Set breakpoints for entire event category

Categories:
- mouse: All mouse events (click, mousedown, etc.)
- keyboard: All keyboard events (keydown, keyup, etc.)
- timer: All timer events (setTimeout, setInterval, etc.)
- websocket: All WebSocket events (message, open, etc.)

Example:
event_breakpoint_set_category(category="mouse")`)
      .enum('category', ['mouse', 'keyboard', 'timer', 'websocket'], 'Event category')
      .required('category')
      .idempotent(),
  ),
  tool('event_breakpoint_remove', (t) =>
    t
      .desc('Remove event breakpoint by ID')
      .string('breakpointId', 'Event breakpoint ID')
      .required('breakpointId')
      .idempotent(),
  ),
  tool('event_breakpoint_list', (t) => t.desc('List all event breakpoints').query()),
  tool('blackbox_add', (t) =>
    t
      .desc(` Blackbox scripts (skip during debugging)

Usage:
- Skip third-party library code
- Focus on business logic
- Improve debugging efficiency

Common patterns:
- "*jquery*.js" - jQuery
- "*react*.js" - React
- "*node_modules/*" - All npm packages
- "*webpack*" - Webpack bundles

Example:
blackbox_add(urlPattern="*node_modules/*")`)
      .string('urlPattern', 'URL pattern to blackbox (supports wildcards *)')
      .required('urlPattern')
      .idempotent(),
  ),
  tool('blackbox_add_common', (t) =>
    t
      .desc(`Blackbox all common libraries (one-click)

Includes:
- jquery, react, vue, angular
- lodash, underscore, moment
- webpack, node_modules, vendor bundles

Example:
blackbox_add_common()`)
      .idempotent(),
  ),
  tool('blackbox_list', (t) => t.desc('List all blackboxed patterns').query()),
];
