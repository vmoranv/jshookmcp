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

    it('tool count matches expected (24 tools)', async () => {
      expect(adbBridgeTools.length).toBe(24);
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
    const expectedNames = [
      'adb_apk_analyze',
      'adb_package_summary',
      'adb_install',
      'adb_uninstall',
      'adb_input_tap',
      'adb_input_swipe',
      'adb_input_keyevent',
      'adb_input_text',
      'adb_proc_maps',
      'adb_root_check',
      'adb_screenshot',
      'adb_screenrecord',
      'adb_port_forward',
      'adb_logcat_query',
      'adb_app_cold_start_trace',
      'adb_file_pull',
      'adb_file_push',
      'adb_pull_native_libs',
      'adb_webview_list',
      'adb_webview_attach',
    ];

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

  describe('adb device control tools', () => {
    it('adb_install exposes APK paths and install flags', async () => {
      const tool = getTool('adb_install');
      expect(tool.inputSchema.required ?? []).toContain('serial');
      expect(getToolProperty('adb_install', 'apkPath').type).toBe('string');
      expect(getToolProperty('adb_install', 'apkPaths').type).toBe('array');
      expect(getToolProperty('adb_install', 'reinstall').default).toBe(true);
      expect(getToolProperty('adb_install', 'allowTestOnly').default).toBe(true);
    });

    it('adb_uninstall requires serial and packageName', async () => {
      const tool = getTool('adb_uninstall');
      expect(tool.inputSchema.required ?? []).toContain('serial');
      expect(tool.inputSchema.required ?? []).toContain('packageName');
      expect(getToolProperty('adb_uninstall', 'keepData').default).toBe(false);
    });

    it('input and inspection tools expose expected required fields', async () => {
      expect(getTool('adb_input_tap').inputSchema.required ?? []).toEqual(
        expect.arrayContaining(['serial', 'x', 'y']),
      );
      expect(getTool('adb_input_swipe').inputSchema.required ?? []).toEqual(
        expect.arrayContaining(['serial', 'x1', 'y1', 'x2', 'y2']),
      );
      expect(getTool('adb_input_keyevent').inputSchema.required ?? []).toEqual(
        expect.arrayContaining(['serial', 'keyCode']),
      );
      expect(getTool('adb_input_text').inputSchema.required ?? []).toEqual(
        expect.arrayContaining(['serial', 'text']),
      );
      expect(getTool('adb_proc_maps').inputSchema.required ?? []).toContain('serial');
      expect(getTool('adb_root_check').inputSchema.required ?? []).toContain('serial');
      expect(getTool('adb_screenshot').inputSchema.required ?? []).toContain('serial');
      expect(getTool('adb_screenrecord').inputSchema.required ?? []).toContain('serial');
      expect(getToolProperty('adb_screenrecord', 'durationSec').type).toBe('number');
      expect(getToolProperty('adb_screenrecord', 'localPath').type).toBe('string');
      expect(getTool('adb_port_forward').inputSchema.required ?? []).toEqual(
        expect.arrayContaining(['serial', 'action', 'direction']),
      );
      expect(getToolProperty('adb_port_forward', 'action').enum).toEqual([
        'add',
        'remove',
        'remove_all',
        'list',
      ]);
      expect(getToolProperty('adb_port_forward', 'direction').enum).toEqual(['forward', 'reverse']);
    });
  });

  describe('adb_pull_native_libs', () => {
    it('requires serial and packageName', async () => {
      const tool = getTool('adb_pull_native_libs');
      expect(tool.inputSchema.required ?? []).toContain('serial');
      expect(tool.inputSchema.required ?? []).toContain('packageName');
    });

    it('has includeSystemLibs boolean default false', async () => {
      const prop = getToolProperty('adb_pull_native_libs', 'includeSystemLibs');
      expect(prop.type).toBe('boolean');
      expect(prop.default).toBe(false);
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
