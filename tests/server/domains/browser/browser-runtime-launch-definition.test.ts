import { describe, expect, it } from 'vitest';
import { browserRuntimeTools } from '@server/domains/browser/definitions.tools.runtime';

type ObjectInputSchema = {
  type: 'object';
  properties: Record<string, unknown>;
};

function getBrowserLaunchSchema(): ObjectInputSchema {
  const tool = browserRuntimeTools.find((candidate) => candidate.name === 'browser_launch');
  expect(tool).toBeDefined();
  return tool?.inputSchema as ObjectInputSchema;
}

describe('browser_launch runtime schema', () => {
  it('exposes extra Chrome args and V8 native syntax toggle', () => {
    const schema = getBrowserLaunchSchema();

    expect(schema.properties).toHaveProperty('args');
    expect(schema.properties).toHaveProperty('enableV8NativesSyntax');
    expect(schema.properties['args']).toEqual(
      expect.objectContaining({
        type: 'array',
        items: { type: 'string' },
      }),
    );
    expect(schema.properties['enableV8NativesSyntax']).toEqual(
      expect.objectContaining({
        type: 'boolean',
      }),
    );
  });
});
