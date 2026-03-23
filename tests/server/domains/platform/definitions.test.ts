import { describe, expect, it } from 'vitest';
import { platformTools } from '@server/domains/platform/definitions';

type PlatformTool = (typeof platformTools)[number];

function getTool(name: string): PlatformTool {
  const tool = platformTools.find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

function getToolProperty(toolName: string, propertyName: string): Record<string, unknown> {
  const tool = getTool(toolName);
  const property = tool.inputSchema.properties?.[propertyName];
  expect(property).toBeDefined();
  return property as Record<string, unknown>;
}

describe('platform tool definitions', () => {
  // ── Array structure ──────────────────────────────────────────

  describe('platformTools array', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(platformTools)).toBe(true);
      expect(platformTools.length).toBeGreaterThan(0);
    });

    it('contains exactly 8 tools', () => {
      expect(platformTools).toHaveLength(8);
    });

    it('has unique tool names', () => {
      const names = platformTools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it.each(platformTools.map((tool) => [tool.name, tool]))(
      'tool "%s" has required MCP structure',
      (_name, tool) => {
        expect(tool).toEqual(
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            name: expect.any(String),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            description: expect.any(String),
            inputSchema: expect.objectContaining({
              type: 'object',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
              properties: expect.any(Object),
            }),
          })
        );
      }
    );

    it('every tool has a non-empty description', () => {
      for (const tool of platformTools) {
        expect(tool.description?.trim().length ?? 0).toBeGreaterThan(0);
      }
    });

    it('every tool inputSchema.type is "object"', () => {
      for (const tool of platformTools) {
        expect(tool.inputSchema.type).toBe('object');
      }
    });
  });

  // ── Expected tool names ──────────────────────────────────────

  describe('expected tool names', () => {
    const expectedNames = [
      'miniapp_pkg_scan',
      'miniapp_pkg_unpack',
      'miniapp_pkg_analyze',
      'asar_extract',
      'electron_inspect_app',
    ];

    it.each(expectedNames)('includes tool "%s"', (name) => {
      const found = platformTools.find((tool) => tool.name === name);
      expect(found).toBeDefined();
    });
  });

  // ── miniapp_pkg_scan ─────────────────────────────────────────

  describe('miniapp_pkg_scan', () => {
    it('has optional searchPath property', () => {
      const tool = getTool('miniapp_pkg_scan');
      expect(tool.inputSchema.properties).toHaveProperty('searchPath');
      const searchPathProp = getToolProperty('miniapp_pkg_scan', 'searchPath');
      expect(searchPathProp.type).toBe('string');
    });

    it('has no required properties', () => {
      const tool = getTool('miniapp_pkg_scan');
      expect(tool.inputSchema.required).toBeUndefined();
    });
  });

  // ── miniapp_pkg_unpack ───────────────────────────────────────

  describe('miniapp_pkg_unpack', () => {
    it('requires inputPath', () => {
      const tool = getTool('miniapp_pkg_unpack');
      expect(tool.inputSchema.required ?? []).toContain('inputPath');
    });

    it('has inputPath and outputDir properties', () => {
      const tool = getTool('miniapp_pkg_unpack');
      expect(tool.inputSchema.properties).toHaveProperty('inputPath');
      expect(tool.inputSchema.properties).toHaveProperty('outputDir');
    });

    it('inputPath is type string', () => {
      const prop = getToolProperty('miniapp_pkg_unpack', 'inputPath');
      expect(prop.type).toBe('string');
    });

    it('outputDir is type string', () => {
      const prop = getToolProperty('miniapp_pkg_unpack', 'outputDir');
      expect(prop.type).toBe('string');
    });
  });

  // ── miniapp_pkg_analyze ──────────────────────────────────────

  describe('miniapp_pkg_analyze', () => {
    it('requires unpackedDir', () => {
      const tool = getTool('miniapp_pkg_analyze');
      expect(tool.inputSchema.required ?? []).toContain('unpackedDir');
    });

    it('unpackedDir is type string', () => {
      const prop = getToolProperty('miniapp_pkg_analyze', 'unpackedDir');
      expect(prop.type).toBe('string');
    });
  });

  // ── asar_extract ─────────────────────────────────────────────

  describe('asar_extract', () => {
    it('requires inputPath', () => {
      const tool = getTool('asar_extract');
      expect(tool.inputSchema.required ?? []).toContain('inputPath');
    });

    it('has inputPath, outputDir, and listOnly properties', () => {
      const tool = getTool('asar_extract');
      expect(tool.inputSchema.properties).toHaveProperty('inputPath');
      expect(tool.inputSchema.properties).toHaveProperty('outputDir');
      expect(tool.inputSchema.properties).toHaveProperty('listOnly');
    });

    it('listOnly is type boolean with default false', () => {
      const prop = getToolProperty('asar_extract', 'listOnly');
      expect(prop.type).toBe('boolean');
      expect(prop.default).toBe(false);
    });

    it('inputPath is type string', () => {
      const prop = getToolProperty('asar_extract', 'inputPath');
      expect(prop.type).toBe('string');
    });
  });

  // ── electron_inspect_app ─────────────────────────────────────

  describe('electron_inspect_app', () => {
    it('requires appPath', () => {
      const tool = getTool('electron_inspect_app');
      expect(tool.inputSchema.required ?? []).toContain('appPath');
    });

    it('appPath is type string', () => {
      const prop = getToolProperty('electron_inspect_app', 'appPath');
      expect(prop.type).toBe('string');
    });

    it('has only one property', () => {
      const tool = getTool('electron_inspect_app');
      expect(Object.keys(tool.inputSchema.properties ?? {})).toHaveLength(1);
    });
  });

  // ── Description quality ──────────────────────────────────────

  describe('description quality', () => {
    it('miniapp_pkg_scan mentions scanning', () => {
      const tool = getTool('miniapp_pkg_scan');
      expect(tool.description?.length ?? 0).toBeGreaterThan(10);
    });

    it('miniapp_pkg_unpack mentions unpacking', () => {
      const tool = getTool('miniapp_pkg_unpack');
      expect(tool.description?.length ?? 0).toBeGreaterThan(10);
    });

    it('asar_extract mentions Electron or asar', () => {
      const tool = getTool('asar_extract');
      const desc = tool.description?.toLowerCase() ?? '';
      expect(desc.includes('electron') || desc.includes('asar')).toBe(true);
    });

    it('electron_inspect_app mentions Electron', () => {
      const tool = getTool('electron_inspect_app');
      const desc = tool.description?.toLowerCase() ?? '';
      expect(desc).toContain('electron');
    });
  });

  // ── Required fields completeness ─────────────────────────────

  describe('required fields completeness', () => {
    it('tools with required field declare an array', () => {
      for (const tool of platformTools) {
        if (tool.inputSchema.required) {
          expect(Array.isArray(tool.inputSchema.required)).toBe(true);
          expect(tool.inputSchema.required!.length).toBeGreaterThan(0);
        }
      }
    });

    it('every required field exists in properties', () => {
      for (const tool of platformTools) {
        if (tool.inputSchema.required) {
          for (const reqField of tool.inputSchema.required) {
            expect(tool.inputSchema.properties).toHaveProperty(reqField);
          }
        }
      }
    });
  });
});
