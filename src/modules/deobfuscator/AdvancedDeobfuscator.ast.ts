import * as parser from '@babel/parser';
import generate from '@babel/generator';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { logger } from '../../utils/logger.js';

export function derotateStringArray(code: string): string {
  logger.info('Derotating string array...');

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    let derotated = 0;

    traverse(ast, {
      CallExpression(path) {
        if (!t.isFunctionExpression(path.node.callee) && !t.isArrowFunctionExpression(path.node.callee)) {
          return;
        }

        const func = path.node.callee;
        if (!t.isFunctionExpression(func) || !t.isBlockStatement(func.body)) {
          return;
        }

        const hasWhileLoop = func.body.body.some((stmt) => t.isWhileStatement(stmt));
        const hasArrayRotation =
          JSON.stringify(func.body).includes('push') && JSON.stringify(func.body).includes('shift');

        if (hasWhileLoop && hasArrayRotation) {
          logger.debug('Found string array rotation IIFE');

          path.remove();
          derotated++;
        }
      },
    });

    if (derotated > 0) {
      logger.info(`Removed ${derotated} string array rotation functions`);
      return generate(ast, { comments: true, compact: false }).code;
    }

    return code;
  } catch (error) {
    logger.error('Failed to derotate string array:', error);
    return code;
  }
}

export function removeDeadCode(code: string): string {
  logger.info('Removing dead code...');

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    let removed = 0;

    traverse(ast, {
      IfStatement(path: NodePath<t.IfStatement>) {
        const test = path.node.test;

        if (t.isBooleanLiteral(test) && test.value === false) {
          if (path.node.alternate) {
            path.replaceWith(path.node.alternate);
          } else {
            path.remove();
          }
          removed++;
          return;
        }

        if (t.isBooleanLiteral(test) && test.value === true) {
          path.replaceWith(path.node.consequent);
          removed++;
          return;
        }

        if (
          t.isUnaryExpression(test) &&
          test.operator === '!' &&
          t.isUnaryExpression(test.argument) &&
          test.argument.operator === '!' &&
          t.isArrayExpression(test.argument.argument)
        ) {
          path.replaceWith(path.node.consequent);
          removed++;
          return;
        }
      },

      BlockStatement(path: NodePath<t.BlockStatement>) {
        const body = path.node.body;
        let foundTerminator = false;
        const newBody: t.Statement[] = [];

        for (const stmt of body) {
          if (foundTerminator) {
            removed++;
            continue;
          }

          newBody.push(stmt);

          if (t.isReturnStatement(stmt) || t.isThrowStatement(stmt)) {
            foundTerminator = true;
          }
        }

        if (newBody.length < body.length) {
          path.node.body = newBody;
        }
      },
    });

    if (removed > 0) {
      logger.info(`Removed ${removed} dead code blocks`);
      return generate(ast, { comments: true, compact: false }).code;
    }

    return code;
  } catch (error) {
    logger.error('Failed to remove dead code:', error);
    return code;
  }
}

export function removeOpaquePredicates(code: string): string {
  logger.info('Removing opaque predicates...');

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    let removed = 0;

    traverse(ast, {
      IfStatement(path: NodePath<t.IfStatement>) {
        const test = path.node.test;

        if (t.isBinaryExpression(test)) {
          const left = test.left;
          const right = test.right;
          const operator = test.operator;

          if (t.isNumericLiteral(left) && t.isNumericLiteral(right)) {
            let result: boolean | undefined;

            switch (operator) {
              case '>':
                result = left.value > right.value;
                break;
              case '<':
                result = left.value < right.value;
                break;
              case '>=':
                result = left.value >= right.value;
                break;
              case '<=':
                result = left.value <= right.value;
                break;
              case '===':
              case '==':
                result = left.value === right.value;
                break;
              case '!==':
              case '!=':
                result = left.value !== right.value;
                break;
            }

            if (result !== undefined) {
              if (result) {
                path.replaceWith(path.node.consequent);
              } else if (path.node.alternate) {
                path.replaceWith(path.node.alternate);
              } else {
                path.remove();
              }
              removed++;
              return;
            }
          }
        }

        if (t.isBinaryExpression(test) && (test.operator === '===' || test.operator === '==')) {
          const left = test.left;
          const right = test.right;

          if (
            t.isBinaryExpression(left) &&
            left.operator === '*' &&
            t.isNumericLiteral(right) &&
            right.value === 0
          ) {
            if (
              (t.isNumericLiteral(left.left) && left.left.value === 0) ||
              (t.isNumericLiteral(left.right) && left.right.value === 0)
            ) {
              path.replaceWith(path.node.consequent);
              removed++;
            }
          }
        }
      },
    });

    if (removed > 0) {
      logger.info(`Removed ${removed} opaque predicates`);
      return generate(ast, { comments: true, compact: false }).code;
    }

    return code;
  } catch (error) {
    logger.error('Failed to remove opaque predicates:', error);
    return code;
  }
}

export function decodeStrings(code: string): string {
  logger.info('Decoding strings...');

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    let decoded = 0;

    traverse(ast, {
      CallExpression(path: NodePath<t.CallExpression>) {
        if (
          t.isMemberExpression(path.node.callee) &&
          t.isIdentifier(path.node.callee.object, { name: 'String' }) &&
          t.isIdentifier(path.node.callee.property, { name: 'fromCharCode' })
        ) {
          const numericArgs = path.node.arguments.filter((arg): arg is t.NumericLiteral =>
            t.isNumericLiteral(arg)
          );

          if (numericArgs.length === path.node.arguments.length) {
            const charCodes = numericArgs.map((arg) => arg.value);
            const decodedString = String.fromCharCode(...charCodes);
            path.replaceWith(t.stringLiteral(decodedString));
            decoded++;
          }
        }
      },
    });

    if (decoded > 0) {
      logger.info(`Decoded ${decoded} string expressions`);
      return generate(ast, { comments: false, compact: false }).code;
    }

    return code;
  } catch (error) {
    logger.error('Failed to decode strings:', error);
    return code;
  }
}

export function applyASTOptimizations(code: string): string {
  logger.info('Applying AST optimizations...');

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    let optimized = 0;

    traverse(ast, {
      BinaryExpression(path: NodePath<t.BinaryExpression>) {
        const { left, right, operator } = path.node;

        if (t.isNumericLiteral(left) && t.isNumericLiteral(right)) {
          let result: number | undefined;

          switch (operator) {
            case '+':
              result = left.value + right.value;
              break;
            case '-':
              result = left.value - right.value;
              break;
            case '*':
              result = left.value * right.value;
              break;
            case '/':
              result = left.value / right.value;
              break;
            case '%':
              result = left.value % right.value;
              break;
            case '**':
              result = Math.pow(left.value, right.value);
              break;
          }

          if (result !== undefined) {
            path.replaceWith(t.numericLiteral(result));
            optimized++;
          }
        }
      },

      LogicalExpression(path: NodePath<t.LogicalExpression>) {
        const { left, right, operator } = path.node;

        if (operator === '&&' && t.isBooleanLiteral(left) && left.value === true) {
          path.replaceWith(right);
          optimized++;
        }

        if (operator === '||' && t.isBooleanLiteral(left) && left.value === false) {
          path.replaceWith(right);
          optimized++;
        }
      },

      EmptyStatement(path: NodePath<t.EmptyStatement>) {
        path.remove();
        optimized++;
      },

      ConditionalExpression(path: NodePath<t.ConditionalExpression>) {
        const { test, consequent, alternate } = path.node;

        if (t.isBooleanLiteral(test) && test.value === true) {
          path.replaceWith(consequent);
          optimized++;
        }

        if (t.isBooleanLiteral(test) && test.value === false) {
          path.replaceWith(alternate);
          optimized++;
        }
      },
    });

    if (optimized > 0) {
      logger.info(`Applied ${optimized} AST optimizations`);
      return generate(ast, { comments: true, compact: false }).code;
    }

    return code;
  } catch (error) {
    logger.error('Failed to apply AST optimizations:', error);
    return code;
  }
}

export function estimateCodeComplexity(code: string): number {
  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    let complexity = 0;

    traverse(ast, {
      FunctionDeclaration() {
        complexity += 2;
      },
      FunctionExpression() {
        complexity += 2;
      },
      ArrowFunctionExpression() {
        complexity += 2;
      },

      IfStatement() {
        complexity += 1;
      },
      SwitchStatement() {
        complexity += 2;
      },
      ConditionalExpression() {
        complexity += 1;
      },

      WhileStatement() {
        complexity += 2;
      },
      ForStatement() {
        complexity += 2;
      },
      DoWhileStatement() {
        complexity += 2;
      },

      TryStatement() {
        complexity += 3;
      },
    });

    return complexity;
  } catch {
    return 100;
  }
}
