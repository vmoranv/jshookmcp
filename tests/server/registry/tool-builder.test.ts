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

  it('supports block-bodied configurators that do not return a builder', () => {
    const built = tool('void_callback_tool', (t: ToolBuilder) => {
      t.desc('Void callback builder form')
        .string('serial', 'Device serial')
        .requiredOpenWorld('serial');
    });

    expect(built).toMatchObject({
      name: 'void_callback_tool',
      description: 'Void callback builder form',
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

  it('supports outputSchema configuration for structured payload typing', () => {
    const built = tool('structured_tool', (t) =>
      t
        .desc('Returns typed output')
        .outputSchema({ type: 'object', properties: { count: { type: 'number' } } }),
    );

    expect(built.outputSchema).toEqual({
      type: 'object',
      properties: { count: { type: 'number' } },
    });
  });

  it('returns new builder snapshots without mutating the previous one', () => {
    let captured!: ToolBuilder;
    tool('immutability_probe', (t) => {
      captured = t;
      return t;
    });

    const base = captured as ToolBuilder & { build(): ReturnType<typeof tool> };
    const next = base.desc('Derived').string('value', 'Probe value');

    expect(base.build()).toMatchObject({
      name: 'immutability_probe',
      description: '',
      inputSchema: { properties: {} },
    });
    expect((next as ToolBuilder & { build(): ReturnType<typeof tool> }).build()).toMatchObject({
      name: 'immutability_probe',
      description: 'Derived',
      inputSchema: {
        properties: {
          value: {
            type: 'string',
            description: 'Probe value',
          },
        },
      },
    });
  });
});
