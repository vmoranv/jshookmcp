import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const advancedBrowserToolDefinitions: Tool[] = [
  tool('js_heap_search', (t) =>
    t
      .desc(`Search the browser JavaScript heap for string values matching a pattern. This is the CE (Cheat Engine) equivalent for web — scans the JS runtime memory to find tokens, API keys, signatures, or any string stored in JS objects.

USE THIS to:
- Find auth tokens stored in memory but not in cookies/localStorage
- Locate signing keys or secrets held in JS closures
- Discover values that are only briefly held in memory during a request

WARNING: Takes a full heap snapshot (can be 50-500MB for complex pages). Use specific patterns to reduce result noise.
Results are paginated via DetailedDataManager when large.`)
      .string('pattern', 'String pattern to search for in the JS heap')
      .number('maxResults', 'Maximum number of matches to return (default: 50)', { default: 50 })
      .boolean('caseSensitive', 'Case-sensitive search (default: false)', { default: false })
      .required('pattern')
      .query(),
  ),
  tool('tab_workflow', (t) =>
    t
      .desc(`Cross-tab coordination for multi-page automation flows.

Actions:
- list: Show all aliases and shared context
- alias_bind: Name an existing tab by index (e.g., alias="register" index=0)
- alias_open: Open a URL in a new tab and name it
- navigate: Navigate a named tab to a URL
- wait_for: Wait for selector or text to appear in a named tab
- context_set: Store a value in shared context (accessible across tabs)
- context_get: Read a value from shared context
- transfer: Evaluate JS in a named tab and store result in shared context

USE THIS for:
- Registration page ↔ email verification page workflows
- Any flow requiring coordination between multiple open tabs`)
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
