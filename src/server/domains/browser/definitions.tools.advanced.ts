import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const advancedBrowserToolDefinitions: Tool[] = [
  tool('js_heap_search', (t) =>
    t
      .desc('Search JS heap for strings matching a pattern.')
      .string('pattern', 'Pattern to search')
      .number('maxResults', 'Max matches', { default: 50 })
      .boolean('caseSensitive', 'Case sensitive', { default: false })
      .required('pattern')
      .query(),
  ),
  tool('tab_workflow', (t) =>
    t
      .desc('Cross-tab coordination.')
      .enum(
        'action',
        [
          'list',
          'alias_bind',
          'alias_open',
          'navigate',
          'wait_for',
          'context_set',
          'context_get',
          'transfer',
        ],
        'Action',
      )
      .string('alias', 'Tab alias')
      .string('fromAlias', 'Source tab alias')
      .number('index', 'Tab index (0-based)')
      .string('url', 'URL')
      .string('selector', 'CSS selector to wait for')
      .string('waitForText', 'Text to wait for')
      .string('key', 'Context key')
      .string('value', 'Context value')
      .string('expression', 'JS expression for transfer')
      .number('timeoutMs', 'Timeout ms', { default: 10000 })
      .requiredOpenWorld('action'),
  ),
];
