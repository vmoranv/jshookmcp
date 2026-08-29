import type { Tool } from '@modelcontextprotocol/server';
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
      .desc('Inject an in-page script, XHR, fetch, or function monitor.')
      .enum('type', ['script', 'xhr', 'fetch', 'function'], 'Injection type')
      .string('functionName', 'Global function path to trace')
      .boolean('persistent', 'Keep the injection across page navigations', { default: false })
      .required('type')
      .openWorld(),
  ),
  tool('console_inject_fetch_interceptor', (t) =>
    t
      .desc('Inject a fetch interceptor.')
      .boolean('persistent', 'Keep the injection across page navigations', { default: false })
      .openWorld(),
  ),
  tool('console_inject_xhr_interceptor', (t) =>
    t
      .desc('Inject an XMLHttpRequest interceptor.')
      .boolean('persistent', 'Keep the injection across page navigations', { default: false })
      .openWorld(),
  ),
  tool('console_buffers', (t) =>
    t
      .desc('Manage injected interceptor state.')
      .enum('action', ['clear', 'reset'], 'Buffer action: clear buffers or reset interceptors')
      .required('action'),
  ),
];
