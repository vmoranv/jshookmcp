import { describe, expect, it } from 'vitest';
import {
  ExtensionBuilder,
  createExtension,
  jsonResponse,
  errorResponse,
  type ExtensionToolHandler,
} from '@extension-sdk/plugin';

/* ================================================================== */
/*  ExtensionBuilder                                                   */
/* ================================================================== */

describe('ExtensionBuilder', () => {
  describe('constructor and basic properties', () => {
    it('creates builder with id and version', () => {
      const builder = new ExtensionBuilder('my-plugin', '1.0.0');
      expect(builder.id).toBe('my-plugin');
      expect(builder.version).toBe('1.0.0');
    });

    it('createExtension factory creates builder', () => {
      const builder = createExtension('factory-plugin', '2.0.0');
      expect(builder.id).toBe('factory-plugin');
      expect(builder.version).toBe('2.0.0');
    });

    it('has default values for optional properties', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      expect(builder.pluginName).toBe('');
      expect(builder.pluginDescription).toBe('');
      expect(builder.compatibleCoreRange).toBe('>=0.1.0');
      expect(builder.tools).toEqual([]);
      expect(builder.allowedCommands).toEqual([]);
      expect(builder.allowedHosts).toEqual([]);
      expect(builder.allowedTools).toEqual([]);
      expect(builder.declaredMetrics).toEqual([]);
      expect(builder.configDefaults).toEqual({});
      expect(builder.onLoadHandler).toBeUndefined();
      expect(builder.onValidateHandler).toBeUndefined();
      expect(builder.onActivateHandler).toBeUndefined();
      expect(builder.onDeactivateHandler).toBeUndefined();
    });
  });

  describe('name / description / compatibleCore', () => {
    it('name sets name and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.name('My Plugin');
      expect(result).toBe(builder);
      expect(builder.pluginName).toBe('My Plugin');
    });

    it('description sets description and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.description('A test plugin');
      expect(result).toBe(builder);
      expect(builder.pluginDescription).toBe('A test plugin');
    });

    it('compatibleCore sets version range and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.compatibleCore('^1.0.0');
      expect(result).toBe(builder);
      expect(builder.compatibleCoreRange).toBe('^1.0.0');
    });
  });

  describe('allowCommand / allowHost / allowTool / metric', () => {
    it('allowCommand adds single command and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.allowCommand('echo');
      expect(result).toBe(builder);
      expect(builder.allowedCommands).toEqual(['echo']);
    });

    it('allowCommand adds multiple commands', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      builder.allowCommand(['echo', 'ping']);
      expect(builder.allowedCommands).toEqual(['echo', 'ping']);
    });

    it('allowHost adds single host and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.allowHost('example.com');
      expect(result).toBe(builder);
      expect(builder.allowedHosts).toEqual(['example.com']);
    });

    it('allowHost adds multiple hosts', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      builder.allowHost(['api.example.com', 'cdn.example.com']);
      expect(builder.allowedHosts).toEqual(['api.example.com', 'cdn.example.com']);
    });

    it('allowTool adds single tool and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.allowTool('page_navigate');
      expect(result).toBe(builder);
      expect(builder.allowedTools).toEqual(['page_navigate']);
    });

    it('allowTool adds multiple tools', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      builder.allowTool(['page_navigate', 'page_screenshot']);
      expect(builder.allowedTools).toEqual(['page_navigate', 'page_screenshot']);
    });

    it('metric adds single metric and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.metric('plugin.loaded');
      expect(result).toBe(builder);
      expect(builder.declaredMetrics).toEqual(['plugin.loaded']);
    });

    it('metric adds multiple metrics', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      builder.metric(['plugin.loaded', 'plugin.activated']);
      expect(builder.declaredMetrics).toEqual(['plugin.loaded', 'plugin.activated']);
    });
  });

  describe('configDefault', () => {
    it('sets config default and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.configDefault('timeout', 5000);
      expect(result).toBe(builder);
      expect(builder.configDefaults).toEqual({ timeout: 5000 });
    });

    it('allows multiple config defaults', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      builder.configDefault('timeout', 5000);
      builder.configDefault('retries', 3);
      expect(builder.configDefaults).toEqual({ timeout: 5000, retries: 3 });
    });
  });

  describe('tool', () => {
    it('adds tool definition and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const handler: ExtensionToolHandler = async () => ({
        content: [{ type: 'text', text: 'ok' }],
      });
      const result = builder.tool('echo', 'Echoes input', { message: { type: 'string' } }, handler);
      expect(result).toBe(builder);
      expect(builder.tools).toHaveLength(1);
      expect(builder.tools[0]!.name).toBe('echo');
      expect(builder.tools[0]!.description).toBe('Echoes input');
      expect(builder.tools[0]!.schema).toEqual({
        type: 'object',
        properties: { message: { type: 'string' } },
      });
      expect(builder.tools[0]!.handler).toBe(handler);
    });
  });

  describe('profile', () => {
    it('defaults to full tier', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      expect(builder.profiles).toEqual(['full']);
    });

    it('accepts a single profile', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      builder.profile('workflow');
      expect(builder.profiles).toEqual(['workflow']);
    });

    it('accepts multiple profiles', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      builder.profile(['search', 'workflow']);
      expect(builder.profiles).toEqual(['search', 'workflow']);
    });
  });

  describe('lifecycle handlers', () => {
    it('onLoad sets handler and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const handler = () => {};
      const result = builder.onLoad(handler);
      expect(result).toBe(builder);
      expect(builder.onLoadHandler).toBe(handler);
    });

    it('onValidate sets handler and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const handler = () => ({ valid: true, errors: [] });
      const result = builder.onValidate(handler);
      expect(result).toBe(builder);
      expect(builder.onValidateHandler).toBe(handler);
    });

    it('onActivate sets handler and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const handler = async () => {};
      const result = builder.onActivate(handler);
      expect(result).toBe(builder);
      expect(builder.onActivateHandler).toBe(handler);
    });

    it('onDeactivate sets handler and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const handler = async () => {};
      const result = builder.onDeactivate(handler);
      expect(result).toBe(builder);
      expect(builder.onDeactivateHandler).toBe(handler);
    });
  });

  describe('fluent chaining', () => {
    it('supports method chaining', () => {
      const builder = createExtension('chain-test', '1.0.0')
        .name('Chain Test')
        .description('Testing method chaining')
        .compatibleCore('^1.0.0')
        .allowTool('page_navigate')
        .metric('test.metric')
        .configDefault('timeout', 5000)
        .profile('workflow')
        .onLoad(() => {})
        .onActivate(async () => {});

      expect(builder.id).toBe('chain-test');
      expect(builder.pluginName).toBe('Chain Test');
      expect(builder.pluginDescription).toBe('Testing method chaining');
      expect(builder.compatibleCoreRange).toBe('^1.0.0');
      expect(builder.allowedTools).toEqual(['page_navigate']);
      expect(builder.declaredMetrics).toEqual(['test.metric']);
      expect(builder.configDefaults).toEqual({ timeout: 5000 });
      expect(builder.profiles).toEqual(['workflow']);
      expect(builder.onLoadHandler).toBeDefined();
      expect(builder.onActivateHandler).toBeDefined();
    });
  });

  describe('property access', () => {
    it('properties are accessible via getters', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      builder.name('Test');

      expect(builder.pluginName).toBe('Test');

      const tools = builder.tools;
      expect(Array.isArray(tools)).toBe(true);
    });

    it('handler properties return the assigned functions', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const loadHandler = () => {};
      const validateHandler = () => ({ valid: true, errors: [] });
      const activateHandler = async () => {};
      const deactivateHandler = async () => {};

      builder
        .onLoad(loadHandler)
        .onValidate(validateHandler)
        .onActivate(activateHandler)
        .onDeactivate(deactivateHandler);

      expect(builder.onLoadHandler).toBe(loadHandler);
      expect(builder.onValidateHandler).toBe(validateHandler);
      expect(builder.onActivateHandler).toBe(activateHandler);
      expect(builder.onDeactivateHandler).toBe(deactivateHandler);
    });
  });

  describe('response helpers', () => {
    it('jsonResponse creates correct MCP format', () => {
      const res = jsonResponse({ success: true, data: 42 });
      expect(res.content).toHaveLength(1);
      expect(res.content[0]!.type).toBe('text');
      const parsed = JSON.parse((res.content[0] as { type: 'text'; text: string }).text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toBe(42);
    });

    it('errorResponse includes tool and error message', () => {
      const res = errorResponse('my_tool', new Error('boom'));
      const parsed = JSON.parse((res.content[0] as { type: 'text'; text: string }).text);
      expect(parsed.success).toBe(false);
      expect(parsed.tool).toBe('my_tool');
      expect(parsed.error).toBe('boom');
    });

    it('errorResponse handles non-Error objects', () => {
      const res = errorResponse('my_tool', 'string error');
      const parsed = JSON.parse((res.content[0] as { type: 'text'; text: string }).text);
      expect(parsed.error).toBe('string error');
    });
  });
});
