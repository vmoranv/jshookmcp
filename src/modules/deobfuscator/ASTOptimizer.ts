import * as parser from '@babel/parser';
import { BABEL_PARSE_PLUGINS } from '@utils/babel-plugins';
import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import { generate } from '@babel/generator';
import * as t from '@babel/types';
import { logger } from '@utils/logger';

/** Number of full optimization passes over the AST. */
const AST_OPT_PASSES = 3;
/** Traversals executed per pass (used for progress reporting). */
const AST_OPT_STEPS_PER_PASS = 8;
/** A constant variable referenced no more than this many times is inlined. */
const MAX_USAGE_COUNT = 3;
/** Valid JS identifier shape: `$`/`_`/alpha start, then word characters. */
const DUPLICATE_IDENTIFIER_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

export class ASTOptimizer {
  optimize(
    code: string,
    options?: { onProgress?: (progress: number, total?: number) => void },
  ): string {
    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: BABEL_PARSE_PLUGINS,
      });

      const totalSteps = AST_OPT_PASSES * AST_OPT_STEPS_PER_PASS;
      let currentStep = 0;

      for (let i = 0; i < AST_OPT_PASSES; i++) {
        logger.debug(`AST optimization pass ${i + 1}`);

        this.constantFolding(ast);
        options?.onProgress?.(++currentStep, totalSteps);

        this.constantPropagation(ast);
        options?.onProgress?.(++currentStep, totalSteps);

        this.deadCodeElimination(ast);
        options?.onProgress?.(++currentStep, totalSteps);

        this.expressionSimplification(ast);
        options?.onProgress?.(++currentStep, totalSteps);

        this.variableInlining(ast);
        options?.onProgress?.(++currentStep, totalSteps);

        this.objectPropertyUnfolding(ast);
        options?.onProgress?.(++currentStep, totalSteps);

        this.computedPropertyResolution(ast);
        options?.onProgress?.(++currentStep, totalSteps);

        this.sequenceExpressionExpansion(ast);
        options?.onProgress?.(++currentStep, totalSteps);
      }

      const output = generate(ast, {
        comments: false,
        compact: false,
      });

      return output.code;
    } catch (error) {
      logger.error('AST optimization failed', error);
      return code;
    }
  }

  private constantFolding(ast: t.File): void {
    traverse(ast, {
      BinaryExpression(path) {
        const { left, right, operator } = path.node;

        if (t.isNumericLiteral(left) && t.isNumericLiteral(right)) {
          let result: number;

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
              result = left.value ** right.value;
              break;
            default:
              return;
          }

          path.replaceWith(t.numericLiteral(result));
        }

        if (t.isStringLiteral(left) && t.isStringLiteral(right) && operator === '+') {
          path.replaceWith(t.stringLiteral(left.value + right.value));
        }
      },

      UnaryExpression(path) {
        const { argument, operator } = path.node;

        if (t.isNumericLiteral(argument)) {
          if (operator === '-') {
            path.replaceWith(t.numericLiteral(-argument.value));
          } else if (operator === '+') {
            path.replaceWith(t.numericLiteral(argument.value));
          } else if (operator === '!') {
            path.replaceWith(t.booleanLiteral(!argument.value));
          }
        }

        if (t.isBooleanLiteral(argument) && operator === '!') {
          path.replaceWith(t.booleanLiteral(!argument.value));
        }
      },
    });
  }

  private constantPropagation(ast: t.File): void {
    // Keyed by the binding's identifier node (not the name) so same-named
    // variables in sibling scopes never conflate, and only bindings that are
    // never reassigned (`binding.constant`) qualify as constants.
    const constants = new Map<t.Identifier, t.Expression>();

    traverse(ast, {
      VariableDeclarator(path) {
        const { id, init } = path.node;

        if (t.isIdentifier(id) && init && t.isLiteral(init)) {
          const binding = path.scope.getBinding(id.name);
          if (binding && binding.constant && binding.path === path) {
            constants.set(binding.identifier, init);
          }
        }
      },

      Identifier(path) {
        if (!path.isReferencedIdentifier()) {
          return;
        }
        const binding = path.scope.getBinding(path.node.name);
        if (binding) {
          const constant = constants.get(binding.identifier);
          if (constant) {
            (path as unknown as NodePath<t.Node>).replaceWith(t.cloneNode(constant));
          }
        }
      },
    });
  }

  private deadCodeElimination(ast: t.File): void {
    traverse(ast, {
      IfStatement(path) {
        const { test, consequent, alternate } = path.node;

        if (t.isBooleanLiteral(test)) {
          if (test.value) {
            path.replaceWith(consequent);
          } else {
            if (alternate) {
              path.replaceWith(alternate);
            } else {
              path.remove();
            }
          }
        }
      },

      ConditionalExpression(path) {
        const { test, consequent, alternate } = path.node;

        if (t.isBooleanLiteral(test)) {
          path.replaceWith(test.value ? consequent : alternate);
        }
      },

      LogicalExpression(path) {
        const { left, right, operator } = path.node;

        if (t.isBooleanLiteral(left)) {
          if (operator === '&&') {
            path.replaceWith(left.value ? right : left);
          } else if (operator === '||') {
            path.replaceWith(left.value ? left : right);
          }
        }
      },
    });
  }

  private expressionSimplification(ast: t.File): void {
    traverse(ast, {
      BinaryExpression(path) {
        const { left, right, operator } = path.node;

        if (operator === '+' && t.isNumericLiteral(right) && right.value === 0) {
          path.replaceWith(left);
        }

        if (operator === '*' && t.isNumericLiteral(right) && right.value === 1) {
          path.replaceWith(left);
        }

        if (operator === '*' && t.isNumericLiteral(right) && right.value === 0) {
          path.replaceWith(t.numericLiteral(0));
        }
      },

      UnaryExpression(path) {
        const { argument, operator } = path.node;

        if (operator === '!' && t.isUnaryExpression(argument) && argument.operator === '!') {
          // Only rewrite to Boolean(x) when the global Boolean is still in
          // scope — a shadowing declaration would change the program's meaning.
          if (path.scope.getBinding('Boolean')) {
            return;
          }
          path.replaceWith(t.callExpression(t.identifier('Boolean'), [argument.argument]));
        }
      },
    });
  }

  private variableInlining(ast: t.File): void {
    // Scope-aware: keyed by binding identifier so same-named variables in
    // sibling scopes get independent usage counts, and reassigned bindings
    // (`binding.constant === false`) are never inlined.
    const inlineCandidates = new Map<t.Identifier, { value: t.Expression; usageCount: number }>();

    traverse(ast, {
      VariableDeclarator(path) {
        const { id, init } = path.node;

        if (t.isIdentifier(id) && init && t.isLiteral(init)) {
          const binding = path.scope.getBinding(id.name);
          if (binding && binding.constant && binding.path === path) {
            inlineCandidates.set(binding.identifier, { value: init, usageCount: 0 });
          }
        }
      },

      Identifier(path) {
        if (!path.isReferencedIdentifier()) {
          return;
        }
        const binding = path.scope.getBinding(path.node.name);
        if (binding) {
          const candidate = inlineCandidates.get(binding.identifier);
          if (candidate) {
            candidate.usageCount++;
          }
        }
      },
    });

    traverse(ast, {
      Identifier(path) {
        if (!path.isReferencedIdentifier()) {
          return;
        }
        const binding = path.scope.getBinding(path.node.name);
        if (binding) {
          const candidate = inlineCandidates.get(binding.identifier);
          if (candidate && candidate.usageCount <= MAX_USAGE_COUNT) {
            (path as unknown as NodePath<t.Node>).replaceWith(t.cloneNode(candidate.value));
          }
        }
      },
    });
  }

  private objectPropertyUnfolding(ast: t.File): void {
    traverse(ast, {
      MemberExpression(path) {
        const { object, property, computed } = path.node;

        if (computed && t.isStringLiteral(property)) {
          if (DUPLICATE_IDENTIFIER_PATTERN.test(property.value)) {
            path.replaceWith(t.memberExpression(object, t.identifier(property.value), false));
          }
        }
      },
    });
  }

  private computedPropertyResolution(ast: t.File): void {
    traverse(ast, {
      ObjectProperty(path) {
        const { key, computed } = path.node;

        if (computed && t.isStringLiteral(key) && key.value) {
          if (DUPLICATE_IDENTIFIER_PATTERN.test(key.value)) {
            (path.node as t.ObjectProperty).computed = false;
            (path.node as t.ObjectProperty).key = t.identifier(key.value);
          }
        }
      },
    });
  }

  private sequenceExpressionExpansion(ast: t.File): void {
    traverse(ast, {
      SequenceExpression(path: NodePath<t.SequenceExpression>) {
        const { expressions } = path.node;

        if (expressions.length === 1 && expressions[0]) {
          path.replaceWith(expressions[0]);
        }

        if (path.parentPath.isExpressionStatement()) {
          const statements = expressions.map((expr: t.Expression) => t.expressionStatement(expr));
          path.parentPath.replaceWithMultiple(statements);
        }
      },
    });
  }
}
