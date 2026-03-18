import { describe, expect, it } from 'vitest';
import {
  ExtensionBuilder,
  createExtension,
  type ExtensionToolHandler,
} from '@extension-sdk/plugin';

/* ================================================================== */
/*  ExtensionBuilder                                                   */
/* ================================================================== */

describe('ExtensionBuilder', () => {
  describe('constructor and basic properties', () => {
    it('creates builder with id and version', () => {
      const builder = new ExtensionBuilder('my-plugin', '1.0.0');
      expect(builder._id).toBe('my-plugin');
      expect(builder._version).toBe('1.0.0');
    });

    it('createExtension factory creates builder', () => {
      const builder = createExtension('factory-plugin', '2.0.0');
      expect(builder._id).toBe('factory-plugin');
      expect(builder._version).toBe('2.0.0');
    });

    it('has default values for optional properties', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      expect(builder._name).toBe('');
      expect(builder._description).toBe('');
      expect(builder._compatibleCore).toBe('>=0.1.0');
      expect(builder._tools).toEqual([]);
      expect(builder._allowCommands).toEqual([]);
      expect(builder._allowHosts).toEqual([]);
      expect(builder._allowTools).toEqual([]);
      expect(builder._metrics).toEqual([]);
      expect(builder._configDefaults).toEqual({});
      expect(builder._onLoadHandler).toBeUndefined();
      expect(builder._onValidateHandler).toBeUndefined();
      expect(builder._onActivateHandler).toBeUndefined();
      expect(builder._onDeactivateHandler).toBeUndefined();
    });
  });

  describe('name / description / compatibleCore', () => {
    it('name sets name and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.name('My Plugin');
      expect(result).toBe(builder);
      expect(builder._name).toBe('My Plugin');
    });

    it('description sets description and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.description('A test plugin');
      expect(result).toBe(builder);
      expect(builder._description).toBe('A test plugin');
    });

    it('compatibleCore sets version range and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.compatibleCore('^1.0.0');
      expect(result).toBe(builder);
      expect(builder._compatibleCore).toBe('^1.0.0');
    });
  });

  describe('allowCommand / allowHost / allowTool / metric', () => {
    it('allowCommand adds single command and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.allowCommand('echo');
      expect(result).toBe(builder);
      expect(builder._allowCommands).toEqual(['echo']);
    });

    it('allowCommand adds multiple commands', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      builder.allowCommand(['echo', 'ping']);
      expect(builder._allowCommands).toEqual(['echo', 'ping']);
    });

    it('allowHost adds single host and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.allowHost('example.com');
      expect(result).toBe(builder);
      expect(builder._allowHosts).toEqual(['example.com']);
    });

    it('allowHost adds multiple hosts', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      builder.allowHost(['api.example.com', 'cdn.example.com']);
      expect(builder._allowHosts).toEqual(['api.example.com', 'cdn.example.com']);
    });

    it('allowTool adds single tool and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.allowTool('page_navigate');
      expect(result).toBe(builder);
      expect(builder._allowTools).toEqual(['page_navigate']);
    });

    it('allowTool adds multiple tools', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      builder.allowTool(['page_navigate', 'page_screenshot']);
      expect(builder._allowTools).toEqual(['page_navigate', 'page_screenshot']);
    });

    it('metric adds single metric and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.metric('plugin.loaded');
      expect(result).toBe(builder);
      expect(builder._metrics).toEqual(['plugin.loaded']);
    });

    it('metric adds multiple metrics', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      builder.metric(['plugin.loaded', 'plugin.activated']);
      expect(builder._metrics).toEqual(['plugin.loaded', 'plugin.activated']);
    });
  });

  describe('configDefault', () => {
    it('sets config default and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const result = builder.configDefault('timeout', 5000);
      expect(result).toBe(builder);
      expect(builder._configDefaults).toEqual({ timeout: 5000 });
    });

    it('allows multiple config defaults', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      builder.configDefault('timeout', 5000);
      builder.configDefault('retries', 3);
      expect(builder._configDefaults).toEqual({ timeout: 5000, retries: 3 });
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
      expect(builder._tools).toHaveLength(1);
      expect(builder._tools[0]!.name).toBe('echo');
      expect(builder._tools[0]!.description).toBe('Echoes input');
      expect(builder._tools[0]!.schema).toEqual({
        type: 'object',
        properties: { message: { type: 'string' } },
      });
      expect(builder._tools[0]!.handler).toBe(handler);
    });
  });

  describe('lifecycle handlers', () => {
    it('onLoad sets handler and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const handler = () => {};
      const result = builder.onLoad(handler);
      expect(result).toBe(builder);
      expect(builder._onLoadHandler).toBe(handler);
    });

    it('onValidate sets handler and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const handler = () => ({ valid: true, errors: [] });
      const result = builder.onValidate(handler);
      expect(result).toBe(builder);
      expect(builder._onValidateHandler).toBe(handler);
    });

    it('onActivate sets handler and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const handler = async () => {};
      const result = builder.onActivate(handler);
      expect(result).toBe(builder);
      expect(builder._onActivateHandler).toBe(handler);
    });

    it('onDeactivate sets handler and returns this', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      const handler = async () => {};
      const result = builder.onDeactivate(handler);
      expect(result).toBe(builder);
      expect(builder._onDeactivateHandler).toBe(handler);
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
        .onLoad(() => {})
        .onActivate(async () => {});

      expect(builder._id).toBe('chain-test');
      expect(builder._name).toBe('Chain Test');
      expect(builder._description).toBe('Testing method chaining');
      expect(builder._compatibleCore).toBe('^1.0.0');
      expect(builder._allowTools).toEqual(['page_navigate']);
      expect(builder._metrics).toEqual(['test.metric']);
      expect(builder._configDefaults).toEqual({ timeout: 5000 });
      expect(builder._onLoadHandler).toBeDefined();
      expect(builder._onActivateHandler).toBeDefined();
    });
  });

  describe('property access', () => {
    it('properties are accessible', () => {
      const builder = new ExtensionBuilder('test', '1.0.0');
      builder.name('Test');

      expect(builder._name).toBe('Test');

      const tools = builder._tools;
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

      expect(builder._onLoadHandler).toBe(loadHandler);
      expect(builder._onValidateHandler).toBe(validateHandler);
      expect(builder._onActivateHandler).toBe(activateHandler);
      expect(builder._onDeactivateHandler).toBe(deactivateHandler);
    });
  });
});
