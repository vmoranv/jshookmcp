import * as parser from '@babel/parser';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

import { ASTOptimizer } from '@modules/deobfuscator/ASTOptimizer';

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

  it('folds unary expressions and inlines repeated literals', () => {
    const code = `
      const answer = 42;
      const total = answer + answer + answer;
      const neg = -5;
      const enabled = !false;
      const normalized = !!flag;
    `;
    const output = new ASTOptimizer().optimize(code);

    expect(output).toContain('const total = 126');
    expect(output).toContain('const neg = -5');
    expect(output).toContain('const enabled = true');
    expect(output).toContain('Boolean(flag)');
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

  it('covers remaining arithmetic and dead-code simplification branches', () => {
    const code = `
      const sum = 1 + 2;
      const diff = 8 - 3;
      const prod = 2 * 4;
      const div = 9 / 3;
      const mod = 10 % 4;
      const pow = 2 ** 3;
      const positive = +5;
      const zeroed = 6 * 0;
      const same = 7 * 1;
      const plusZero = value + 0;
      if (true) { keep(); } else { drop(); }
      if (false) { removed(); }
      const ternaryTrue = true ? 'yes' : 'no';
      const ternaryFalse = false ? 'yes' : 'no';
      const logicalAnd = false && fallback();
      const logicalOr = false || fallback();
      const logicalOrTrue = true || fallback();
      const member = obj["not-valid-key"];
      const computed = { ["not-valid-key"]: 1, ["validKey"]: 2 };
    `;

    const output = new ASTOptimizer().optimize(code);

    expect(output).toContain('const sum = 3');
    expect(output).toContain('const diff = 5');
    expect(output).toContain('const prod = 8');
    expect(output).toContain('const div = 3');
    expect(output).toContain('const mod = 2');
    expect(output).toContain('const pow = 8');
    expect(output).toContain('const positive = 5');
    expect(output).toContain('const zeroed = 0');
    expect(output).toContain('const same = 7');
    expect(output).toContain('const plusZero = value');
    expect(output).toContain('keep();');
    expect(output).not.toContain('drop();');
    expect(output).not.toContain('removed();');
    expect(output).toContain("const ternaryTrue = 'yes'");
    expect(output).toContain("const ternaryFalse = 'no'");
    expect(output).toContain('const logicalAnd = false');
    expect(output).toContain('const logicalOr = fallback()');
    expect(output).toContain('const logicalOrTrue = true');
    expect(output).toContain('obj["not-valid-key"]');
    expect(output).toContain('validKey: 2');
  });

  it('expands sequence expressions in expression statements', () => {
    const code = '(a(), b(), c());';
    const output = new ASTOptimizer().optimize(code);

    expect(output).toContain('a();');
    expect(output).toContain('b();');
    expect(output).toContain('c();');
  });

  it('respects the variable inlining usage threshold', () => {
    const optimizer = new ASTOptimizer() as any;
    const ast = parser.parse(
      `
        const inlineMe = 1;
        const keepMe = 2;
        const useInline = inlineMe + inlineMe + inlineMe;
        const useKeep = keepMe + keepMe + keepMe + keepMe;
      `,
      { sourceType: 'module' },
    );

    optimizer.variableInlining(ast);
    const output = generate(ast).code;

    expect(output).toContain('const useInline = 1 + 1 + 1');
    expect(output).toContain('const useKeep = keepMe + keepMe + keepMe + keepMe');
  });

  it('expands a single-expression sequence node when invoked directly', () => {
    const optimizer = new ASTOptimizer() as any;
    const ast = parser.parse('foo();', { sourceType: 'module' });
    const statement = ast.program.body[0];

    expect(statement?.type).toBe('ExpressionStatement');
    if (statement?.type === 'ExpressionStatement') {
      statement.expression = t.sequenceExpression([t.callExpression(t.identifier('foo'), [])]);
    }

    optimizer.sequenceExpressionExpansion(ast);
    const output = generate(ast).code;

    expect(output).toContain('foo();');
  });

  it('returns original code when parsing fails', () => {
    const code = 'function broken( {';
    const output = new ASTOptimizer().optimize(code);

    expect(output).toBe(code);
    expect(loggerState.error).toHaveBeenCalled();
  });
});
