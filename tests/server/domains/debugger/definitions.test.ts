import { describe, it, expect } from 'vitest';
import { DEBUGGER_CORE_TOOLS } from '@server/domains/debugger/definitions.tools.core';
import { DEBUGGER_ADVANCED_TOOLS } from '@server/domains/debugger/definitions.tools.advanced';
import { debuggerTools } from '@server/domains/debugger/definitions.tools';

// Re-export through definitions.ts
import { debuggerTools as definitionsReExport } from '@server/domains/debugger/definitions';

describe('debugger tool definitions', () => {
  // ── Core tools structure ───────────────────────────────────

  describe('DEBUGGER_CORE_TOOLS', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(DEBUGGER_CORE_TOOLS)).toBe(true);
      expect(DEBUGGER_CORE_TOOLS.length).toBeGreaterThan(0);
    });

    it('contains the expected number of core tools', () => {
      // 22 core tools defined in definitions.tools.core.ts
      expect(DEBUGGER_CORE_TOOLS).toHaveLength(22);
    });

    it.each(DEBUGGER_CORE_TOOLS.map((tool) => [tool.name, tool]))(
      'tool "%s" has required structure',
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

    it('has unique tool names', () => {
      const names = DEBUGGER_CORE_TOOLS.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    const expectedCoreNames = [
      'debugger_enable',
      'debugger_disable',
      'debugger_pause',
      'debugger_resume',
      'debugger_step_into',
      'debugger_step_over',
      'debugger_step_out',
      'breakpoint_set',
      'breakpoint_remove',
      'breakpoint_list',
      'get_call_stack',
      'debugger_evaluate',
      'debugger_evaluate_global',
      'debugger_wait_for_paused',
      'debugger_get_paused_state',
      'breakpoint_set_on_exception',
      'get_object_properties',
      'get_scope_variables_enhanced',
      'debugger_save_session',
      'debugger_load_session',
      'debugger_export_session',
      'debugger_list_sessions',
    ];

    it.each(expectedCoreNames)('includes tool "%s"', (name) => {
      const found = DEBUGGER_CORE_TOOLS.find((t) => t.name === name);
      expect(found).toBeDefined();
    });
  });

  // ── Core tools: inputSchema validation ─────────────────────

  describe('core tool inputSchema validation', () => {
    it('breakpoint_set requires lineNumber', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'breakpoint_set')!;
      expect(tool.inputSchema.required).toContain('lineNumber');
      expect(tool.inputSchema.properties).toHaveProperty('url');
      expect(tool.inputSchema.properties).toHaveProperty('scriptId');
      expect(tool.inputSchema.properties).toHaveProperty('lineNumber');
      expect(tool.inputSchema.properties).toHaveProperty('columnNumber');
      expect(tool.inputSchema.properties).toHaveProperty('condition');
    });

    it('breakpoint_remove requires breakpointId', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'breakpoint_remove')!;
      expect(tool.inputSchema.required).toContain('breakpointId');
    });

    it('debugger_evaluate requires expression', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'debugger_evaluate')!;
      expect(tool.inputSchema.required).toContain('expression');
      expect(tool.inputSchema.properties).toHaveProperty('callFrameId');
    });

    it('debugger_evaluate_global requires expression', () => {
      const tool = DEBUGGER_CORE_TOOLS.find(
        (t) => t.name === 'debugger_evaluate_global',
      )!;
      expect(tool.inputSchema.required).toContain('expression');
    });

    it('breakpoint_set_on_exception requires state', () => {
      const tool = DEBUGGER_CORE_TOOLS.find(
        (t) => t.name === 'breakpoint_set_on_exception',
      )!;
      expect(tool.inputSchema.required).toContain('state');
      const stateProp = tool.inputSchema.properties!.state as Record<string, unknown>;
      expect(stateProp.enum).toEqual(['none', 'uncaught', 'all']);
    });

    it('get_object_properties requires objectId', () => {
      const tool = DEBUGGER_CORE_TOOLS.find(
        (t) => t.name === 'get_object_properties',
      )!;
      expect(tool.inputSchema.required).toContain('objectId');
    });

    it('debugger_wait_for_paused has optional timeout with default', () => {
      const tool = DEBUGGER_CORE_TOOLS.find(
        (t) => t.name === 'debugger_wait_for_paused',
      )!;
      expect(tool.inputSchema.required).toBeUndefined();
      const timeoutProp = tool.inputSchema.properties!.timeout as Record<string, unknown>;
      expect(timeoutProp.type).toBe('number');
      expect(timeoutProp.default).toBe(30000);
    });

    it('get_scope_variables_enhanced has optional properties with defaults', () => {
      const tool = DEBUGGER_CORE_TOOLS.find(
        (t) => t.name === 'get_scope_variables_enhanced',
      )!;
      expect(tool.inputSchema.required).toBeUndefined();
      const props = tool.inputSchema.properties!;
      expect(props).toHaveProperty('callFrameId');
      expect(props).toHaveProperty('includeObjectProperties');
      expect(props).toHaveProperty('maxDepth');
      expect(props).toHaveProperty('skipErrors');
      expect((props.includeObjectProperties as Record<string, unknown>).default).toBe(false);
      expect((props.maxDepth as Record<string, unknown>).default).toBe(1);
      expect((props.skipErrors as Record<string, unknown>).default).toBe(true);
    });

    const noArgTools = [
      'debugger_enable',
      'debugger_disable',
      'debugger_pause',
      'debugger_resume',
      'debugger_step_into',
      'debugger_step_over',
      'debugger_step_out',
      'breakpoint_list',
      'get_call_stack',
      'debugger_get_paused_state',
      'debugger_list_sessions',
    ];

    it.each(noArgTools)('"%s" has no required properties', (name) => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === name)!;
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('debugger_save_session has optional filePath and metadata', () => {
      const tool = DEBUGGER_CORE_TOOLS.find(
        (t) => t.name === 'debugger_save_session',
      )!;
      expect(tool.inputSchema.required).toBeUndefined();
      expect(tool.inputSchema.properties).toHaveProperty('filePath');
      expect(tool.inputSchema.properties).toHaveProperty('metadata');
    });

    it('debugger_load_session has optional filePath and sessionData', () => {
      const tool = DEBUGGER_CORE_TOOLS.find(
        (t) => t.name === 'debugger_load_session',
      )!;
      expect(tool.inputSchema.required).toBeUndefined();
      expect(tool.inputSchema.properties).toHaveProperty('filePath');
      expect(tool.inputSchema.properties).toHaveProperty('sessionData');
    });

    it('debugger_export_session has optional metadata', () => {
      const tool = DEBUGGER_CORE_TOOLS.find(
        (t) => t.name === 'debugger_export_session',
      )!;
      expect(tool.inputSchema.required).toBeUndefined();
      expect(tool.inputSchema.properties).toHaveProperty('metadata');
    });
  });

  // ── Advanced tools structure ───────────────────────────────

  describe('DEBUGGER_ADVANCED_TOOLS', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(DEBUGGER_ADVANCED_TOOLS)).toBe(true);
      expect(DEBUGGER_ADVANCED_TOOLS.length).toBeGreaterThan(0);
    });

    it('contains the expected number of advanced tools', () => {
      // 15 advanced tools defined in definitions.tools.advanced.ts
      expect(DEBUGGER_ADVANCED_TOOLS).toHaveLength(15);
    });

    it.each(DEBUGGER_ADVANCED_TOOLS.map((tool) => [tool.name, tool]))(
      'tool "%s" has required structure',
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

    it('has unique tool names', () => {
      const names = DEBUGGER_ADVANCED_TOOLS.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    const expectedAdvancedNames = [
      'watch_add',
      'watch_remove',
      'watch_list',
      'watch_evaluate_all',
      'watch_clear_all',
      'xhr_breakpoint_set',
      'xhr_breakpoint_remove',
      'xhr_breakpoint_list',
      'event_breakpoint_set',
      'event_breakpoint_set_category',
      'event_breakpoint_remove',
      'event_breakpoint_list',
      'blackbox_add',
      'blackbox_add_common',
      'blackbox_list',
    ];

    it.each(expectedAdvancedNames)('includes tool "%s"', (name) => {
      const found = DEBUGGER_ADVANCED_TOOLS.find((t) => t.name === name);
      expect(found).toBeDefined();
    });
  });

  // ── Advanced tools: inputSchema validation ─────────────────

  describe('advanced tool inputSchema validation', () => {
    it('watch_add requires expression', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find((t) => t.name === 'watch_add')!;
      expect(tool.inputSchema.required).toContain('expression');
      expect(tool.inputSchema.properties).toHaveProperty('expression');
      expect(tool.inputSchema.properties).toHaveProperty('name');
    });

    it('watch_remove requires watchId', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find((t) => t.name === 'watch_remove')!;
      expect(tool.inputSchema.required).toContain('watchId');
    });

    it('xhr_breakpoint_set requires urlPattern', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find(
        (t) => t.name === 'xhr_breakpoint_set',
      )!;
      expect(tool.inputSchema.required).toContain('urlPattern');
    });

    it('xhr_breakpoint_remove requires breakpointId', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find(
        (t) => t.name === 'xhr_breakpoint_remove',
      )!;
      expect(tool.inputSchema.required).toContain('breakpointId');
    });

    it('event_breakpoint_set requires eventName', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find(
        (t) => t.name === 'event_breakpoint_set',
      )!;
      expect(tool.inputSchema.required).toContain('eventName');
      expect(tool.inputSchema.properties).toHaveProperty('targetName');
    });

    it('event_breakpoint_set_category requires category with enum', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find(
        (t) => t.name === 'event_breakpoint_set_category',
      )!;
      expect(tool.inputSchema.required).toContain('category');
      const categoryProp = tool.inputSchema.properties!.category as Record<string, unknown>;
      expect(categoryProp.enum).toEqual(['mouse', 'keyboard', 'timer', 'websocket']);
    });

    it('event_breakpoint_remove requires breakpointId', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find(
        (t) => t.name === 'event_breakpoint_remove',
      )!;
      expect(tool.inputSchema.required).toContain('breakpointId');
    });

    it('blackbox_add requires urlPattern', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find((t) => t.name === 'blackbox_add')!;
      expect(tool.inputSchema.required).toContain('urlPattern');
    });

    const noArgAdvancedTools = [
      'watch_list',
      'watch_clear_all',
      'xhr_breakpoint_list',
      'event_breakpoint_list',
      'blackbox_add_common',
      'blackbox_list',
    ];

    it.each(noArgAdvancedTools)('"%s" has no required properties', (name) => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find((t) => t.name === name)!;
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('watch_evaluate_all has optional callFrameId', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find(
        (t) => t.name === 'watch_evaluate_all',
      )!;
      expect(tool.inputSchema.required).toBeUndefined();
      expect(tool.inputSchema.properties).toHaveProperty('callFrameId');
    });
  });

  // ── Combined debuggerTools ─────────────────────────────────

  describe('debuggerTools (combined)', () => {
    it('merges core and advanced tools', () => {
      expect(debuggerTools).toEqual([
        ...DEBUGGER_CORE_TOOLS,
        ...DEBUGGER_ADVANCED_TOOLS,
      ]);
    });

    it('has correct total count', () => {
      expect(debuggerTools).toHaveLength(
        DEBUGGER_CORE_TOOLS.length + DEBUGGER_ADVANCED_TOOLS.length,
      );
    });

    it('has all unique names across both arrays', () => {
      const names = debuggerTools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('every tool has a non-empty description', () => {
      for (const tool of debuggerTools) {
        expect(tool.description.trim().length).toBeGreaterThan(0);
      }
    });

    it('every tool inputSchema.type is "object"', () => {
      for (const tool of debuggerTools) {
        expect(tool.inputSchema.type).toBe('object');
      }
    });
  });

  // ── Re-export ──────────────────────────────────────────────

  describe('definitions.ts re-export', () => {
    it('re-exports debuggerTools from definitions.tools', () => {
      expect(definitionsReExport).toBe(debuggerTools);
    });
  });

  // ── Description quality ────────────────────────────────────

  describe('tool description quality', () => {
    it('breakpoint_set description mentions URL and conditions', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'breakpoint_set')!;
      expect(tool.description).toContain('breakpoint');
      expect(tool.description).toContain('condition');
    });

    it('get_scope_variables_enhanced description mentions improvements', () => {
      const tool = DEBUGGER_CORE_TOOLS.find(
        (t) => t.name === 'get_scope_variables_enhanced',
      )!;
      expect(tool.description).toContain('Enhanced');
      expect(tool.description).toContain('depth');
    });

    it('debugger_save_session description mentions JSON', () => {
      const tool = DEBUGGER_CORE_TOOLS.find(
        (t) => t.name === 'debugger_save_session',
      )!;
      expect(tool.description).toContain('JSON');
      expect(tool.description).toContain('breakpoints');
    });

    it('blackbox_add_common description mentions common libraries', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find(
        (t) => t.name === 'blackbox_add_common',
      )!;
      expect(tool.description).toContain('jquery');
      expect(tool.description).toContain('react');
    });

    it('event_breakpoint_set description lists event types', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find(
        (t) => t.name === 'event_breakpoint_set',
      )!;
      expect(tool.description).toContain('click');
      expect(tool.description).toContain('setTimeout');
    });

    it('xhr_breakpoint_set description mentions wildcard patterns', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find(
        (t) => t.name === 'xhr_breakpoint_set',
      )!;
      expect(tool.description).toContain('wildcard');
    });
  });

  // ── Property type validation ───────────────────────────────

  describe('property type declarations', () => {
    it('breakpoint_set lineNumber is type number', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'breakpoint_set')!;
      const prop = tool.inputSchema.properties!.lineNumber as Record<string, unknown>;
      expect(prop.type).toBe('number');
    });

    it('breakpoint_set columnNumber is type number', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'breakpoint_set')!;
      const prop = tool.inputSchema.properties!.columnNumber as Record<string, unknown>;
      expect(prop.type).toBe('number');
    });

    it('breakpoint_set condition is type string', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'breakpoint_set')!;
      const prop = tool.inputSchema.properties!.condition as Record<string, unknown>;
      expect(prop.type).toBe('string');
    });

    it('get_scope_variables_enhanced maxDepth is type number', () => {
      const tool = DEBUGGER_CORE_TOOLS.find(
        (t) => t.name === 'get_scope_variables_enhanced',
      )!;
      const prop = tool.inputSchema.properties!.maxDepth as Record<string, unknown>;
      expect(prop.type).toBe('number');
    });

    it('get_scope_variables_enhanced skipErrors is type boolean', () => {
      const tool = DEBUGGER_CORE_TOOLS.find(
        (t) => t.name === 'get_scope_variables_enhanced',
      )!;
      const prop = tool.inputSchema.properties!.skipErrors as Record<string, unknown>;
      expect(prop.type).toBe('boolean');
    });

    it('watch_add expression is type string', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find((t) => t.name === 'watch_add')!;
      const prop = tool.inputSchema.properties!.expression as Record<string, unknown>;
      expect(prop.type).toBe('string');
    });
  });
});
