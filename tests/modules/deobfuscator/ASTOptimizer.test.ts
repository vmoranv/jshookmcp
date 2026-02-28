import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

import { ASTOptimizer } from '../../../src/modules/deobfuscator/ASTOptimizer.js';

describe('ASTOptimizer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  it('folds numeric and string constants', () => {
    const code = 'const a = 1 + 2; const b = "x" + "y";';
    const output = new ASTOptimizer().optimize(code);

    expect(output).toContain('const a = 3');
    expect(output).toContain('const b = "xy"');
  });

  it('eliminates dead branches and simplifies logical expressions', () => {
    const code = 'if (false) { x(); } else { y(); } const z = true && run();';
    const output = new ASTOptimizer().optimize(code);

    expect(output).toContain('y();');
    expect(output).toContain('const z = run()');
    expect(output).not.toContain('if (false)');
  });

  it('unfolds computed member/property names where possible', () => {
    const code = `const v = obj["name"]; const o = { ["foo"]: 1 };`;
    const output = new ASTOptimizer().optimize(code);

    expect(output).toContain('obj.name');
    expect(output).toContain('foo: 1');
  });

  it('expands sequence expressions in expression statements', () => {
    const code = '(a(), b(), c());';
    const output = new ASTOptimizer().optimize(code);

    expect(output).toContain('a();');
    expect(output).toContain('b();');
    expect(output).toContain('c();');
  });

  it('returns original code when parsing fails', () => {
    const code = 'function broken( {';
    const output = new ASTOptimizer().optimize(code);

    expect(output).toBe(code);
    expect(loggerState.error).toHaveBeenCalled();
  });
});

