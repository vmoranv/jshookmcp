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
      // 12 core tools defined in definitions.tools.core.ts
      expect(DEBUGGER_CORE_TOOLS).toHaveLength(12);
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
      'debugger_lifecycle',
      'debugger_pause',
      'debugger_resume',
      'debugger_step',
      'breakpoint',
      'get_call_stack',
      'debugger_evaluate',
      'debugger_wait_for_paused',
      'debugger_get_paused_state',
      'get_object_properties',
      'get_scope_variables_enhanced',
      'debugger_session',
    ];

    it.each(expectedCoreNames)('includes tool "%s"', (name) => {
      const found = DEBUGGER_CORE_TOOLS.find((t) => t.name === name);
      expect(found).toBeDefined();
    });
  });

  // ── Core tools: inputSchema validation ─────────────────────

  describe('core tool inputSchema validation', () => {
    it('breakpoint requires action', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'breakpoint')!;
      expect(tool.inputSchema.required).toContain('action');
      expect(tool.inputSchema.properties).toHaveProperty('action');
      expect(tool.inputSchema.properties).toHaveProperty('type');
      expect(tool.inputSchema.properties).toHaveProperty('lineNumber');
      expect(tool.inputSchema.properties).toHaveProperty('scriptId');
      expect(tool.inputSchema.properties).toHaveProperty('columnNumber');
      expect(tool.inputSchema.properties).toHaveProperty('condition');
      expect(tool.inputSchema.properties).toHaveProperty('urlPattern');
      expect(tool.inputSchema.properties).toHaveProperty('eventName');
      expect(tool.inputSchema.properties).toHaveProperty('targetName');
      expect(tool.inputSchema.properties).toHaveProperty('category');
      expect(tool.inputSchema.properties).toHaveProperty('state');
      expect(tool.inputSchema.properties).toHaveProperty('breakpointId');
    });

    it('breakpoint has type enum with all consolidated types', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'breakpoint')!;
      const typeProp = tool.inputSchema.properties!.type as Record<string, unknown>;
      expect(typeProp.enum).toEqual(['code', 'xhr', 'event', 'event_category', 'exception']);
    });

    it('breakpoint has action enum', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'breakpoint')!;
      const actionProp = tool.inputSchema.properties!.action as Record<string, unknown>;
      expect(actionProp.enum).toEqual(['set', 'remove', 'list']);
    });

    it('debugger_evaluate requires expression', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'debugger_evaluate')!;
      expect(tool.inputSchema.required).toContain('expression');
      expect(tool.inputSchema.properties).toHaveProperty('callFrameId');
      expect(tool.inputSchema.properties).toHaveProperty('context');
    });

    it('breakpoint has exception state enum', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'breakpoint')!;
      const stateProp = tool.inputSchema.properties!.state as Record<string, unknown>;
      expect(stateProp.enum).toEqual(['none', 'uncaught', 'all']);
    });

    it('get_object_properties requires objectId', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'get_object_properties')!;
      expect(tool.inputSchema.required).toContain('objectId');
    });

    it('debugger_wait_for_paused has optional timeout with default', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'debugger_wait_for_paused')!;
      expect(tool.inputSchema.required).toBeUndefined();
      const timeoutProp = tool.inputSchema.properties!.timeout as Record<string, unknown>;
      expect(timeoutProp.type).toBe('number');
      expect(timeoutProp.default).toBe(30000);
    });

    it('get_scope_variables_enhanced has optional properties with defaults', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'get_scope_variables_enhanced')!;
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
      'debugger_pause',
      'debugger_resume',
      'get_call_stack',
      'debugger_get_paused_state',
    ];

    it.each(noArgTools)('"%s" has no required properties', (name) => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === name)!;
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('debugger_session has action and optional properties', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'debugger_session')!;
      expect(tool.inputSchema.required).toContain('action');
      expect(tool.inputSchema.properties).toHaveProperty('filePath');
      expect(tool.inputSchema.properties).toHaveProperty('sessionData');
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
      // 4 advanced tools defined in definitions.tools.advanced.ts
      expect(DEBUGGER_ADVANCED_TOOLS).toHaveLength(4);
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

    const expectedAdvancedNames = ['watch', 'blackbox_add', 'blackbox_add_common', 'blackbox_list'];

    it.each(expectedAdvancedNames)('includes tool "%s"', (name) => {
      const found = DEBUGGER_ADVANCED_TOOLS.find((t) => t.name === name);
      expect(found).toBeDefined();
    });
  });

  // ── Advanced tools: inputSchema validation ─────────────────

  describe('advanced tool inputSchema validation', () => {
    it('watch requires action', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find((t) => t.name === 'watch')!;
      expect(tool.inputSchema.required).toContain('action');
      expect(tool.inputSchema.properties).toHaveProperty('action');
      expect(tool.inputSchema.properties).toHaveProperty('expression');
      expect(tool.inputSchema.properties).toHaveProperty('name');
      expect(tool.inputSchema.properties).toHaveProperty('watchId');
      expect(tool.inputSchema.properties).toHaveProperty('callFrameId');
    });

    it('watch has action enum with all consolidated actions', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find((t) => t.name === 'watch')!;
      const actionProp = tool.inputSchema.properties!.action as Record<string, unknown>;
      expect(actionProp.enum).toEqual(['add', 'remove', 'list', 'evaluate_all', 'clear_all']);
    });

    it('blackbox_add requires urlPattern', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find((t) => t.name === 'blackbox_add')!;
      expect(tool.inputSchema.required).toContain('urlPattern');
    });

    const noArgAdvancedTools = ['blackbox_add_common', 'blackbox_list'];

    it.each(noArgAdvancedTools)('"%s" has no required properties', (name) => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find((t) => t.name === name)!;
      expect(tool.inputSchema.required).toBeUndefined();
    });
  });

  // ── Combined debuggerTools ─────────────────────────────────

  describe('debuggerTools (combined)', () => {
    it('merges core and advanced tools', () => {
      expect(debuggerTools).toEqual([...DEBUGGER_CORE_TOOLS, ...DEBUGGER_ADVANCED_TOOLS]);
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
        const description = tool.description ?? '';
        expect(description.trim().length).toBeGreaterThan(0);
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

  // ── Property type validation ───────────────────────────────

  describe('property type declarations', () => {
    it('breakpoint lineNumber is type number', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'breakpoint')!;
      const prop = tool.inputSchema.properties!.lineNumber as Record<string, unknown>;
      expect(prop.type).toBe('number');
    });

    it('breakpoint columnNumber is type number', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'breakpoint')!;
      const prop = tool.inputSchema.properties!.columnNumber as Record<string, unknown>;
      expect(prop.type).toBe('number');
    });

    it('breakpoint condition is type string', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'breakpoint')!;
      const prop = tool.inputSchema.properties!.condition as Record<string, unknown>;
      expect(prop.type).toBe('string');
    });

    it('get_scope_variables_enhanced maxDepth is type number', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'get_scope_variables_enhanced')!;
      const prop = tool.inputSchema.properties!.maxDepth as Record<string, unknown>;
      expect(prop.type).toBe('number');
    });

    it('get_scope_variables_enhanced skipErrors is type boolean', () => {
      const tool = DEBUGGER_CORE_TOOLS.find((t) => t.name === 'get_scope_variables_enhanced')!;
      const prop = tool.inputSchema.properties!.skipErrors as Record<string, unknown>;
      expect(prop.type).toBe('boolean');
    });

    it('watch expression is type string', () => {
      const tool = DEBUGGER_ADVANCED_TOOLS.find((t) => t.name === 'watch')!;
      const prop = tool.inputSchema.properties!.expression as Record<string, unknown>;
      expect(prop.type).toBe('string');
    });
  });
});
