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
import { generateVMAnalysisMessages } from '../../services/prompts/deobfuscation.js';

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
    const warnings: string[] = [];
    const unresolvedParts: UnresolvedPart[] = [];

    if (vmType === 'obfuscator.io') {
      return this.restoreObfuscatorIO(code, aggressive, warnings, unresolvedParts);
    } else if (vmType === 'jsfuck') {
      return this.restoreJSFuck(code, warnings);
    } else if (vmType === 'jjencode') {
      return this.restoreJJEncode(code, warnings);
    } else {
      return this.restoreCustomVM(code, aggressive, warnings, unresolvedParts);
    }
  }

  private async restoreObfuscatorIO(
    code: string,
    aggressive: boolean,
    warnings: string[],
    unresolvedParts: UnresolvedPart[]
  ): Promise<{
    code: string;
    confidence: number;
    warnings: string[];
    unresolvedParts?: UnresolvedPart[];
  }> {
    let restored = code;
    let confidence = 0.5;

    try {
      const stringArrayMatch = code.match(/var\s+(_0x[a-f0-9]+)\s*=\s*(\[.*?\]);/s);
      if (stringArrayMatch) {
        const arrayName = stringArrayMatch[1];
        const arrayContent = stringArrayMatch[2];

        logger.info(` : ${arrayName}`);

        try {
          const sandboxResult = await this.sandbox.execute({ code: `return ${arrayContent || '[]'};`, timeoutMs: 3000 });
          const stringArray = sandboxResult.ok ? sandboxResult.output : undefined;

          if (Array.isArray(stringArray)) {
            logger.info(`String array detected, ${stringArray.length} strings found`);

            const refPattern = new RegExp(`${arrayName}\\[(\\d+)\\]`, 'g');
            restored = restored.replace(refPattern, (_match, index) => {
              const idx = parseInt(index, 10);
              if (idx < stringArray.length) {
                return JSON.stringify(stringArray[idx]);
              }
              return _match;
            });

            confidence += 0.2;
          }
        } catch (e) {
          warnings.push(`: ${e}`);
          unresolvedParts.push({
            location: 'String Array',
            reason: '',
            suggestion: '',
          });
        }
      }

      restored = restored.replace(
        /\(function\s*\(_0x[a-f0-9]+,\s*_0x[a-f0-9]+\)\s*\{[\s\S]*?\}\(_0x[a-f0-9]+,\s*0x[a-f0-9]+\)\);?/g,
        ''
      );

      if (aggressive) {
        restored = restored.replace(/\(function\s*\(\)\s*\{([\s\S]*)\}\(\)\);?/g, '$1');
        confidence += 0.1;
      }

      restored = restored.replace(/0x([0-9a-f]+)/gi, (_match, hex) => {
        return String(parseInt(hex, 16));
      });

      restored = restored.replace(/;\s*;/g, ';');
      restored = restored.replace(/\{\s*\}/g, '{}');

      warnings.push('obfuscator.io detected, may need special handling');

      return {
        code: restored,
        confidence: Math.min(confidence, 1.0),
        warnings,
        unresolvedParts: unresolvedParts.length > 0 ? unresolvedParts : undefined,
      };
    } catch (error) {
      warnings.push(`obfuscator.io: ${error}`);
      return {
        code,
        confidence: 0.2,
        warnings,
        unresolvedParts,
      };
    }
  }

  private async restoreJSFuck(
    code: string,
    warnings: string[]
  ): Promise<{
    code: string;
    confidence: number;
    warnings: string[];
  }> {
    try {
      logger.info('JSFuck detected, attempting deobfuscation...');

      try {
        if (code.length > 100000) {
          warnings.push('JSFuck code detected, file too large to process directly.');
          warnings.push('Consider using an online JSFuck decoder tool.');
          return {
            code,
            confidence: 0.1,
            warnings,
          };
        }

        const sandboxResult1 = await this.sandbox.execute({ code: `return ${code};`, timeoutMs: 5000 });
        const result = sandboxResult1.ok ? sandboxResult1.output : undefined;

        if (typeof result === 'string') {
          logger.info(' JSFuck');
          return {
            code: result,
            confidence: 0.9,
            warnings: ['JSFuck'],
          };
        } else {
          warnings.push('JSFuck');
          return {
            code,
            confidence: 0.2,
            warnings,
          };
        }
      } catch (execError) {
        warnings.push(`JSFuck: ${execError}`);
        warnings.push('Consider using an online JSFuck decoder tool.');
        return {
          code,
          confidence: 0.1,
          warnings,
        };
      }
    } catch (error) {
      warnings.push(`JSFuck: ${error}`);
      return {
        code,
        confidence: 0.1,
        warnings,
      };
    }
  }

  private async restoreJJEncode(
    code: string,
    warnings: string[]
  ): Promise<{
    code: string;
    confidence: number;
    warnings: string[];
  }> {
    try {
      logger.info('JJEncode detected, attempting deobfuscation...');

      try {
        const lines = code.split('\n').filter((line) => line.trim());
        const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';

        if (lastLine && lastLine.includes('$$$$')) {
          const sandboxResult2 = await this.sandbox.execute({ code: `${code}; return $$$$()`, timeoutMs: 5000 });
          const result = sandboxResult2.ok ? sandboxResult2.output : undefined;

          if (typeof result === 'string') {
            logger.info(' JJEncode');
            return {
              code: result,
              confidence: 0.9,
              warnings: ['JJEncode'],
            };
          }
        }

        const sandboxResult3 = await this.sandbox.execute({ code, timeoutMs: 5000 });
        if (!sandboxResult3.ok) {
          logger.warn('JJEncode sandbox execution failed:', sandboxResult3.error);
        }

        warnings.push('JJEncode deobfuscation may be incomplete');
        warnings.push('Result may still contain JJEncode fragments');
        return {
          code,
          confidence: 0.2,
          warnings,
        };
      } catch (execError) {
        warnings.push(`JJEncode: ${execError}`);
        warnings.push('Result may contain evaluation artifacts');
        return {
          code,
          confidence: 0.1,
          warnings,
        };
      }
    } catch (error) {
      warnings.push(`JJEncode: ${error}`);
      return {
        code,
        confidence: 0.1,
        warnings,
      };
    }
  }

  private async restoreCustomVM(
    code: string,
    aggressive: boolean,
    warnings: string[],
    unresolvedParts: UnresolvedPart[]
  ): Promise<{
    code: string;
    confidence: number;
    warnings: string[];
    unresolvedParts?: UnresolvedPart[];
  }> {
    if (!this.llm) {
      warnings.push('LLM service unavailable, using fallback');
      warnings.push('Configure DeepSeek/OpenAI API key for AI-assisted deobfuscation');

      return this.restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
    }

    try {
      logger.info(' LLMVM...');

      const response = await this.llm.chat(generateVMAnalysisMessages(code));

      const analysisText = response.content;

      logger.info(' LLM');
      logger.info(`: ${analysisText.substring(0, 200)}...`);

      let vmAnalysis: any;
      try {
        const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          vmAnalysis = JSON.parse(jsonMatch[0]);
        }
      } catch {
        warnings.push('LLM analysis failed, using fallback');
        return this.restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
      }

      if (vmAnalysis) {
        warnings.push(`LLMVM: ${vmAnalysis.vmType || 'Unknown'}`);

        if (vmAnalysis.warnings && Array.isArray(vmAnalysis.warnings)) {
          warnings.push(...vmAnalysis.warnings);
        }

        if (vmAnalysis.restorationSteps && Array.isArray(vmAnalysis.restorationSteps)) {
          unresolvedParts.push({
            location: 'VM Restoration',
            reason: 'LLM',
            suggestion: vmAnalysis.restorationSteps.join('\n'),
          });
        }

        return {
          code,
          confidence: 0.6,
          warnings,
          unresolvedParts: unresolvedParts.length > 0 ? unresolvedParts : undefined,
        };
      }

      return this.restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
    } catch (error) {
      logger.error('LLM', error);
      warnings.push(`LLM: ${error}`);
      return this.restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
    }
  }

  private restoreCustomVMBasic(
    code: string,
    aggressive: boolean,
    warnings: string[],
    unresolvedParts: UnresolvedPart[]
  ): {
    code: string;
    confidence: number;
    warnings: string[];
    unresolvedParts?: UnresolvedPart[];
  } {
    let restored = code;
    let confidence = 0.3;

    try {
      restored = restored.replace(/if\s*\([^)]*\)\s*\{\s*\}/g, '');

      restored = restored.replace(/!!\s*\(/g, 'Boolean(');

      restored = restored.replace(/""\s*\+\s*/g, '');

      if (aggressive) {
        restored = restored.replace(/debugger;?/g, '');
        confidence += 0.1;

        restored = restored.replace(/\?\s*([^:]+)\s*:\s*\1/g, '$1');
        confidence += 0.05;
      }

      warnings.push('Analysis incomplete, partial results may be returned');
      warnings.push('For better results, configure an LLM API key');

      unresolvedParts.push({
        location: 'Custom VM',
        reason: 'VM',
        suggestion: 'VM protection detected, LLM-assisted analysis recommended',
      });

      return {
        code: restored,
        confidence,
        warnings,
        unresolvedParts: unresolvedParts.length > 0 ? unresolvedParts : undefined,
      };
    } catch (error) {
      warnings.push(`: ${error}`);
      return {
        code,
        confidence: 0.1,
        warnings,
        unresolvedParts,
      };
    }
  }
}
