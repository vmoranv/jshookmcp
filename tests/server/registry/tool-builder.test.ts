import { describe, expect, it } from 'vitest';
import { tool, type ToolBuilder } from '@server/registry/tool-builder';

describe('tool-builder', () => {
  it('supports callback form and auto-builds the final tool', () => {
    const built = tool('callback_tool', (t: ToolBuilder) =>
      t.desc('Callback builder form').string('serial', 'Device serial').requiredOpenWorld('serial'),
    );

    expect(built).toMatchObject({
      name: 'callback_tool',
      description: 'Callback builder form',
      inputSchema: {
        type: 'object',
        required: ['serial'],
        properties: {
          serial: {
            type: 'string',
            description: 'Device serial',
          },
        },
      },
      annotations: {
        openWorldHint: true,
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    });
  });

  it('supports query helper for read-only idempotent tools', () => {
    const built = tool('query_tool', (t: ToolBuilder) => t.desc('Query tool').query());

    expect(built.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it('supports resettable helper for destructive idempotent tools', () => {
    const built = tool('reset_tool', (t: ToolBuilder) => t.desc('Reset tool').resettable());

    expect(built.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: true,
      destructiveHint: true,
      openWorldHint: false,
    });
  });
});
