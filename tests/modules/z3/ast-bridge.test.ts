import { describe, expect, it } from 'vitest';
import { AstBridgeError, canParseExpr, jsExprToZ3, type VarDecl } from '@modules/z3/ast-bridge';

const realZ3 = process.env.Z3_TEST_REAL === '1';

/**
 * Minimal Z3 Context mock. `const(name)` returns a recording proxy whose
 * prototype lists the expected duck-type methods (`.gt()`, `.add()`, etc.)
 * so the bridge's `call()` reflection finds real functions. Each call pushes
 * `{op, args}` onto the shared `calls` array for assertion.
 */
function makeMockCtx() {
  const calls: Array<{ op: string; label: string; args: unknown[] }> = [];
  const mk = (label: string): Record<string, unknown> =>
    new Proxy(
      { _label: label },
      {
        get(_target, prop: string | symbol) {
          if (prop === '_label') return label;
          if (typeof prop === 'symbol') return undefined; // Symbol(Symbol.toPrimitive) etc.
          return (...args: unknown[]) => {
            calls.push({ op: prop, label, args });
            return mk(`${label}.${prop}`);
          };
        },
      },
    );
  const type = (label: string) => ({
    const: (name: string) => mk(`${label}.const(${name})`),
    val: (v: unknown) => mk(`${label}.val(${String(v)})`),
  });
  return {
    ctx: { Int: type('Int'), Bool: type('Bool'), Real: type('Real'), BitVec: type('BitVec') },
    calls,
  };
}

describe('ast-bridge (pure logic, mock Context)', () => {
  it('parses a numeric literal and returns a proxy (no throw)', () => {
    const { ctx } = makeMockCtx();
    const result = jsExprToZ3('42', {} as never, ctx as never, []);
    expect(result).toBeDefined();
  });

  it('resolves a declared int variable via env', () => {
    const { ctx } = makeMockCtx();
    const vars: VarDecl[] = [{ name: 'x', type: 'int' }];
    const result = jsExprToZ3('x', {} as never, ctx as never, vars);
    expect(result).toBeDefined();
  });

  it('throws AstBridgeError for an undeclared variable', () => {
    const { ctx } = makeMockCtx();
    expect(() => jsExprToZ3('y', {} as never, ctx as never, [])).toThrow(AstBridgeError);
    expect(() => jsExprToZ3('y', {} as never, ctx as never, [])).toThrow(/Undeclared variable: y/);
  });

  it('translates each binary comparison operator to the right Z3 method', () => {
    const expected: [string, string][] = [
      ['<', 'lt'],
      ['>', 'gt'],
      ['<=', 'le'],
      ['>=', 'ge'],
      ['==', 'eq'],
      ['===', 'eq'],
      ['!=', 'neq'],
      ['!==', 'neq'],
    ];
    for (const [jsOp, z3Op] of expected) {
      const { ctx, calls } = makeMockCtx();
      jsExprToZ3(`x ${jsOp} 10`, {} as never, ctx as never, [{ name: 'x', type: 'int' }]);
      expect(calls[0]?.op).toBe(z3Op);
    }
  });

  it('translates arithmetic operators (+ - * / % **)', () => {
    const expected: [string, string][] = [
      ['+', 'add'],
      ['-', 'sub'],
      ['*', 'mul'],
      ['/', 'div'],
      ['%', 'mod'],
      ['**', 'pow'],
    ];
    for (const [jsOp, z3Op] of expected) {
      const { ctx, calls } = makeMockCtx();
      jsExprToZ3(`x ${jsOp} 1`, {} as never, ctx as never, [{ name: 'x', type: 'int' }]);
      expect(calls[0]?.op).toBe(z3Op);
    }
  });

  it('translates && to and, || to or', () => {
    const { ctx: ctxObj, calls: c1 } = makeMockCtx();
    jsExprToZ3('x > 0 && y < 0', {} as never, ctxObj as never, [
      { name: 'x', type: 'int' },
      { name: 'y', type: 'int' },
    ]);
    expect(c1.some((c) => c.op === 'and')).toBe(true);

    const { ctx: ctx2, calls: c2 } = makeMockCtx();
    jsExprToZ3('x > 0 || y < 0', {} as never, ctx2 as never, [
      { name: 'x', type: 'int' },
      { name: 'y', type: 'int' },
    ]);
    expect(c2.some((c) => c.op === 'or')).toBe(true);
  });

  it('translates ! to not, unary - to neg', () => {
    const { ctx, calls } = makeMockCtx();
    jsExprToZ3('!x', {} as never, ctx as never, [{ name: 'x', type: 'bool' }]);
    expect(calls.some((c) => c.op === 'not')).toBe(true);

    const { ctx: ctx2, calls: c2 } = makeMockCtx();
    jsExprToZ3('-x', {} as never, ctx2 as never, [{ name: 'x', type: 'int' }]);
    expect(c2.some((c) => c.op === 'neg')).toBe(true);
  });

  it('handles nested parens and unary on a compound expression', () => {
    const { ctx, calls } = makeMockCtx();
    jsExprToZ3('!(x > 10 && y < 5)', {} as never, ctx as never, [
      { name: 'x', type: 'int' },
      { name: 'y', type: 'int' },
    ]);
    expect(calls.some((c) => c.op === 'and')).toBe(true);
    expect(calls.some((c) => c.op === 'not')).toBe(true);
  });

  it('declares bitvec variables and resolves them', () => {
    const { ctx } = makeMockCtx();
    const result = jsExprToZ3('x', {} as never, ctx as never, [
      { name: 'x', type: 'bitvec', bits: 32 },
    ]);
    expect(result).toBeDefined();
  });

  it('throws for unsupported binary operators', () => {
    const { ctx } = makeMockCtx();
    expect(() =>
      jsExprToZ3('x & 1', {} as never, ctx as never, [{ name: 'x', type: 'int' }]),
    ).toThrow(/Unsupported binary operator: &/);
  });

  it('throws for unsupported node types (template literal)', () => {
    const { ctx } = makeMockCtx();
    // `` template literals are `TaggedTemplateExpression` etc., not supportable
    expect(() => jsExprToZ3('`hello`', {} as never, ctx as never, [])).toThrow(AstBridgeError);
  });

  it('canParseExpr returns true for valid expressions', () => {
    expect(canParseExpr('x > 10')).toBe(true);
    expect(canParseExpr('!(a && b) || c')).toBe(true);
  });

  it('canParseExpr returns false for unparseable garbage', () => {
    expect(canParseExpr('@#$%')).toBe(false);
  });
});

describe.runIf(realZ3)('ast-bridge (real Z3 WASM)', () => {
  const loadBridge = () => import('@modules/z3/ast-bridge');
  const loadSolver = () => import('@modules/z3/Z3Solver');

  it('solves a SAT conjunction of int constraints', async () => {
    const { withZ3 } = await loadSolver();
    const bridge = await loadBridge();
    const result = await withZ3(async (api) => {
      const ctx = new api.Context('main');
      const { Solver, And: AndExpr } = ctx;
      const solver = new Solver();
      solver.set('timeout', 5000);

      const a = bridge.jsExprToZ3('x > 10', api, ctx, [{ name: 'x', type: 'int' }]) as never;
      const b = bridge.jsExprToZ3('x < 20', api, ctx, [{ name: 'x', type: 'int' }]) as never;
      solver.add(AndExpr(a, b));
      const res = await solver.check();
      if (res !== 'sat') return null;
      return solver.model().get(ctx.Int.const('x'))?.toString() ?? null;
    });
    expect(result).not.toBeNull();
    const n = Number(result);
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThan(20);
  });

  it('proves an UNSAT pair of constraints', async () => {
    const { withZ3 } = await loadSolver();
    const bridge = await loadBridge();
    const res = await withZ3(async (api) => {
      const ctx = new api.Context('main');
      const { Solver, And: AndExpr } = ctx;
      const solver = new Solver();
      solver.set('timeout', 5000);
      const a = bridge.jsExprToZ3('x > 10', api, ctx, [{ name: 'x', type: 'int' }]) as never;
      const b = bridge.jsExprToZ3('x < 5', api, ctx, [{ name: 'x', type: 'int' }]) as never;
      solver.add(AndExpr(a, b));
      return solver.check();
    });
    expect(res).toBe('unsat');
  });

  it('handles complex nested logical expression', async () => {
    const { withZ3 } = await loadSolver();
    const bridge = await loadBridge();
    const res = await withZ3(async (api) => {
      const ctx = new api.Context('main');
      const { Solver } = ctx;
      const solver = new Solver();
      solver.set('timeout', 5000);
      // (x > 0 && y > 0) => x + y > 0  (always true for integers)
      const c = bridge.jsExprToZ3('!(x > 0 && y > 0) || (x + y > 0)', api, ctx, [
        { name: 'x', type: 'int' },
        { name: 'y', type: 'int' },
      ]) as never;
      solver.add(c);
      return solver.check();
    });
    // This is a tautology, so z3 should return 'sat' (it's satisfiable,
    // there are no contradictions)
    expect(res).toBe('sat');
  });
});
