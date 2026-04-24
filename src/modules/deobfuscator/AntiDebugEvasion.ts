import * as parser from '@babel/parser';
import generate from '@babel/generator';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { logger } from '@utils/logger';

export interface AntiDebugResult {
  code: string;
  removed: number;
  confidence: number;
  warnings: string[];
}

export function detectAntiDebugPatterns(code: string): string[] {
  const patterns: string[] = [];

  if (/debugger\s*;?/.test(code)) patterns.push('debugger_statement');
  if (/Object\.defineProperty\s*\(\s*.*\s*,\s*['"]prototype['"]/.test(code)) {
    patterns.push('prototype_manipulation');
  }
  if (/toString\s*\.toString\s*\.call\s*\(\s*\w+\s*\)\s*===?\s*['"]\[object Object\]['"]/.test(code)) {
    patterns.push('toString_override_check');
  }
  if (/\.constructor\.name/.test(code)) patterns.push('constructor_name_check');
  if (/hasOwnProperty\s*\(/.test(code) && /call\s*\(/.test(code)) {
    patterns.push('hasOwnProperty_call');
  }
  if (/window\s*!==?\s*this/.test(code)) patterns.push('window_check');
  if (/top\s*!==?\s*self/.test(code)) patterns.push('top_self_check');
  if (/__ANTIDEBUG|_ANTI_DEBUG|__TIMING_ATTACK|__ENV_CHECK/.test(code)) {
    patterns.push('named_antidebug_vars');
  }
  if (/new\s+Date\s*\(\s*\)\s*-\s*\w+\s*>/.test(code)) patterns.push('timing_attack');
  if (/Function\(['"]use strict['"]\)/.test(code)) patterns.push('strict_mode_check');
  if (/process\.env/.test(code)) patterns.push('env_access');
  if (/navigator\.userAgent/.test(code)) patterns.push('useragent_check');

  return patterns;
}

export function detectSelfDefending(code: string): boolean {
  let score = 0;
  if (/eval\s*\(\s*.*?\)\s*!==?\s*void\s+\d+/.test(code)) score++;
  if (/code\s*===?\s*atob\s*\(\s*.*?\)/.test(code)) score++;
  if (/document\.head|document\.body/.test(code)) score++;
  if (/__jsvar\s*=\s*[^;]+;[\s\S]{0,200}eval\s*\(\s*__jsvar/.test(code)) score++;
  if (/checksum|md5|sha\d*\s*\(/.test(code.toLowerCase())) score++;

  return score >= 2;
}

export function neutralizeAntiDebug(code: string): AntiDebugResult {
  const warnings: string[] = [];
  let removed = 0;
  let confidence = 0;

  const patterns = detectAntiDebugPatterns(code);
  const isSelfDefending = detectSelfDefending(code);

  if (patterns.length === 0 && !isSelfDefending) {
    return { code, removed: 0, confidence: 0, warnings };
  }

  logger.info(`Anti-debug/anti-tamper patterns detected: ${patterns.join(', ')}${isSelfDefending ? ' + self-defending' : ''}`);

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });

    traverse(ast, {
      ExpressionStatement(exprPath: NodePath<t.ExpressionStatement>) {
        const expr = exprPath.node.expression;

        if (t.isSequenceExpression(expr)) {
          const lastIdx = expr.expressions.length - 1;
          if (lastIdx >= 0) {
            const last = expr.expressions[lastIdx];
            if (t.isCallExpression(last) && isDebugCheckCall(last)) {
              if (expr.expressions.length === 1) {
                exprPath.remove();
                removed++;
                return;
              }
              expr.expressions.splice(lastIdx, 1);
              removed++;
              return;
            }
          }
        }

        if (t.isCallExpression(expr) && isDebugCheckCall(expr)) {
          exprPath.remove();
          removed++;
          return;
        }

        if (t.isAssignmentExpression(expr) && isAntiDebugAssignment(expr.left as any)) {
          exprPath.remove();
          removed++;
          return;
        }
      },

      IfStatement(ifPath: NodePath<t.IfStatement>) {
        const test = ifPath.node.test;

        if (t.isBinaryExpression(test) && isTimingCheck(test)) {
          ifPath.remove();
          removed++;
          return;
        }

        if (t.isCallExpression(test) && isEnvCheckCall(test)) {
          ifPath.remove();
          removed++;
          return;
        }

        if (t.isUnaryExpression(test) && test.operator === '!' && t.isCallExpression(test.argument)) {
          if (isDebugCheckCall(test.argument)) {
            ifPath.remove();
            removed++;
            return;
          }
        }
      },

      WhileStatement(whilePath: NodePath<t.WhileStatement>) {
        const body = whilePath.node.body;
        if (!t.isBlockStatement(body)) return;

        const hadDebugger = body.body.some((s) => t.isDebuggerStatement(s));
        if (hadDebugger) {
          body.body = body.body.filter((s) => !t.isDebuggerStatement(s));
          removed++;
        }

        if (isInfiniteLoopWithDebug(whilePath.node)) {
          whilePath.remove();
          removed++;
        }
      },

      ForStatement(forPath: NodePath<t.ForStatement>) {
        const body = forPath.node.body;
        if (!t.isBlockStatement(body)) return;

        const hadDebugger = body.body.some((s) => t.isDebuggerStatement(s));
        if (hadDebugger) {
          body.body = body.body.filter((s) => !t.isDebuggerStatement(s));
          removed++;
        }

        if (isInfiniteLoopWithDebug(forPath.node)) {
          forPath.remove();
          removed++;
        }
      },

      SwitchStatement(switchPath: NodePath<t.SwitchStatement>) {
        if (isDebugSwitch(switchPath.node)) {
          switchPath.remove();
          removed++;
        }
      },
    });

    traverse(ast, {
      VariableDeclarator(varPath: NodePath<t.VariableDeclarator>) {
        const { id } = varPath.node;
        if (!t.isIdentifier(id)) return;

        const name = id.name;
        if (/__ANTIDEBUG|_ANTI_DEBUG|__TIMING|_ENV_CHECK|antiDebug|antidebug/i.test(name)) {
          varPath.remove();
          removed++;
          return;
        }

        const init = varPath.node.init;
        if (init && t.isConditionalExpression(init) && t.isCallExpression(init.test) && isDebugCheckCall(init.test as t.CallExpression)) {
          if (t.isArrayExpression(init.consequent)) {
            varPath.get('init').replaceWith(init.consequent);
            removed++;
          }
        }
      },
    });

    if (removed > 0) {
      confidence = Math.min(0.5 + removed * 0.08, 0.95);
      logger.info(`Neutralized ${removed} anti-debug/anti-tamper constructs`);
    }

    return {
      code: generate(ast, { comments: false, compact: false }).code,
      removed,
      confidence,
      warnings,
    };
  } catch (error) {
    warnings.push(`Anti-debug neutralization failed: ${error instanceof Error ? error.message : String(error)}`);
    return { code, removed: 0, confidence: 0, warnings };
  }
}

function isDebugCheckCall(expr: t.CallExpression): boolean {
  if (!t.isMemberExpression(expr.callee)) return false;
  const prop = expr.callee.property;
  if (!t.isIdentifier(prop)) return false;

  const name = prop.name;
  return name === 'hasOwnProperty' || name === 'call' || name === 'apply' || name === 'bind';
}

function isTimingCheck(expr: t.BinaryExpression): boolean {
  const left = expr.left;
  const right = expr.right;

  const isDateDiffLeft =
    t.isNewExpression(left) && t.isIdentifier(left.callee) && left.callee.name === 'Date';
  const isDateDiffRight =
    t.isNewExpression(right) && t.isIdentifier(right.callee) && right.callee.name === 'Date';

  const hasComparison = ['>', '<', '>=', '<='].includes(expr.operator);

  return (isDateDiffLeft || isDateDiffRight) && hasComparison;
}

function isEnvCheckCall(expr: t.CallExpression): boolean {
  if (!t.isMemberExpression(expr.callee)) return false;
  const obj = expr.callee.object;
  if (!t.isIdentifier(obj)) return false;

  const name = obj.name;
  return (
    name === 'navigator' ||
    name === 'window' ||
    name === 'document' ||
    name === 'process' ||
    name === 'top' ||
    name === 'self'
  );
}

function isAntiDebugAssignment(expr: t.Expression | t.Pattern | t.LVal): boolean {
  if (t.isIdentifier(expr)) {
    return /__ANTIDEBUG|_ANTI_DEBUG|antiDebug|__timing/i.test(expr.name);
  }
  return false;
}

function isInfiniteLoopWithDebug(node: t.WhileStatement | t.ForStatement): boolean {
  if (t.isWhileStatement(node)) {
    if (t.isBooleanLiteral(node.test) && node.test.value === true) return true;
  }
  if (t.isForStatement(node)) {
    if (t.isBooleanLiteral(node.test) && node.test.value === true) return true;
    if (!node.test) return true;
  }
  return false;
}

function isDebugSwitch(node: t.SwitchStatement): boolean {
  if (!t.isIdentifier(node.discriminant)) return false;
  return /__ANTIDEBUG|_ANTI_DEBUG|__TIMING/i.test(node.discriminant.name);
}
