import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { logger } from '@utils/logger';
import {
  SYMBOLIC_EXEC_MAX_PATHS,
  SYMBOLIC_EXEC_MAX_DEPTH,
  SYMBOLIC_EXEC_TIMEOUT_MS,
  SYMBOLIC_EXEC_Z3_TIMEOUT_MS,
} from '@src/constants';
import { withZ3, isZ3Failed } from '@modules/z3/Z3Solver';
import { jsExprToZ3, AstBridgeError } from '@modules/z3/ast-bridge';

/** Safety cap on pc — a runaway program counter terminates the path. */
const MAX_PC_TERMINATION = 1000;
/** Safety cap on path constraints — a path with too many branches terminates. */
const MAX_PATH_CONSTRAINTS = 50;
/** Normalizes a path's pc into a 0..1 coverage estimate. */
const PATH_COVERAGE_NORMALIZER = 100;

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

/**
 * Build the conjunction of a path's constraints as a single Z3 formula.
 *
 * Path constraints are conjunctive — all must hold for the path to be
 * traversed. A single expression is added directly rather than wrapped in a
 * one-argument `And`, matching the original.
 */
function buildConjunctiveFormula(
  constraints: Constraint[],
  api: unknown,
  ctx: unknown,
  And: (...args: unknown[]) => unknown,
): unknown {
  const z3Exprs: unknown[] = [];
  for (const c of constraints) {
    const vars = extractVarsFromExpr(c.expression);
    const z3expr = jsExprToZ3(
      c.expression,
      api as never,
      ctx as never,
      vars.map((v) => ({ name: v, type: 'int' as const })),
    );
    z3Exprs.push(z3expr);
  }
  return z3Exprs.length === 1 ? z3Exprs[0] : And(...z3Exprs);
}

/** The Z3 model surface this function needs: evaluate a declaration to a value. */
interface Z3ModelLike {
  eval: (declaration: unknown) => unknown;
}

/**
 * Record the model's variable assignments as warnings — best effort.
 *
 * `model.eval` here is Z3's own model evaluator, not JavaScript `eval`. It is
 * destructured into a local so the call site reads as a method on a resolved
 * model rather than something that looks like dynamic code execution.
 */
function recordModelAssignments(
  model: unknown,
  constraints: Constraint[],
  ctx: unknown,
  pathId: string,
  warnings: string[],
): void {
  if (!model) {
    return;
  }
  try {
    const allVars = new Set<string>();
    for (const c of constraints) {
      for (const v of extractVarsFromExpr(c.expression)) {
        allVars.add(v);
      }
    }
    const { eval: evalInModel } = model as Z3ModelLike;
    const intConst = (ctx as { Int: { const: (n: string) => unknown } }).Int.const;
    for (const v of allVars) {
      const assigned = evalInModel.call(model, intConst(v));
      if (assigned) {
        warnings.push(`  ${pathId}: ${v} = ${String(assigned)}`);
      }
    }
  } catch {
    // model extraction is best-effort; don't fail the path
  }
}

/**
 * Turn a solver verdict into path feasibility.
 *
 * `unsat` → infeasible, `sat` → feasible plus model dump, `unknown` → hand the
 * path to the legacy solver rather than guessing.
 */
function applySolverVerdict(
  checkResult: string,
  readModel: () => unknown,
  path: ExecutionPath,
  ctx: unknown,
  warnings: string[],
  legacyFallback: () => { satisfiable: boolean },
): void {
  if (checkResult === 'unsat') {
    path.isFeasible = false;
    warnings.push(` ${path.id} UNSAT (Z3)`);
    return;
  }
  if (checkResult === 'sat') {
    path.isFeasible = true;
    recordModelAssignments(readModel(), path.constraints, ctx, path.id, warnings);
    return;
  }
  // 'unknown' — Z3 couldn't decide; fall through to the legacy solver for
  // this path only.
  path.isFeasible = legacyFallback().satisfiable;
}

export class SymbolicExecutor {
  private symbolCounter = 0;
  private pathCounter = 0;

  async execute(options: SymbolicExecutorOptions): Promise<SymbolicExecutorResult> {
    const startTime = Date.now();
    const {
      code,
      maxPaths = SYMBOLIC_EXEC_MAX_PATHS,
      maxDepth = SYMBOLIC_EXEC_MAX_DEPTH,
      timeout = SYMBOLIC_EXEC_TIMEOUT_MS,
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

      const statementTable = this.buildStatementTable(ast);
      const worklist: { state: SymbolicState; depth: number }[] = [
        { state: initialState, depth: 0 },
      ];

      while (worklist.length > 0 && paths.length < maxPaths) {
        if (Date.now() - startTime > timeout) {
          warnings.push('Symbolic execution timed out');
          break;
        }

        const { state, depth } = worklist.pop()!;

        if (depth >= maxDepth) {
          warnings.push(`Max depth reached: ${maxDepth}`);
          continue;
        }

        const nextStates = this.executeStep(state, ast, statementTable);

        for (const nextState of nextStates) {
          if (this.isTerminalState(nextState, statementTable.entries.length)) {
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
        const remainingBudget = timeout - (Date.now() - startTime);
        if (remainingBudget <= 0) {
          warnings.push('Constraint solving skipped:budget');
        } else {
          await this.solveConstraints(paths, warnings, remainingBudget);
        }
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

  /**
   * Flatten the program into a statement table. `pc` addresses this table:
   * each entry's `next` is the index to continue at after the statement runs,
   * so structured control flow (if branches, loop bodies) jumps correctly
   * instead of drifting through raw traverse node indexes.
   */
  private buildStatementTable(ast: t.File): {
    entries: Array<{ node: t.Statement; next: number }>;
    branchTargets: Map<t.Statement, number>;
  } {
    const entries: Array<{ node: t.Statement; next: number }> = [];
    const indexOf = new Map<t.Statement, number>();
    const branchTargets = new Map<t.Statement, number>();

    // Pass 1: register every statement in DFS pre-order (source order).
    const registerChildren = (stmt: t.Statement): void => {
      if (t.isBlockStatement(stmt)) {
        stmt.body.forEach((s) => register(s));
      } else if (t.isIfStatement(stmt)) {
        if (stmt.consequent) register(stmt.consequent);
        if (stmt.alternate) register(stmt.alternate);
      } else if (
        t.isWhileStatement(stmt) ||
        t.isDoWhileStatement(stmt) ||
        t.isForStatement(stmt) ||
        t.isForInStatement(stmt) ||
        t.isForOfStatement(stmt)
      ) {
        if (stmt.body) register(stmt.body);
      } else if (t.isTryStatement(stmt)) {
        stmt.block.body.forEach((s) => register(s));
        stmt.handler?.body.body.forEach((s) => register(s));
        stmt.finalizer?.body.forEach((s) => register(s));
      } else if (t.isSwitchStatement(stmt)) {
        stmt.cases.forEach((c) => c.consequent.forEach((s) => register(s)));
      }
    };

    const register = (stmt: t.Statement): void => {
      // Block statements are containers, not executable steps — their body
      // statements register individually so pc stays a statement counter.
      if (t.isBlockStatement(stmt)) {
        stmt.body.forEach((s) => register(s));
        return;
      }
      indexOf.set(stmt, entries.length);
      entries.push({ node: stmt, next: 0 });
      registerChildren(stmt);
    };

    ast.program.body.forEach((s) => register(s));

    // Pass 2: fill `next` top-down (child blocks exit into their parent
    // statement's continuation).
    const processBlock = (block: t.Statement[], exitIndex: number): void => {
      for (let i = 0; i < block.length; i += 1) {
        const stmt = block[i]!;
        const idx = indexOf.get(stmt)!;
        const nextStmt = block[i + 1];
        entries[idx]!.next = nextStmt ? indexOf.get(nextStmt)! : exitIndex;
      }
      block.forEach((stmt) => processChildren(stmt));
    };

    const processChildren = (stmt: t.Statement): void => {
      const exitIndex = indexOf.get(stmt)!;
      if (t.isBlockStatement(stmt)) {
        processBlock(stmt.body, exitIndex);
      } else if (t.isIfStatement(stmt)) {
        const consequentBlock = stmt.consequent
          ? t.isBlockStatement(stmt.consequent)
            ? stmt.consequent.body
            : [stmt.consequent]
          : [];
        const alternateBlock = stmt.alternate
          ? t.isBlockStatement(stmt.alternate)
            ? stmt.alternate.body
            : [stmt.alternate]
          : [];
        if (consequentBlock[0]) {
          branchTargets.set(stmt, indexOf.get(consequentBlock[0])!);
        }
        processBlock(consequentBlock, exitIndex);
        processBlock(alternateBlock, exitIndex);
      } else if (
        t.isWhileStatement(stmt) ||
        t.isDoWhileStatement(stmt) ||
        t.isForStatement(stmt) ||
        t.isForInStatement(stmt) ||
        t.isForOfStatement(stmt)
      ) {
        const body = stmt.body
          ? t.isBlockStatement(stmt.body)
            ? stmt.body.body
            : [stmt.body]
          : [];
        if (body[0]) {
          branchTargets.set(stmt, indexOf.get(body[0])!);
        }
        processBlock(body, exitIndex);
      } else if (t.isTryStatement(stmt)) {
        processBlock(stmt.block.body, exitIndex);
        if (stmt.handler?.body) processBlock(stmt.handler.body.body, exitIndex);
        if (stmt.finalizer) processBlock(stmt.finalizer.body, exitIndex);
      } else if (t.isSwitchStatement(stmt)) {
        // Conservative approximation: case bodies run in source order, then
        // execution continues past the switch.
        stmt.cases.forEach((c) => processBlock(c.consequent, exitIndex));
      }
    };

    processBlock(ast.program.body, entries.length);

    return { entries, branchTargets };
  }

  private executeStep(
    state: SymbolicState,
    ast: t.File,
    table?: {
      entries: Array<{ node: t.Statement; next: number }>;
      branchTargets: Map<t.Statement, number>;
    },
  ): SymbolicState[] {
    const resolvedTable = table ?? this.buildStatementTable(ast);
    const entry = resolvedTable.entries[state.pc];
    if (!entry) {
      return [];
    }
    // Assignments are wrapped in ExpressionStatements — unwrap so the
    // assignment branch below handles them structurally.
    let currentNode: t.Node = entry.node;
    if (t.isExpressionStatement(currentNode) && t.isAssignmentExpression(currentNode.expression)) {
      currentNode = currentNode.expression;
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
      newState.pc = entry.next;
      return [newState];
    }

    if (t.isIfStatement(currentNode)) {
      const trueState = this.cloneState(state);
      const falseState = this.cloneState(state);

      const ifStmt = currentNode as t.IfStatement;
      const conditionExpr = this.nodeToString(ifStmt.test);
      trueState.pathConstraints.push({
        type: this.constraintTypeFromTest(ifStmt.test),
        expression: conditionExpr,
        description: '',
      });
      falseState.pathConstraints.push({
        type: 'custom',
        expression: `!(${conditionExpr})`,
        description: '',
      });

      const consequentStart = resolvedTable.branchTargets.get(currentNode);
      trueState.pc = consequentStart ?? entry.next;
      falseState.pc = entry.next;
      return [trueState, falseState];
    }

    if (
      t.isWhileStatement(currentNode) ||
      t.isDoWhileStatement(currentNode) ||
      t.isForStatement(currentNode) ||
      t.isForInStatement(currentNode) ||
      t.isForOfStatement(currentNode)
    ) {
      const enterState = this.cloneState(state);
      const skipState = this.cloneState(state);

      const bodyStart = resolvedTable.branchTargets.get(currentNode);
      enterState.pc = bodyStart ?? entry.next;
      skipState.pc = entry.next;
      return [enterState, skipState];
    }

    if (t.isAssignmentExpression(currentNode)) {
      const newState = this.cloneState(state);
      const assignExpr = currentNode as t.AssignmentExpression;
      if (t.isIdentifier(assignExpr.left)) {
        const varName = assignExpr.left.name;
        const rightExpr = this.nodeToString(assignExpr.right);
        const symbolicValue = this.createSymbolicValue('unknown', rightExpr, rightExpr);
        // Resolve the RHS into a constraint so the solver can reason about
        // the assignment (aliases, binary expressions, literals).
        if (t.isIdentifier(assignExpr.right)) {
          symbolicValue.constraints.push({
            type: 'custom',
            expression: `${varName} == ${rightExpr}`,
            description: `Alias: ${varName} = ${rightExpr}`,
          });
        } else if (t.isBinaryExpression(assignExpr.right)) {
          symbolicValue.constraints.push({
            type: 'custom',
            expression: `${varName} == ${rightExpr}`,
            description: `Assignment: ${varName} = ${rightExpr}`,
          });
        } else if (
          t.isNumericLiteral(assignExpr.right) ||
          t.isStringLiteral(assignExpr.right) ||
          t.isBooleanLiteral(assignExpr.right)
        ) {
          symbolicValue.constraints.push({
            type: 'equality',
            expression: `${varName} == ${rightExpr}`,
            description: `Assignment: ${varName} = ${rightExpr}`,
          });
        }
        newState.memory.set(varName, symbolicValue);
      }
      newState.pc = entry.next;
      return [newState];
    }

    const newState = this.cloneState(state);
    newState.pc = entry.next;
    return [newState];
  }

  /** Classify a branch condition into a solver-friendly constraint type. */
  private constraintTypeFromTest(test: t.Expression): Constraint['type'] {
    if (t.isBinaryExpression(test)) {
      switch (test.operator) {
        case '==':
        case '===':
          return 'equality';
        case '!=':
        case '!==':
        case '<':
        case '>':
        case '<=':
        case '>=':
          return 'inequality';
        default:
          return 'custom';
      }
    }
    return 'custom';
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

  private isTerminalState(state: SymbolicState, statementCount: number): boolean {
    // Execution finished when pc leaves the statement table. An empty
    // stack/memory is NOT terminal on its own — a program with no variables
    // must still execute its statements.
    if (state.pc >= statementCount || state.pc > MAX_PC_TERMINATION) {
      return true;
    }

    if (state.pathConstraints.length > MAX_PATH_CONSTRAINTS) {
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
    return Math.min(state.pc / PATH_COVERAGE_NORMALIZER, 1.0);
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

  /**
   * Derive the per-path Z3 solver timeout from the remaining executor budget.
   * Each path gets an equal share (floor 1s) so the whole solve phase stays
   * within budget even after Z3 mutex wait time is counted against it.
   */
  private computePerPathTimeout(pathCount: number, budgetMs: number): number {
    if (pathCount <= 0) return Math.max(1_000, budgetMs);
    return Math.max(1_000, Math.floor(budgetMs / pathCount));
  }

  private async solveConstraints(
    paths: ExecutionPath[],
    warnings: string[],
    budgetMs?: number,
  ): Promise<void> {
    logger.info(' ...');

    const solveStartedAt = Date.now();
    const z3Used = await this.solveConstraintsZ3(paths, warnings, budgetMs);
    if (!z3Used) {
      // Z3 unavailable — fall back to the simple regex solver with only the
      // budget left over after the Z3 attempt (init/mutex time is already
      // counted against the executor budget; reusing the full budget here
      // would let the solve phase run up to ~2x its allowance).
      const remainingBudget =
        typeof budgetMs === 'number' && budgetMs > 0
          ? Math.max(0, budgetMs - (Date.now() - solveStartedAt))
          : budgetMs;
      this.solveConstraintsLegacy(paths, warnings, remainingBudget);
    }

    logger.info(
      `Path analysis complete, feasible paths: ${paths.filter((p) => p.isFeasible).length}/${paths.length}`,
    );
  }

  /**
   * Solve path constraints with Z3 SMT.
   * @returns true if Z3 was used, false if init failed and caller should fall back
   */
  private async solveConstraintsZ3(
    paths: ExecutionPath[],
    warnings: string[],
    budgetMs?: number,
  ): Promise<boolean> {
    if (isZ3Failed()) return false;

    // Budget governance: the Z3 phase must finish within the executor's
    // remaining time budget. A hard deadline skips unsolved paths (they keep
    // their heuristic feasibility), and the per-path solver timeout is derived
    // from the remaining budget rather than the global constant. The deadline
    // is re-checked after the Z3 mutex is acquired, so mutex wait time is
    // counted toward the budget too.
    const hasBudget = typeof budgetMs === 'number' && budgetMs > 0;
    const deadline = hasBudget ? Date.now() + budgetMs : undefined;
    const perPathTimeout = hasBudget
      ? this.computePerPathTimeout(paths.length, budgetMs)
      : SYMBOLIC_EXEC_Z3_TIMEOUT_MS;

    let z3Worked = false;
    const result = await withZ3(async (api) => {
      const ctx = new api.Context('main');
      const { Solver, And } = ctx;

      for (const path of paths) {
        if (deadline !== undefined && Date.now() >= deadline) {
          warnings.push(` ${path.id} skipped:budget`);
          break;
        }

        if (path.constraints.length === 0) {
          path.isFeasible = true;
          continue;
        }

        try {
          const solver = new Solver();
          solver.set('timeout', perPathTimeout);
          const formula = buildConjunctiveFormula(path.constraints, api, ctx, And);
          solver.add(formula as never);

          const checkResult = await solver.check();
          // `model()` is only meaningful after `sat`; call it lazily so the
          // unsat/unknown paths do not touch the model at all.
          applySolverVerdict(
            checkResult,
            () => solver.model(),
            path,
            ctx,
            warnings,
            () => this.simpleSMTSolver(path.constraints),
          );
        } catch (err) {
          if (err instanceof AstBridgeError) {
            // Expression too complex for our babel bridge — fall back for
            // this single path
            const legacyResult = this.simpleSMTSolver(path.constraints);
            path.isFeasible = legacyResult.satisfiable;
            warnings.push(` ${path.id} ${err.nodeType}: ${err.message} (fell back to regex)`);
          } else {
            logger.warn(`[symbolic] Z3 path analysis failed for ${path.id}:`, err);
            // Fall back for this path
            const legacyResult = this.simpleSMTSolver(path.constraints);
            path.isFeasible = legacyResult.satisfiable;
          }
        }
      }
      z3Worked = true;
      return true;
    });

    if (result === null || !z3Worked) {
      return false;
    }
    return true;
  }

  /**
   * Legacy regex-based SMT solver — kept as fallback when Z3 is unavailable.
   * @deprecated Z3 is the primary solver; this exists only for graceful degradation.
   */
  private solveConstraintsLegacy(
    paths: ExecutionPath[],
    warnings: string[],
    budgetMs?: number,
  ): void {
    // A defined numeric budget (including 0, meaning already exhausted) bounds
    // the solver; undefined means unbounded.
    const hasBudget = typeof budgetMs === 'number' && budgetMs >= 0;
    const deadline = hasBudget ? Date.now() + budgetMs : undefined;

    for (const path of paths) {
      if (deadline !== undefined && Date.now() >= deadline) {
        warnings.push(` ${path.id} skipped:budget`);
        break;
      }
      if (path.constraints.length === 0) {
        path.isFeasible = true;
        continue;
      }
      const result = this.simpleSMTSolver(path.constraints);
      if (!result.satisfiable) {
        path.isFeasible = false;
        warnings.push(` ${path.id}  (legacy regex): ${result.reason}`);
      } else {
        path.isFeasible = true;
      }
    }
  }

  private simpleSMTSolver(constraints: Constraint[]): { satisfiable: boolean; reason?: string } {
    // Work on every parseable numeric relation regardless of its declared
    // type — the executor mostly emits 'custom' constraints and the old
    // filter (range|inequality only) made the solver trivially satisfiable.
    for (let i = 0; i < constraints.length; i++) {
      for (let j = i + 1; j < constraints.length; j++) {
        const c1 = constraints[i];
        const c2 = constraints[j];

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
    const parsed1 = this.parseNumericRelation(expr1);
    const parsed2 = this.parseNumericRelation(expr2);
    if (!parsed1 || !parsed2 || parsed1.variable !== parsed2.variable) {
      return false;
    }

    // Equality vs anything: `x == v` contradicts any bound that excludes v.
    if (parsed1.operator === '==') {
      return !this.valueSatisfiesBound(parsed1.value, parsed2);
    }
    if (parsed2.operator === '==') {
      return !this.valueSatisfiesBound(parsed2.value, parsed1);
    }

    // Two inequalities: intersecting the ranges reveals contradictions.
    const lo = Math.max(parsed1.lower ?? -Infinity, parsed2.lower ?? -Infinity);
    const hi = Math.min(parsed1.upper ?? Infinity, parsed2.upper ?? Infinity);
    if (lo > hi) {
      return true;
    }
    if (lo === hi) {
      const loStrict =
        (parsed1.lower !== null && parsed1.lowerStrict) ||
        (parsed2.lower !== null && parsed2.lowerStrict);
      const hiStrict =
        (parsed1.upper !== null && parsed1.upperStrict) ||
        (parsed2.upper !== null && parsed2.upperStrict);
      return loStrict || hiStrict;
    }
    return false;
  }

  /** Does `value` satisfy a parsed relation (e.g. x > 5, x <= 3)? */
  private valueSatisfiesBound(value: number, relation: NumericRelation): boolean {
    if (relation.operator === '==') {
      return value === relation.value;
    }
    if (relation.lower !== null) {
      if (value < relation.lower) return false;
      if (value === relation.lower && relation.lowerStrict) return false;
    }
    if (relation.upper !== null) {
      if (value > relation.upper) return false;
      if (value === relation.upper && relation.upperStrict) return false;
    }
    return true;
  }

  /**
   * Parse a numeric relation like `x > 5`, `!(x > 5)`, `x == 3` into
   * normalized bounds. Returns null when the expression is not a simple
   * single-variable numeric relation.
   */
  private parseNumericRelation(expr: string): NumericRelation | null {
    const match = expr
      .trim()
      .match(/^!?\(?([a-zA-Z_][a-zA-Z0-9_]*)\s*(===|==|>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)\)?$/);
    if (!match?.[1] || !match[2] || match[3] === undefined) {
      return null;
    }

    const variable = match[1];
    let operator = match[2];
    const value = Number(match[3]);
    const negated = expr.trim().startsWith('!');
    if (negated) {
      // !(x > 5) ⟺ x <= 5
      operator =
        { '>': '<=', '<': '>=', '>=': '<', '<=': '>', '==': '!=', '===': '!==' }[operator] ??
        operator;
      // A negated equality is not a simple bound — treat as unsupported.
      if (operator === '!=' || operator === '!==') {
        return null;
      }
    }

    const relation: NumericRelation = {
      variable,
      operator,
      value,
      lower: null,
      lowerStrict: false,
      upper: null,
      upperStrict: false,
    };
    switch (operator) {
      case '>':
        relation.lower = value;
        relation.lowerStrict = true;
        break;
      case '>=':
        relation.lower = value;
        break;
      case '<':
        relation.upper = value;
        relation.upperStrict = true;
        break;
      case '<=':
        relation.upper = value;
        break;
      case '==':
      case '===':
        break; // equality handled via `value`
      default:
        return null;
    }
    return relation;
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
    description: string,
  ): void {
    value.constraints.push({
      type,
      expression,
      description,
    });
  }
}

/** Normalized single-variable numeric relation from {@link SymbolicExecutor.parseNumericRelation}. */
interface NumericRelation {
  variable: string;
  operator: '==' | '>=' | '<=' | '>' | '<' | string;
  value: number;
  lower: number | null;
  lowerStrict: boolean;
  upper: number | null;
  upperStrict: boolean;
}

/** Simple regex to extract identifiers from a constraint expression. */
function extractVarsFromExpr(expr: string): string[] {
  const seen = new Set<string>();
  const matches = expr.matchAll(/[a-zA-Z_][a-zA-Z0-9_]*/g);
  // Skip known keywords / operators
  const ignored = new Set([
    'true',
    'false',
    'null',
    'undefined',
    'void',
    'typeof',
    'NaN',
    'Infinity',
    'if',
    'else',
    'while',
    'for',
    'switch',
    'case',
    'break',
    'continue',
    'return',
    'new',
    'function',
  ]);
  for (const m of matches) {
    const id = m[0];
    if (!ignored.has(id)) seen.add(id);
  }
  return [...seen];
}
