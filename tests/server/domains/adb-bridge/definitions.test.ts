import { describe, expect, it } from 'vitest';
import { adbBridgeTools } from '@server/domains/adb-bridge/definitions';

type ADBBridgeTool = (typeof adbBridgeTools)[number];

function getTool(name: string): ADBBridgeTool {
  const tool = adbBridgeTools.find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

function getToolProperty(toolName: string, propertyName: string): Record<string, unknown> {
  const tool = getTool(toolName);
  const property = tool.inputSchema.properties?.[propertyName];
  expect(property).toBeDefined();
  return property as Record<string, unknown>;
}

describe('adb-bridge tool definitions', () => {
  describe('adbBridgeTools array', () => {
    it('is a non-empty array', async () => {
      expect(Array.isArray(adbBridgeTools)).toBe(true);
      expect(adbBridgeTools.length).toBeGreaterThan(0);
    });

    it('tool count matches expected (3 tools)', async () => {
      expect(adbBridgeTools.length).toBe(3);
    });

    it('has unique tool names', async () => {
      const names = adbBridgeTools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it.each(adbBridgeTools.map((tool) => [tool.name, tool]))(
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
      for (const tool of adbBridgeTools) {
        expect(tool.description?.trim().length ?? 0).toBeGreaterThan(0);
      }
    });

    it('every tool inputSchema.type is "object"', async () => {
      for (const tool of adbBridgeTools) {
        expect(tool.inputSchema.type).toBe('object');
      }
    });
  });

  describe('expected tool names', () => {
    const expectedNames = ['adb_apk_analyze', 'adb_webview_list', 'adb_webview_attach'];

    it.each(expectedNames)('includes tool "%s"', (name) => {
      const found = adbBridgeTools.find((tool) => tool.name === name);
      expect(found).toBeDefined();
    });
  });

  describe('adb_apk_analyze', () => {
    it('requires serial and packageName', async () => {
      const tool = getTool('adb_apk_analyze');
      expect(tool.inputSchema.required ?? []).toContain('serial');
      expect(tool.inputSchema.required ?? []).toContain('packageName');
    });

    it('serial and packageName are type string', async () => {
      expect(getToolProperty('adb_apk_analyze', 'serial').type).toBe('string');
      expect(getToolProperty('adb_apk_analyze', 'packageName').type).toBe('string');
    });
  });

  describe('adb_webview_list', () => {
    it('requires serial', async () => {
      const tool = getTool('adb_webview_list');
      expect(tool.inputSchema.required ?? []).toContain('serial');
    });

    it('has optional hostPort with default', async () => {
      const prop = getToolProperty('adb_webview_list', 'hostPort');
      expect(prop.type).toBe('number');
      expect(prop.default).toBe(9222);
    });
  });

  describe('adb_webview_attach', () => {
    it('requires serial and targetId', async () => {
      const tool = getTool('adb_webview_attach');
      expect(tool.inputSchema.required ?? []).toContain('serial');
      expect(tool.inputSchema.required ?? []).toContain('targetId');
    });

    it('has optional hostPort with default', async () => {
      const prop = getToolProperty('adb_webview_attach', 'hostPort');
      expect(prop.type).toBe('number');
      expect(prop.default).toBe(9222);
    });
  });

  describe('required fields completeness', () => {
    it('tools with required field declare an array', async () => {
      for (const tool of adbBridgeTools) {
        if (tool.inputSchema.required) {
          expect(Array.isArray(tool.inputSchema.required)).toBe(true);
          expect(tool.inputSchema.required!.length).toBeGreaterThan(0);
        }
      }
    });

    it('every required field exists in properties', async () => {
      for (const tool of adbBridgeTools) {
        if (tool.inputSchema.required) {
          for (const reqField of tool.inputSchema.required) {
            expect(tool.inputSchema.properties).toHaveProperty(reqField);
          }
        }
      }
    });
  });
});
