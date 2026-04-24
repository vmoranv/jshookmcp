import * as parser from '@babel/parser';
import generate from '@babel/generator';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { logger } from '@utils/logger';

export interface CFFRestoreResult {
  code: string;
  restored: number;
  confidence: number;
  warnings: string[];
}

export function detectCFFPattern(code: string): boolean {
  const CFF_INDICATORS = [
    /while\s*\(\s*!?\s*\w+\s*\)\s*\{[\s\S]{0,50}switch\s*\(\s*\w+\s*\)/,
    /switch\s*\(\s*_0x[a-f0-9]+\s*\)\s*\{[\s\S]{0,100}case\s+0x[0-9a-f]+:[\s\S]{0,100}_0x[a-f0-9]+\s*=\s*_0x[a-f0-9]+\s*\+\s*0x[0-9a-f]+/i,
    /_0x[0-9a-f]+\s*=\s*0x[0-9a-f]+;[\s\S]{0,200}while\s*\(\s*!?\s*_0x[0-9a-f]+\s*\)/i,
    /for\s*\(\s*;\s*!?\s*\w+\s*;\s*\)\s*\{[\s\S]{0,50}switch\s*\(\s*\w+\s*\)/,
    /state\s*=\s*Math\.floor\s*\(\s*Math\.random\s*\(\s*\)\s*\*\s*\d+\s*\)/,
    /_0x[0-9a-f]+\[(_0x[0-9a-f]+)\]\s*&&\s*eval/,
  ];

  return CFF_INDICATORS.some((re) => re.test(code));
}

export function restoreControlFlowFlattening(code: string): CFFRestoreResult {
  const warnings: string[] = [];
  let restored = 0;
  let confidence = 0;

  if (!detectCFFPattern(code)) {
    return { code, restored: 0, confidence: 0, warnings };
  }

  logger.info('Control flow flattening detected, attempting to restore...');

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });

    let changed = true;
    let iterations = 0;
    const MAX_ITERATIONS = 10;

    while (changed && iterations < MAX_ITERATIONS) {
      changed = false;
      iterations++;

      traverse(ast, {
        SwitchStatement(switchPath: NodePath<t.SwitchStatement>) {
          const disc = switchPath.node.discriminant;
          if (!t.isIdentifier(disc)) return;

          const varName = disc.name;
          const switchStart = switchPath.node.cases[0]?.test;

          if (!switchStart || !t.isNumericLiteral(switchStart)) return;

          const caseValues = switchPath.node.cases
            .map((c) => (c.test && t.isNumericLiteral(c.test) ? c.test.value : null))
            .filter((v): v is number => v !== null)
            .sort((a, b) => a - b);

          if (caseValues.length < 2) return;

          const minCase = caseValues[0];
          const maxCase = caseValues[caseValues.length - 1];
          if (minCase === undefined || maxCase === undefined) return;
          const expectedRange = maxCase - minCase + 1;

          if (caseValues.length < expectedRange * 0.5) return;

          const reachableFrom = new Map<number, number>();

          for (const c of switchPath.node.cases) {
            if (!c.test || !t.isNumericLiteral(c.test)) continue;
            const caseVal = c.test.value;

            for (const stmt of c.consequent) {
              if (t.isBreakStatement(stmt)) break;
              if (
                t.isExpressionStatement(stmt) &&
                t.isAssignmentExpression(stmt.expression) &&
                t.isIdentifier(stmt.expression.left) &&
                stmt.expression.left.name === varName &&
                t.isNumericLiteral(stmt.expression.right)
              ) {
                reachableFrom.set(caseVal, stmt.expression.right.value);
              }
            }
          }

          if (reachableFrom.size < caseValues.length * 0.3) return;

          let elseBranch: t.Statement = t.blockStatement([t.breakStatement()]);

          for (let i = switchPath.node.cases.length - 1; i >= 0; i--) {
            const caseItem = switchPath.node.cases[i];
            if (!caseItem || !caseItem.test || !t.isNumericLiteral(caseItem.test)) continue;

            const caseVal = caseItem.test.value;

            const nonControlFlow: t.Statement[] = [];
            for (const stmt of caseItem.consequent) {
              if (
                t.isBreakStatement(stmt) ||
                t.isContinueStatement(stmt) ||
                (t.isExpressionStatement(stmt) &&
                  t.isAssignmentExpression(stmt.expression) &&
                  t.isIdentifier(stmt.expression.left) &&
                  stmt.expression.left.name === varName)
              ) {
                continue;
              }
              nonControlFlow.push(stmt);
            }

            if (nonControlFlow.length > 0) {
              elseBranch = t.ifStatement(
                t.binaryExpression('===', t.identifier(varName), t.numericLiteral(caseVal)),
                t.blockStatement(nonControlFlow),
                elseBranch,
              );
            }
          }

          if (elseBranch.type === 'IfStatement') {
            // Same infinite-loop guard as buildIfChainFromCases — without it,
            // the nonControlFlow filter strips state-variable assignments so
            // the while(true) never terminates.
            const guardVar = '__cff_guard__';
            const limit = caseValues.length * 3 + 10;
            const guardDecl = t.variableDeclaration('let', [
              t.variableDeclarator(t.identifier(guardVar), t.numericLiteral(limit)),
            ]);
            const guardCheck = t.ifStatement(
              t.binaryExpression('<=', t.updateExpression('--', t.identifier(guardVar), true), t.numericLiteral(0)),
              t.breakStatement(),
            );
            const guardedBody = t.blockStatement([guardCheck, elseBranch]);

            switchPath.replaceWith(
              t.ifStatement(
                t.binaryExpression('!==', t.identifier(varName), t.numericLiteral(minCase)),
                t.blockStatement([guardDecl, t.whileStatement(t.booleanLiteral(true), guardedBody)]),
              ),
            );
            changed = true;
            restored++;
          }
        },
      });

      traverse(ast, {
        WhileStatement(whilePath: NodePath<t.WhileStatement>) {
          const body = whilePath.node.body;
          if (!t.isBlockStatement(body)) return;

          const hasSwitchInBody = body.body.some((s) => t.isSwitchStatement(s));
          if (!hasSwitchInBody) return;

          const outerVar = findStateVariableInBody(body.body);
          if (!outerVar) return;

          const switchStmt = body.body.find((s) => t.isSwitchStatement(s)) as t.SwitchStatement | undefined;
          if (!switchStmt || !t.isIdentifier(switchStmt.discriminant)) return;
          if (switchStmt.discriminant.name !== outerVar) return;

          const reachable = new Map<number, t.Statement[]>();

          for (const c of switchStmt.cases) {
            if (!c.test || !t.isNumericLiteral(c.test)) continue;
            const val = c.test.value;
            const stmts: t.Statement[] = [];

            for (const s of c.consequent) {
              if (t.isBreakStatement(s)) break;
              if (
                t.isExpressionStatement(s) &&
                t.isAssignmentExpression(s.expression) &&
                t.isIdentifier(s.expression.left) &&
                s.expression.left.name === outerVar
              ) {
                continue;
              }
              stmts.push(s);
            }

            reachable.set(val, stmts);
          }

          if (reachable.size === 0) return;

          const sortedKeys = Array.from(reachable.keys()).sort((a, b) => a - b);
          const ifChain = buildIfChainFromCases(outerVar, sortedKeys, reachable, whilePath.node.test);

          if (ifChain) {
            whilePath.replaceWith(ifChain);
            changed = true;
            restored++;
          }
        },

        ForStatement(forPath: NodePath<t.ForStatement>) {
          const body = forPath.node.body;
          if (!t.isBlockStatement(body)) return;

          const hasSwitchInBody = body.body.some((s) => t.isSwitchStatement(s));
          if (!hasSwitchInBody) return;

          const outerVar = findStateVariableInBody(body.body);
          if (!outerVar) return;

          const switchStmt = body.body.find((s) => t.isSwitchStatement(s)) as t.SwitchStatement | undefined;
          if (!switchStmt || !t.isIdentifier(switchStmt.discriminant)) return;
          if (switchStmt.discriminant.name !== outerVar) return;

          const reachable = new Map<number, t.Statement[]>();

          for (const c of switchStmt.cases) {
            if (!c.test || !t.isNumericLiteral(c.test)) continue;
            const val = c.test.value;
            const stmts: t.Statement[] = [];

            for (const s of c.consequent) {
              if (t.isBreakStatement(s)) break;
              if (
                t.isExpressionStatement(s) &&
                t.isAssignmentExpression(s.expression) &&
                t.isIdentifier(s.expression.left) &&
                s.expression.left.name === outerVar
              ) {
                continue;
              }
              stmts.push(s);
            }

            reachable.set(val, stmts);
          }

          if (reachable.size === 0) return;

          const sortedKeys = Array.from(reachable.keys()).sort((a, b) => a - b);
          const ifChain = buildIfChainFromCases(outerVar, sortedKeys, reachable, forPath.node.test || t.booleanLiteral(true));

          if (ifChain) {
            forPath.replaceWith(ifChain);
            changed = true;
            restored++;
          }
        },
      });
    }

    if (restored > 0) {
      confidence = Math.min(0.3 + restored * 0.15, 0.9);
      logger.info(`Control flow flattening: restored ${restored} flattened blocks`);
    }

    return {
      code: generate(ast, { comments: false, compact: false }).code,
      restored,
      confidence,
      warnings,
    };
  } catch (error) {
    warnings.push(`CFF restore failed: ${error instanceof Error ? error.message : String(error)}`);
    return { code, restored: 0, confidence: 0, warnings };
  }
}

function findStateVariableInBody(stmts: readonly t.Statement[]): string | null {
  for (const stmt of stmts) {
    if (t.isSwitchStatement(stmt) && t.isIdentifier(stmt.discriminant)) {
      return stmt.discriminant.name;
    }
    if (t.isWhileStatement(stmt) && t.isBlockStatement(stmt.body)) {
      return findStateVariableInBody(stmt.body.body);
    }
  }
  return null;
}

function buildIfChainFromCases(
  varName: string,
  keys: number[],
  reachable: Map<number, t.Statement[]>,
  loopTest: t.Expression = t.booleanLiteral(true),
): t.Statement | null {
  if (keys.length === 0) return null;

  let elseBranch: t.Statement = t.blockStatement([t.breakStatement()]);

  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    if (k === undefined) continue;
    const stmts = reachable.get(k);
    if (!stmts || stmts.length === 0) continue;

    elseBranch = t.ifStatement(
      t.binaryExpression('===', t.identifier(varName), t.numericLiteral(k)),
      t.blockStatement(stmts),
      elseBranch,
    );
  }

  // Inject a bounded iteration counter to prevent infinite loops in the
  // restored output. Without this guard, if the state variable never reaches
  // a terminal value, the generated while(true) loops forever.
  const guardVar = '__cff_guard__';
  const limit = keys.length * 3 + 10;
  const guardDecl = t.variableDeclaration('let', [
    t.variableDeclarator(t.identifier(guardVar), t.numericLiteral(limit)),
  ]);
  const guardCheck = t.ifStatement(
    t.binaryExpression('<=', t.updateExpression('--', t.identifier(guardVar), true), t.numericLiteral(0)),
    t.breakStatement(),
  );
  const guardedBody = t.blockStatement([guardCheck, elseBranch]);

  return t.blockStatement([guardDecl, t.whileStatement(loopTest, guardedBody)]);
}
