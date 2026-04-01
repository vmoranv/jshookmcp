import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { describe, expect, it } from 'vitest';
import { SymbolicExecutor, type Constraint } from '@modules/symbolic/SymbolicExecutor';

const makeState = (pc: number) => ({
  pc,
  stack: [],
  registers: new Map(),
  memory: new Map(),
  pathConstraints: [],
});

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

  it('covers executeStep branches and helper coverage utilities', () => {
    const executor = new SymbolicExecutor() as any;
    const ast = parser.parse(
      `
        let x = 1;
        if (x) { x = 2; } else { x = 3; }
        while (true) { break; }
        for (;;) { continue; }
        x = 4;
        x++;
      `,
      { sourceType: 'module', plugins: ['typescript'], errorRecovery: true },
    );

    const nodes: { type: string; index: number }[] = [];
    traverse(ast, {
      enter(path) {
        nodes.push({ type: path.node.type, index: nodes.length });
      },
    });

    const variableDeclarationIndex = nodes.find(
      (node) => node.type === 'VariableDeclaration',
    )?.index;
    const ifStatementIndex = nodes.find((node) => node.type === 'IfStatement')?.index;
    const whileStatementIndex = nodes.find((node) => node.type === 'WhileStatement')?.index;
    const forStatementIndex = nodes.find((node) => node.type === 'ForStatement')?.index;
    const assignmentIndex = nodes.find((node) => node.type === 'AssignmentExpression')?.index;
    const numericLiteralIndex = nodes.find((node) => node.type === 'NumericLiteral')?.index;

    expect(variableDeclarationIndex).toBeDefined();
    expect(ifStatementIndex).toBeDefined();
    expect(whileStatementIndex).toBeDefined();
    expect(forStatementIndex).toBeDefined();
    expect(assignmentIndex).toBeDefined();
    expect(numericLiteralIndex).toBeDefined();

    expect(executor.executeStep(makeState(variableDeclarationIndex!), ast)).toHaveLength(1);

    const ifStates = executor.executeStep(makeState(ifStatementIndex!), ast);
    expect(ifStates).toHaveLength(2);
    expect(ifStates[0].pathConstraints[0]?.expression).toContain('x');

    const loopStates = executor.executeStep(makeState(whileStatementIndex!), ast);
    expect(loopStates).toHaveLength(2);
    expect(loopStates[0].pc).toBe(whileStatementIndex! + 1);
    expect(loopStates[1].pc).toBe(whileStatementIndex! + 2);

    const forStates = executor.executeStep(makeState(forStatementIndex!), ast);
    expect(forStates).toHaveLength(2);

    const assignmentStates = executor.executeStep(makeState(assignmentIndex!), ast);
    expect(assignmentStates).toHaveLength(1);
    expect(assignmentStates[0].memory.size).toBeGreaterThan(0);

    const fallbackStates = executor.executeStep(makeState(numericLiteralIndex!), ast);
    expect(fallbackStates).toHaveLength(1);
    expect(fallbackStates[0].pc).toBe(numericLiteralIndex! + 1);

    expect(executor.nodeToString(parser.parseExpression('a + 1'))).toBe('a + 1');
    expect(executor.nodeToString(parser.parseExpression('!flag'))).toBe('!flag');
    expect(executor.nodeToString(parser.parseExpression('callMe()'))).toBe('[Complex Expression]');

    const path = executor.createPath({
      pc: 7,
      stack: [executor.createSymbolicValue('number', 'x')],
      registers: new Map(),
      memory: new Map(),
      pathConstraints: [
        { type: 'inequality', expression: '!(x > 10)', description: '' },
        { type: 'range', expression: 'x > 10', description: '' },
      ],
    });

    expect(path.id).toMatch(/^path-/);
    expect(path.coverage).toBeCloseTo(0.07, 2);
    expect(path.isFeasible).toBe(false);

    const values: any[] = [];
    executor.collectSymbolicValues(
      {
        pc: 0,
        stack: [executor.createSymbolicValue('number', 'stacked')],
        registers: new Map([['r1', executor.createSymbolicValue('number', 'reg')]]),
        memory: new Map([['m1', executor.createSymbolicValue('number', 'mem')]]),
        pathConstraints: [],
      },
      values,
    );
    expect(values.map((value) => value.name)).toEqual(
      expect.arrayContaining(['stacked', 'reg', 'mem']),
    );

    const constraints: Constraint[] = [];
    executor.collectConstraints(
      {
        pc: 0,
        stack: [
          (() => {
            const value = executor.createSymbolicValue('number', 'stacked');
            executor.addConstraint(value, 'custom', 'stacked > 0', 'stacked');
            return value;
          })(),
        ],
        registers: new Map(),
        memory: new Map(),
        pathConstraints: [{ type: 'custom', expression: 'pc == 0', description: '' }],
      },
      constraints,
    );
    expect(constraints.map((constraint) => constraint.expression)).toEqual(
      expect.arrayContaining(['pc == 0', 'stacked > 0']),
    );
  });
});
