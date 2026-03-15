import { describe, it, expect } from 'vitest';
import { platformTools } from '@server/domains/platform/definitions';

describe('platform tool definitions', () => {
  // ── Array structure ──────────────────────────────────────────

  describe('platformTools array', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(platformTools)).toBe(true);
      expect(platformTools.length).toBeGreaterThan(0);
    });

    it('contains exactly 5 tools', () => {
      expect(platformTools).toHaveLength(5);
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
      for (const tool of platformTools) {
        expect(tool.description.trim().length).toBeGreaterThan(0);
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
      const found = platformTools.find((t) => t.name === name);
      expect(found).toBeDefined();
    });
  });

  // ── miniapp_pkg_scan ─────────────────────────────────────────

  describe('miniapp_pkg_scan', () => {
    it('has optional searchPath property', () => {
      const tool = platformTools.find((t) => t.name === 'miniapp_pkg_scan')!;
      expect(tool.inputSchema.properties).toHaveProperty('searchPath');
      const searchPathProp = tool.inputSchema.properties!.searchPath as Record<string, unknown>;
      expect(searchPathProp.type).toBe('string');
    });

    it('has no required properties', () => {
      const tool = platformTools.find((t) => t.name === 'miniapp_pkg_scan')!;
      expect(tool.inputSchema.required).toBeUndefined();
    });
  });

  // ── miniapp_pkg_unpack ───────────────────────────────────────

  describe('miniapp_pkg_unpack', () => {
    it('requires inputPath', () => {
      const tool = platformTools.find((t) => t.name === 'miniapp_pkg_unpack')!;
      expect(tool.inputSchema.required).toContain('inputPath');
    });

    it('has inputPath and outputDir properties', () => {
      const tool = platformTools.find((t) => t.name === 'miniapp_pkg_unpack')!;
      expect(tool.inputSchema.properties).toHaveProperty('inputPath');
      expect(tool.inputSchema.properties).toHaveProperty('outputDir');
    });

    it('inputPath is type string', () => {
      const tool = platformTools.find((t) => t.name === 'miniapp_pkg_unpack')!;
      const prop = tool.inputSchema.properties!.inputPath as Record<string, unknown>;
      expect(prop.type).toBe('string');
    });

    it('outputDir is type string', () => {
      const tool = platformTools.find((t) => t.name === 'miniapp_pkg_unpack')!;
      const prop = tool.inputSchema.properties!.outputDir as Record<string, unknown>;
      expect(prop.type).toBe('string');
    });
  });

  // ── miniapp_pkg_analyze ──────────────────────────────────────

  describe('miniapp_pkg_analyze', () => {
    it('requires unpackedDir', () => {
      const tool = platformTools.find((t) => t.name === 'miniapp_pkg_analyze')!;
      expect(tool.inputSchema.required).toContain('unpackedDir');
    });

    it('unpackedDir is type string', () => {
      const tool = platformTools.find((t) => t.name === 'miniapp_pkg_analyze')!;
      const prop = tool.inputSchema.properties!.unpackedDir as Record<string, unknown>;
      expect(prop.type).toBe('string');
    });
  });

  // ── asar_extract ─────────────────────────────────────────────

  describe('asar_extract', () => {
    it('requires inputPath', () => {
      const tool = platformTools.find((t) => t.name === 'asar_extract')!;
      expect(tool.inputSchema.required).toContain('inputPath');
    });

    it('has inputPath, outputDir, and listOnly properties', () => {
      const tool = platformTools.find((t) => t.name === 'asar_extract')!;
      expect(tool.inputSchema.properties).toHaveProperty('inputPath');
      expect(tool.inputSchema.properties).toHaveProperty('outputDir');
      expect(tool.inputSchema.properties).toHaveProperty('listOnly');
    });

    it('listOnly is type boolean with default false', () => {
      const tool = platformTools.find((t) => t.name === 'asar_extract')!;
      const prop = tool.inputSchema.properties!.listOnly as Record<string, unknown>;
      expect(prop.type).toBe('boolean');
      expect(prop.default).toBe(false);
    });

    it('inputPath is type string', () => {
      const tool = platformTools.find((t) => t.name === 'asar_extract')!;
      const prop = tool.inputSchema.properties!.inputPath as Record<string, unknown>;
      expect(prop.type).toBe('string');
    });
  });

  // ── electron_inspect_app ─────────────────────────────────────

  describe('electron_inspect_app', () => {
    it('requires appPath', () => {
      const tool = platformTools.find((t) => t.name === 'electron_inspect_app')!;
      expect(tool.inputSchema.required).toContain('appPath');
    });

    it('appPath is type string', () => {
      const tool = platformTools.find((t) => t.name === 'electron_inspect_app')!;
      const prop = tool.inputSchema.properties!.appPath as Record<string, unknown>;
      expect(prop.type).toBe('string');
    });

    it('has only one property', () => {
      const tool = platformTools.find((t) => t.name === 'electron_inspect_app')!;
      expect(Object.keys(tool.inputSchema.properties!)).toHaveLength(1);
    });
  });

  // ── Description quality ──────────────────────────────────────

  describe('description quality', () => {
    it('miniapp_pkg_scan mentions scanning', () => {
      const tool = platformTools.find((t) => t.name === 'miniapp_pkg_scan')!;
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('miniapp_pkg_unpack mentions unpacking', () => {
      const tool = platformTools.find((t) => t.name === 'miniapp_pkg_unpack')!;
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('asar_extract mentions Electron or asar', () => {
      const tool = platformTools.find((t) => t.name === 'asar_extract')!;
      const desc = tool.description.toLowerCase();
      expect(desc.includes('electron') || desc.includes('asar')).toBe(true);
    });

    it('electron_inspect_app mentions Electron', () => {
      const tool = platformTools.find((t) => t.name === 'electron_inspect_app')!;
      const desc = tool.description.toLowerCase();
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
