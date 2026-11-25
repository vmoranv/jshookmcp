import * as parser from '@babel/parser';
import { describe, expect, it, vi } from 'vitest';
import { SymbolicExecutor, type Constraint } from '@modules/symbolic/SymbolicExecutor';

vi.mock('@src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const makeState = (pc: number) => ({
  pc,
  stack: [],
  registers: new Map(),
  memory: new Map(),
  pathConstraints: [],
});

describe('SymbolicExecutor bug fixes', () => {
  it('walks statements structurally: pc counts statements, not traverse nodes', async () => {
    const executor = new SymbolicExecutor();
    const result = await executor.execute({
      code: 'let a = 1; let b = 2; let c = a + b;',
      maxPaths: 10,
      maxDepth: 10,
    });

    expect(result.paths).toHaveLength(1);
    // The terminal state's pc equals the number of top-level statements —
    // not the number of AST nodes (which includes Program, declarators,
    // identifiers and literals).
    const finalState = result.paths[0]?.states[0];
    expect(finalState?.pc).toBe(3);
  });

  it('does not treat an empty-memory initial state as terminal', async () => {
    const executor = new SymbolicExecutor();
    const result = await executor.execute({
      code: 'console.log("hello");',
      maxPaths: 5,
      maxDepth: 5,
    });

    // The statement must actually execute before the path terminates.
    expect(result.coverage).toBeGreaterThan(0);
    expect(result.stats.totalPaths).toBeGreaterThanOrEqual(1);
  });

  it('branches into if-consequent and past the if on structural pcs', () => {
    const executor = new SymbolicExecutor() as any;
    const ast = parser.parse('let x = 1; if (x > 5) { x = 2; } else { x = 3; }', {
      sourceType: 'module',
    });

    // Statement indexes: 0=let x, 1=if, 2=x=2 (true), 3=x=3 (false)
    const table = executor.buildStatementTable(ast);
    expect(table.entries).toHaveLength(4);

    const ifStates = executor.executeStep(makeState(1), ast, table);
    expect(ifStates).toHaveLength(2);
    expect(ifStates[0].pc).toBe(2); // true branch enters the consequent
    expect(ifStates[1].pc).toBe(4); // false branch continues past the if
  });

  it('while loop skip jumps past the loop, enter jumps into the body', () => {
    const executor = new SymbolicExecutor() as any;
    const ast = parser.parse('while (x < 10) { x = x + 1; }', { sourceType: 'module' });

    const table = executor.buildStatementTable(ast);
    expect(table.entries).toHaveLength(2);

    const loopStates = executor.executeStep(makeState(0), ast, table);
    expect(loopStates).toHaveLength(2);
    expect(loopStates[0].pc).toBe(1); // enter → body
    expect(loopStates[1].pc).toBe(2); // skip → past the loop (terminal)
  });

  it('resolves assignment right-hand sides into constraints', () => {
    const executor = new SymbolicExecutor() as any;
    const ast = parser.parse('x = y + 1;', { sourceType: 'module' });
    const table = executor.buildStatementTable(ast);

    const states = executor.executeStep(makeState(0), ast, table);
    const value = states[0].memory.get('x');
    expect(value).toBeDefined();
    expect(value.constraints.some((c: Constraint) => c.expression.includes('y + 1'))).toBe(true);
  });

  it('flags custom inequality constraints as contradictory in the legacy solver', () => {
    const executor = new SymbolicExecutor() as any;
    const result = executor.simpleSMTSolver([
      { type: 'custom', expression: 'x > 10', description: '' },
      { type: 'custom', expression: 'x < 5', description: '' },
    ]);
    expect(result.satisfiable).toBe(false);
  });

  it('flags equality-vs-inequality contradictions', () => {
    const executor = new SymbolicExecutor() as any;
    const result = executor.simpleSMTSolver([
      { type: 'custom', expression: 'x == 5', description: '' },
      { type: 'custom', expression: 'x > 5', description: '' },
    ]);
    expect(result.satisfiable).toBe(false);
  });

  it('handles negated constraints (!(x > 5)) in the legacy solver', () => {
    const executor = new SymbolicExecutor() as any;
    const result = executor.simpleSMTSolver([
      { type: 'custom', expression: '!(x > 5)', description: '' },
      { type: 'custom', expression: 'x > 5', description: '' },
    ]);
    expect(result.satisfiable).toBe(false);
  });

  it('does not re-enter an if statement after its body', async () => {
    const executor = new SymbolicExecutor();
    const result = await executor.execute({
      code: 'if (x) { y = 1; } z = 2;',
      maxPaths: 10,
      maxDepth: 20,
    });

    // `if` is statement 0; a correct continuation visits it once per path
    // instead of looping back to it after the consequent.
    for (const path of result.paths) {
      const visits = path.states.filter((state) => state.pc === 0).length;
      expect(visits).toBeLessThanOrEqual(1);
    }
  });
});
