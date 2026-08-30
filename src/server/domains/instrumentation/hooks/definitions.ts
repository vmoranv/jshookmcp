import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';

export const aiHookTools: Tool[] = [
  tool('ai_hook', (t) =>
    t
      .desc(
        'Manage AI hooks. Actions: inject (inject code into page), get_data (retrieve captured hook data), list ' +
          '(all active hooks), clear (remove hook data by id or all), toggle (enable/disable a hook), export ' +
          '(export data as JSON/CSV).',
      )
      .enum(
        'action',
        ['inject', 'get_data', 'list', 'clear', 'toggle', 'export'],
        'Operation to perform',
      )
      .string(
        'hookId',
        'Hook identifier (required for inject/get_data/toggle; optional for clear/export)',
      )
      .string('code', 'Hook code to inject (required for action=inject)')
      .number(
        'maxMatches',
        'Auto-unhook guard (action=inject only): after the hook fires this many calls the injected guard flips metadata.enabled=false. Hook code must call window.__aiHookUnhookGuard(hookId, value) per call.',
      )
      .string(
        'unhookPredicate',
        'Auto-unhook guard (action=inject only): JS expression compiled in-page as new Function("value", src); truthy result flips metadata.enabled=false. Hook code must call window.__aiHookUnhookGuard(hookId, value) per call.',
      )
      .enum(
        'method',
        ['evaluateOnNewDocument', 'evaluate'],
        'Injection method (for action=inject)',
        {
          default: 'evaluate',
        },
      )
      .boolean('enabled', 'Enable or disable hook (required for action=toggle)')
      .enum('format', ['json', 'csv'], 'Export format (for action=export)', { default: 'json' })
      .required('action'),
  ),
];

export const hookPresetTools: Tool[] = [
  tool('hook_preset', (t) =>
    t
      .desc(
        'Install a pre-built JavaScript hook from 20+ built-in presets (eval, atob/btoa, Proxy, Reflect, ' +
          'Object.defineProperty, etc.), or provide customTemplate/customTemplates to install your own reusable ' +
          'hook bodies. Use listPresets=true to see all available preset descriptions.',
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
          mutateReturn: {
            type: 'string',
            description:
              'Optional JS expression that mutates a hooked call return value. May reference __result (the ' +
              'original return). When set, the wrapper exposes __mutateReturn(result); wrap the original call ' +
              'in your body, e.g. `return __mutateReturn(_orig.call(this, code));`. Ships NO hardcoded mutation.',
          },
        },
        required: ['id', 'body'],
        description:
          'Inline custom template. body should contain the hook body inserted into the standard buildHookCode ' +
          'wrapper. Use {{STACK_CODE}} and {{LOG_FN}} placeholders when needed.',
      })
      .prop('customTemplates', {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            body: { type: 'string' },
            mutateReturn: { type: 'string' },
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
