import { describe, it, expect } from 'vitest';
import { wasmTools } from '@server/domains/wasm/definitions';

describe('wasm/definitions', () => {
  it('exports a non-empty array of tool definitions', () => {
    expect(Array.isArray(wasmTools)).toBe(true);
    expect(wasmTools.length).toBeGreaterThan(0);
  });

  it('exports exactly 8 tools', () => {
    expect(wasmTools).toHaveLength(8);
  });

  it('contains all expected tool names', () => {
    const names = wasmTools.map((t) => t.name);
    expect(names).toContain('wasm_dump');
    expect(names).toContain('wasm_disassemble');
    expect(names).toContain('wasm_decompile');
    expect(names).toContain('wasm_inspect_sections');
    expect(names).toContain('wasm_offline_run');
    expect(names).toContain('wasm_optimize');
    expect(names).toContain('wasm_vmp_trace');
    expect(names).toContain('wasm_memory_inspect');
  });

  it('has unique tool names', () => {
    const names = wasmTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool has name, description, and inputSchema', () => {
    for (const tool of wasmTools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('every tool name starts with "wasm_"', () => {
    for (const tool of wasmTools) {
      expect(tool.name.startsWith('wasm_')).toBe(true);
    }
  });

  /* ---------- wasm_dump ---------- */

  describe('wasm_dump', () => {
    const tool = wasmTools.find((t) => t.name === 'wasm_dump')!;

    it('has optional moduleIndex and outputPath properties', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.moduleIndex).toBeDefined();
      expect(props.moduleIndex.type).toBe('number');
      expect(props.moduleIndex.default).toBe(0);
      expect(props.outputPath).toBeDefined();
      expect(props.outputPath.type).toBe('string');
    });

    it('has no required fields', () => {
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('description mentions WASM', () => {
      expect(tool.description.toLowerCase()).toContain('wasm');
    });
  });

  /* ---------- wasm_disassemble ---------- */

  describe('wasm_disassemble', () => {
    const tool = wasmTools.find((t) => t.name === 'wasm_disassemble')!;

    it('requires inputPath', () => {
      expect(tool.inputSchema.required).toContain('inputPath');
    });

    it('has inputPath, outputPath, and foldExprs properties', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.inputPath).toBeDefined();
      expect(props.inputPath.type).toBe('string');
      expect(props.outputPath).toBeDefined();
      expect(props.outputPath.type).toBe('string');
      expect(props.foldExprs).toBeDefined();
      expect(props.foldExprs.type).toBe('boolean');
      expect(props.foldExprs.default).toBe(true);
    });

    it('description mentions WAT or wasm2wat', () => {
      expect(
        tool.description.includes('WAT') || tool.description.includes('wasm2wat')
      ).toBe(true);
    });
  });

  /* ---------- wasm_decompile ---------- */

  describe('wasm_decompile', () => {
    const tool = wasmTools.find((t) => t.name === 'wasm_decompile')!;

    it('requires inputPath', () => {
      expect(tool.inputSchema.required).toContain('inputPath');
    });

    it('has inputPath and outputPath properties', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.inputPath).toBeDefined();
      expect(props.outputPath).toBeDefined();
    });

    it('description mentions C-like or wasm-decompile', () => {
      expect(
        tool.description.includes('C-like') || tool.description.includes('wasm-decompile')
      ).toBe(true);
    });
  });

  /* ---------- wasm_inspect_sections ---------- */

  describe('wasm_inspect_sections', () => {
    const tool = wasmTools.find((t) => t.name === 'wasm_inspect_sections')!;

    it('requires inputPath', () => {
      expect(tool.inputSchema.required).toContain('inputPath');
    });

    it('has sections enum with expected values', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.sections).toBeDefined();
      expect(props.sections.enum).toEqual(['headers', 'details', 'disassemble', 'all']);
      expect(props.sections.default).toBe('details');
    });
  });

  /* ---------- wasm_offline_run ---------- */

  describe('wasm_offline_run', () => {
    const tool = wasmTools.find((t) => t.name === 'wasm_offline_run')!;

    it('requires inputPath and functionName', () => {
      expect(tool.inputSchema.required).toContain('inputPath');
      expect(tool.inputSchema.required).toContain('functionName');
    });

    it('has args as array of strings', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.args).toBeDefined();
      expect(props.args.type).toBe('array');
      expect(props.args.items.type).toBe('string');
    });

    it('has runtime enum with expected values', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.runtime).toBeDefined();
      expect(props.runtime.enum).toEqual(['wasmtime', 'wasmer', 'auto']);
      expect(props.runtime.default).toBe('auto');
    });

    it('has timeoutMs with default 10000', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.timeoutMs).toBeDefined();
      expect(props.timeoutMs.type).toBe('number');
      expect(props.timeoutMs.default).toBe(10000);
    });

    it('description mentions sandbox or security', () => {
      expect(tool.description.toLowerCase()).toContain('sandbox');
    });
  });

  /* ---------- wasm_optimize ---------- */

  describe('wasm_optimize', () => {
    const tool = wasmTools.find((t) => t.name === 'wasm_optimize')!;

    it('requires inputPath', () => {
      expect(tool.inputSchema.required).toContain('inputPath');
    });

    it('has level enum with optimization levels', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.level).toBeDefined();
      expect(props.level.enum).toEqual(['O1', 'O2', 'O3', 'O4', 'Os', 'Oz']);
      expect(props.level.default).toBe('O2');
    });

    it('description mentions binaryen or wasm-opt', () => {
      expect(
        tool.description.includes('binaryen') || tool.description.includes('wasm-opt')
      ).toBe(true);
    });
  });

  /* ---------- wasm_vmp_trace ---------- */

  describe('wasm_vmp_trace', () => {
    const tool = wasmTools.find((t) => t.name === 'wasm_vmp_trace')!;

    it('has optional maxEvents with default 5000', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.maxEvents).toBeDefined();
      expect(props.maxEvents.type).toBe('number');
      expect(props.maxEvents.default).toBe(5000);
    });

    it('has optional filterModule string', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.filterModule).toBeDefined();
      expect(props.filterModule.type).toBe('string');
    });

    it('has no required fields', () => {
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('description mentions VMP', () => {
      expect(tool.description).toContain('VMP');
    });
  });

  /* ---------- wasm_memory_inspect ---------- */

  describe('wasm_memory_inspect', () => {
    const tool = wasmTools.find((t) => t.name === 'wasm_memory_inspect')!;

    it('has offset with default 0', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.offset).toBeDefined();
      expect(props.offset.type).toBe('number');
      expect(props.offset.default).toBe(0);
    });

    it('has length with default 256', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.length).toBeDefined();
      expect(props.length.type).toBe('number');
      expect(props.length.default).toBe(256);
    });

    it('has format enum with expected values', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.format).toBeDefined();
      expect(props.format.enum).toEqual(['hex', 'ascii', 'both']);
      expect(props.format.default).toBe('both');
    });

    it('has optional searchPattern', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.searchPattern).toBeDefined();
      expect(props.searchPattern.type).toBe('string');
    });

    it('has no required fields', () => {
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('description mentions memory or linear memory', () => {
      const desc = tool.description.toLowerCase();
      expect(desc.includes('memory')).toBe(true);
    });
  });

  /* ---------- schema structural validation ---------- */

  describe('schema structural consistency', () => {
    it('all tools with required fields list only properties that exist', () => {
      for (const tool of wasmTools) {
        const required = tool.inputSchema.required as string[] | undefined;
        if (!required) continue;
        const props = Object.keys(tool.inputSchema.properties ?? {});
        for (const field of required) {
          expect(props).toContain(field);
        }
      }
    });

    it('all property values have a type field', () => {
      for (const tool of wasmTools) {
        const props = tool.inputSchema.properties as Record<string, any> | undefined;
        if (!props) continue;
        for (const [key, schema] of Object.entries(props)) {
          expect(schema.type).toBeDefined();
        }
      }
    });

    it('enum properties have at least 2 values', () => {
      for (const tool of wasmTools) {
        const props = tool.inputSchema.properties as Record<string, any> | undefined;
        if (!props) continue;
        for (const [key, schema] of Object.entries(props)) {
          if (schema.enum) {
            expect(schema.enum.length).toBeGreaterThanOrEqual(2);
          }
        }
      }
    });

    it('default values match the declared type', () => {
      for (const tool of wasmTools) {
        const props = tool.inputSchema.properties as Record<string, any> | undefined;
        if (!props) continue;
        for (const [key, schema] of Object.entries(props)) {
          if (schema.default === undefined) continue;
          if (schema.type === 'number') {
            expect(typeof schema.default).toBe('number');
          } else if (schema.type === 'string') {
            expect(typeof schema.default).toBe('string');
          } else if (schema.type === 'boolean') {
            expect(typeof schema.default).toBe('boolean');
          }
        }
      }
    });

    it('default values for enum properties are included in the enum', () => {
      for (const tool of wasmTools) {
        const props = tool.inputSchema.properties as Record<string, any> | undefined;
        if (!props) continue;
        for (const [key, schema] of Object.entries(props)) {
          if (schema.enum && schema.default !== undefined) {
            expect(schema.enum).toContain(schema.default);
          }
        }
      }
    });
  });
});
