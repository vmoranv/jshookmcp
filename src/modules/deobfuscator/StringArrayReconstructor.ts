import * as parser from '@babel/parser';
import generate from '@babel/generator';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { logger } from '@utils/logger';

export interface StringArrayResult {
  code: string;
  restored: number;
  confidence: number;
  warnings: string[];
}

function decodeStringArrayElement(el: t.Node | null): string | null {
  if (!el) return null;

  if (t.isStringLiteral(el)) return el.value;
  if (t.isNumericLiteral(el)) return String(el.value);
  if (t.isUnaryExpression(el) && el.operator === '-' && t.isNumericLiteral(el.argument)) {
    return String(-el.argument.value);
  }
  if (t.isBinaryExpression(el) && t.isStringLiteral(el.left) && t.isStringLiteral(el.right)) {
    return el.left.value + el.right.value;
  }
  if (t.isConditionalExpression(el)) {
    return null;
  }
  if (t.isCallExpression(el)) {
    return evaluateStringCall(el);
  }
  return null;
}

function evaluateStringCall(expr: t.CallExpression): string | null {
  const callee = expr.callee;

  if (t.isIdentifier(callee) && callee.name === 'atob' && expr.arguments.length === 1) {
    const arg = expr.arguments[0];
    if (t.isStringLiteral(arg)) {
      try {
        return Buffer.from(arg.value, 'base64').toString('utf8');
      } catch {
        return null;
      }
    }
  }

  if (
    t.isMemberExpression(callee) &&
    t.isStringLiteral(callee.object) &&
    t.isIdentifier(callee.property) &&
    callee.property.name === 'charAt' &&
    expr.arguments.length === 1 &&
    t.isNumericLiteral(expr.arguments[0])
  ) {
    return callee.object.value[expr.arguments[0].value] ?? null;
  }

  if (
    t.isIdentifier(callee) &&
    callee.name === 'concat' &&
    expr.arguments.every((a) => t.isStringLiteral(a))
  ) {
    return expr.arguments.map((a) => (t.isStringLiteral(a) ? a.value : '')).join('');
  }

  if (
    t.isMemberExpression(callee) &&
    t.isIdentifier(callee.object) &&
    callee.object.name === 'String' &&
    t.isIdentifier(callee.property) &&
    callee.property.name === 'fromCharCode' &&
    expr.arguments.every((a) => t.isNumericLiteral(a))
  ) {
    return expr.arguments.map((a) => String.fromCharCode(a.value)).join('');
  }

  return null;
}

export function detectStringArrayPattern(code: string): boolean {
  const patterns = [
    /var\s+_0x[a-f0-9]+\s*=\s*\[[\s\S]{10,500}\];/,
    /let\s+_0x[a-f0-9]+\s*=\s*\[[\s\S]{10,500}\];/,
    /const\s+_0x[a-f0-9]+\s*=\s*\[[\s\S]{10,500}\];/,
    /window\['_0x[a-f0-9]+'\]\s*=/,
    /_0x[a-f0-9]+\s*=\s*_0x[a-f0-9]+\s*\|\|\s*\[\]/,
    /['"]__string_array__['"]/,
  ];

  return patterns.some((p) => p.test(code));
}

export function restoreStringArrays(code: string): StringArrayResult {
  const warnings: string[] = [];
  let restored = 0;
  let confidence = 0;

  if (!detectStringArrayPattern(code)) {
    return { code, restored: 0, confidence: 0, warnings };
  }

  logger.info('String array pattern detected, attempting to restore...');

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });

    const arrayMaps = new Map<string, (string | null)[]>();

    traverse(ast, {
      VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
        const { id, init } = path.node;
        if (!t.isIdentifier(id) || !init) return;

        if (t.isArrayExpression(init)) {
          const items = init.elements.map((el) => decodeStringArrayElement(el));
          const nonNullCount = items.filter((i) => i !== null).length;
          if (nonNullCount >= 3) {
            arrayMaps.set(id.name, items);
          }
        }

        if (
          t.isConditionalExpression(init) &&
          t.isArrayExpression(init.consequent) &&
          t.isArrayExpression(init.alternate)
        ) {
          const consItems = init.consequent.elements.map((el) => decodeStringArrayElement(el));
          if (consItems.filter((i) => i !== null).length >= 3) {
            arrayMaps.set(id.name, consItems);
          }
        }
      },

      AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
        const { left, right } = path.node;
        if (!t.isIdentifier(left)) return;

        if (t.isArrayExpression(right)) {
          const items = right.elements.map((el) => decodeStringArrayElement(el));
          const nonNullCount = items.filter((i) => i !== null).length;
          if (nonNullCount >= 3) {
            arrayMaps.set(left.name, items);
          }
        }
      },
    });

    let changed = true;
    let iterations = 0;

    while (changed && iterations < 5) {
      changed = false;
      iterations++;

      for (const [arrayName, items] of arrayMaps) {
        if (items.every((i) => i === null)) continue;

        traverse(ast, {
          MemberExpression(memPath: NodePath<t.MemberExpression>) {
            const { object, property, computed } = memPath.node;
            if (!computed) return;
            if (!t.isIdentifier(object) || object.name !== arrayName) return;
            if (!t.isNumericLiteral(property)) return;

            const idx = property.value;
            if (idx >= 0 && idx < items.length && items[idx] !== null) {
              memPath.replaceWith(t.stringLiteral(items[idx] as string));
              changed = true;
              restored++;
            }
          },
        });
      }
    }

    for (const [arrayName, items] of arrayMaps) {
      const ip = (identPath: any) => {
        if (identPath.node.name !== arrayName) return;
        if (identPath.isBindingIdentifier?.()) return;
        const parent = identPath.parentPath;
        if (!parent) return;
        if (parent.isMemberExpression?.({ object: identPath.node, computed: true })) return;

        const idx = findIndexInMemberAccess(parent);
        if (idx !== null && idx >= 0 && idx < items.length && items[idx] !== null) {
          identPath.replaceWith(t.stringLiteral(items[idx] as string));
          changed = true;
          restored++;
        }
      };
      traverse(ast, { Identifier: ip as any });
    }

    if (restored > 0) {
      confidence = Math.min(0.4 + restored * 0.02, 0.95);
      logger.info(`String arrays: restored ${restored} references across ${arrayMaps.size} arrays`);
    }

    return {
      code: generate(ast, { comments: false, compact: false }).code,
      restored,
      confidence,
      warnings,
    };
  } catch (error) {
    warnings.push(
      `String array restore failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { code, restored: 0, confidence: 0, warnings };
  }
}

function findIndexInMemberAccess(memPath: any): number | null {
  if (!memPath?.isMemberExpression?.({ computed: true })) return null;

  const prop = memPath.node.property;
  if (prop && t.isNumericLiteral(prop)) {
    return prop.value;
  }
  if (prop && t.isBinaryExpression(prop)) {
    const left = prop.left;
    const right = prop.right;
    if (t.isNumericLiteral(left) && t.isNumericLiteral(right)) {
      switch (prop.operator) {
        case '+':
          return left.value + right.value;
        case '-':
          return left.value - right.value;
        case '*':
          return left.value * right.value;
      }
    }
  }
  return null;
}
