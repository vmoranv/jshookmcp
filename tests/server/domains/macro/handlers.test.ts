import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MacroToolHandlers } from '@server/domains/macro/handlers';

vi.mock('@server/macros/MacroRunner', () => {
  return {
    MacroRunner: class {
      async execute() {
        return { ok: true, durationMs: 100 };
      }
      formatProgressReport() {
        return 'Mocked Report';
      }
    },
  };
});

vi.mock('@server/macros/MacroConfigLoader', () => {
  return {
    MacroConfigLoader: {
      loadFromDirectory() {
        return Promise.resolve([
          {
            id: 'custom_macro',
            displayName: 'Custom Macro',
            description: 'Custom',
            tags: [],
            steps: [],
          },
        ]);
      },
    },
  };
});

vi.mock('@utils/outputPaths', () => ({
  getProjectRoot: () => '/mock/project/root',
}));

describe('MacroToolHandlers', () => {
  let handlers: MacroToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    const map = new Map<string, any>();
    const ctx: any = {
      getDomainInstance: (key: string) => map.get(key),
      setDomainInstance: (key: string, inst: any) => map.set(key, inst),
      getToolRegistry: () => ({ getAnnotationsForTool: () => [] }),
    };
    handlers = new MacroToolHandlers(ctx);
  });

  describe('handleListMacros', () => {
    it('should list built-in and custom macros', async () => {
      const result = (await handlers.handleListMacros()) as any;
      expect(result.content[0].type).toBe('text');
      const data = JSON.parse(result.content[0].text);
      expect(data.macros).toBeInstanceOf(Array);
      expect(data.count).toBeGreaterThan(0);
      expect(data.macros.find((m: any) => m.id === 'custom_macro')).toBeDefined();
    });
  });

  describe('handleRunMacro', () => {
    it('should return error if macroId is missing', async () => {
      const result = (await handlers.handleRunMacro({})) as any;
      expect(result.content[0].text).toContain('macroId parameter is required');
    });

    it('should return error if macro not found', async () => {
      const result = (await handlers.handleRunMacro({ macroId: 'non_existent_macro' })) as any;
      expect(result.content[0].text).toContain('not found');
    });

    it('should execute existing macro and return report', async () => {
      // First call list to ensure loaded (though handleRunMacro also loads)
      const result = (await handlers.handleRunMacro({ macroId: 'custom_macro' })) as any;
      expect(result.content[0].text).toBe('Mocked Report');
    });
  });
});
