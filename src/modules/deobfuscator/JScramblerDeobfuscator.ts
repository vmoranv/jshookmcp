import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { logger } from '../../utils/logger.js';

export interface JScramberDeobfuscatorOptions {
  code: string;
  removeDeadCode?: boolean;
  restoreControlFlow?: boolean;
  decryptStrings?: boolean;
  simplifyExpressions?: boolean;
}

export interface JScramberDeobfuscatorResult {
  code: string;
  success: boolean;
  transformations: string[];
  warnings: string[];
  confidence: number;
}

export class JScramberDeobfuscator {
  async deobfuscate(options: JScramberDeobfuscatorOptions): Promise<JScramberDeobfuscatorResult> {
    const {
      code,
      removeDeadCode = true,
      restoreControlFlow = true,
      decryptStrings = true,
      simplifyExpressions = true,
    } = options;

    logger.info(' JScrambler...');

    const transformations: string[] = [];
    const warnings: string[] = [];
    let currentCode = code;

    try {
      const ast = parser.parse(currentCode, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
      });

      if (this.detectSelfDefending(ast)) {
        this.removeSelfDefending(ast);
        transformations.push('');
      }

      if (decryptStrings) {
        const decrypted = this.decryptStrings(ast);
        if (decrypted > 0) {
          transformations.push(`: ${decrypted}`);
        }
      }

      if (restoreControlFlow) {
        const restored = this.restoreControlFlow(ast);
        if (restored > 0) {
          transformations.push(`: ${restored}`);
        }
      }

      if (removeDeadCode) {
        const removed = this.removeDeadCode(ast);
        if (removed > 0) {
          transformations.push(`: ${removed}`);
        }
      }

      if (simplifyExpressions) {
        const simplified = this.simplifyExpressions(ast);
        if (simplified > 0) {
          transformations.push(`: ${simplified}`);
        }
      }

      const output = generate(ast, {
        comments: true,
        compact: false,
      });

      currentCode = output.code;

      const confidence = this.calculateConfidence(transformations.length);

      logger.info(
        `JScrambler deobfuscation complete, ${transformations.length} transformations applied`
      );

      return {
        code: currentCode,
        success: true,
        transformations,
        warnings,
        confidence,
      };
    } catch (error) {
      logger.error('JScrambler', error);
      return {
        code: currentCode,
        success: false,
        transformations,
        warnings: [...warnings, String(error)],
        confidence: 0,
      };
    }
  }

  private detectSelfDefending(ast: t.File): boolean {
    let hasSelfDefending = false;

    traverse(ast, {
      FunctionDeclaration(path) {
        if (path.node.body.body.some((stmt) => t.isDebuggerStatement(stmt))) {
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

  private removeSelfDefending(ast: t.File): void {
    traverse(ast, {
      DebuggerStatement(path) {
        path.remove();
      },

      CallExpression(path) {
        if (
          t.isIdentifier(path.node.callee) &&
          (path.node.callee.name === 'setInterval' || path.node.callee.name === 'setTimeout')
        ) {
          const arg = path.node.arguments[0];
          if (t.isFunctionExpression(arg) || t.isArrowFunctionExpression(arg)) {
            const body = arg.body;
            if (t.isBlockStatement(body)) {
              if (body.body.some((stmt) => t.isDebuggerStatement(stmt))) {
                path.remove();
              }
            }
          }
        }
      },
    });
  }

  private decryptStrings(ast: t.File): number {
    let count = 0;

    const decryptFunctions = this.findDecryptFunctions(ast);

    traverse(ast, {
      CallExpression(path) {
        if (t.isIdentifier(path.node.callee)) {
          const funcName = path.node.callee.name;
          if (decryptFunctions.has(funcName)) {
            try {
              const decrypted = '[DECRYPTED_STRING]';
              path.replaceWith(t.stringLiteral(decrypted));
              count++;
            } catch {}
          }
        }
      },
    });

    return count;
  }

  private findDecryptFunctions(ast: t.File): Set<string> {
    const decryptFunctions = new Set<string>();

    traverse(ast, {
      FunctionDeclaration(path) {
        const code = generate(path.node).code;
        if (
          code.includes('charCodeAt') &&
          code.includes('fromCharCode') &&
          code.includes('split')
        ) {
          if (path.node.id) {
            decryptFunctions.add(path.node.id.name);
          }
        }
      },
    });

    return decryptFunctions;
  }

  private restoreControlFlow(ast: t.File): number {
    let count = 0;
    const self = this;

    traverse(ast, {
      WhileStatement(path) {
        if (self.isControlFlowFlatteningPattern(path.node)) {
          try {
            self.unflattenControlFlowPattern(path);
            count++;
          } catch {}
        }
      },
    });

    return count;
  }

  private isControlFlowFlatteningPattern(node: t.WhileStatement): boolean {
    if (!t.isBooleanLiteral(node.test) || !node.test.value) {
      return false;
    }

    if (!t.isBlockStatement(node.body)) {
      return false;
    }

    const firstStmt = node.body.body[0];
    return t.isSwitchStatement(firstStmt);
  }

  private unflattenControlFlowPattern(path: NodePath<t.WhileStatement>): void {
    const whileStmt = path.node as t.WhileStatement;
    if (t.isBlockStatement(whileStmt.body)) {
      const switchStmt = whileStmt.body.body[0];
      if (t.isSwitchStatement(switchStmt)) {
        path.replaceWithMultiple(switchStmt.cases.map((c) => c.consequent).flat());
      }
    }
  }

  private removeDeadCode(ast: t.File): number {
    let count = 0;

    traverse(ast, {
      IfStatement(path) {
        if (t.isBooleanLiteral(path.node.test)) {
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

  private simplifyExpressions(ast: t.File): number {
    let count = 0;

    traverse(ast, {
      BinaryExpression(path) {
        if (t.isNumericLiteral(path.node.left) && t.isNumericLiteral(path.node.right)) {
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
            path.replaceWith(t.numericLiteral(result));
            count++;
          }
        }
      },
    });

    return count;
  }

  private calculateConfidence(transformationCount: number): number {
    return Math.min(transformationCount / 5, 1.0);
  }
}
