import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { logger } from '../../utils/logger.js';

export type SymbolicValueType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'object'
  | 'array'
  | 'function'
  | 'undefined'
  | 'unknown';

export interface SymbolicValue {
  id: string;
  type: SymbolicValueType;
  name: string;
  constraints: Constraint[];
  possibleValues?: unknown[];
  source?: string;
}

export interface Constraint {
  type: 'equality' | 'inequality' | 'range' | 'type' | 'custom';
  expression: string;
  description: string;
}

export interface SymbolicState {
  pc: number;
  stack: SymbolicValue[];
  registers: Map<string, SymbolicValue>;
  memory: Map<string, SymbolicValue>;
  pathConstraints: Constraint[];
}

export interface ExecutionPath {
  id: string;
  states: SymbolicState[];
  constraints: Constraint[];
  isFeasible: boolean;
  coverage: number;
}

export interface SymbolicExecutorOptions {
  code: string;
  maxPaths?: number;
  maxDepth?: number;
  timeout?: number;
  enableConstraintSolving?: boolean;
}

export interface SymbolicExecutorResult {
  paths: ExecutionPath[];
  coverage: number;
  symbolicValues: SymbolicValue[];
  constraints: Constraint[];
  warnings: string[];
  stats: {
    totalPaths: number;
    feasiblePaths: number;
    infeasiblePaths: number;
    executionTime: number;
  };
}

export class SymbolicExecutor {
  private symbolCounter = 0;
  private pathCounter = 0;

  async execute(options: SymbolicExecutorOptions): Promise<SymbolicExecutorResult> {
    const startTime = Date.now();
    const {
      code,
      maxPaths = 100,
      maxDepth = 50,
      timeout = 30000,
      enableConstraintSolving = false,
    } = options;

    logger.info(' ...');

    const paths: ExecutionPath[] = [];
    const allSymbolicValues: SymbolicValue[] = [];
    const allConstraints: Constraint[] = [];
    const warnings: string[] = [];

    try {
      const ast = parser.parse(code, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
      });

      const initialState: SymbolicState = {
        pc: 0,
        stack: [],
        registers: new Map(),
        memory: new Map(),
        pathConstraints: [],
      };

      const worklist: { state: SymbolicState; depth: number }[] = [
        { state: initialState, depth: 0 },
      ];

      while (worklist.length > 0 && paths.length < maxPaths) {
        if (Date.now() - startTime > timeout) {
          warnings.push('');
          break;
        }

        const { state, depth } = worklist.pop()!;

        if (depth >= maxDepth) {
          warnings.push(`: ${maxDepth}`);
          continue;
        }

        const nextStates = this.executeStep(state, ast);

        for (const nextState of nextStates) {
          if (this.isTerminalState(nextState)) {
            const path = this.createPath(nextState);
            paths.push(path);

            this.collectSymbolicValues(nextState, allSymbolicValues);
            this.collectConstraints(nextState, allConstraints);
          } else {
            worklist.push({ state: nextState, depth: depth + 1 });
          }
        }
      }

      if (enableConstraintSolving) {
        await this.solveConstraints(paths, warnings);
      }

      const coverage = this.calculateCoverage(paths, ast);

      const executionTime = Date.now() - startTime;

      logger.info(`Symbolic execution complete in ${executionTime}ms`);
      logger.info(` : ${paths.length}`);
      logger.info(` : ${(coverage * 100).toFixed(1)}%`);

      return {
        paths,
        coverage,
        symbolicValues: allSymbolicValues,
        constraints: allConstraints,
        warnings,
        stats: {
          totalPaths: paths.length,
          feasiblePaths: paths.filter((p) => p.isFeasible).length,
          infeasiblePaths: paths.filter((p) => !p.isFeasible).length,
          executionTime,
        },
      };
    } catch (error) {
      logger.error('', error);
      throw error;
    }
  }

  private executeStep(state: SymbolicState, ast: t.File): SymbolicState[] {
    const nextStates: SymbolicState[] = [];
    let currentNode: t.Node | null = null;

    let nodeIndex = 0;
    traverse(ast, {
      enter(path) {
        if (nodeIndex === state.pc) {
          currentNode = path.node;
          path.stop();
        }
        nodeIndex++;
      },
    });

    if (!currentNode) {
      return [];
    }

    if (t.isVariableDeclaration(currentNode)) {
      const newState = this.cloneState(state);
      const varDecl = currentNode as t.VariableDeclaration;
      varDecl.declarations.forEach((decl: t.VariableDeclarator) => {
        if (t.isIdentifier(decl.id)) {
          const varName = decl.id.name;
          const symbolicValue = this.createSymbolicValue('unknown', varName, varName);
          newState.memory.set(varName, symbolicValue);
        }
      });
      newState.pc++;
      nextStates.push(newState);
    } else if (t.isIfStatement(currentNode)) {
      const trueState = this.cloneState(state);
      const falseState = this.cloneState(state);

      const ifStmt = currentNode as t.IfStatement;
      const conditionExpr = this.nodeToString(ifStmt.test);
      trueState.pathConstraints.push({
        type: 'custom',
        expression: conditionExpr,
        description: '',
      });
      falseState.pathConstraints.push({
        type: 'custom',
        expression: `!(${conditionExpr})`,
        description: '',
      });

      trueState.pc++;
      falseState.pc++;
      nextStates.push(trueState, falseState);
    } else if (t.isWhileStatement(currentNode) || t.isForStatement(currentNode)) {
      const enterState = this.cloneState(state);
      const skipState = this.cloneState(state);

      enterState.pc++;
      skipState.pc += 2;
      nextStates.push(enterState, skipState);
    } else if (t.isAssignmentExpression(currentNode)) {
      const newState = this.cloneState(state);
      const assignExpr = currentNode as t.AssignmentExpression;
      if (t.isIdentifier(assignExpr.left)) {
        const varName = assignExpr.left.name;
        const rightExpr = this.nodeToString(assignExpr.right);
        const symbolicValue = this.createSymbolicValue('unknown', rightExpr, rightExpr);
        newState.memory.set(varName, symbolicValue);
      }
      newState.pc++;
      nextStates.push(newState);
    } else {
      const newState = this.cloneState(state);
      newState.pc++;
      nextStates.push(newState);
    }

    return nextStates;
  }

  private nodeToString(node: t.Node): string {
    if (t.isIdentifier(node)) {
      return node.name;
    } else if (t.isNumericLiteral(node)) {
      return String(node.value);
    } else if (t.isStringLiteral(node)) {
      return `"${node.value}"`;
    } else if (t.isBinaryExpression(node)) {
      return `${this.nodeToString(node.left)} ${node.operator} ${this.nodeToString(node.right)}`;
    } else if (t.isUnaryExpression(node)) {
      return `${node.operator}${this.nodeToString(node.argument)}`;
    } else {
      return '[Complex Expression]';
    }
  }

  private isTerminalState(state: SymbolicState): boolean {
    if (state.pc > 1000) {
      return true;
    }

    if (state.pathConstraints.length > 50) {
      return true;
    }

    if (state.stack.length === 0 && state.memory.size === 0) {
      return true;
    }

    return false;
  }

  private createPath(state: SymbolicState): ExecutionPath {
    const pathId = `path-${this.pathCounter++}`;

    const coverage = this.calculatePathCoverage(state);

    return {
      id: pathId,
      states: [state],
      constraints: [...state.pathConstraints],
      isFeasible: this.checkPathFeasibility(state.pathConstraints),
      coverage,
    };
  }

  private calculatePathCoverage(state: SymbolicState): number {
    return Math.min(state.pc / 100, 1.0);
  }

  private checkPathFeasibility(constraints: Constraint[]): boolean {
    const expressions = new Set<string>();

    for (const constraint of constraints) {
      const expr = constraint.expression;

      if (expressions.has(`!(${expr})`)) {
        return false;
      }

      expressions.add(expr);
    }

    return true;
  }

  private collectSymbolicValues(state: SymbolicState, collection: SymbolicValue[]): void {
    const seen = new Set<string>();

    for (const value of state.stack) {
      if (!seen.has(value.id)) {
        collection.push(value);
        seen.add(value.id);
      }
    }

    for (const value of state.registers.values()) {
      if (!seen.has(value.id)) {
        collection.push(value);
        seen.add(value.id);
      }
    }

    for (const value of state.memory.values()) {
      if (!seen.has(value.id)) {
        collection.push(value);
        seen.add(value.id);
      }
    }
  }

  private collectConstraints(state: SymbolicState, collection: Constraint[]): void {
    const seen = new Set<string>();

    for (const constraint of state.pathConstraints) {
      const key = `${constraint.type}:${constraint.expression}`;
      if (!seen.has(key)) {
        collection.push(constraint);
        seen.add(key);
      }
    }

    const allValues = [
      ...state.stack,
      ...Array.from(state.registers.values()),
      ...Array.from(state.memory.values()),
    ];

    for (const value of allValues) {
      for (const constraint of value.constraints) {
        const key = `${constraint.type}:${constraint.expression}`;
        if (!seen.has(key)) {
          collection.push(constraint);
          seen.add(key);
        }
      }
    }
  }

  private async solveConstraints(paths: ExecutionPath[], warnings: string[]): Promise<void> {
    logger.info(' ...');

    for (const path of paths) {
      const result = this.simpleSMTSolver(path.constraints);

      if (!result.satisfiable) {
        path.isFeasible = false;
        warnings.push(` ${path.id} : ${result.reason}`);
      } else {
        path.isFeasible = true;
      }
    }

    logger.info(
      `Path analysis complete, feasible paths: ${paths.filter((p) => p.isFeasible).length}/${paths.length}`
    );
  }

  private simpleSMTSolver(constraints: Constraint[]): { satisfiable: boolean; reason?: string } {
    const numericConstraints = constraints.filter(
      (c) => c.type === 'range' || c.type === 'inequality'
    );

    for (let i = 0; i < numericConstraints.length; i++) {
      for (let j = i + 1; j < numericConstraints.length; j++) {
        const c1 = numericConstraints[i];
        const c2 = numericConstraints[j];

        if (!c1 || !c2) continue;

        if (this.areContradictory(c1.expression, c2.expression)) {
          return {
            satisfiable: false,
            reason: `: ${c1.expression}  ${c2.expression}`,
          };
        }
      }
    }

    return { satisfiable: true };
  }

  private areContradictory(expr1: string, expr2: string): boolean {
    const pattern1 = /(\w+)\s*>\s*(\d+)/;
    const pattern2 = /(\w+)\s*<\s*(\d+)/;

    const match1 = expr1.match(pattern1);
    const match2 = expr2.match(pattern2);

    if (match1 && match2 && match1[1] === match2[1] && match1[2] && match2[2]) {
      const val1 = parseInt(match1[2], 10);
      const val2 = parseInt(match2[2], 10);
      return val1 >= val2;
    }

    return false;
  }

  private calculateCoverage(paths: ExecutionPath[], ast: t.File): number {
    let totalStatements = 0;
    traverse(ast, {
      Statement() {
        totalStatements++;
      },
    });

    if (totalStatements === 0) {
      return 0;
    }

    const coveredStatements = new Set<number>();
    for (const path of paths) {
      for (const state of path.states) {
        coveredStatements.add(state.pc);
      }
    }

    return coveredStatements.size / totalStatements;
  }

  private cloneState(state: SymbolicState): SymbolicState {
    return {
      pc: state.pc,
      stack: [...state.stack],
      registers: new Map(state.registers),
      memory: new Map(state.memory),
      pathConstraints: [...state.pathConstraints],
    };
  }

  createSymbolicValue(type: SymbolicValueType, name: string, source?: string): SymbolicValue {
    return {
      id: `sym-${this.symbolCounter++}`,
      type,
      name,
      constraints: [],
      source,
    };
  }

  addConstraint(
    value: SymbolicValue,
    type: Constraint['type'],
    expression: string,
    description: string
  ): void {
    value.constraints.push({
      type,
      expression,
      description,
    });
  }
}
