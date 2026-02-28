import { describe, expect, it } from 'vitest';
import { SymbolicExecutor, type Constraint } from '../../../src/modules/symbolic/SymbolicExecutor.js';

describe('SymbolicExecutor', () => {
  it('creates symbolic values with unique ids', () => {
    const executor = new SymbolicExecutor();
    const a = executor.createSymbolicValue('number', 'a');
    const b = executor.createSymbolicValue('number', 'b');
    expect(a.id).not.toBe(b.id);
    expect(a.name).toBe('a');
  });

  it('executes simple code and returns result shape', async () => {
    const executor = new SymbolicExecutor();
    const result = await executor.execute({
      code: 'let x = 1; if (x) { x = 2; }',
      maxPaths: 5,
      maxDepth: 5,
    });

    expect(result).toHaveProperty('paths');
    expect(result).toHaveProperty('coverage');
    expect(result.stats.totalPaths).toBeGreaterThanOrEqual(0);
  });

  it('stops with timeout warning when timeout is too small', async () => {
    const executor = new SymbolicExecutor();
    const result = await executor.execute({
      code: 'let x=0; while(x<10){ x=x+1; }',
      timeout: 0,
      maxPaths: 10,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('marks contradictory constraints unsatisfiable in solver', () => {
    const executor = new SymbolicExecutor() as any;
    const constraints: Constraint[] = [
      { type: 'range', expression: 'x > 10', description: '' },
      { type: 'inequality', expression: 'x < 5', description: '' },
    ];
    const solved = executor.simpleSMTSolver(constraints);
    expect(solved.satisfiable).toBe(false);
  });

  it('detects contradictory expressions via helper', () => {
    const executor = new SymbolicExecutor() as any;
    expect(executor.areContradictory('x > 10', 'x < 10')).toBe(true);
    expect(executor.areContradictory('x > 1', 'x < 99')).toBe(false);
  });
});
