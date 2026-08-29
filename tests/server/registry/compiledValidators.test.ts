import { afterEach, describe, expect, it } from 'vitest';
import {
  clearCompiledValidators,
  compileToolValidator,
  compiledValidatorCount,
  fastValidateToolArgs,
  getCompiledValidator,
  registerCompiledValidator,
} from '@server/registry/compiled-validators';

describe('compiled-validators (JIT singleton pool, plan Task 4.2)', () => {
  afterEach(() => {
    clearCompiledValidators();
  });

  it('compiles a flat schema into a pure validator', () => {
    const validator = compileToolValidator('t_simple', {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        max: { type: 'integer' },
        ratio: { type: 'number' },
        verbose: { type: 'boolean' },
        mode: { type: 'string', enum: ['fast', 'slow'] },
        tags: { type: 'array' },
        options: { type: 'object' },
      },
      required: ['pattern'],
    });
    expect(validator).toBeTypeOf('function');

    expect(validator!({ pattern: 'aa' })).toBeNull();
    expect(
      validator!({ pattern: 'aa', max: 5, ratio: 0.5, verbose: true, mode: 'fast' }),
    ).toBeNull();
    expect(validator!({})).toBe('missing required argument: pattern');
    expect(validator!({ pattern: 42 })).toBe(
      'invalid type for t_simple.pattern: expected string, got number',
    );
    expect(validator!({ pattern: 'aa', max: 1.5 })).toBe(
      'invalid type for t_simple.max: expected integer, got number',
    );
    expect(validator!({ pattern: 'aa', mode: 'turbo' })).toContain(
      'invalid value for t_simple.mode',
    );
    expect(validator!({ pattern: 'aa', tags: 'not-array' })).toContain('expected array');
    expect(validator!({ pattern: 'aa', options: [] })).toContain('expected object');
    // null treated as absent (delegates optionality to Zod)
    expect(validator!({ pattern: 'aa', max: null })).toBeNull();
  });

  it('returns null (no-op) for complex or empty schemas instead of guessing', () => {
    expect(compileToolValidator('t_anyof', { anyOf: [{ type: 'string' }] })).toBeNull();
    expect(
      compileToolValidator('t_ref', {
        type: 'object',
        properties: { a: { $ref: '#/x' } },
      }),
    ).toBeNull();
    expect(
      compileToolValidator('t_nested', {
        type: 'object',
        properties: { a: { type: 'object', properties: { b: { type: 'string' } } } },
      }),
    ).toBeNull();
    expect(compileToolValidator('t_empty', { type: 'object', properties: {} })).toBeNull();
    expect(
      compileToolValidator('t_union', {
        type: 'object',
        properties: { a: { type: ['string', 'null'] } },
      }),
    ).toBeNull();
  });

  it('pool registers once, retrieves by name and ignores re-registration', () => {
    clearCompiledValidators();
    const tool = {
      name: 'demo_tool',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
    };
    registerCompiledValidator(tool);
    registerCompiledValidator(tool); // idempotent
    expect(compiledValidatorCount()).toBe(1);

    const validator = getCompiledValidator('demo_tool');
    expect(validator).toBeTypeOf('function');
    expect(validator!({})).toContain('missing required argument: q');
    expect(getCompiledValidator('unknown_tool')).toBeUndefined();

    // Broken schema registration must not throw.
    registerCompiledValidator({ name: 'broken_tool', inputSchema: 'not-a-schema' });
    expect(getCompiledValidator('broken_tool')).toBeUndefined();
    clearCompiledValidators();
    expect(compiledValidatorCount()).toBe(0);
  });

  it('fastValidateToolArgs passes through unknown tools and honours compiled validators', () => {
    registerCompiledValidator({
      name: 'pcapng_read',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    });

    expect(fastValidateToolArgs('pcapng_read', { path: 'a.pcapng' })).toBeNull();
    expect(fastValidateToolArgs('pcapng_read', {})).toContain('missing required argument: path');
    // Unknown tools are always OK (fall through to Zod / handler-level checks).
    expect(fastValidateToolArgs('never_registered_tool', { whatever: true })).toBeNull();
  });

  it('compiled validator accepts extra (undeclared) keys like _meta', () => {
    const validator = compileToolValidator('t_extra', {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    });
    expect(
      validator!({
        path: 'x',
        _meta: { progressToken: 'p1', sessionId: 's' },
        onProgress: () => {},
      }),
    ).toBeNull();
  });
});
