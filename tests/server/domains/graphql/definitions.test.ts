import { describe, expect, it, vi } from 'vitest';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

import { graphqlTools } from '@server/domains/graphql/definitions';

describe('graphql definitions', () => {
  describe('tool array structure', () => {
    it('exports a non-empty array of tools', async () => {
      expect(Array.isArray(graphqlTools)).toBe(true);
      expect(graphqlTools.length).toBeGreaterThan(0);
    });

    it('contains exactly 5 tools', async () => {
      expect(graphqlTools).toHaveLength(5);
    });

    it('every tool has a name and description', async () => {
      for (const tool of graphqlTools) {
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect(tool.description!.length).toBeGreaterThan(0);
      }
    });

    it('every tool has an inputSchema', async () => {
      for (const tool of graphqlTools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });

    it('tool names are unique', async () => {
      const names = graphqlTools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe('call_graph_analyze tool', () => {
    const tool = graphqlTools.find((t) => t.name === 'call_graph_analyze')!;

    it('exists', async () => {
      expect(tool).toBeDefined();
    });

    it('has maxDepth property', async () => {
      expect(tool.inputSchema.properties).toHaveProperty('maxDepth');
      expect((tool.inputSchema.properties as any).maxDepth.type).toBe('number');
      expect((tool.inputSchema.properties as any).maxDepth.default).toBe(5);
    });

    it('has filterPattern property', async () => {
      expect(tool.inputSchema.properties).toHaveProperty('filterPattern');
      expect((tool.inputSchema.properties as any).filterPattern.type).toBe('string');
    });

    it('has no required fields', async () => {
      expect(tool.inputSchema.required).toBeUndefined();
    });
  });

  describe('script_replace_persist tool', () => {
    const tool = graphqlTools.find((t) => t.name === 'script_replace_persist')!;

    it('exists', async () => {
      expect(tool).toBeDefined();
    });

    it('has url and replacement as required', async () => {
      expect(tool.inputSchema.required).toEqual(['url', 'replacement']);
    });

    it('has url property', async () => {
      expect(tool.inputSchema.properties).toHaveProperty('url');
    });

    it('has replacement property', async () => {
      expect(tool.inputSchema.properties).toHaveProperty('replacement');
    });

    it('has matchType property with enum', async () => {
      const matchType = (tool.inputSchema.properties as any).matchType;
      expect(matchType).toBeDefined();
      expect(matchType.enum).toEqual(['exact', 'contains', 'regex']);
      expect(matchType.default).toBe('contains');
    });
  });

  describe('graphql_introspect tool', () => {
    const tool = graphqlTools.find((t) => t.name === 'graphql_introspect')!;

    it('exists', async () => {
      expect(tool).toBeDefined();
    });

    it('has endpoint as required', async () => {
      expect(tool.inputSchema.required).toEqual(['endpoint']);
    });

    it('has headers property with additionalProperties string', async () => {
      const headers = (tool.inputSchema.properties as any).headers;
      expect(headers).toBeDefined();
      expect(headers.type).toBe('object');
      expect(headers.additionalProperties.type).toBe('string');
    });
  });

  describe('graphql_extract_queries tool', () => {
    const tool = graphqlTools.find((t) => t.name === 'graphql_extract_queries')!;

    it('exists', async () => {
      expect(tool).toBeDefined();
    });

    it('has limit property', async () => {
      const limit = (tool.inputSchema.properties as any).limit;
      expect(limit).toBeDefined();
      expect(limit.type).toBe('number');
      expect(limit.default).toBe(50);
    });

    it('has no required fields', async () => {
      expect(tool.inputSchema.required).toBeUndefined();
    });
  });

  describe('graphql_replay tool', () => {
    const tool = graphqlTools.find((t) => t.name === 'graphql_replay')!;

    it('exists', async () => {
      expect(tool).toBeDefined();
    });

    it('has endpoint and query as required', async () => {
      expect(tool.inputSchema.required).toEqual(['endpoint', 'query']);
    });

    it('has variables property', async () => {
      const variables = (tool.inputSchema.properties as any).variables;
      expect(variables).toBeDefined();
      expect(variables.type).toBe('object');
      expect(variables.additionalProperties).toBe(true);
    });

    it('has operationName property', async () => {
      const operationName = (tool.inputSchema.properties as any).operationName;
      expect(operationName).toBeDefined();
      expect(operationName.type).toBe('string');
    });

    it('has headers property', async () => {
      const headers = (tool.inputSchema.properties as any).headers;
      expect(headers).toBeDefined();
      expect(headers.type).toBe('object');
    });
  });
});

describe('graphql barrel/re-export chain', () => {
  it('handlers.ts re-exports GraphQLToolHandlers', async () => {
    const handlers = await import('@server/domains/graphql/handlers');
    expect(handlers.GraphQLToolHandlers).toBeDefined();
    expect(typeof handlers.GraphQLToolHandlers).toBe('function');
  });

  it('index.ts re-exports graphqlTools and GraphQLToolHandlers', async () => {
    const indexModule = await import('@server/domains/graphql/index');
    expect(indexModule.graphqlTools).toBeDefined();
    expect(indexModule.GraphQLToolHandlers).toBeDefined();
    expect(Array.isArray(indexModule.graphqlTools)).toBe(true);
  });

  it('GraphQLToolHandlers from handlers.ts is the same class as from index.ts', async () => {
    const fromHandlers = await import('@server/domains/graphql/handlers');
    const fromIndex = await import('@server/domains/graphql/index');
    expect(fromHandlers.GraphQLToolHandlers).toBe(fromIndex.GraphQLToolHandlers);
  });
});

describe('graphql manifest', () => {
  it('exports a valid domain manifest', async () => {
    const manifestModule = await import('@server/domains/graphql/manifest');
    const manifest = manifestModule.default;

    expect(manifest).toBeDefined();
    expect(manifest.kind).toBe('domain-manifest');
    expect(manifest.version).toBe(1);
    expect(manifest.domain).toBe('graphql');
    expect(manifest.depKey).toBe('graphqlHandlers');
  });

  it('includes workflow and full profiles', async () => {
    const manifestModule = await import('@server/domains/graphql/manifest');
    const manifest = manifestModule.default;

    expect(manifest.profiles).toEqual(['workflow', 'full']);
  });

  it('has registrations for all 5 tools', async () => {
    const manifestModule = await import('@server/domains/graphql/manifest');
    const manifest = manifestModule.default;

    expect(manifest.registrations).toHaveLength(5);
    const toolNames = manifest.registrations.map((r: any) => r.tool.name);
    expect(toolNames).toContain('call_graph_analyze');
    expect(toolNames).toContain('script_replace_persist');
    expect(toolNames).toContain('graphql_introspect');
    expect(toolNames).toContain('graphql_extract_queries');
    expect(toolNames).toContain('graphql_replay');
  });

  it('all registrations have domain set to graphql', async () => {
    const manifestModule = await import('@server/domains/graphql/manifest');
    const manifest = manifestModule.default;

    for (const reg of manifest.registrations) {
      expect(reg.domain).toBe('graphql');
    }
  });

  it('all registrations have a bind function', async () => {
    const manifestModule = await import('@server/domains/graphql/manifest');
    const manifest = manifestModule.default;

    for (const reg of manifest.registrations) {
      expect(typeof reg.bind).toBe('function');
    }
  });

  it('ensure function creates handlers when called', async () => {
    const manifestModule = await import('@server/domains/graphql/manifest');
    const manifest = manifestModule.default;

    const ctx: any = {
      config: { puppeteer: {} },
      registerCaches: vi.fn(async () => {}),
    };

    const result = await manifest.ensure(ctx);
    expect(result).toBeDefined();
    expect(ctx.graphqlHandlers).toBe(result);
    expect(ctx.collector).toBeDefined();
  });

  it('ensure function reuses existing handlers', async () => {
    const manifestModule = await import('@server/domains/graphql/manifest');
    const manifest = manifestModule.default;

    const ctx: any = {
      config: { puppeteer: {} },
      registerCaches: vi.fn(async () => {}),
    };

    const first = await manifest.ensure(ctx);
    const second = await manifest.ensure(ctx);
    expect(first).toBe(second);
  });

  it('ensure function reuses existing collector', async () => {
    const manifestModule = await import('@server/domains/graphql/manifest');
    const manifest = manifestModule.default;

    const existingCollector = { existing: true };
    const ctx: any = {
      config: { puppeteer: {} },
      collector: existingCollector,
      registerCaches: vi.fn(async () => {}),
    };

    await manifest.ensure(ctx);
    expect(ctx.collector).toBe(existingCollector);
  });
});
