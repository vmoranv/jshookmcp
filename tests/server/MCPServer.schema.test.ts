import { describe, it, expect } from 'vitest';
import { buildZodShape } from '../../src/server/MCPServer.schema.js';

describe('MCPServer.schema – buildZodShape', () => {
  it('converts basic string property', () => {
    const shape = buildZodShape({
      properties: {
        name: { type: 'string', description: 'The name' },
      },
      required: ['name'],
    });
    expect(shape.name).toBeDefined();
    const result = shape.name!.safeParse('hello');
    expect(result.success).toBe(true);
  });

  it('converts string enum property', () => {
    const shape = buildZodShape({
      properties: {
        mode: { type: 'string', enum: ['fast', 'slow'] },
      },
    });
    const valid = shape.mode!.safeParse('fast');
    expect(valid.success).toBe(true);
    const invalid = shape.mode!.safeParse('medium');
    expect(invalid.success).toBe(false);
  });

  it('converts number with min/max constraints', () => {
    const shape = buildZodShape({
      properties: {
        count: { type: 'number', minimum: 1, maximum: 100 },
      },
      required: ['count'],
    });
    expect(shape.count!.safeParse(50).success).toBe(true);
    expect(shape.count!.safeParse(0).success).toBe(false);
    expect(shape.count!.safeParse(101).success).toBe(false);
  });

  it('converts integer type', () => {
    const shape = buildZodShape({
      properties: {
        port: { type: 'integer', minimum: 1, maximum: 65535 },
      },
      required: ['port'],
    });
    expect(shape.port!.safeParse(8080).success).toBe(true);
    expect(shape.port!.safeParse(3.14).success).toBe(false);
  });

  it('converts boolean property', () => {
    const shape = buildZodShape({
      properties: {
        enabled: { type: 'boolean' },
      },
    });
    expect(shape.enabled!.safeParse(true).success).toBe(true);
    expect(shape.enabled!.safeParse('yes').success).toBe(false);
  });

  it('converts array of strings', () => {
    const shape = buildZodShape({
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
      },
    });
    expect(shape.tags!.safeParse(['a', 'b']).success).toBe(true);
    expect(shape.tags!.safeParse('not-array').success).toBe(false);
  });

  it('converts nested object', () => {
    const shape = buildZodShape({
      properties: {
        config: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            port: { type: 'number' },
          },
          required: ['host'],
        },
      },
    });
    expect(shape.config!.safeParse({ host: 'localhost' }).success).toBe(true);
    expect(shape.config!.safeParse({ port: 3000 }).success).toBe(false);
  });

  it('marks required vs optional fields correctly', () => {
    const shape = buildZodShape({
      properties: {
        required_field: { type: 'string' },
        optional_field: { type: 'string' },
      },
      required: ['required_field'],
    });
    // required_field should reject undefined
    expect(shape.required_field!.safeParse(undefined).success).toBe(false);
    // optional_field should accept undefined
    expect(shape.optional_field!.safeParse(undefined).success).toBe(true);
  });

  it('handles string with pattern constraint', () => {
    const shape = buildZodShape({
      properties: {
        hex: { type: 'string', pattern: '^[0-9a-f]+$' },
      },
    });
    expect(shape.hex!.safeParse('deadbeef').success).toBe(true);
    expect(shape.hex!.safeParse('xyz').success).toBe(false);
  });

  it('preserves description on generated zod type', () => {
    const shape = buildZodShape({
      properties: {
        url: { type: 'string', description: 'Target URL to navigate to' },
      },
      required: ['url'],
    });
    expect(shape.url).toBeDefined();
    // Zod stores description internally
    expect(shape.url!.description).toBe('Target URL to navigate to');
  });

  it('handles empty schema gracefully', () => {
    const shape = buildZodShape({});
    expect(Object.keys(shape).length).toBe(0);
  });

  it('handles unknown type as z.unknown', () => {
    const shape = buildZodShape({
      properties: {
        weird: { type: 'custom_type' },
      },
    });
    expect(shape.weird!.safeParse('anything').success).toBe(true);
    expect(shape.weird!.safeParse(42).success).toBe(true);
  });
});
