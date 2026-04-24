import * as parser from '@babel/parser';
import generate from '@babel/generator';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { logger } from '@utils/logger';

export interface DeadStoreEliminationResult {
  code: string;
  removed: number;
  warnings: string[];
}

export function removeDeadStores(code: string): DeadStoreEliminationResult {
  const warnings: string[] = [];
  let removed = 0;

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });

    traverse(ast, {
      FunctionDeclaration(funcPath: NodePath<t.FunctionDeclaration>) {
        const funcId = funcPath.node.id;
        if (!funcId) return;

        const binding = funcPath.scope.getBinding(funcId.name);
        if (binding && binding.referencePaths.length === 0) {
          funcPath.remove();
          removed++;
        }
      },

      FunctionExpression(funcPath: NodePath<t.FunctionExpression>) {
        const funcId = funcPath.node.id;
        if (!funcId) return;

        const binding = funcPath.scope.getBinding(funcId.name);
        if (binding && binding.referencePaths.length === 0) {
          funcPath.remove();
          removed++;
        }
      },
    });

    traverse(ast, {
      VariableDeclarator(varPath: NodePath<t.VariableDeclarator>) {
        const { id, init } = varPath.node;
        if (!t.isIdentifier(id)) return;

        const binding = varPath.scope.getBinding(id.name);
        if (!binding || binding.referencePaths.length > 0) return;
        if (binding.constantViolations.length > 0) return;

        if (
          t.isFunctionExpression(init) ||
          t.isArrowFunctionExpression(init) ||
          t.isObjectExpression(init) ||
          t.isArrayExpression(init)
        ) {
          varPath.remove();
          removed++;
        }
      },
    });

    traverse(ast, {
      BlockStatement(blockPath: NodePath<t.BlockStatement>) {
        const body = blockPath.node.body;
        const newBody: t.Statement[] = [];

        for (const stmt of body) {
          if (t.isFunctionDeclaration(stmt)) {
            newBody.push(stmt);
            continue;
          }

          if (t.isExpressionStatement(stmt)) {
            const expr = stmt.expression;
            if (t.isAssignmentExpression(expr) && t.isIdentifier(expr.left)) {
              const binding = blockPath.scope.getBinding(expr.left.name);
              if (!binding || binding.referencePaths.length === 0) {
                removed++;
                continue;
              }
            }
          }

          newBody.push(stmt);
        }

        if (newBody.length !== body.length) {
          blockPath.node.body = newBody;
        }
      },
    });

    traverse(ast, {
      IfStatement(ifPath: NodePath<t.IfStatement>) {
        const test = ifPath.node.test;

        if (t.isBooleanLiteral(test) && test.value === false) {
          if (ifPath.node.alternate) {
            ifPath.replaceWithMultiple([ifPath.node.alternate]);
          } else {
            ifPath.remove();
          }
          removed++;
          return;
        }

        if (t.isBooleanLiteral(test) && test.value === true) {
          const consequent = ifPath.node.consequent;
          if (t.isBlockStatement(consequent)) {
            ifPath.replaceWithMultiple(consequent.body);
          } else {
            ifPath.replaceWithMultiple([consequent]);
          }
          removed++;
        }
      },
    });

    traverse(ast, {
      ForStatement(loopPath: NodePath<t.ForStatement>) {
        const body = loopPath.node.body;
        if (t.isBlockStatement(body) && body.body.every((s) => t.isEmptyStatement(s) || t.isDebuggerStatement(s))) {
          loopPath.remove();
          removed++;
        }
      },

      WhileStatement(loopPath: NodePath<t.WhileStatement>) {
        const body = loopPath.node.body;
        if (t.isBlockStatement(body) && body.body.every((s) => t.isEmptyStatement(s) || t.isDebuggerStatement(s))) {
          loopPath.remove();
          removed++;
        }
      },
    });

    traverse(ast, {
      TryStatement(tryPath: NodePath<t.TryStatement>) {
        if (tryPath.node.handler && tryPath.node.handler.body.body.length === 0) {
          const hasFinalizer = tryPath.node.finalizer && tryPath.node.finalizer.body.length > 0;

          if (hasFinalizer && tryPath.node.finalizer) {
            tryPath.replaceWith(tryPath.node.finalizer);
          } else {
            tryPath.replaceWithMultiple(tryPath.node.block.body);
          }
          removed++;
        }
      },
    });

    if (removed > 0) {
      logger.info(`Dead store elimination: removed ${removed} constructs`);
    }

    return {
      code: generate(ast, { comments: false, compact: false }).code,
      removed,
      warnings,
    };
  } catch (error) {
    warnings.push(`Dead store elimination failed: ${error instanceof Error ? error.message : String(error)}`);
    return { code, removed: 0, warnings };
  }
}

export function removeUnreachableCode(code: string): DeadStoreEliminationResult {
  const warnings: string[] = [];
  let removed = 0;

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });

    traverse(ast, {
      BlockStatement(blockPath: NodePath<t.BlockStatement>) {
        const body = blockPath.node.body;
        const newBody: t.Statement[] = [];
        let sawTerminator = false;

        for (const stmt of body) {
          if (sawTerminator) {
            removed++;
            continue;
          }

          newBody.push(stmt);

          if (
            t.isReturnStatement(stmt) ||
            t.isThrowStatement(stmt) ||
            t.isBreakStatement(stmt) ||
            t.isContinueStatement(stmt)
          ) {
            sawTerminator = true;
          }
        }

        if (newBody.length !== body.length) {
          blockPath.node.body = newBody;
        }
      },
    });

    if (removed > 0) {
      logger.info(`Unreachable code removal: removed ${removed} unreachable statements`);
    }

    return {
      code: generate(ast, { comments: false, compact: false }).code,
      removed,
      warnings,
    };
  } catch (error) {
    warnings.push(`Unreachable code removal failed: ${error instanceof Error ? error.message : String(error)}`);
    return { code, removed: 0, warnings };
  }
}
