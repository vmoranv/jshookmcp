import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const advancedBrowserToolDefinitions: Tool[] = [
  tool('js_heap_search', (t) =>
    t
      .desc(
        `Search JS heap for string values matching a pattern. WARNING: takes a full heap snapshot.`,
      )
      .string('pattern', 'String pattern to search for in the JS heap')
      .number('maxResults', 'Maximum number of matches to return (default: 50)', { default: 50 })
      .boolean('caseSensitive', 'Case-sensitive search (default: false)', { default: false })
      .required('pattern')
      .query(),
  ),
  tool('tab_workflow', (t) =>
    t
      .desc(
        `Cross-tab coordination: list/bind/navigate/wait/context-set/transfer across named tabs.`,
      )
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

        'Tab workflow action to perform',
      )
      .string(
        'alias',
        'Tab alias name (used by alias_bind, alias_open, navigate, wait_for, transfer)',
      )
      .string('fromAlias', 'Source tab alias for transfer action')
      .number('index', 'Tab index (0-based) for alias_bind')
      .string('url', 'URL for alias_open or navigate')
      .string('selector', 'CSS selector to wait for (wait_for action)')
      .string('waitForText', 'Text string to wait for in page body (wait_for action)')
      .string('key', 'Context key for context_set, context_get, transfer')
      .string('value', 'Value to store (context_set action)')
      .string('expression', 'JavaScript expression to evaluate in the source tab (transfer action)')
      .number('timeoutMs', 'Timeout in milliseconds for wait_for (default: 10000)', {
        default: 10000,
      })
      .requiredOpenWorld('action'),
  ),
];
