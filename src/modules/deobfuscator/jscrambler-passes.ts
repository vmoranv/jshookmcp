/**
 * JScrambler control-flow + cleanup passes.
 *
 * Split out of `jscrambler-core.ts` so the traversal passes that operate on a
 * whole AST read separately from the string-decryption evaluator. Babel is
 * injected through `JscramblerCoreBabel`, exactly like the core — this module
 * has no repo-relative runtime imports, so the eval worker can load it through
 * the same `file://` path scheme (see `resolveJscramblerCoreUrl`).
 */
import type * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';
import type { JscramblerCoreBabel, JscramblerLog } from './jscrambler-core';

export interface JscramblerPasses {
  detectSelfDefending(ast: t.File): boolean;
  removeSelfDefending(ast: t.File): void;
  restoreControlFlow(ast: t.File, warnings: string[], log?: JscramblerLog): number;
  removeDeadCode(ast: t.File): number;
  simplifyExpressions(ast: t.File): number;
}

export function createJscramblerPasses(babel: JscramblerCoreBabel): JscramblerPasses {
  const { traverse, generate, types } = babel;

  function detectSelfDefending(ast: t.File): boolean {
    let hasSelfDefending = false;

    traverse(ast, {
      FunctionDeclaration(path) {
        if (path.node.body.body.some((stmt) => types.isDebuggerStatement(stmt))) {
          hasSelfDefending = true;
        }

        const code = generate(path.node).code;
        if (code.includes('toString') && code.includes('constructor')) {
          hasSelfDefending = true;
        }
      },
    });

    return hasSelfDefending;
  }

  function removeSelfDefending(ast: t.File): void {
    traverse(ast, {
      DebuggerStatement(path) {
        path.remove();
      },

      CallExpression(path) {
        if (
          types.isIdentifier(path.node.callee) &&
          (path.node.callee.name === 'setInterval' || path.node.callee.name === 'setTimeout')
        ) {
          const arg = path.node.arguments[0];
          if (types.isFunctionExpression(arg) || types.isArrowFunctionExpression(arg)) {
            const body = arg.body;
            if (types.isBlockStatement(body)) {
              if (body.body.some((stmt) => types.isDebuggerStatement(stmt))) {
                if (path.parentPath?.isExpressionStatement()) {
                  path.remove();
                } else {
                  // The timer call is an operand (assignment init, ternary
                  // branch, ...) — removing the node outright would leave
                  // invalid syntax behind; replace it with `undefined`.
                  path.replaceWith(types.identifier('undefined'));
                }
              }
            }
          }
        }
      },
    });
  }

  /** Value of a `state = <literal>` statement, or undefined when not one. */
  function extractStateUpdate(stmt: t.Statement, stateName: string): string | number | undefined {
    if (
      !types.isExpressionStatement(stmt) ||
      !types.isAssignmentExpression(stmt.expression) ||
      !types.isIdentifier(stmt.expression.left) ||
      stmt.expression.left.name !== stateName
    ) {
      return undefined;
    }
    const right = stmt.expression.right;
    if (types.isNumericLiteral(right) || types.isStringLiteral(right)) {
      return right.value;
    }
    return undefined;
  }

  /** Case test as a primitive value, or null when not a literal. */
  function caseTestValue(c: t.SwitchCase): string | number | null {
    const test = c.test;
    if (types.isNumericLiteral(test) || types.isStringLiteral(test)) {
      return test.value;
    }
    return null;
  }

  /**
   * Linearize a `while (true) { switch (state) { ... } }` state machine by
   * following the `state = <literal>` updates from the first case. Returns
   * false (leaving the pattern intact) when the state graph is cyclic, jumps
   * to an unknown target, or leaves cases unreachable — flattening those would
   * change program semantics.
   */
  function unflattenControlFlowPattern(path: NodePath<t.WhileStatement>): boolean {
    const whileStmt = path.node;
    if (!types.isBlockStatement(whileStmt.body)) {
      return false;
    }
    const switchStmt = whileStmt.body.body[0];
    if (!types.isSwitchStatement(switchStmt)) {
      return false;
    }

    if (!types.isIdentifier(switchStmt.discriminant)) {
      return false;
    }
    const stateName = switchStmt.discriminant.name;
    const cases = switchStmt.cases;
    const first = cases[0];
    if (!first || first.test === null) {
      return false;
    }

    const sequence: t.SwitchCase[] = [];
    const visited = new Set<t.SwitchCase>();
    let current: t.SwitchCase | undefined = first;

    while (current) {
      if (visited.has(current)) {
        return false; // state cycle — cannot linearize
      }
      visited.add(current);
      sequence.push(current);

      let nextValue: string | number | null = null;
      for (const stmt of current.consequent) {
        const update = extractStateUpdate(stmt, stateName);
        if (update !== undefined) {
          nextValue = update;
        }
      }
      if (nextValue === null) {
        break; // terminal case
      }
      const nextCase = cases.find((c) => c.test !== null && caseTestValue(c) === nextValue);
      if (nextCase === undefined) {
        return false; // jump to an unknown state
      }
      current = nextCase;
    }

    if (visited.size !== cases.length) {
      return false; // unreachable cases — keep the pattern conservatively
    }

    const flattened = sequence.flatMap((c) =>
      c.consequent.filter(
        (stmt) =>
          extractStateUpdate(stmt, stateName) === undefined &&
          !types.isBreakStatement(stmt) &&
          !types.isContinueStatement(stmt),
      ),
    );

    if (flattened.length === 0) {
      return false;
    }

    path.replaceWithMultiple(flattened);
    return true;
  }

  function isControlFlowFlatteningPattern(node: t.WhileStatement): boolean {
    if (!types.isBooleanLiteral(node.test) || !node.test.value) {
      return false;
    }

    if (!types.isBlockStatement(node.body)) {
      return false;
    }

    const firstStmt = node.body.body[0];
    return types.isSwitchStatement(firstStmt);
  }

  function restoreControlFlow(ast: t.File, warnings: string[], log?: JscramblerLog): number {
    let count = 0;
    traverse(ast, {
      WhileStatement: (path) => {
        if (isControlFlowFlatteningPattern(path.node)) {
          try {
            if (!unflattenControlFlowPattern(path)) {
              warnings.push(
                'Unable to linearize while-switch control-flow pattern (cyclic or unreachable states); left in place',
              );
            } else {
              count++;
            }
          } catch (error) {
            log?.('warn', 'Failed to unflatten control-flow pattern', error);
          }
        }
      },
    });

    return count;
  }

  function removeDeadCode(ast: t.File): number {
    let count = 0;

    traverse(ast, {
      IfStatement(path) {
        if (types.isBooleanLiteral(path.node.test)) {
          if (path.node.test.value) {
            path.replaceWith(path.node.consequent);
          } else {
            if (path.node.alternate) {
              path.replaceWith(path.node.alternate);
            } else {
              path.remove();
            }
          }
          count++;
        }
      },
    });

    return count;
  }

  function simplifyExpressions(ast: t.File): number {
    let count = 0;

    traverse(ast, {
      BinaryExpression(path) {
        if (types.isNumericLiteral(path.node.left) && types.isNumericLiteral(path.node.right)) {
          const left = path.node.left.value;
          const right = path.node.right.value;
          let result: number | undefined;

          switch (path.node.operator) {
            case '+':
              result = left + right;
              break;
            case '-':
              result = left - right;
              break;
            case '*':
              result = left * right;
              break;
            case '/':
              result = left / right;
              break;
          }

          if (result !== undefined) {
            path.replaceWith(types.numericLiteral(result));
            count++;
          }
        }
      },
    });

    return count;
  }

  return {
    detectSelfDefending,
    removeSelfDefending,
    restoreControlFlow,
    removeDeadCode,
    simplifyExpressions,
  };
}
