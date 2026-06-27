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
          'clear',
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
  tool('page_coverage_start', (t) =>
    t
      .desc(
        'Start JS+CSS code coverage collection on the active page. ' +
          'Coverage tracks which bytes of each loaded script/stylesheet are actually executed. ' +
          'Use page_coverage_stop to stop collection and retrieve results.',
      )
      .query(),
  ),
  tool('page_coverage_stop', (t) =>
    t
      .desc(
        'Stop coverage collection and return per-script JS+CSS coverage results. ' +
          'Includes total bytes, used bytes, and coverage percentage per URL.',
      )
      .query(),
  ),
  tool('page_block_script', (t) =>
    t
      .desc(
        'Manage script blocking rules by URL pattern. Blocked scripts are prevented from loading/executing. ' +
          'Actions: add/block (add a rule), remove/unblock (remove a rule), list (show all rules), clear (remove all).',
      )
      .enum('action', ['add', 'block', 'remove', 'unblock', 'list', 'clear'], 'Action', {
        default: 'list',
      })
      .string(
        'urlPattern',
        'URL pattern to block (exact match or * wildcard). Required for add/block/remove/unblock.',
      )
      .string('reason', 'Reason for blocking (shown in results)')
      .openWorld(),
  ),
];
