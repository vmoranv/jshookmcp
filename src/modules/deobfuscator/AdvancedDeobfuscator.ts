import { logger } from '../../utils/logger.js';
import { LLMService } from '../../services/LLMService.js';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import {
  generateCodeCleanupMessages,
  generateControlFlowUnflatteningMessages,
} from '../../services/prompts/deobfuscation.js';
import { VMDeobfuscator } from './VMDeobfuscator.js';

export interface AdvancedDeobfuscateOptions {
  code: string;
  detectOnly?: boolean;
  aggressiveVM?: boolean;
  useASTOptimization?: boolean;
  timeout?: number;
}

export interface AdvancedDeobfuscateResult {
  code: string;
  detectedTechniques: string[];
  confidence: number;
  warnings: string[];
  astOptimized?: boolean;
  vmDetected?: {
    type: string;
    instructions: number;
    deobfuscated: boolean;
  };
}

export class AdvancedDeobfuscator {
  private llm?: LLMService;
  private vmDeobfuscator: VMDeobfuscator;

  constructor(llm?: LLMService) {
    this.llm = llm;
    this.vmDeobfuscator = new VMDeobfuscator(llm);
  }

  async deobfuscate(options: AdvancedDeobfuscateOptions): Promise<AdvancedDeobfuscateResult> {
    logger.info('Starting advanced deobfuscation...');
    const startTime = Date.now();

    let code = options.code;
    const detectedTechniques: string[] = [];
    const warnings: string[] = [];
    let vmDetected: AdvancedDeobfuscateResult['vmDetected'];
    let astOptimized = false;

    try {
      code = this.normalizeCode(code);

      if (this.detectInvisibleUnicode(code)) {
        detectedTechniques.push('invisible-unicode');
        logger.info('Detected: Invisible Unicode Obfuscation');
        code = this.decodeInvisibleUnicode(code);
      }

      if (this.detectStringEncoding(code)) {
        detectedTechniques.push('string-encoding');
        logger.info('Detected: String Encoding');
        code = this.decodeStrings(code);
      }

      const vmInfo = this.vmDeobfuscator.detectVMProtection(code);
      if (vmInfo.detected) {
        detectedTechniques.push('vm-protection');
        logger.info(`Detected: VM Protection (${vmInfo.type})`);
        vmDetected = {
          type: vmInfo.type,
          instructions: vmInfo.instructionCount,
          deobfuscated: false,
        };

        if (options.aggressiveVM) {
          const vmResult = await this.vmDeobfuscator.deobfuscateVM(code, vmInfo);
          if (vmResult.success) {
            code = vmResult.code;
            vmDetected.deobfuscated = true;
          } else {
            warnings.push('VM deobfuscation failed, code may be incomplete');
          }
        }
      }

      if (this.detectControlFlowFlattening(code)) {
        detectedTechniques.push('control-flow-flattening');
        logger.info('Detected: Control Flow Flattening');
        code = await this.unflattenControlFlow(code);
      }

      if (this.detectStringArrayRotation(code)) {
        detectedTechniques.push('string-array-rotation');
        logger.info('Detected: String Array Rotation');
        code = this.derotateStringArray(code);
      }

      if (this.detectDeadCodeInjection(code)) {
        detectedTechniques.push('dead-code-injection');
        logger.info('Detected: Dead Code Injection');
        code = this.removeDeadCode(code);
      }

      if (this.detectOpaquePredicates(code)) {
        detectedTechniques.push('opaque-predicates');
        logger.info('Detected: Opaque Predicates');
        code = this.removeOpaquePredicates(code);
      }

      if (options.useASTOptimization !== false) {
        logger.info('Applying AST optimizations...');
        const optimized = this.applyASTOptimizations(code);
        if (optimized !== code) {
          code = optimized;
          astOptimized = true;
          detectedTechniques.push('ast-optimized');
        }
      }

      if (this.llm && detectedTechniques.length > 0) {
        logger.info('Using LLM for final cleanup...');
        const llmResult = await this.llmCleanup(code, detectedTechniques);
        if (llmResult) {
          code = llmResult;
        }
      }

      const duration = Date.now() - startTime;
      const confidence = this.calculateConfidence(detectedTechniques, warnings, code);

      logger.success(`Advanced deobfuscation completed in ${duration}ms`);

      return {
        code,
        detectedTechniques,
        confidence,
        warnings,
        vmDetected,
        astOptimized,
      };
    } catch (error) {
      logger.error('Advanced deobfuscation failed', error);
      throw error;
    }
  }

  private detectInvisibleUnicode(code: string): boolean {
    const invisibleChars = ['\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF'];

    return invisibleChars.some((char) => code.includes(char));
  }

  private decodeInvisibleUnicode(code: string): string {
    logger.info('Decoding invisible unicode...');

    const charToBit: Record<string, string> = {
      '\u200B': '0',
      '\u200C': '1',
      '\u200D': '00',
      '\u2060': '01',
      '\uFEFF': '10',
    };

    let decoded = code;

    const invisiblePattern = /[\u200B\u200C\u200D\u2060\uFEFF]+/g;
    const matches = code.match(invisiblePattern);

    if (matches) {
      matches.forEach((match) => {
        let binary = '';
        for (const char of match) {
          binary += charToBit[char] || '';
        }

        if (binary.length % 8 === 0) {
          let text = '';
          for (let i = 0; i < binary.length; i += 8) {
            const byte = binary.substring(i, i + 8);
            text += String.fromCharCode(parseInt(byte, 2));
          }
          decoded = decoded.replace(match, text);
        }
      });
    }

    return decoded;
  }

  private detectControlFlowFlattening(code: string): boolean {
    const pattern = /while\s*\(\s*!!\s*\[\s*\]\s*\)\s*\{[\s\S]*?switch\s*\(/i;
    return pattern.test(code);
  }

  private async unflattenControlFlow(code: string): Promise<string> {
    logger.info('Unflattening control flow...');

    if (this.llm) {
      try {
        const codeSnippet = code.length > 2000 ? code.slice(0, 2000) + '\n...(truncated)' : code;
        const response = await this.llm.chat(generateControlFlowUnflatteningMessages(codeSnippet), {
          temperature: 0.1,
          maxTokens: 3000,
        });

        return this.vmDeobfuscator.extractCodeFromLLMResponse(response.content);
      } catch (error) {
        logger.warn('LLM control flow unflattening failed', error);
      }
    }

    return code;
  }

  private detectStringArrayRotation(code: string): boolean {
    return /\w+\s*=\s*\w+\s*\+\s*0x[0-9a-f]+/.test(code);
  }

  private derotateStringArray(code: string): string {
    logger.info('Derotating string array...');

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let derotated = 0;

      traverse(ast, {
        CallExpression(path) {
          if (
            !t.isFunctionExpression(path.node.callee) &&
            !t.isArrowFunctionExpression(path.node.callee)
          ) {
            return;
          }

          const func = path.node.callee;
          if (!t.isFunctionExpression(func) || !t.isBlockStatement(func.body)) {
            return;
          }

          const hasWhileLoop = func.body.body.some((stmt) => t.isWhileStatement(stmt));
          const hasArrayRotation =
            JSON.stringify(func.body).includes('push') &&
            JSON.stringify(func.body).includes('shift');

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

  private detectDeadCodeInjection(code: string): boolean {
    return /if\s*\(\s*false\s*\)|if\s*\(\s*!!\s*\[\s*\]\s*\)/.test(code);
  }

  private removeDeadCode(code: string): string {
    logger.info('Removing dead code...');

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let removed = 0;

      traverse(ast, {
        IfStatement(path: any) {
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

        BlockStatement(path: any) {
          const body = path.node.body;
          let foundTerminator = false;
          const newBody: any[] = [];

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

  private detectOpaquePredicates(code: string): boolean {
    return /if\s*\(\s*\d+\s*[<>!=]+\s*\d+\s*\)/.test(code);
  }

  private removeOpaquePredicates(code: string): string {
    logger.info('Removing opaque predicates...');

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let removed = 0;

      traverse(ast, {
        IfStatement(path: any) {
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
                } else {
                  if (path.node.alternate) {
                    path.replaceWith(path.node.alternate);
                  } else {
                    path.remove();
                  }
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
                return;
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

  private async llmCleanup(code: string, techniques: string[]): Promise<string | null> {
    if (!this.llm) return null;

    try {
      const response = await this.llm.chat(generateCodeCleanupMessages(code, techniques), {
        temperature: 0.15,
        maxTokens: 3000,
      });

      const cleanedCode = this.vmDeobfuscator.extractCodeFromLLMResponse(response.content);

      if (this.vmDeobfuscator.isValidJavaScript(cleanedCode)) {
        logger.success('LLM cleanup succeeded');
        return cleanedCode;
      } else {
        logger.warn('LLM cleanup produced invalid JavaScript');
        return null;
      }
    } catch (error) {
      logger.warn('LLM cleanup failed', error);
      return null;
    }
  }

  private normalizeCode(code: string): string {
    code = code.replace(/\s+/g, ' ');
    code = code.replace(/\/\*[\s\S]*?\*\//g, '');
    code = code.replace(/\/\/.*/g, '');
    return code.trim();
  }

  private detectStringEncoding(code: string): boolean {
    const patterns = [/\\x[0-9a-f]{2}/i, /\\u[0-9a-f]{4}/i, /String\.fromCharCode/i, /atob\(/i];
    return patterns.some((p) => p.test(code));
  }

  private decodeStrings(code: string): string {
    logger.info('Decoding strings...');

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let decoded = 0;

      traverse(ast, {
        CallExpression(path: any) {
          if (
            t.isMemberExpression(path.node.callee) &&
            t.isIdentifier(path.node.callee.object, { name: 'String' }) &&
            t.isIdentifier(path.node.callee.property, { name: 'fromCharCode' })
          ) {
            const allNumbers = path.node.arguments.every((arg: any) => t.isNumericLiteral(arg));

            if (allNumbers) {
              const charCodes = path.node.arguments.map((arg: any) => arg.value);
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

  private applyASTOptimizations(code: string): string {
    logger.info('Applying AST optimizations...');

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let optimized = 0;

      traverse(ast, {
        BinaryExpression(path: any) {
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

        LogicalExpression(path: any) {
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

        EmptyStatement(path: any) {
          path.remove();
          optimized++;
        },

        ConditionalExpression(path: any) {
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

  private calculateConfidence(techniques: string[], warnings: string[], code: string): number {
    let confidence = 0.3;

    const techniqueBonus = Math.min(techniques.length * 0.12, 0.5);
    confidence += techniqueBonus;

    const warningPenalty = warnings.length * 0.08;
    confidence -= warningPenalty;

    const highConfidenceTechniques = [
      'invisible-unicode',
      'string-array-rotation',
      'dead-code-injection',
      'opaque-predicates',
      'string-encoding',
      'ast-optimized',
    ];

    const highConfidenceCount = techniques.filter((t) =>
      highConfidenceTechniques.some((ht) => t.includes(ht))
    ).length;

    confidence += highConfidenceCount * 0.05;

    if (techniques.some((t) => t.includes('vm-protection'))) {
      confidence -= 0.15;
    }

    if (techniques.some((t) => t.includes('control-flow-flattening'))) {
      confidence -= 0.05;
    }

    const complexity = this.estimateCodeComplexity(code);
    if (complexity < 10) {
      confidence += 0.1;
    } else if (complexity > 100) {
      confidence -= 0.1;
    }

    return Math.max(0.1, Math.min(0.95, confidence));
  }

  private estimateCodeComplexity(code: string): number {
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
}
