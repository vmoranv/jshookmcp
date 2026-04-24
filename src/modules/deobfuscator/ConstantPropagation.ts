import * as parser from '@babel/parser';
import generate from '@babel/generator';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { logger } from '@utils/logger';

export interface ConstantPropagationResult {
  code: string;
  folded: number;
  inlined: number;
  warnings: string[];
}

export function advancedConstantPropagation(code: string): ConstantPropagationResult {
  const warnings: string[] = [];
  let folded = 0;
  let inlined = 0;

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });

    const constBindings = new Map<string, t.Expression>();

    traverse(ast, {
      VariableDeclarator(varPath: NodePath<t.VariableDeclarator>) {
        const { id, init } = varPath.node;
        if (!t.isIdentifier(id) || !init) return;

        if (t.isLiteral(init) || t.isObjectExpression(init) || t.isArrayExpression(init)) {
          const binding = varPath.scope.getBinding(id.name);
          if (binding && !binding.constantViolations.length && !binding.references) {
            constBindings.set(id.name, init);
            folded++;
          }
        }

        if (t.isLiteral(init) || isPureExpression(init)) {
          const binding = varPath.scope.getBinding(id.name);
          if (binding && binding.referencePaths.length <= 3) {
            constBindings.set(id.name, init);
          }
        }
      },
    });

    traverse(ast, {
      BinaryExpression(binPath: NodePath<t.BinaryExpression>) {
        const { left, right, operator } = binPath.node;

        if (t.isNumericLiteral(left) && t.isNumericLiteral(right)) {
          const result = foldBinaryNumeric(left.value, right.value, operator);
          if (result !== undefined) {
            binPath.replaceWith(t.numericLiteral(result));
            folded++;
            return;
          }
        }

        if (t.isStringLiteral(left) && t.isStringLiteral(right) && operator === '+') {
          binPath.replaceWith(t.stringLiteral(left.value + right.value));
          folded++;
          return;
        }

        if (
          (operator === '===' || operator === '==') &&
          t.isIdentifier(left) &&
          t.isIdentifier(right) &&
          left.name === right.name
        ) {
          binPath.replaceWith(t.booleanLiteral(true));
          folded++;
          return;
        }

        if (
          (operator === '!==' || operator === '!=') &&
          t.isIdentifier(left) &&
          t.isIdentifier(right) &&
          left.name === right.name
        ) {
          binPath.replaceWith(t.booleanLiteral(false));
          folded++;
          return;
        }

        if (t.isIdentifier(left) && constBindings.has(left.name)) {
          const repl = constBindings.get(left.name)!;
          if (t.isLiteral(repl) && t.isLiteral(right)) {
            const result = foldBinaryLiteral(repl as t.Literal, right, operator);
            if (result !== undefined) {
              binPath.replaceWith(result);
              folded++;
              return;
            }
          }
        }

        if (t.isIdentifier(right) && constBindings.has(right.name)) {
          const repl = constBindings.get(right.name)!;
          if (t.isLiteral(repl) && t.isLiteral(left)) {
            const result = foldBinaryLiteral(left as t.Literal, repl as t.Literal, operator);
            if (result !== undefined) {
              binPath.replaceWith(result);
              folded++;
              return;
            }
          }
        }
      },

      UnaryExpression(unPath: NodePath<t.UnaryExpression>) {
        const { argument, operator } = unPath.node;

        if (t.isNumericLiteral(argument)) {
          const result = foldUnaryNumeric(argument.value, operator);
          if (result !== undefined) {
            unPath.replaceWith(t.numericLiteral(result));
            folded++;
            return;
          }
        }

        if (t.isBooleanLiteral(argument)) {
          const result = foldUnaryBoolean(argument.value, operator);
          if (result !== undefined) {
            unPath.replaceWith(t.booleanLiteral(result));
            folded++;
          }
        }
      },

      MemberExpression(memPath: NodePath<t.MemberExpression>) {
        const { object, property, computed } = memPath.node;

        if (!computed && t.isIdentifier(object) && constBindings.has(object.name)) {
          const val = constBindings.get(object.name)!;
          if (t.isObjectExpression(val)) {
            for (const prop of val.properties) {
              if (
                t.isObjectProperty(prop) &&
                t.isIdentifier(prop.key) &&
                t.isIdentifier(property) &&
                prop.key.name === property.name
              ) {
                if (t.isLiteral(prop.value)) {
                  memPath.replaceWith(t.cloneNode(prop.value));
                  folded++;
                  return;
                }
              }
            }
          }
        }
      },
    });

    traverse(ast, {
      Identifier(identPath) {
        const ip = identPath as any;
        if (ip.isBindingIdentifier?.()) return;
        const name = ip.node.name;
        if (!constBindings.has(name)) return;

        const parent = ip.parentPath;
        if (!parent) return;
        if (parent.isMemberExpression?.({ object: ip.node, computed: false })) return;
        if (parent.isVariableDeclarator?.({ init: ip.node })) return;

        const val = constBindings.get(name)!;
        if (t.isLiteral(val)) {
          ip.replaceWith(t.cloneNode(val));
          inlined++;
        }
      },
    });

    if (folded > 0 || inlined > 0) {
      logger.info(`Constant propagation: ${folded} folds, ${inlined} inlines`);
    }

    return {
      code: generate(ast, { comments: false, compact: false }).code,
      folded,
      inlined,
      warnings,
    };
  } catch (error) {
    warnings.push(
      `Constant propagation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { code, folded: 0, inlined: 0, warnings };
  }
}

function isPureExpression(node: t.Node): boolean {
  if (t.isBinaryExpression(node)) {
    return isPureExpression(node.left) && isPureExpression(node.right);
  }
  if (t.isUnaryExpression(node)) {
    return isPureExpression(node.argument);
  }
  if (t.isCallExpression(node)) {
    const callee = node.callee;
    if (t.isIdentifier(callee)) {
      return ['String', 'Number', 'Boolean', 'Array', 'Object', 'Math', 'JSON'].includes(
        callee.name,
      );
    }
    return false;
  }
  return t.isLiteral(node);
}

function foldBinaryNumeric(a: number, b: number, op: string): number | undefined {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b !== 0 ? a / b : undefined;
    case '%':
      return b !== 0 ? a % b : undefined;
    case '**':
      return a ** b;
    case '|':
      return a | b;
    case '&':
      return a & b;
    case '^':
      return a ^ b;
    case '<<':
      return a << b;
    case '>>':
      return a >> b;
    case '>>>':
      return a >>> b;
    default:
      return undefined;
  }
}

function foldBinaryLiteral(a: t.Literal, b: t.Literal, op: string): t.Literal | undefined {
  if (t.isNumericLiteral(a) && t.isNumericLiteral(b)) {
    const result = foldBinaryNumeric(a.value, b.value, op);
    if (result !== undefined) return t.numericLiteral(result);
  }
  if (t.isStringLiteral(a) && t.isStringLiteral(b) && op === '+') {
    return t.stringLiteral(a.value + b.value);
  }
  return undefined;
}

function foldUnaryNumeric(a: number, op: string): number | undefined {
  switch (op) {
    case '-':
      return -a;
    case '+':
      return +a;
    case '~':
      return ~a;
    default:
      return undefined;
  }
}

function foldUnaryBoolean(a: boolean, op: string): boolean | undefined {
  if (op === '!') return !a;
  return undefined;
}
