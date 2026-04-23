import { describe, it, expect } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  browserTools,
  advancedBrowserToolDefinitions,
  browserJsdomToolDefinitions,
} from '@server/domains/browser/definitions.tools';
import { browserRuntimeTools } from '@server/domains/browser/definitions.tools.runtime';
import { browserPageCoreTools } from '@server/domains/browser/definitions.tools.page-core';
import { browserPageSystemTools } from '@server/domains/browser/definitions.tools.page-system';
import { browserSecurityStateTools } from '@server/domains/browser/definitions.tools.security';
import { behaviorTools } from '@server/domains/browser/definitions.tools.behavior';

// Re-export through definitions.ts
import {
  browserTools as definitionsReExport,
  advancedBrowserToolDefinitions as advancedReExport,
} from '@server/domains/browser/definitions';

type ObjectInputSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: readonly string[];
};

function getToolByName(tools: readonly Tool[], name: string): Tool {
  const tool = tools.find((candidate) => candidate.name === name);
  expect(tool, `Expected tool "${name}" to exist`).toBeDefined();
  return tool!;
}

function getInputSchema(tool: Tool): ObjectInputSchema {
  const schema = tool.inputSchema as ObjectInputSchema | undefined;
  expect(schema).toBeDefined();
  expect(schema?.type).toBe('object');
  expect(schema?.properties).toBeDefined();
  return schema!;
}

function getSchemaProperty<T extends Record<string, unknown>>(tool: Tool, propertyName: string): T {
  const schema = getInputSchema(tool);
  expect(schema.properties).toHaveProperty(propertyName);
  return schema.properties[propertyName] as T;
}

describe('browser tool definitions', () => {
  // ── browserTools composite ──────────────────────────────────

  describe('browserTools (composite)', () => {
    it('is a non-empty array', async () => {
      expect(Array.isArray(browserTools)).toBe(true);
      expect(browserTools.length).toBeGreaterThan(0);
    });

    it('contains all sub-array tools merged together', async () => {
      const expected =
        browserRuntimeTools.length +
        browserPageCoreTools.length +
        browserPageSystemTools.length +
        browserSecurityStateTools.length +
        behaviorTools.length +
        browserJsdomToolDefinitions.length;
      expect(browserTools).toHaveLength(expected);
    });

    it('has unique tool names', async () => {
      const names = browserTools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it.each(browserTools.map((tool) => [tool.name, tool]))(
      'tool "%s" has required MCP structure',
      (_name, tool) => {
        expect(tool).toEqual(
          expect.objectContaining({
            name: expect.any(String),
            description: expect.any(String),
            inputSchema: expect.objectContaining({
              type: 'object',
              properties: expect.any(Object),
            }),
          }),
        );
      },
    );

    it('every tool has a non-empty description', async () => {
      for (const tool of browserTools) {
        expect((tool.description ?? '').trim().length).toBeGreaterThan(0);
      }
    });

    it('every tool inputSchema.type is "object"', async () => {
      for (const tool of browserTools) {
        expect(getInputSchema(tool).type).toBe('object');
      }
    });
  });

  // ── advancedBrowserToolDefinitions ──────────────────────────

  describe('advancedBrowserToolDefinitions', () => {
    it('is a non-empty array', async () => {
      expect(Array.isArray(advancedBrowserToolDefinitions)).toBe(true);
      expect(advancedBrowserToolDefinitions.length).toBeGreaterThan(0);
    });

    it.each(advancedBrowserToolDefinitions.map((tool) => [tool.name, tool]))(
      'advanced tool "%s" has required MCP structure',
      (_name, tool) => {
        expect(tool).toEqual(
          expect.objectContaining({
            name: expect.any(String),
            description: expect.any(String),
            inputSchema: expect.objectContaining({
              type: 'object',
              properties: expect.any(Object),
            }),
          }),
        );
      },
    );

    it('has unique names', async () => {
      const names = advancedBrowserToolDefinitions.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('includes js_heap_search', async () => {
      expect(advancedBrowserToolDefinitions.find((t) => t.name === 'js_heap_search')).toBeDefined();
    });

    it('includes tab_workflow', async () => {
      expect(advancedBrowserToolDefinitions.find((t) => t.name === 'tab_workflow')).toBeDefined();
    });
  });

  // ── No name collisions between standard and advanced ────────

  describe('cross-array uniqueness', () => {
    it('no name collisions between browserTools and advancedBrowserToolDefinitions', async () => {
      const standardNames = new Set(browserTools.map((t) => t.name));
      const advancedNames = advancedBrowserToolDefinitions.map((t) => t.name);
      for (const name of advancedNames) {
        expect(standardNames.has(name)).toBe(false);
      }
    });
  });

  // ── definitions.ts re-exports ───────────────────────────────

  describe('definitions.ts re-exports', () => {
    it('re-exports browserTools from definitions.tools', async () => {
      expect(definitionsReExport).toBe(browserTools);
    });

    it('re-exports advancedBrowserToolDefinitions from definitions.tools', async () => {
      expect(advancedReExport).toBe(advancedBrowserToolDefinitions);
    });
  });

  // ── Runtime tools ───────────────────────────────────────────

  describe('browserRuntimeTools', () => {
    const expectedNames = [
      'get_detailed_data',
      'browser_launch',
      'camoufox_server',
      'browser_attach',
      'browser_close',
      'browser_status',
    ];

    it.each(expectedNames)('includes tool "%s"', (name) => {
      expect(browserRuntimeTools.find((t) => t.name === name)).toBeDefined();
    });

    it('get_detailed_data requires detailId', async () => {
      const tool = getToolByName(browserRuntimeTools, 'get_detailed_data');
      const schema = getInputSchema(tool);
      expect(schema.required).toContain('detailId');
      expect(schema.properties).toHaveProperty('path');
    });

    it('browser_launch has driver enum with chrome and camoufox', async () => {
      const tool = getToolByName(browserRuntimeTools, 'browser_launch');
      const driverProp = getSchemaProperty<Record<string, unknown>>(tool, 'driver');
      expect(driverProp.enum).toEqual(['chrome', 'camoufox']);
    });

    it('browser_launch exposes advanced camoufox fingerprint fields', async () => {
      const tool = getToolByName(browserRuntimeTools, 'browser_launch');
      const schema = getInputSchema(tool);
      expect(schema.properties).toHaveProperty('fingerprint');
      expect(schema.properties).toHaveProperty('webglConfig');
      expect(schema.properties).toHaveProperty('firefoxUserPrefs');
      expect(schema.properties).toHaveProperty('excludeAddons');
      expect(schema.properties).toHaveProperty('customFontsOnly');
      expect(schema.properties).toHaveProperty('mainWorldEval');
    });

    it('browser_attach has browserURL and wsEndpoint properties', async () => {
      const tool = getToolByName(browserRuntimeTools, 'browser_attach');
      const schema = getInputSchema(tool);
      expect(schema.properties).toHaveProperty('browserURL');
      expect(schema.properties).toHaveProperty('wsEndpoint');
      expect(schema.properties).toHaveProperty('pageIndex');
    });

    it('browser_close and browser_status have no required properties', async () => {
      const closeTool = getToolByName(browserRuntimeTools, 'browser_close');
      const statusTool = getToolByName(browserRuntimeTools, 'browser_status');
      expect(getInputSchema(closeTool).required).toBeUndefined();
      expect(getInputSchema(statusTool).required).toBeUndefined();
    });
  });

  // ── Page core tools ─────────────────────────────────────────

  describe('browserPageCoreTools', () => {
    it('page_navigate requires url', async () => {
      const tool = getToolByName(browserPageCoreTools, 'page_navigate');
      expect(getInputSchema(tool).required).toContain('url');
    });

    it('page_navigate has waitUntil enum', async () => {
      const tool = getToolByName(browserPageCoreTools, 'page_navigate');
      const prop = getSchemaProperty<Record<string, unknown>>(tool, 'waitUntil');
      expect(prop.enum).toEqual(['load', 'domcontentloaded', 'networkidle', 'commit']);
    });

    it('page_navigate has enableNetworkMonitoring boolean', async () => {
      const tool = getToolByName(browserPageCoreTools, 'page_navigate');
      const prop = getSchemaProperty<Record<string, unknown>>(tool, 'enableNetworkMonitoring');
      expect(prop.type).toBe('boolean');
      expect(prop.default).toBe(false);
    });

    const noArgPageTools = ['page_reload', 'page_back', 'page_forward'];
    it.each(noArgPageTools)('%s has no required properties', (name) => {
      const tool = getToolByName(browserPageCoreTools, name);
      expect(getInputSchema(tool).required).toBeUndefined();
    });

    it('page_click requires selector', async () => {
      const tool = getToolByName(browserPageCoreTools, 'page_click');
      expect(getInputSchema(tool).required).toContain('selector');
      const buttonProp = getSchemaProperty<Record<string, unknown>>(tool, 'button');
      expect(buttonProp.enum).toEqual(['left', 'right', 'middle']);
    });

    it('page_type requires selector and text', async () => {
      const tool = getToolByName(browserPageCoreTools, 'page_type');
      const schema = getInputSchema(tool);
      expect(schema.required).toContain('selector');
      expect(schema.required).toContain('text');
    });

    it('page_select requires selector and values', async () => {
      const tool = getToolByName(browserPageCoreTools, 'page_select');
      const schema = getInputSchema(tool);
      expect(schema.required).toContain('selector');
      expect(schema.required).toContain('values');
    });

    it('page_evaluate requires code', async () => {
      const tool = getToolByName(browserPageCoreTools, 'page_evaluate');
      expect(getInputSchema(tool).required).toContain('code');
    });

    it('browser_evaluate_cdp_target requires code and keeps target evaluation explicit', async () => {
      const tool = getToolByName(browserRuntimeTools, 'browser_evaluate_cdp_target');
      const schema = getInputSchema(tool);
      expect(schema.required).toContain('code');
      expect(schema.properties).not.toHaveProperty('targetId');
    });

    it('page_wait_for_selector requires selector', async () => {
      const tool = getToolByName(browserPageCoreTools, 'page_wait_for_selector');
      expect(getInputSchema(tool).required).toContain('selector');
    });
  });

  // ── Page system tools ───────────────────────────────────────

  describe('browserPageSystemTools', () => {
    it('console_execute requires expression', async () => {
      const tool = getToolByName(browserPageSystemTools, 'console_execute');
      expect(getInputSchema(tool).required).toContain('expression');
    });

    it('console_get_logs has optional type enum', async () => {
      const tool = getToolByName(browserPageSystemTools, 'console_get_logs');
      const typeProp = getSchemaProperty<Record<string, unknown>>(tool, 'type');
      expect(typeProp.enum).toEqual(['log', 'warn', 'error', 'info', 'debug']);
    });

    it('page_set_viewport requires width and height', async () => {
      const tool = getToolByName(browserPageSystemTools, 'page_set_viewport');
      const schema = getInputSchema(tool);
      expect(schema.required).toContain('width');
      expect(schema.required).toContain('height');
    });

    it('page_emulate_device requires device', async () => {
      const tool = getToolByName(browserPageSystemTools, 'page_emulate_device');
      expect(getInputSchema(tool).required).toContain('device');
    });

    it('page_cookies requires action', async () => {
      const tool = getToolByName(browserPageSystemTools, 'page_cookies');
      expect(getInputSchema(tool).required).toContain('action');
    });

    it('page_local_storage requires action', async () => {
      const tool = getToolByName(browserPageSystemTools, 'page_local_storage');
      expect(getInputSchema(tool).required).toContain('action');
    });

    it('page_press_key requires key', async () => {
      const tool = getToolByName(browserPageSystemTools, 'page_press_key');
      expect(getInputSchema(tool).required).toContain('key');
    });

    it('page_inject_script requires script', async () => {
      const tool = getToolByName(browserPageSystemTools, 'page_inject_script');
      expect(getInputSchema(tool).required).toContain('script');
    });

    // No noArgSystemTools remaining
  });

  // ── Security state tools ────────────────────────────────────

  describe('browserSecurityStateTools', () => {
    it('captcha_detect has no required properties', async () => {
      const tool = getToolByName(browserSecurityStateTools, 'captcha_detect');
      expect(getInputSchema(tool).required).toBeUndefined();
    });

    it('stealth_inject has no required properties', async () => {
      const tool = getToolByName(browserSecurityStateTools, 'stealth_inject');
      expect(getInputSchema(tool).required).toBeUndefined();
    });

    it('stealth_set_user_agent has platform enum', async () => {
      const tool = getToolByName(browserSecurityStateTools, 'stealth_set_user_agent');
      const prop = getSchemaProperty<Record<string, unknown>>(tool, 'platform');
      expect(prop.enum).toEqual(['windows', 'mac', 'linux']);
    });

    it('browser_select_tab has index, urlPattern, and titlePattern', async () => {
      const tool = getToolByName(browserSecurityStateTools, 'browser_select_tab');
      const schema = getInputSchema(tool);
      expect(schema.properties).toHaveProperty('index');
      expect(schema.properties).toHaveProperty('urlPattern');
      expect(schema.properties).toHaveProperty('titlePattern');
    });

    it('framework_state_extract has framework enum', async () => {
      const tool = getToolByName(browserSecurityStateTools, 'framework_state_extract');
      const prop = getSchemaProperty<Record<string, unknown>>(tool, 'framework');
      expect(prop.enum).toEqual(['auto', 'react', 'vue2', 'vue3', 'svelte', 'solid', 'preact']);
    });

    it('indexeddb_dump has optional database, store, and maxRecords', async () => {
      const tool = getToolByName(browserSecurityStateTools, 'indexeddb_dump');
      const schema = getInputSchema(tool);
      expect(schema.properties).toHaveProperty('database');
      expect(schema.properties).toHaveProperty('store');
      expect(schema.properties).toHaveProperty('maxRecords');
      expect(schema.required).toBeUndefined();
    });
  });

  // ── Behavior tools ──────────────────────────────────────────

  describe('behaviorTools', () => {
    it('has exactly 5 behavior tools', async () => {
      expect(behaviorTools).toHaveLength(5);
    });

    const expectedBehaviorNames = [
      'human_mouse',
      'human_scroll',
      'human_typing',
      'captcha_vision_solve',
      'widget_challenge_solve',
    ];

    it.each(expectedBehaviorNames)('includes "%s"', (name) => {
      expect(behaviorTools.find((t) => t.name === name)).toBeDefined();
    });

    it('human_typing requires selector and text', async () => {
      const tool = getToolByName(behaviorTools, 'human_typing');
      const schema = getInputSchema(tool);
      expect(schema.required).toContain('selector');
      expect(schema.required).toContain('text');
    });

    it('human_mouse has no required properties', async () => {
      const tool = getToolByName(behaviorTools, 'human_mouse');
      expect(getInputSchema(tool).required).toBeUndefined();
    });

    it('human_scroll has no required properties', async () => {
      const tool = getToolByName(behaviorTools, 'human_scroll');
      expect(getInputSchema(tool).required).toBeUndefined();
    });

    it('captcha_vision_solve has mode enum', async () => {
      const tool = getToolByName(behaviorTools, 'captcha_vision_solve');
      const modeProp = getSchemaProperty<Record<string, unknown>>(tool, 'mode');
      expect(modeProp.enum).toEqual(['external_service', 'manual']);
    });

    it('captcha_vision_solve has challengeType enum', async () => {
      const tool = getToolByName(behaviorTools, 'captcha_vision_solve');
      const prop = getSchemaProperty<Record<string, unknown>>(tool, 'challengeType');
      expect(prop.enum).toEqual(['image', 'widget', 'browser_check', 'auto']);
      expect(prop.default).toBe('auto');
    });

    it('widget_challenge_solve has mode enum with three options', async () => {
      const tool = getToolByName(behaviorTools, 'widget_challenge_solve');
      const modeProp = getSchemaProperty<Record<string, unknown>>(tool, 'mode');
      expect(modeProp.enum).toEqual(['external_service', 'hook', 'manual']);
    });

    it('widget_challenge_solve has injectToken boolean with default true', async () => {
      const tool = getToolByName(behaviorTools, 'widget_challenge_solve');
      const prop = getSchemaProperty<Record<string, unknown>>(tool, 'injectToken');
      expect(prop.type).toBe('boolean');
      expect(prop.default).toBe(true);
    });
  });

  // ── Advanced tool inputSchema ───────────────────────────────

  describe('advanced tool inputSchema', () => {
    it('js_heap_search requires pattern', async () => {
      const tool = getToolByName(advancedBrowserToolDefinitions, 'js_heap_search');
      const schema = getInputSchema(tool);
      expect(schema.required).toContain('pattern');
      expect(schema.properties).toHaveProperty('maxResults');
      expect(schema.properties).toHaveProperty('caseSensitive');
    });

    it('tab_workflow requires action', async () => {
      const tool = getToolByName(advancedBrowserToolDefinitions, 'tab_workflow');
      expect(getInputSchema(tool).required).toContain('action');
    });

    it('tab_workflow action has correct enum', async () => {
      const tool = getToolByName(advancedBrowserToolDefinitions, 'tab_workflow');
      const actionProp = getSchemaProperty<Record<string, unknown>>(tool, 'action');
      expect(actionProp.enum).toEqual([
        'list',
        'alias_bind',
        'alias_open',
        'navigate',
        'wait_for',
        'context_set',
        'context_get',
        'transfer',
      ]);
    });

    it('js_heap_search maxResults has default 50', async () => {
      const tool = getToolByName(advancedBrowserToolDefinitions, 'js_heap_search');
      const prop = getSchemaProperty<Record<string, unknown>>(tool, 'maxResults');
      expect(prop.default).toBe(50);
    });

    it('js_heap_search caseSensitive has default false', async () => {
      const tool = getToolByName(advancedBrowserToolDefinitions, 'js_heap_search');
      const prop = getSchemaProperty<Record<string, unknown>>(tool, 'caseSensitive');
      expect(prop.default).toBe(false);
    });
  });

  // ── Required fields completeness ────────────────────────────

  describe('required fields completeness', () => {
    const allTools = [...browserTools, ...advancedBrowserToolDefinitions];

    it('every required field exists in properties', async () => {
      for (const tool of allTools) {
        const schema = getInputSchema(tool);
        if (schema.required) {
          for (const reqField of schema.required) {
            expect(
              schema.properties,
              `Tool "${tool.name}" requires "${reqField}" but it is missing from properties`,
            ).toHaveProperty(reqField);
          }
        }
      }
    });

    it('tools with required field declare a non-empty array', async () => {
      for (const tool of allTools) {
        const schema = getInputSchema(tool);
        if (schema.required) {
          expect(Array.isArray(schema.required)).toBe(true);
          expect(schema.required.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
