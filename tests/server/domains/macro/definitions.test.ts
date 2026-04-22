import { describe, expect, it } from 'vitest';
import { macroTools } from '@server/domains/macro/definitions';

describe('macroTools', () => {
  it('should define run_macro tool', async () => {
    const tool = macroTools.find((t) => t.name === 'run_macro');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('Execute a registered macro');
    expect(tool?.inputSchema.required).toContain('macroId');
    expect(tool?.inputSchema.properties).toHaveProperty('inputOverrides');
  });

  it('should define list_macros tool', async () => {
    const tool = macroTools.find((t) => t.name === 'list_macros');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('List all available macros');
    expect(tool?.inputSchema.properties).toEqual({});
  });
});
