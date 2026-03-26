import { describe, expect, it } from 'vitest';
import { coreTools } from '@server/domains/analysis/definitions';

describe('server/domains/analysis/definitions', () => {
  it('exports coreTools as a non-empty array', () => {
    expect(Array.isArray(coreTools)).toBe(true);
    expect(coreTools.length).toBeGreaterThan(0);
  });

  it('every tool has name, description, and inputSchema', () => {
    coreTools.forEach((tool) => {
      expect(tool).toEqual(
        expect.objectContaining({
          name: expect.any(String),
          description: expect.any(String),
          inputSchema: expect.objectContaining({
            type: 'object',
          }),
        }),
      );
    });
  });

  it('has no duplicate tool names', () => {
    const names = coreTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('includes expected core tools', () => {
    const names = coreTools.map((t) => t.name);

    expect(names).toContain('collect_code');
    expect(names).toContain('search_in_scripts');
    expect(names).toContain('extract_function_tree');
    expect(names).toContain('deobfuscate');
    expect(names).toContain('understand_code');
    expect(names).toContain('detect_crypto');
    expect(names).toContain('manage_hooks');
    expect(names).toContain('detect_obfuscation');
    expect(names).toContain('advanced_deobfuscate');
    expect(names).toContain('webcrack_unpack');
    expect(names).toContain('clear_collected_data');
    expect(names).toContain('get_collection_stats');
    expect(names).toContain('webpack_enumerate');
    expect(names).toContain('source_map_extract');
  });

  it('collect_code requires url parameter', () => {
    const tool = coreTools.find((t) => t.name === 'collect_code')!;
    expect(tool.inputSchema.required).toContain('url');
    expect(tool.inputSchema.properties).toHaveProperty('url');
    expect(tool.inputSchema.properties).toHaveProperty('smartMode');
    expect(tool.inputSchema.properties).toHaveProperty('compress');
  });

  it('search_in_scripts requires keyword parameter', () => {
    const tool = coreTools.find((t) => t.name === 'search_in_scripts')!;
    expect(tool.inputSchema.required).toContain('keyword');
    expect(tool.inputSchema.properties).toHaveProperty('isRegex');
    expect(tool.inputSchema.properties).toHaveProperty('caseSensitive');
    expect(tool.inputSchema.properties).toHaveProperty('maxMatches');
  });

  it('extract_function_tree requires scriptId and functionName', () => {
    const tool = coreTools.find((t) => t.name === 'extract_function_tree')!;
    expect(tool.inputSchema.required).toContain('scriptId');
    expect(tool.inputSchema.required).toContain('functionName');
  });

  it('deobfuscate requires code and has webcrack options', () => {
    const tool = coreTools.find((t) => t.name === 'deobfuscate')!;
    expect(tool.inputSchema.required).toContain('code');
    expect(tool.inputSchema.properties).toHaveProperty('unpack');
    expect(tool.inputSchema.properties).toHaveProperty('unminify');
    expect(tool.inputSchema.properties).toHaveProperty('jsx');
    expect(tool.inputSchema.properties).toHaveProperty('mangle');
    expect(tool.inputSchema.properties).toHaveProperty('outputDir');
    expect(tool.inputSchema.properties).toHaveProperty('mappings');
  });

  it('understand_code requires code and has focus enum', () => {
    const tool = coreTools.find((t) => t.name === 'understand_code')!;
    expect(tool.inputSchema.required).toContain('code');
    const focusProp = tool.inputSchema.properties!.focus as { enum?: string[] };
    expect(focusProp.enum).toContain('structure');
    expect(focusProp.enum).toContain('business');
    expect(focusProp.enum).toContain('security');
    expect(focusProp.enum).toContain('all');
  });

  it('manage_hooks requires action and has correct enums', () => {
    const tool = coreTools.find((t) => t.name === 'manage_hooks')!;
    expect(tool.inputSchema.required).toContain('action');
    const actionProp = tool.inputSchema.properties!.action as { enum?: string[] };
    expect(actionProp.enum).toEqual(['create', 'list', 'records', 'clear']);
  });

  it('advanced_deobfuscate requires code and has webcrack options', () => {
    const tool = coreTools.find((t) => t.name === 'advanced_deobfuscate')!;
    expect(tool.inputSchema.required).toContain('code');
    expect(tool.inputSchema.properties).toHaveProperty('aggressiveVM');
    expect(tool.inputSchema.properties).toHaveProperty('useASTOptimization');
    expect(tool.inputSchema.properties).toHaveProperty('timeout');
    expect(tool.inputSchema.properties).toHaveProperty('unpack');
  });

  it('webcrack_unpack requires code and has extraction options', () => {
    const tool = coreTools.find((t) => t.name === 'webcrack_unpack')!;
    expect(tool.inputSchema.required).toContain('code');
    expect(tool.inputSchema.properties).toHaveProperty('includeModuleCode');
    expect(tool.inputSchema.properties).toHaveProperty('maxBundleModules');
    expect(tool.inputSchema.properties).toHaveProperty('mappings');
  });

  it('clear_collected_data and get_collection_stats have no required params', () => {
    const clearTool = coreTools.find((t) => t.name === 'clear_collected_data')!;
    const statsTool = coreTools.find((t) => t.name === 'get_collection_stats')!;

    expect(clearTool.inputSchema.required ?? []).toHaveLength(0);
    expect(statsTool.inputSchema.required ?? []).toHaveLength(0);
  });

  it('webpack_enumerate has optional searchKeyword', () => {
    const tool = coreTools.find((t) => t.name === 'webpack_enumerate')!;
    expect(tool.inputSchema.properties).toHaveProperty('searchKeyword');
    expect(tool.inputSchema.properties).toHaveProperty('maxResults');
    // No required params
    expect(tool.inputSchema.required ?? []).toHaveLength(0);
  });

  it('source_map_extract has optional filter and content params', () => {
    const tool = coreTools.find((t) => t.name === 'source_map_extract')!;
    expect(tool.inputSchema.properties).toHaveProperty('includeContent');
    expect(tool.inputSchema.properties).toHaveProperty('filterPath');
    expect(tool.inputSchema.properties).toHaveProperty('maxFiles');
  });

  it('deobfuscate mappings items have required path and pattern', () => {
    const tool = coreTools.find((t) => t.name === 'deobfuscate')!;
    const mappings = tool.inputSchema.properties!.mappings as {
      items?: { required?: string[] };
    };
    expect(mappings.items?.required).toContain('path');
    expect(mappings.items?.required).toContain('pattern');
  });
});
