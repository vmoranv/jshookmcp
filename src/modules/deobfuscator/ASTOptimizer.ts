import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { logger } from '@utils/logger';

export class ASTOptimizer {
  optimize(code: string): string {
    try {
      const ast = parser.parse(code, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
      });

      for (let i = 0; i < 4; i++) {
        logger.debug(`AST optimization pass ${i + 1}`);

        this.passLiteralAndUnaryOps(ast);
        this.applyInlineAndFold(ast);
        this.passControlFlowAndStatements(ast);
        this.passObjectAndSequenceOps(ast);
      }

      const output = generate(ast, {
        comments: false,
        compact: false,
      });

      return output.code;
    } catch (error) {
      const errorDetails = {
        error: 'ASTOptimizationFailed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        context: {
          codePreview: code.substring(0, 500),
        },
      };
      logger.error(`AST optimization failed: ${JSON.stringify(errorDetails)}`);
      throw new Error(JSON.stringify(errorDetails));
    }
  }

  private passLiteralAndUnaryOps(ast: t.File): void {
    traverse(ast, {
      NumericLiteral(path) {
        const raw = path.node.extra?.raw as string | undefined;
        if (raw && /^0x[0-9a-fA-F]+$/.test(raw)) {
          const node = t.numericLiteral(path.node.value);
          node.extra = { raw: String(path.node.value), rawValue: path.node.value };
          path.replaceWith(node);
        }
      },

      StringLiteral(path) {
        const raw = path.node.extra?.raw as string | undefined;
        if (raw && /\\u[0-9a-fA-F]{4}/.test(raw)) {
          path.replaceWith(t.stringLiteral(path.node.value));
        }
      },

      UnaryExpression(path) {
        const { argument, operator } = path.node;

        if (operator === 'void' && t.isNumericLiteral(argument) && argument.value === 0) {
          path.replaceWith(t.identifier('undefined'));
          return;
        }

        if (t.isNumericLiteral(argument)) {
          if (operator === '-') {
            path.replaceWith(t.numericLiteral(-argument.value));
            return;
          }
          if (operator === '+') {
            path.replaceWith(t.numericLiteral(argument.value));
            return;
          }
          if (operator === '!') {
            path.replaceWith(t.booleanLiteral(!argument.value));
            return;
          }
          if (operator === '~') {
            path.replaceWith(t.numericLiteral(~argument.value));
            return;
          }
        }

        if (t.isBooleanLiteral(argument) && operator === '!') {
          path.replaceWith(t.booleanLiteral(!argument.value));
          return;
        }

        if (operator === '!' && t.isUnaryExpression(argument) && argument.operator === '!') {
          if (t.isLiteral(argument.argument)) {
            const val = (argument.argument as t.NumericLiteral | t.StringLiteral | t.BooleanLiteral)
              .value;
            path.replaceWith(t.booleanLiteral(Boolean(val)));
          }
        }
      },

      BinaryExpression(path) {
        const { left, right, operator } = path.node;

        if (
          ['===', '!==', '==', '!='].includes(operator) &&
          t.isUnaryExpression(left) &&
          left.operator === 'typeof' &&
          t.isStringLiteral(right)
        ) {
          const validTypes = [
            'undefined',
            'boolean',
            'number',
            'string',
            'object',
            'function',
            'symbol',
            'bigint',
          ];
          if (!validTypes.includes(right.value)) {
            path.replaceWith(t.booleanLiteral(false));
          }
        }
      },
    });
  }

  private collectConstants(ast: t.File): Map<string, t.Expression> {
    const constants = new Map<string, t.Expression>();
    traverse(ast, {
      VariableDeclarator(vDeclPath) {
        const { id, init } = vDeclPath.node;
        if (t.isIdentifier(id) && init && t.isLiteral(init)) {
          const binding = vDeclPath.scope.getBinding(id.name);
          if (binding && !binding.constantViolations.length) {
            constants.set(id.name, init);
          }
        }
      },
    });
    return constants;
  }

  private collectInlineCandidates(
    ast: t.File,
  ): Map<string, { value: t.Expression; usageCount: number }> {
    const inlineCandidates = new Map<string, { value: t.Expression; usageCount: number }>();

    traverse(ast, {
      VariableDeclarator(vDeclPath) {
        const { id, init } = vDeclPath.node;
        if (t.isIdentifier(id) && init && t.isLiteral(init)) {
          inlineCandidates.set(id.name, { value: init, usageCount: 0 });
        }
      },
    });

    return inlineCandidates;
  }

  private countInlineUsages(
    ast: t.File,
    inlineCandidates: Map<string, { value: t.Expression; usageCount: number }>,
  ): void {
    traverse(ast, {
      Identifier(identPath) {
        const name = identPath.node.name;
        const inlineCand = inlineCandidates.get(name);
        if (inlineCand && !identPath.isBindingIdentifier()) {
          inlineCand.usageCount++;
        }
      },
    });
  }

  private applyInlineAndFold(ast: t.File): void {
    const constants = this.collectConstants(ast);
    const inlineCandidates = this.collectInlineCandidates(ast);
    this.countInlineUsages(ast, inlineCandidates);
    this.applyConstantAndInlineReplacement(ast, constants, inlineCandidates);
    this.applyBinaryExpressionFolding(ast);
    this.applyUnaryExpressionFolding(ast);
  }

  private applyConstantAndInlineReplacement(
    ast: t.File,
    constants: Map<string, t.Expression>,
    inlineCandidates: Map<string, { value: t.Expression; usageCount: number }>,
  ): void {
    traverse(ast, {
      Identifier(identPath) {
        const ip = identPath as any;
        if (ip.isBindingIdentifier?.()) return;
        const parent = ip.parentPath;
        if (!parent) return;
        if (parent.isObjectProperty?.({ key: ip.node })) return;
        if (parent.isMemberExpression?.({ property: ip.node }) && !parent.node.computed) return;

        const constVal = constants.get(ip.node.name);
        if (constVal) {
          ip.replaceWith(t.cloneNode(constVal));
          return;
        }

        const cand = inlineCandidates.get(ip.node.name);
        if (cand && cand.usageCount <= 3) {
          ip.replaceWith(t.cloneNode(cand.value));
        }
      },
    });
  }

  private applyBinaryExpressionFolding(ast: t.File): void {
    traverse(ast, {
      BinaryExpression(binPath) {
        const { left, right, operator } = binPath.node;

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
              if (right.value !== 0) result = left.value / right.value;
              break;
            case '%':
              if (right.value !== 0) result = left.value % right.value;
              break;
            case '**':
              result = left.value ** right.value;
              break;
            case '|':
              result = left.value | right.value;
              break;
            case '&':
              result = left.value & right.value;
              break;
            case '^':
              result = left.value ^ right.value;
              break;
            case '<<':
              result = left.value << right.value;
              break;
            case '>>':
              result = left.value >> right.value;
              break;
            case '>>>':
              result = left.value >>> right.value;
              break;
          }
          if (result !== undefined && Number.isFinite(result)) {
            binPath.replaceWith(t.numericLiteral(result));
            return;
          }
        }

        if (t.isStringLiteral(left) && t.isStringLiteral(right) && operator === '+') {
          binPath.replaceWith(t.stringLiteral(left.value + right.value));
          return;
        }
        if (t.isStringLiteral(left) && t.isNumericLiteral(right) && operator === '+') {
          binPath.replaceWith(t.stringLiteral(left.value + String(right.value)));
          return;
        }
        if (t.isNumericLiteral(left) && t.isStringLiteral(right) && operator === '+') {
          binPath.replaceWith(t.stringLiteral(String(left.value) + right.value));
          return;
        }

        if (
          (operator === '+' && t.isNumericLiteral(right) && right.value === 0) ||
          (operator === '-' && t.isNumericLiteral(right) && right.value === 0) ||
          (operator === '*' && t.isNumericLiteral(right) && right.value === 1) ||
          (operator === '/' && t.isNumericLiteral(right) && right.value === 1) ||
          (operator === '**' && t.isNumericLiteral(right) && right.value === 1)
        ) {
          binPath.replaceWith(left);
          return;
        }
        if (
          (operator === '*' && t.isNumericLiteral(right) && right.value === 0) ||
          (operator === '**' && t.isNumericLiteral(right) && right.value === 0)
        ) {
          binPath.replaceWith(t.numericLiteral(operator === '**' ? 1 : 0));
          return;
        }
        if (
          (operator === '===' || operator === '==') &&
          t.isIdentifier(left) &&
          t.isIdentifier(right) &&
          left.name === right.name
        ) {
          binPath.replaceWith(t.booleanLiteral(true));
          return;
        }
        if (
          (operator === '!==' || operator === '!=') &&
          t.isIdentifier(left) &&
          t.isIdentifier(right) &&
          left.name === right.name
        ) {
          binPath.replaceWith(t.booleanLiteral(false));
          return;
        }
      },
    });
  }

  private applyUnaryExpressionFolding(ast: t.File): void {
    traverse(ast, {
      UnaryExpression(unPath) {
        const { argument, operator } = unPath.node;
        if (operator === '!' && t.isUnaryExpression(argument) && argument.operator === '!') {
          unPath.replaceWith(t.callExpression(t.identifier('Boolean'), [argument.argument]));
        }
      },
    });
  }

  private passControlFlowAndStatements(ast: t.File): void {
    traverse(ast, {
      IfStatement(ifPath) {
        const { test, consequent, alternate } = ifPath.node;

        if (t.isBooleanLiteral(test)) {
          ifPath.replaceWith(test.value ? consequent : (alternate ?? t.emptyStatement()));
          return;
        }
        if (t.isNumericLiteral(test)) {
          ifPath.replaceWith(test.value !== 0 ? consequent : (alternate ?? t.emptyStatement()));
        }
      },

      ConditionalExpression(condPath) {
        const { test, consequent, alternate } = condPath.node;
        if (t.isBooleanLiteral(test)) {
          condPath.replaceWith(test.value ? consequent : alternate);
          return;
        }
        if (t.isNumericLiteral(test)) {
          condPath.replaceWith(test.value !== 0 ? consequent : alternate);
        }
      },

      LogicalExpression(logPath) {
        const { left, right, operator } = logPath.node;

        if (t.isBooleanLiteral(left)) {
          if (operator === '&&') {
            logPath.replaceWith(left.value ? right : left);
          } else if (operator === '||') {
            logPath.replaceWith(left.value ? left : right);
          }
          return;
        }

        if (t.isNumericLiteral(left)) {
          if (operator === '&&') {
            logPath.replaceWith(left.value !== 0 ? right : t.numericLiteral(0));
          } else if (operator === '||') {
            logPath.replaceWith(left.value !== 0 ? left : right);
          }
        }
      },

      ExpressionStatement(exprStmtPath) {
        const expr = exprStmtPath.node.expression;

        const isIIFE = (node: t.Expression): node is t.CallExpression => {
          if (!t.isCallExpression(node)) return false;
          const callee = node.callee;
          return (
            (t.isFunctionExpression(callee) || t.isArrowFunctionExpression(callee)) &&
            node.arguments.length === 0
          );
        };

        if (!isIIFE(expr)) return;

        const callee = expr.callee as t.FunctionExpression | t.ArrowFunctionExpression;
        if (callee.params.length > 0) return;

        let body: t.Statement[];
        if (t.isBlockStatement(callee.body)) {
          body = callee.body.body;
        } else {
          body = [t.expressionStatement(callee.body as t.Expression)];
        }

        if (body.some((s) => t.isReturnStatement(s))) return;
        if (body.some((s) => t.isThrowStatement(s))) return;
        if (body.some((s) => t.isVariableDeclaration(s) && s.kind !== 'var')) return;

        if (body.length > 0) {
          exprStmtPath.replaceWithMultiple(body);
        } else {
          exprStmtPath.remove();
        }
      },
    });
  }

  private passObjectAndSequenceOps(ast: t.File): void {
    traverse(ast, {
      MemberExpression(memPath) {
        const { object, property, computed } = memPath.node;
        if (computed && t.isStringLiteral(property)) {
          if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(property.value)) {
            memPath.replaceWith(t.memberExpression(object, t.identifier(property.value), false));
          }
        }
      },

      ObjectProperty(objPropPath) {
        const { key, computed } = objPropPath.node;
        if (computed && t.isStringLiteral(key)) {
          if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key.value)) {
            objPropPath.node.computed = false;
            objPropPath.node.key = t.identifier(key.value);
          }
        }
      },

      SequenceExpression(seqPath) {
        const { expressions } = seqPath.node;
        if (expressions.length === 1 && expressions[0]) {
          seqPath.replaceWith(expressions[0]);
          return;
        }
        if (seqPath.parentPath?.isExpressionStatement()) {
          const stmts = expressions.map((expr: t.Expression) => t.expressionStatement(expr));
          seqPath.parentPath.replaceWithMultiple(stmts);
        }
      },

      'BinaryExpression|UnaryExpression': {
        exit(bPath) {
          const node = bPath.node as t.BinaryExpression;
          if (node.operator !== '+') return;

          const collectParts = (expr: t.Expression): string | null => {
            if (t.isStringLiteral(expr)) return expr.value;
            if (t.isNumericLiteral(expr)) return String(expr.value);
            if (t.isBinaryExpression(expr) && expr.operator === '+') {
              const l = collectParts(expr.left as t.Expression);
              const r = collectParts(expr.right as t.Expression);
              if (l !== null && r !== null) return l + r;
            }
            return null;
          };

          const result = collectParts(node);
          if (result !== null) {
            bPath.replaceWith(t.stringLiteral(result));
          }
        },
      },
    });
  }
}
