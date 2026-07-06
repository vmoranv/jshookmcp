import { describe, expect, it } from 'vitest';
import { binaryInstrumentTools } from '@server/domains/binary-instrument/definitions';

type BinaryInstrumentTool = (typeof binaryInstrumentTools)[number];

function getTool(name: string): BinaryInstrumentTool {
  const tool = binaryInstrumentTools.find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

function getToolProperty(toolName: string, propertyName: string): Record<string, unknown> {
  const tool = getTool(toolName);
  const property = tool.inputSchema.properties?.[propertyName];
  expect(property).toBeDefined();
  return property as Record<string, unknown>;
}

describe('binary-instrument tool definitions', () => {
  it('exports a non-empty array of tool definitions', async () => {
    expect(Array.isArray(binaryInstrumentTools)).toBe(true);
    expect(binaryInstrumentTools.length).toBeGreaterThan(0);
  });

  it('includes apk reverse-engineering helper tools', async () => {
    expect(getTool('apktool_decode').name).toBe('apktool_decode');
    expect(getTool('apk_manifest_dump').name).toBe('apk_manifest_dump');
    expect(getTool('apk_manifest_query').name).toBe('apk_manifest_query');
    expect(getTool('apk_static_triage').name).toBe('apk_static_triage');
    expect(getTool('dex_scan_file').name).toBe('dex_scan_file');
    expect(getTool('binary_strings_extract').name).toBe('binary_strings_extract');
    expect(getTool('apk_native_libs_list').name).toBe('apk_native_libs_list');
    expect(getTool('jadx_decompile_apk').name).toBe('jadx_decompile_apk');
    expect(getTool('frida_dex_dump').name).toBe('frida_dex_dump');
  });

  it('includes early Frida instrumentation tools', async () => {
    expect(getTool('frida_spawn').inputSchema.required ?? []).toContain('target');
    expect(getTool('frida_resume').inputSchema.required ?? []).toContain('sessionId');
    expect(getTool('frida_attach_interceptor').inputSchema.required ?? []).toContain('symbol');
    expect(getToolProperty('frida_attach_interceptor', 'argSpec').type).toBe('array');
    expect(getToolProperty('frida_attach_interceptor', 'install').default).toBe(false);
    expect(getToolProperty('frida_generate_script', 'argSpec').type).toBe('array');
  });

  it('apktool_decode requires apkPath and exposes force boolean', async () => {
    const tool = getTool('apktool_decode');
    expect(tool.inputSchema.required ?? []).toContain('apkPath');
    const force = getToolProperty('apktool_decode', 'force');
    expect(force.type).toBe('boolean');
    expect(force.default).toBe(false);
  });

  it('apk_manifest_dump requires apkPath', async () => {
    const tool = getTool('apk_manifest_dump');
    expect(tool.inputSchema.required ?? []).toContain('apkPath');
    expect(getToolProperty('apk_manifest_dump', 'apkPath').type).toBe('string');
  });

  it('apk_native_libs_list requires apkPath', async () => {
    const tool = getTool('apk_native_libs_list');
    expect(tool.inputSchema.required ?? []).toContain('apkPath');
    expect(getToolProperty('apk_native_libs_list', 'apkPath').type).toBe('string');
  });

  it('high-level APK tools require apkPath', async () => {
    expect(getTool('apk_manifest_query').inputSchema.required ?? []).toContain('apkPath');
    expect(getTool('apk_static_triage').inputSchema.required ?? []).toContain('apkPath');
    expect(getTool('jadx_decompile_apk').inputSchema.required ?? []).toContain('apkPath');
  });
});
