import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const consoleTools: Tool[] = [
  tool('console_get_exceptions', (t) =>
    t
      .desc('Get captured uncaught exceptions from the page')
      .string('url', 'Filter by URL substring')
      .number('limit', 'Maximum number of exceptions to return', {
        default: 50,
        minimum: 1,
        maximum: 1000,
      })
      .readOnly(),
  ),
  tool('console_inject', (t) =>
    t
      .desc(
        `Inject an in-page monitor/interceptor. Types:
- script: Track dynamically created script elements
- xhr: Capture AJAX request/response data
- fetch: Capture fetch() calls (useful when CDP misses wrapped fetch)
- function: Proxy-based tracer for a named global function (requires functionName)`,
      )
      .enum('type', ['script', 'xhr', 'fetch', 'function'], 'Injection type')
      .string(
        'functionName',
        'Global function path to trace (type=function, e.g. "window.someFunction")',
      )
      .boolean(
        'persistent',
        'Survive page navigations via evaluateOnNewDocument (default: false)',
        { default: false },
      )
      .required('type')
      .openWorld(),
  ),
  tool('console_inject_fetch_interceptor', (t) =>
    t
      .desc('Inject the fetch() interceptor directly')
      .boolean(
        'persistent',
        'Survive page navigations via evaluateOnNewDocument (default: false)',
        { default: false },
      )
      .openWorld(),
  ),
  tool('console_inject_xhr_interceptor', (t) =>
    t
      .desc('Inject the XMLHttpRequest interceptor directly')
      .boolean(
        'persistent',
        'Survive page navigations via evaluateOnNewDocument (default: false)',
        { default: false },
      )
      .openWorld(),
  ),
  tool('console_buffers', (t) =>
    t
      .desc('Manage injected interceptor state.')
      .enum('action', ['clear', 'reset'], 'Buffer action: clear buffers or reset interceptors')
      .required('action'),
  ),
];
