import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import type {
  JSVMPDeobfuscatorOptions,
  JSVMPDeobfuscatorResult,
  VMFeatures,
  VMInstruction,
  VMType,
  ComplexityLevel,
  UnresolvedPart,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { ExecutionSandbox } from '../security/ExecutionSandbox.js';
import type { LLMService } from '../../services/LLMService.js';
import { restoreCustomVMBasic, restoreJSVMPCode } from './JSVMPDeobfuscator.restore.js';

export class JSVMPDeobfuscator {
  private llm?: LLMService;
  private readonly sandbox = new ExecutionSandbox();

  constructor(llm?: LLMService) {
    this.llm = llm;
  }

  async deobfuscate(options: JSVMPDeobfuscatorOptions): Promise<JSVMPDeobfuscatorResult> {
    const startTime = Date.now();
    const {
      code,
      aggressive = false,
      extractInstructions = false,
      timeout = 30000,
      maxIterations = 100,
    } = options;

    logger.info(' JSVMP...');

    try {
      const vmFeatures = this.detectJSVMP(code);
      if (!vmFeatures) {
        logger.info('JSVMP');
        return {
          isJSVMP: false,
          deobfuscatedCode: code,
          confidence: 0,
          warnings: ['JSVMP'],
        };
      }

      logger.info(`JSVMP analysis complete, complexity: ${vmFeatures.complexity}`);
      logger.info(` : ${vmFeatures.instructionCount}`);

      const vmType = this.identifyVMType(code, vmFeatures);
      logger.info(` : ${vmType}`);

      let instructions: VMInstruction[] | undefined;
      if (extractInstructions) {
        logger.info(' ...');
        instructions = this.extractInstructions(code, vmFeatures);
        logger.info(`  ${instructions.length} `);
      }

      logger.info(' ...');
      const deobfuscationResult = await this.restoreCode(
        code,
        vmFeatures,
        vmType,
        aggressive,
        timeout,
        maxIterations
      );

      const processingTime = Date.now() - startTime;

      const result: JSVMPDeobfuscatorResult = {
        isJSVMP: true,
        vmType,
        vmFeatures,
        instructions,
        deobfuscatedCode: deobfuscationResult.code,
        confidence: deobfuscationResult.confidence,
        warnings: deobfuscationResult.warnings,
        unresolvedParts: deobfuscationResult.unresolvedParts,
        stats: {
          originalSize: code.length,
          deobfuscatedSize: deobfuscationResult.code.length,
          reductionRate: 1 - deobfuscationResult.code.length / code.length,
          processingTime,
        },
      };

      logger.info(`JSVMP deobfuscation complete in ${processingTime}ms`);
      logger.info(` : ${(result.confidence * 100).toFixed(1)}%`);

      return result;
    } catch (error) {
      logger.error('JSVMP', error);
      return {
        isJSVMP: false,
        deobfuscatedCode: code,
        confidence: 0,
        warnings: [`: ${error}`],
      };
    }
  }

  private detectJSVMP(code: string): VMFeatures | null {
    try {
      const ast = parser.parse(code, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
      });

      let hasSwitch = false;
      let hasInstructionArray = false;
      let hasProgramCounter = false;
      let instructionCount = 0;
      let interpreterLocation = '';
      let maxSwitchCases = 0;

      let hasBytecodeArray = false;
      let hasApplyCall = false;
      let hasWhileLoop = false;
      let bytecodePattern = false;

      traverse(ast, {
        SwitchStatement(path) {
          const caseCount = path.node.cases.length;
          if (caseCount > 10) {
            hasSwitch = true;
            if (caseCount > maxSwitchCases) {
              maxSwitchCases = caseCount;
              instructionCount = caseCount;
              interpreterLocation = `Line ${path.node.loc?.start.line || 0}`;
            }
          }
        },

        ArrayExpression(path) {
          if (path.node.elements.length > 50) {
            hasInstructionArray = true;
          }
        },

        UpdateExpression(path) {
          if (path.node.operator === '++' || path.node.operator === '--') {
            const arg = path.node.argument;
            if (t.isIdentifier(arg) && arg.name.length <= 3) {
              hasProgramCounter = true;
            }
          }
        },

        CallExpression(path) {
          if (
            t.isIdentifier(path.node.callee, { name: 'parseInt' }) &&
            path.node.arguments.length >= 2
          ) {
            const firstArg = path.node.arguments[0];
            if (t.isBinaryExpression(firstArg) && firstArg.operator === '+') {
              bytecodePattern = true;
              hasBytecodeArray = true;
            }
          }

          if (
            t.isMemberExpression(path.node.callee) &&
            t.isIdentifier(path.node.callee.property, { name: 'apply' })
          ) {
            hasApplyCall = true;
          }
        },

        WhileStatement(path) {
          if (
            t.isBooleanLiteral(path.node.test, { value: true }) ||
            t.isNumericLiteral(path.node.test, { value: 1 })
          ) {
            hasWhileLoop = true;
          }
        },

        ForStatement(path) {
          if (!path.node.test) {
            hasWhileLoop = true;
          }
        },
      });

      const isJSVMP =
        hasSwitch &&
        (hasInstructionArray || hasProgramCounter) &&
        (hasApplyCall || hasWhileLoop || bytecodePattern);

      if (isJSVMP) {
        const complexity: ComplexityLevel =
          instructionCount > 100 ? 'high' : instructionCount > 50 ? 'medium' : 'low';

        logger.info(' JSVMP:');
        logger.info(`  - Switch: ${hasSwitch} (${maxSwitchCases} cases)`);
        logger.info(`  - : ${hasInstructionArray}`);
        logger.info(`  - : ${hasProgramCounter}`);
        logger.info(`  - : ${hasBytecodeArray}`);
        logger.info(`  - Apply: ${hasApplyCall}`);
        logger.info(`  - : ${hasWhileLoop}`);
        logger.info(`  - : ${bytecodePattern}`);

        return {
          instructionCount,
          interpreterLocation,
          complexity,
          hasSwitch,
          hasInstructionArray,
          hasProgramCounter,
        };
      }

      return null;
    } catch (error) {
      logger.warn('JSVMP analysis failed', error);

      return this.detectJSVMPWithRegex(code);
    }
  }

  private detectJSVMPWithRegex(code: string): VMFeatures | null {
    const switchMatches = code.match(/switch\s*\(/g);
    const hasSwitch = (switchMatches?.length || 0) > 0;

    const bytecodePattern = /parseInt\s*\(\s*["']?\s*\+\s*\w+\[/g.test(code);

    const applyPattern = /\.apply\s*\(/g.test(code);

    const whilePattern = /while\s*\(\s*(true|1)\s*\)/g.test(code);

    if (hasSwitch && (bytecodePattern || applyPattern || whilePattern)) {
      logger.info(' JSVMP');
      return {
        instructionCount: 0,
        interpreterLocation: 'Unknown',
        complexity: 'medium',
        hasSwitch: true,
        hasInstructionArray: bytecodePattern,
        hasProgramCounter: applyPattern,
      };
    }

    return null;
  }

  private identifyVMType(code: string, _features: VMFeatures): VMType {
    if (code.includes('_0x') && code.includes('function(_0x')) {
      return 'obfuscator.io';
    }

    if (/^\s*\[\s*\]\s*\[\s*\(/.test(code)) {
      return 'jsfuck';
    }

    if (code.includes('$=~[];')) {
      return 'jjencode';
    }

    return 'custom';
  }

  private extractInstructions(code: string, features: VMFeatures): VMInstruction[] {
    const instructions: VMInstruction[] = [];

    try {
      const ast = parser.parse(code, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'typescript'],
      });

      const self = this;
      traverse(ast, {
        SwitchStatement(path) {
          if (path.node.cases.length === features.instructionCount) {
            path.node.cases.forEach((caseNode, index) => {
              const opcode = caseNode.test
                ? t.isNumericLiteral(caseNode.test)
                  ? caseNode.test.value
                  : t.isStringLiteral(caseNode.test)
                    ? caseNode.test.value
                    : index
                : index;

              const type = self.inferInstructionType(caseNode);

              instructions.push({
                opcode,
                name: `INST_${opcode}`,
                type,
                description: `Instruction ${opcode}`,
              });
            });
          }
        },
      });
    } catch (error) {
      logger.warn('', error);
    }

    return instructions;
  }

  private inferInstructionType(caseNode: t.SwitchCase): VMInstruction['type'] {
    const code = generate(caseNode).code;
    const consequent = caseNode.consequent;

    let hasAssignment = false;
    let hasArrayAccess = false;
    let hasFunctionCall = false;
    let hasArithmetic = false;
    let hasControlFlow = false;

    for (const stmt of consequent) {
      if (t.isExpressionStatement(stmt)) {
        const expr = stmt.expression;

        if (t.isAssignmentExpression(expr)) {
          hasAssignment = true;
        }

        if (t.isMemberExpression(expr) && t.isNumericLiteral(expr.property)) {
          hasArrayAccess = true;
        }

        if (t.isCallExpression(expr)) {
          hasFunctionCall = true;
        }

        if (t.isBinaryExpression(expr)) {
          if (['+', '-', '*', '/', '%', '**'].includes(expr.operator)) {
            hasArithmetic = true;
          }
        }
      }

      if (
        t.isIfStatement(stmt) ||
        t.isWhileStatement(stmt) ||
        t.isBreakStatement(stmt) ||
        t.isContinueStatement(stmt) ||
        t.isReturnStatement(stmt)
      ) {
        hasControlFlow = true;
      }
    }

    if (
      (code.includes('push') || code.includes('.push(')) &&
      (hasArrayAccess || code.includes('['))
    ) {
      return 'load';
    }

    if (hasAssignment && !hasArithmetic && !hasFunctionCall) {
      return 'store';
    }

    if (hasArithmetic || code.match(/[+\-*/%]/)) {
      return 'arithmetic';
    }

    if (hasControlFlow || code.includes('break') || code.includes('continue')) {
      return 'control';
    }

    if (hasFunctionCall || code.includes('.apply(') || code.includes('.call(')) {
      return 'call';
    }

    return 'unknown';
  }

  private async restoreCode(
    code: string,
    _features: VMFeatures,
    vmType: VMType,
    aggressive: boolean,
    _timeout: number,
    _maxIterations: number
  ): Promise<{
    code: string;
    confidence: number;
    warnings: string[];
    unresolvedParts?: UnresolvedPart[];
  }> {
    void this.restoreCustomVMBasic;
    return restoreJSVMPCode(
      {
        llm: this.llm,
        sandbox: this.sandbox,
      },
      code,
      vmType,
      aggressive
    );
  }

  // Kept for backward compatibility with existing tests/introspection.
  private restoreCustomVMBasic(
    code: string,
    aggressive: boolean,
    warnings: string[],
    unresolvedParts: UnresolvedPart[]
  ) {
    return restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
  }
}
