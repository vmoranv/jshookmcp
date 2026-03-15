import { describe, it, expect } from 'vitest';
import { browserTools, advancedBrowserToolDefinitions } from '@server/domains/browser/definitions.tools';
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

describe('browser tool definitions', () => {
  // ── browserTools composite ──────────────────────────────────

  describe('browserTools (composite)', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(browserTools)).toBe(true);
      expect(browserTools.length).toBeGreaterThan(0);
    });

    it('contains all sub-array tools merged together', () => {
      const expected =
        browserRuntimeTools.length +
        browserPageCoreTools.length +
        browserPageSystemTools.length +
        browserSecurityStateTools.length +
        behaviorTools.length;
      expect(browserTools).toHaveLength(expected);
    });

    it('has unique tool names', () => {
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

    it('every tool has a non-empty description', () => {
      for (const tool of browserTools) {
        expect(tool.description.trim().length).toBeGreaterThan(0);
      }
    });

    it('every tool inputSchema.type is "object"', () => {
      for (const tool of browserTools) {
        expect(tool.inputSchema.type).toBe('object');
      }
    });
  });

  // ── advancedBrowserToolDefinitions ──────────────────────────

  describe('advancedBrowserToolDefinitions', () => {
    it('is a non-empty array', () => {
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

    it('has unique names', () => {
      const names = advancedBrowserToolDefinitions.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('includes js_heap_search', () => {
      expect(advancedBrowserToolDefinitions.find((t) => t.name === 'js_heap_search')).toBeDefined();
    });

    it('includes tab_workflow', () => {
      expect(advancedBrowserToolDefinitions.find((t) => t.name === 'tab_workflow')).toBeDefined();
    });
  });

  // ── No name collisions between standard and advanced ────────

  describe('cross-array uniqueness', () => {
    it('no name collisions between browserTools and advancedBrowserToolDefinitions', () => {
      const standardNames = new Set(browserTools.map((t) => t.name));
      const advancedNames = advancedBrowserToolDefinitions.map((t) => t.name);
      for (const name of advancedNames) {
        expect(standardNames.has(name)).toBe(false);
      }
    });
  });

  // ── definitions.ts re-exports ───────────────────────────────

  describe('definitions.ts re-exports', () => {
    it('re-exports browserTools from definitions.tools', () => {
      expect(definitionsReExport).toBe(browserTools);
    });

    it('re-exports advancedBrowserToolDefinitions from definitions.tools', () => {
      expect(advancedReExport).toBe(advancedBrowserToolDefinitions);
    });
  });

  // ── Runtime tools ───────────────────────────────────────────

  describe('browserRuntimeTools', () => {
    const expectedNames = [
      'get_detailed_data',
      'browser_launch',
      'camoufox_server_launch',
      'camoufox_server_close',
      'camoufox_server_status',
      'browser_attach',
      'browser_close',
      'browser_status',
    ];

    it.each(expectedNames)('includes tool "%s"', (name) => {
      expect(browserRuntimeTools.find((t) => t.name === name)).toBeDefined();
    });

    it('get_detailed_data requires detailId', () => {
      const tool = browserRuntimeTools.find((t) => t.name === 'get_detailed_data')!;
      expect(tool.inputSchema.required).toContain('detailId');
      expect(tool.inputSchema.properties).toHaveProperty('path');
    });

    it('browser_launch has driver enum with chrome and camoufox', () => {
      const tool = browserRuntimeTools.find((t) => t.name === 'browser_launch')!;
      const driverProp = tool.inputSchema.properties!.driver as Record<string, unknown>;
      expect(driverProp.enum).toEqual(['chrome', 'camoufox']);
    });

    it('browser_attach has browserURL and wsEndpoint properties', () => {
      const tool = browserRuntimeTools.find((t) => t.name === 'browser_attach')!;
      expect(tool.inputSchema.properties).toHaveProperty('browserURL');
      expect(tool.inputSchema.properties).toHaveProperty('wsEndpoint');
      expect(tool.inputSchema.properties).toHaveProperty('pageIndex');
    });

    it('browser_close and browser_status have no required properties', () => {
      const closeTool = browserRuntimeTools.find((t) => t.name === 'browser_close')!;
      const statusTool = browserRuntimeTools.find((t) => t.name === 'browser_status')!;
      expect(closeTool.inputSchema.required).toBeUndefined();
      expect(statusTool.inputSchema.required).toBeUndefined();
    });
  });

  // ── Page core tools ─────────────────────────────────────────

  describe('browserPageCoreTools', () => {
    it('page_navigate requires url', () => {
      const tool = browserPageCoreTools.find((t) => t.name === 'page_navigate')!;
      expect(tool.inputSchema.required).toContain('url');
    });

    it('page_navigate has waitUntil enum', () => {
      const tool = browserPageCoreTools.find((t) => t.name === 'page_navigate')!;
      const prop = tool.inputSchema.properties!.waitUntil as Record<string, unknown>;
      expect(prop.enum).toEqual(['load', 'domcontentloaded', 'networkidle', 'commit']);
    });

    it('page_navigate has enableNetworkMonitoring boolean', () => {
      const tool = browserPageCoreTools.find((t) => t.name === 'page_navigate')!;
      const prop = tool.inputSchema.properties!.enableNetworkMonitoring as Record<string, unknown>;
      expect(prop.type).toBe('boolean');
      expect(prop.default).toBe(false);
    });

    const noArgPageTools = ['page_reload', 'page_back', 'page_forward'];
    it.each(noArgPageTools)('%s has no required properties', (name) => {
      const tool = browserPageCoreTools.find((t) => t.name === name)!;
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('dom_query_selector requires selector', () => {
      const tool = browserPageCoreTools.find((t) => t.name === 'dom_query_selector')!;
      expect(tool.inputSchema.required).toContain('selector');
    });

    it('dom_query_all requires selector', () => {
      const tool = browserPageCoreTools.find((t) => t.name === 'dom_query_all')!;
      expect(tool.inputSchema.required).toContain('selector');
    });

    it('page_click requires selector', () => {
      const tool = browserPageCoreTools.find((t) => t.name === 'page_click')!;
      expect(tool.inputSchema.required).toContain('selector');
      const buttonProp = tool.inputSchema.properties!.button as Record<string, unknown>;
      expect(buttonProp.enum).toEqual(['left', 'right', 'middle']);
    });

    it('page_type requires selector and text', () => {
      const tool = browserPageCoreTools.find((t) => t.name === 'page_type')!;
      expect(tool.inputSchema.required).toContain('selector');
      expect(tool.inputSchema.required).toContain('text');
    });

    it('page_select requires selector and values', () => {
      const tool = browserPageCoreTools.find((t) => t.name === 'page_select')!;
      expect(tool.inputSchema.required).toContain('selector');
      expect(tool.inputSchema.required).toContain('values');
    });

    it('page_evaluate requires code', () => {
      const tool = browserPageCoreTools.find((t) => t.name === 'page_evaluate')!;
      expect(tool.inputSchema.required).toContain('code');
    });

    it('page_wait_for_selector requires selector', () => {
      const tool = browserPageCoreTools.find((t) => t.name === 'page_wait_for_selector')!;
      expect(tool.inputSchema.required).toContain('selector');
    });
  });

  // ── Page system tools ───────────────────────────────────────

  describe('browserPageSystemTools', () => {
    it('console_execute requires expression', () => {
      const tool = browserPageSystemTools.find((t) => t.name === 'console_execute')!;
      expect(tool.inputSchema.required).toContain('expression');
    });

    it('console_get_logs has optional type enum', () => {
      const tool = browserPageSystemTools.find((t) => t.name === 'console_get_logs')!;
      const typeProp = tool.inputSchema.properties!.type as Record<string, unknown>;
      expect(typeProp.enum).toEqual(['log', 'warn', 'error', 'info', 'debug']);
    });

    it('page_set_viewport requires width and height', () => {
      const tool = browserPageSystemTools.find((t) => t.name === 'page_set_viewport')!;
      expect(tool.inputSchema.required).toContain('width');
      expect(tool.inputSchema.required).toContain('height');
    });

    it('page_emulate_device requires device', () => {
      const tool = browserPageSystemTools.find((t) => t.name === 'page_emulate_device')!;
      expect(tool.inputSchema.required).toContain('device');
    });

    it('page_set_cookies requires cookies', () => {
      const tool = browserPageSystemTools.find((t) => t.name === 'page_set_cookies')!;
      expect(tool.inputSchema.required).toContain('cookies');
    });

    it('page_set_local_storage requires key and value', () => {
      const tool = browserPageSystemTools.find((t) => t.name === 'page_set_local_storage')!;
      expect(tool.inputSchema.required).toContain('key');
      expect(tool.inputSchema.required).toContain('value');
    });

    it('page_press_key requires key', () => {
      const tool = browserPageSystemTools.find((t) => t.name === 'page_press_key')!;
      expect(tool.inputSchema.required).toContain('key');
    });

    it('dom_get_computed_style requires selector', () => {
      const tool = browserPageSystemTools.find((t) => t.name === 'dom_get_computed_style')!;
      expect(tool.inputSchema.required).toContain('selector');
    });

    it('dom_find_by_text requires text', () => {
      const tool = browserPageSystemTools.find((t) => t.name === 'dom_find_by_text')!;
      expect(tool.inputSchema.required).toContain('text');
    });

    it('dom_get_xpath requires selector', () => {
      const tool = browserPageSystemTools.find((t) => t.name === 'dom_get_xpath')!;
      expect(tool.inputSchema.required).toContain('selector');
    });

    it('dom_is_in_viewport requires selector', () => {
      const tool = browserPageSystemTools.find((t) => t.name === 'dom_is_in_viewport')!;
      expect(tool.inputSchema.required).toContain('selector');
    });

    it('page_inject_script requires script', () => {
      const tool = browserPageSystemTools.find((t) => t.name === 'page_inject_script')!;
      expect(tool.inputSchema.required).toContain('script');
    });

    const noArgSystemTools = [
      'console_enable',
      'page_get_performance',
      'page_get_cookies',
      'page_clear_cookies',
      'page_get_local_storage',
      'page_get_all_links',
    ];

    it.each(noArgSystemTools)('%s has no required properties', (name) => {
      const tool = browserPageSystemTools.find((t) => t.name === name)!;
      expect(tool.inputSchema.required).toBeUndefined();
    });
  });

  // ── Security state tools ────────────────────────────────────

  describe('browserSecurityStateTools', () => {
    it('captcha_detect has no required properties', () => {
      const tool = browserSecurityStateTools.find((t) => t.name === 'captcha_detect')!;
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('stealth_inject has no required properties', () => {
      const tool = browserSecurityStateTools.find((t) => t.name === 'stealth_inject')!;
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('stealth_set_user_agent has platform enum', () => {
      const tool = browserSecurityStateTools.find((t) => t.name === 'stealth_set_user_agent')!;
      const prop = tool.inputSchema.properties!.platform as Record<string, unknown>;
      expect(prop.enum).toEqual(['windows', 'mac', 'linux']);
    });

    it('browser_select_tab has index, urlPattern, and titlePattern', () => {
      const tool = browserSecurityStateTools.find((t) => t.name === 'browser_select_tab')!;
      expect(tool.inputSchema.properties).toHaveProperty('index');
      expect(tool.inputSchema.properties).toHaveProperty('urlPattern');
      expect(tool.inputSchema.properties).toHaveProperty('titlePattern');
    });

    it('framework_state_extract has framework enum', () => {
      const tool = browserSecurityStateTools.find((t) => t.name === 'framework_state_extract')!;
      const prop = tool.inputSchema.properties!.framework as Record<string, unknown>;
      expect(prop.enum).toEqual(['auto', 'react', 'vue2', 'vue3']);
    });

    it('indexeddb_dump has optional database, store, and maxRecords', () => {
      const tool = browserSecurityStateTools.find((t) => t.name === 'indexeddb_dump')!;
      expect(tool.inputSchema.properties).toHaveProperty('database');
      expect(tool.inputSchema.properties).toHaveProperty('store');
      expect(tool.inputSchema.properties).toHaveProperty('maxRecords');
      expect(tool.inputSchema.required).toBeUndefined();
    });
  });

  // ── Behavior tools ──────────────────────────────────────────

  describe('behaviorTools', () => {
    it('has exactly 5 behavior tools', () => {
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

    it('human_typing requires selector and text', () => {
      const tool = behaviorTools.find((t) => t.name === 'human_typing')!;
      expect(tool.inputSchema.required).toContain('selector');
      expect(tool.inputSchema.required).toContain('text');
    });

    it('human_mouse has no required properties', () => {
      const tool = behaviorTools.find((t) => t.name === 'human_mouse')!;
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('human_scroll has no required properties', () => {
      const tool = behaviorTools.find((t) => t.name === 'human_scroll')!;
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('captcha_vision_solve has mode enum', () => {
      const tool = behaviorTools.find((t) => t.name === 'captcha_vision_solve')!;
      const modeProp = tool.inputSchema.properties!.mode as Record<string, unknown>;
      expect(modeProp.enum).toEqual(['external_service', 'manual']);
    });

    it('captcha_vision_solve has challengeType enum', () => {
      const tool = behaviorTools.find((t) => t.name === 'captcha_vision_solve')!;
      const prop = tool.inputSchema.properties!.challengeType as Record<string, unknown>;
      expect(prop.enum).toEqual(['image', 'widget', 'browser_check', 'auto']);
      expect(prop.default).toBe('auto');
    });

    it('widget_challenge_solve has mode enum with three options', () => {
      const tool = behaviorTools.find((t) => t.name === 'widget_challenge_solve')!;
      const modeProp = tool.inputSchema.properties!.mode as Record<string, unknown>;
      expect(modeProp.enum).toEqual(['external_service', 'hook', 'manual']);
    });

    it('widget_challenge_solve has injectToken boolean with default true', () => {
      const tool = behaviorTools.find((t) => t.name === 'widget_challenge_solve')!;
      const prop = tool.inputSchema.properties!.injectToken as Record<string, unknown>;
      expect(prop.type).toBe('boolean');
      expect(prop.default).toBe(true);
    });
  });

  // ── Advanced tool inputSchema ───────────────────────────────

  describe('advanced tool inputSchema', () => {
    it('js_heap_search requires pattern', () => {
      const tool = advancedBrowserToolDefinitions.find((t) => t.name === 'js_heap_search')!;
      expect(tool.inputSchema.required).toContain('pattern');
      expect(tool.inputSchema.properties).toHaveProperty('maxResults');
      expect(tool.inputSchema.properties).toHaveProperty('caseSensitive');
    });

    it('tab_workflow requires action', () => {
      const tool = advancedBrowserToolDefinitions.find((t) => t.name === 'tab_workflow')!;
      expect(tool.inputSchema.required).toContain('action');
    });

    it('tab_workflow action has correct enum', () => {
      const tool = advancedBrowserToolDefinitions.find((t) => t.name === 'tab_workflow')!;
      const actionProp = tool.inputSchema.properties!.action as Record<string, unknown>;
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

    it('js_heap_search maxResults has default 50', () => {
      const tool = advancedBrowserToolDefinitions.find((t) => t.name === 'js_heap_search')!;
      const prop = tool.inputSchema.properties!.maxResults as Record<string, unknown>;
      expect(prop.default).toBe(50);
    });

    it('js_heap_search caseSensitive has default false', () => {
      const tool = advancedBrowserToolDefinitions.find((t) => t.name === 'js_heap_search')!;
      const prop = tool.inputSchema.properties!.caseSensitive as Record<string, unknown>;
      expect(prop.default).toBe(false);
    });
  });

  // ── Required fields completeness ────────────────────────────

  describe('required fields completeness', () => {
    const allTools = [...browserTools, ...advancedBrowserToolDefinitions];

    it('every required field exists in properties', () => {
      for (const tool of allTools) {
        if (tool.inputSchema.required) {
          for (const reqField of tool.inputSchema.required) {
            expect(
              tool.inputSchema.properties,
              `Tool "${tool.name}" requires "${reqField}" but it is missing from properties`,
            ).toHaveProperty(reqField);
          }
        }
      }
    });

    it('tools with required field declare a non-empty array', () => {
      for (const tool of allTools) {
        if (tool.inputSchema.required) {
          expect(Array.isArray(tool.inputSchema.required)).toBe(true);
          expect(tool.inputSchema.required!.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
