import { describe, it, expect } from 'vitest';
import { wasmTools } from '@server/domains/wasm/definitions';

type ToolDefinition = (typeof wasmTools)[number];
type SchemaProperty = {
  type?: string;
  default?: any;
  enum?: any[];
  items?: { type?: string };
};

function getTool(name: string): ToolDefinition {
  const tool = wasmTools.find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

function getDescription(tool: ToolDefinition): string {
  return tool.description ?? '';
}

function getProperties(tool: ToolDefinition): Record<string, SchemaProperty> {
  return (tool.inputSchema.properties ?? {}) as Record<string, SchemaProperty>;
}

function getProperty(tool: ToolDefinition, key: string): SchemaProperty {
  const property = getProperties(tool)[key];
  expect(property).toBeDefined();
  return property ?? {};
}

describe('wasm/definitions', () => {
  it('exports a non-empty array of tool definitions', async () => {
    expect(Array.isArray(wasmTools)).toBe(true);
    expect(wasmTools.length).toBeGreaterThan(0);
  });

  it('exports exactly 8 tools', async () => {
    expect(wasmTools).toHaveLength(8);
  });

  it('contains all expected tool names', async () => {
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

  it('has unique tool names', async () => {
    const names = wasmTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool has name, description, and inputSchema', async () => {
    for (const tool of wasmTools) {
      const description = getDescription(tool);
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('every tool name starts with "wasm_"', async () => {
    for (const tool of wasmTools) {
      expect(tool.name.startsWith('wasm_')).toBe(true);
    }
  });

  /* ---------- wasm_dump ---------- */

  describe('wasm_dump', () => {
    const tool = getTool('wasm_dump');

    it('has optional moduleIndex and outputPath properties', async () => {
      const moduleIndex = getProperty(tool, 'moduleIndex');
      const outputPath = getProperty(tool, 'outputPath');
      expect(moduleIndex.type).toBe('number');
      expect(moduleIndex.default).toBe(0);
      expect(outputPath.type).toBe('string');
    });

    it('has no required fields', async () => {
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('description mentions WASM', async () => {
      expect(getDescription(tool).toLowerCase()).toContain('wasm');
    });
  });

  /* ---------- wasm_disassemble ---------- */

  describe('wasm_disassemble', () => {
    const tool = getTool('wasm_disassemble');

    it('requires inputPath', async () => {
      expect(tool.inputSchema.required).toContain('inputPath');
    });

    it('has inputPath, outputPath, and foldExprs properties', async () => {
      const inputPath = getProperty(tool, 'inputPath');
      const outputPath = getProperty(tool, 'outputPath');
      const foldExprs = getProperty(tool, 'foldExprs');
      expect(inputPath.type).toBe('string');
      expect(outputPath.type).toBe('string');
      expect(foldExprs.type).toBe('boolean');
      expect(foldExprs.default).toBe(true);
    });

    it('description mentions WAT or wasm2wat', async () => {
      expect(
        getDescription(tool).includes('WAT') || getDescription(tool).includes('wasm2wat'),
      ).toBe(true);
    });
  });

  /* ---------- wasm_decompile ---------- */

  describe('wasm_decompile', () => {
    const tool = getTool('wasm_decompile');

    it('requires inputPath', async () => {
      expect(tool.inputSchema.required).toContain('inputPath');
    });

    it('has inputPath and outputPath properties', async () => {
      const props = getProperties(tool);
      expect(props.inputPath).toBeDefined();
      expect(props.outputPath).toBeDefined();
    });

    it('description mentions C-like or wasm-decompile', async () => {
      expect(
        getDescription(tool).includes('C-like') || getDescription(tool).includes('wasm-decompile'),
      ).toBe(true);
    });
  });

  /* ---------- wasm_inspect_sections ---------- */

  describe('wasm_inspect_sections', () => {
    const tool = getTool('wasm_inspect_sections');

    it('requires inputPath', async () => {
      expect(tool.inputSchema.required).toContain('inputPath');
    });

    it('has sections enum with expected values', async () => {
      const sections = getProperty(tool, 'sections');
      expect(sections.enum).toEqual(['headers', 'details', 'disassemble', 'all']);
      expect(sections.default).toBe('details');
    });
  });

  /* ---------- wasm_offline_run ---------- */

  describe('wasm_offline_run', () => {
    const tool = getTool('wasm_offline_run');

    it('requires inputPath and functionName', async () => {
      expect(tool.inputSchema.required).toContain('inputPath');
      expect(tool.inputSchema.required).toContain('functionName');
    });

    it('has args as array of strings', async () => {
      const args = getProperty(tool, 'args');
      expect(args.type).toBe('array');
      expect(args.items?.type).toBe('string');
    });

    it('has runtime enum with expected values', async () => {
      const runtime = getProperty(tool, 'runtime');
      expect(runtime.enum).toEqual(['wasmtime', 'wasmer', 'auto']);
      expect(runtime.default).toBe('auto');
    });

    it('has timeoutMs with default 10000', async () => {
      const timeoutMs = getProperty(tool, 'timeoutMs');
      expect(timeoutMs.type).toBe('number');
      expect(timeoutMs.default).toBe(10000);
    });

    it('description mentions sandbox or security', async () => {
      expect(getDescription(tool).toLowerCase()).toContain('sandbox');
    });
  });

  /* ---------- wasm_optimize ---------- */

  describe('wasm_optimize', () => {
    const tool = getTool('wasm_optimize');

    it('requires inputPath', async () => {
      expect(tool.inputSchema.required).toContain('inputPath');
    });

    it('has level enum with optimization levels', async () => {
      const level = getProperty(tool, 'level');
      expect(level.enum).toEqual(['O1', 'O2', 'O3', 'O4', 'Os', 'Oz']);
      expect(level.default).toBe('O2');
    });

    it('description mentions binaryen or wasm-opt', async () => {
      expect(
        getDescription(tool).includes('binaryen') || getDescription(tool).includes('wasm-opt'),
      ).toBe(true);
    });
  });

  /* ---------- wasm_vmp_trace ---------- */

  describe('wasm_vmp_trace', () => {
    const tool = getTool('wasm_vmp_trace');

    it('has optional maxEvents with default 5000', async () => {
      const maxEvents = getProperty(tool, 'maxEvents');
      expect(maxEvents.type).toBe('number');
      expect(maxEvents.default).toBe(5000);
    });

    it('has optional filterModule string', async () => {
      const filterModule = getProperty(tool, 'filterModule');
      expect(filterModule.type).toBe('string');
    });

    it('has no required fields', async () => {
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('description mentions VMP', async () => {
      expect(getDescription(tool)).toContain('VMP');
    });
  });

  /* ---------- wasm_memory_inspect ---------- */

  describe('wasm_memory_inspect', () => {
    const tool = getTool('wasm_memory_inspect');

    it('has offset with default 0', async () => {
      const offset = getProperty(tool, 'offset');
      expect(offset.type).toBe('number');
      expect(offset.default).toBe(0);
    });

    it('has length with default 256', async () => {
      const length = getProperty(tool, 'length');
      expect(length.type).toBe('number');
      expect(length.default).toBe(256);
    });

    it('has format enum with expected values', async () => {
      const format = getProperty(tool, 'format');
      expect(format.enum).toEqual(['hex', 'ascii', 'both']);
      expect(format.default).toBe('both');
    });

    it('has optional searchPattern', async () => {
      const searchPattern = getProperty(tool, 'searchPattern');
      expect(searchPattern.type).toBe('string');
    });

    it('has no required fields', async () => {
      expect(tool.inputSchema.required).toBeUndefined();
    });

    it('description mentions memory or linear memory', async () => {
      const desc = getDescription(tool).toLowerCase();
      expect(desc.includes('memory')).toBe(true);
    });
  });

  /* ---------- schema structural validation ---------- */

  describe('schema structural consistency', () => {
    it('all tools with required fields list only properties that exist', async () => {
      for (const tool of wasmTools) {
        const required = tool.inputSchema.required as string[] | undefined;
        if (!required) continue;
        const props = Object.keys(tool.inputSchema.properties ?? {});
        for (const field of required) {
          expect(props).toContain(field);
        }
      }
    });

    it('all property values have a type field', async () => {
      for (const tool of wasmTools) {
        const props = getProperties(tool);
        if (!props) continue;
        for (const schema of Object.values(props)) {
          expect(schema.type).toBeDefined();
        }
      }
    });

    it('enum properties have at least 2 values', async () => {
      for (const tool of wasmTools) {
        const props = getProperties(tool);
        if (!props) continue;
        for (const schema of Object.values(props)) {
          if (schema.enum) {
            expect(schema.enum.length).toBeGreaterThanOrEqual(2);
          }
        }
      }
    });

    it('default values match the declared type', async () => {
      for (const tool of wasmTools) {
        const props = getProperties(tool);
        if (!props) continue;
        for (const schema of Object.values(props)) {
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

    it('default values for enum properties are included in the enum', async () => {
      for (const tool of wasmTools) {
        const props = getProperties(tool);
        if (!props) continue;
        for (const schema of Object.values(props)) {
          if (schema.enum && schema.default !== undefined) {
            expect(schema.enum).toContain(schema.default);
          }
        }
      }
    });
  });
});
