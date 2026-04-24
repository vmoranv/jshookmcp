import { describe, it, expect, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));

import { checkEquivalence, EquivalenceCheck, EquivalenceResult } from '@modules/deobfuscator/EquivalenceOracle';

describe('EquivalenceOracle', () => {
  it('checkEquivalence with identical code returns equivalent=true', async () => {
    const code = 'const x = 42;';
    const result = await checkEquivalence(code, code);
    expect(result.equivalent).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('checkEquivalence with different code returns appropriate checks', async () => {
    const original = 'const x = 42; const y = "hello";';
    const deobfuscated = 'const x = 42;';
    const result = await checkEquivalence(original, deobfuscated);
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.checks[0]).toHaveProperty('name');
    expect(result.checks[0]).toHaveProperty('passed');
    expect(result.checks[0]).toHaveProperty('severity');
  });

  it('checkEquivalence preserves literal values', async () => {
    const code = 'const msg = "hello world"; const num = 123;';
    const result = await checkEquivalence(code, code);
    const literalCheck = result.checks.find((c) => c.name === 'literal-preservation');
    expect(literalCheck).toBeDefined();
    expect(literalCheck?.passed).toBe(true);
  });

  it('checkEquivalence preserves function names', async () => {
    const code = 'function greet(name) { return "Hello " + name; }';
    const result = await checkEquivalence(code, code);
    const fnCheck = result.checks.find((c) => c.name === 'function-signature-preservation');
    expect(fnCheck).toBeDefined();
    expect(fnCheck?.passed).toBe(true);
  });

  it('checkEquivalence preserves exports', async () => {
    const code = 'export function main() { return 1; }';
    const result = await checkEquivalence(code, code);
    const exportCheck = result.checks.find((c) => c.name === 'export-preservation');
    expect(exportCheck).toBeDefined();
  });

  it('checkEquivalence returns confidence between 0 and 1', async () => {
    const result = await checkEquivalence('const a = 1;', 'const a = 1;');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('checkEquivalence returns delta information', async () => {
    const result = await checkEquivalence('const x = 1;', 'const x = 1;');
    expect(result.delta).toHaveProperty('literalsAdded');
    expect(result.delta).toHaveProperty('literalsRemoved');
    expect(result.delta).toHaveProperty('functionsAdded');
    expect(result.delta).toHaveProperty('functionsRemoved');
    expect(result.delta).toHaveProperty('exportsChanged');
    expect(result.delta).toHaveProperty('controlFlowChanged');
  });

  it('critical failures trigger rollback recommendation', async () => {
    const result = await checkEquivalence('const x = 1;', 'const x = 1; broken syntax {{{');
    expect(result.shouldRollback).toBe(true);
    expect(result.equivalent).toBe(false);
    expect(result.confidence).toBe(0);
  });
});
