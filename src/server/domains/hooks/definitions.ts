import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const aiHookTools: Tool[] = [
  tool('ai_hook_generate')
    .desc(
      'Generate hook code for a target function, API, or object method.\n\nHook types:\n- function: Hook a named global function (e.g. window.btoa)\n- object-method: Hook a method on an object (e.g. crypto.subtle.encrypt)\n- api: Hook a built-in API (e.g. fetch, XMLHttpRequest)\n- property: Hook a property getter/setter\n- event: Hook an event listener\n- custom: Provide custom hook code\n\nAfter generating, inject the hook with ai_hook_inject.',
    )
    .string('description', 'What the hook should do (e.g., "Capture all fetch requests to /api")')
    .prop('target', {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['function', 'object-method', 'api', 'property', 'event', 'custom'],
          description: 'Hook type',
        },
        name: { type: 'string', description: 'Function or API name (e.g., "btoa", "fetch")' },
        pattern: { type: 'string', description: 'Pattern for matching (used with api type)' },
        object: { type: 'string', description: 'Object path (e.g., "window.crypto.subtle")' },
        property: { type: 'string', description: 'Property name to hook' },
      },
      required: ['type'],
      description: 'Hook target specification',
    })
    .prop('behavior', {
      type: 'object',
      properties: {
        captureArgs: { type: 'boolean', description: 'Capture function arguments', default: true },
        captureReturn: { type: 'boolean', description: 'Capture return value', default: true },
        captureStack: { type: 'boolean', description: 'Capture call stack', default: false },
        modifyArgs: { type: 'boolean', description: 'Allow argument modification', default: false },
        modifyReturn: {
          type: 'boolean',
          description: 'Allow return value modification',
          default: false,
        },
        blockExecution: {
          type: 'boolean',
          description: 'Block the original function from executing',
          default: false,
        },
        logToConsole: { type: 'boolean', description: 'Log hook events to console', default: true },
      },
      description: 'Hook behavior configuration',
    })
    .prop('condition', {
      type: 'object',
      properties: {
        argFilter: {
          type: 'string',
          description: 'JS expression to filter by args (e.g., "args[0].includes(\'password\')")',
        },
        returnFilter: { type: 'string', description: 'JS expression to filter by return value' },
        urlPattern: { type: 'string', description: 'Regex pattern to match request URL' },
        maxCalls: { type: 'number', description: 'Stop capturing after this many calls' },
      },
      description: 'Conditional trigger for the hook',
    })
    .prop('customCode', {
      type: 'object',
      properties: {
        before: { type: 'string', description: 'Code to run before the original function' },
        after: { type: 'string', description: 'Code to run after the original function' },
        replace: { type: 'string', description: 'Code to replace the original function entirely' },
      },
      description: 'Custom code to inject at hook points',
    })
    .required('description', 'target', 'behavior')
    .build(),

  tool('ai_hook_inject')
    .desc(
      'Inject a generated hook into the page.\n\nMethods:\n- evaluateOnNewDocument: Runs before page scripts (use for API hooks like fetch/XHR)\n- evaluate: Runs in current page context (use for hooking already-loaded code)',
    )
    .string('hookId', 'Hook ID returned by ai_hook_generate')
    .string('code', 'Hook code returned by ai_hook_generate')
    .enum('method', ['evaluateOnNewDocument', 'evaluate'], 'Injection method', {
      default: 'evaluate',
    })
    .required('hookId', 'code')
    .build(),

  tool('ai_hook_get_data')
    .desc(
      'Retrieve captured data from an active hook (arguments, return values, timestamps, call count)',
    )
    .string('hookId', 'Hook ID')
    .required('hookId')
    .build(),

  tool('ai_hook_list')
    .desc('List all active hooks with their IDs, types, creation time, and call counts')
    .build(),

  tool('ai_hook_clear')
    .desc('Remove one hook by ID or clear all hooks and their captured data')
    .string('hookId', 'Hook ID to clear (omit to clear all hooks)')
    .build(),

  tool('ai_hook_toggle')
    .desc('Enable or disable a hook without removing it')
    .string('hookId', 'Hook ID')
    .boolean('enabled', 'true to enable, false to disable')
    .required('hookId', 'enabled')
    .build(),

  tool('ai_hook_export')
    .desc('Export captured hook data in JSON or CSV format')
    .string('hookId', 'Hook ID to export (omit to export all hooks)')
    .enum('format', ['json', 'csv'], 'Export format', { default: 'json' })
    .build(),
];

export const hookPresetTools: Tool[] = [
  tool('hook_preset')
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
    )
    .build(),
];
