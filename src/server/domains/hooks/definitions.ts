import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const aiHookTools: Tool[] = [
  tool('ai_hook_inject', (t) =>
    t
      .desc(
        'Inject a generated hook into the page.\n\nMethods:\n- evaluateOnNewDocument: Runs before page scripts (use for API hooks like fetch/XHR)\n- evaluate: Runs in current page context (use for hooking already-loaded code)',
      )
      .string('hookId', 'Hook ID for injection')
      .string('code', 'Hook code to inject')
      .enum('method', ['evaluateOnNewDocument', 'evaluate'], 'Injection method', {
        default: 'evaluate',
      })
      .required('hookId', 'code'),
  ),
  tool('ai_hook_get_data', (t) =>
    t
      .desc(
        'Retrieve captured data from an active hook (arguments, return values, timestamps, call count)',
      )
      .string('hookId', 'Hook ID')
      .required('hookId'),
  ),
  tool('ai_hook_list', (t) =>
    t.desc('List all active hooks with their IDs, types, creation time, and call counts'),
  ),
  tool('ai_hook_clear', (t) =>
    t
      .desc('Remove one hook by ID or clear all hooks and their captured data')
      .string('hookId', 'Hook ID to clear (omit to clear all hooks)'),
  ),
  tool('ai_hook_toggle', (t) =>
    t
      .desc('Enable or disable a hook without removing it')
      .string('hookId', 'Hook ID')
      .boolean('enabled', 'true to enable, false to disable')
      .required('hookId', 'enabled'),
  ),
  tool('ai_hook_export', (t) =>
    t
      .desc('Export captured hook data in JSON or CSV format')
      .string('hookId', 'Hook ID to export (omit to export all hooks)')
      .enum('format', ['json', 'csv'], 'Export format', { default: 'json' }),
  ),
];

export const hookPresetTools: Tool[] = [
  tool('hook_preset', (t) =>
    t
      .desc(
        'Install a pre-built JavaScript hook from 20+ built-in presets (eval, atob/btoa, Proxy, Reflect, Object.defineProperty, etc.), or provide customTemplate/customTemplates to install your own reusable hook bodies. Use listPresets=true to see all available preset descriptions.',
      )
      .string(
        'preset',
        'Single preset name to install. Accepts built-in preset ids or ids provided by customTemplate/customTemplates.',
      )
      .array(
        'presets',
        { type: 'string' },
        'List of preset names to install simultaneously. Accepts built-in ids and custom template ids.',
      )
      .prop('customTemplate', {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Stable preset id, for example deobfuscation-sinks' },
          description: {
            type: 'string',
            description: 'Human-readable description for listPresets output.',
          },
          body: {
            type: 'string',
            description: 'Hook body snippet inserted into the preset wrapper.',
          },
        },
        required: ['id', 'body'],
        description:
          'Inline custom template. body should contain the hook body inserted into the standard buildHookCode wrapper. Use {{STACK_CODE}} and {{LOG_FN}} placeholders when needed.',
      })
      .prop('customTemplates', {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['id', 'body'],
        },
        description: 'List of inline custom templates to register for this invocation.',
      })
      .boolean('captureStack', 'Include call stack in captured data (has performance impact)', {
        default: false,
      })
      .boolean('logToConsole', 'Log hook events to browser console', { default: true })
      .enum(
        'method',
        ['evaluate', 'evaluateOnNewDocument'],
        'Injection method: evaluate=current page, evaluateOnNewDocument=before page scripts',
        { default: 'evaluate' },
      )
      .boolean(
        'listPresets',
        'Set to true to list all available presets with descriptions instead of installing.',
        { default: false },
      ),
  ),
];
