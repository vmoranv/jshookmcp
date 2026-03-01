import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import crypto from 'crypto';
import type { DeobfuscateOptions, DeobfuscateResult, ObfuscationType } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { LLMService } from '../../services/LLMService.js';
import { generateDeobfuscationPrompt } from '../../services/prompts/deobfuscation.js';
import {
  calculateReadabilityScore as calculateReadabilityScoreUtil,
  detectObfuscationType as detectObfuscationTypeUtil,
} from './Deobfuscator.utils.js';

export class Deobfuscator {
  private llm?: LLMService;
  private stringArrays: Map<string, string[]> = new Map();
  private resultCache = new Map<string, DeobfuscateResult>();
  private maxCacheSize = 100;

  constructor(llm?: LLMService) {
    this.llm = llm;
  }

  private generateCacheKey(options: DeobfuscateOptions): string {
    const key = JSON.stringify({
      code: options.code.substring(0, 1000),
      aggressive: options.aggressive,
      preserveLogic: options.preserveLogic,
    });
    return crypto.createHash('md5').update(key).digest('hex');
  }
  async deobfuscate(options: DeobfuscateOptions): Promise<DeobfuscateResult> {
    const cacheKey = this.generateCacheKey(options);
    const cached = this.resultCache.get(cacheKey);
    if (cached) {
      logger.debug('Deobfuscation result from cache');
      return cached;
    }

    logger.info('Starting deobfuscation...');
    const startTime = Date.now();

    try {
      let code = options.code;
      const transformations: Array<{ type: string; description: string; success: boolean }> = [];

      const obfuscationType = this.detectObfuscationType(code);
      logger.info(`Detected obfuscation types: ${obfuscationType.join(', ')}`);

      code = await this.extractStringArrays(code, transformations);

      code = await this.basicTransform(code, transformations);

      code = await this.decodeStrings(code, transformations);

      code = await this.decryptArrays(code, transformations);

      if (options.aggressive) {
        code = await this.unflattenControlFlow(code, transformations);
      }

      code = await this.simplifyExpressions(code, transformations);

      if (options.renameVariables) {
        code = await this.renameVariables(code, transformations);
      }

      let analysis = 'Basic deobfuscation completed.';
      if (this.llm && options.llm) {
        const llmResult = await this.llmAnalysis(code);
        if (llmResult) {
          analysis = llmResult;
          transformations.push({
            type: 'llm-analysis',
            description: 'AI-assisted code analysis completed',
            success: true,
          });
        }
      }

      const deobfuscateTime = Date.now() - startTime;
      const readabilityScore = this.calculateReadabilityScore(code);
      const confidence = this.calculateConfidence(transformations, readabilityScore);

      logger.success(
        `Deobfuscation completed in ${deobfuscateTime}ms (confidence: ${(confidence * 100).toFixed(1)}%)`
      );

      const result: DeobfuscateResult = {
        code,
        readabilityScore,
        confidence,
        obfuscationType,
        transformations,
        analysis,
      };

      if (this.resultCache.size >= this.maxCacheSize) {
        const firstKey = this.resultCache.keys().next().value;
        if (firstKey) {
          this.resultCache.delete(firstKey);
        }
      }
      this.resultCache.set(cacheKey, result);

      return result;
    } catch (error) {
      logger.error('Deobfuscation failed', error);
      throw error;
    }
  }

  private detectObfuscationType(code: string): ObfuscationType[] {
    return detectObfuscationTypeUtil(code);
  }

  private async basicTransform(
    code: string,
    transformations: Array<{ type: string; description: string; success: boolean }>
  ): Promise<string> {
    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

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
            }
          }
        },

        IfStatement(path) {
          if (t.isBooleanLiteral(path.node.test)) {
            if (path.node.test.value) {
              path.replaceWith(path.node.consequent);
            } else if (path.node.alternate) {
              path.replaceWith(path.node.alternate);
            } else {
              path.remove();
            }
          }
        },
      });

      const output = generate(ast, {
        comments: true,
        compact: false,
      });

      transformations.push({
        type: 'basic-ast-transform',
        description: 'Applied constant folding and dead code elimination',
        success: true,
      });

      return output.code;
    } catch (error) {
      logger.warn('Basic transform failed, returning original code', error);
      transformations.push({
        type: 'basic-ast-transform',
        description: 'Failed to apply AST transformations',
        success: false,
      });
      return code;
    }
  }

  private async decodeStrings(
    code: string,
    transformations: Array<{ type: string; description: string; success: boolean }>
  ): Promise<string> {
    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let decoded = 0;

      traverse(ast, {
        StringLiteral(path) {
          const value = path.node.value;

          if (value.includes('\\x')) {
            try {
              const decodedValue = value.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => {
                return String.fromCharCode(parseInt(hex, 16));
              });
              path.node.value = decodedValue;
              decoded++;
            } catch {}
          }

          if (value.includes('\\u')) {
            try {
              const decodedValue = value.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => {
                return String.fromCharCode(parseInt(hex, 16));
              });
              path.node.value = decodedValue;
              decoded++;
            } catch {}
          }
        },
      });

      if (decoded > 0) {
        const output = generate(ast, { comments: true, compact: false });
        transformations.push({
          type: 'string-decode',
          description: `Decoded ${decoded} strings`,
          success: true,
        });
        return output.code;
      }

      return code;
    } catch (error) {
      logger.warn('String decoding failed', error);
      transformations.push({
        type: 'string-decode',
        description: 'Failed to decode strings',
        success: false,
      });
      return code;
    }
  }

  private async llmAnalysis(code: string): Promise<string | null> {
    if (!this.llm) return null;

    try {
      const messages = generateDeobfuscationPrompt(code);
      const response = await this.llm.chat(messages, { temperature: 0.3, maxTokens: 2000 });

      return response.content;
    } catch (error) {
      logger.warn('LLM analysis failed', error);
      return null;
    }
  }

  private calculateConfidence(
    transformations: Array<{ type: string; description: string; success: boolean }>,
    readabilityScore: number
  ): number {
    const successCount = transformations.filter((t) => t.success).length;
    const totalCount = transformations.length || 1;
    const transformConfidence = successCount / totalCount;

    const readabilityConfidence = readabilityScore / 100;

    const confidence = transformConfidence * 0.6 + readabilityConfidence * 0.4;

    return Math.min(Math.max(confidence, 0), 1);
  }

  private async extractStringArrays(
    code: string,
    transformations: Array<{ type: string; description: string; success: boolean }>
  ): Promise<string> {
    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let extracted = 0;

      traverse(ast, {
        VariableDeclarator: (path) => {
          if (
            t.isIdentifier(path.node.id) &&
            path.node.id.name.startsWith('_0x') &&
            t.isArrayExpression(path.node.init)
          ) {
            const arrayName = path.node.id.name;
            const strings: string[] = [];

            path.node.init.elements.forEach((element) => {
              if (t.isStringLiteral(element)) {
                strings.push(element.value);
              }
            });

            if (strings.length > 0) {
              this.stringArrays.set(arrayName, strings);
              extracted++;
              logger.debug(`Extracted string array: ${arrayName} (${strings.length} strings)`);
            }
          }
        },
      });

      if (extracted > 0) {
        transformations.push({
          type: 'extract-string-arrays',
          description: `Extracted ${extracted} string arrays`,
          success: true,
        });
      }

      return code;
    } catch (error) {
      logger.warn('String array extraction failed', error);
      transformations.push({
        type: 'extract-string-arrays',
        description: 'Failed to extract string arrays',
        success: false,
      });
      return code;
    }
  }

  private async decryptArrays(
    code: string,
    transformations: Array<{ type: string; description: string; success: boolean }>
  ): Promise<string> {
    if (this.stringArrays.size === 0) {
      return code;
    }

    const self = this;

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let replaced = 0;

      traverse(ast, {
        MemberExpression(path) {
          if (
            t.isIdentifier(path.node.object) &&
            t.isNumericLiteral(path.node.property) &&
            path.node.object.name.startsWith('_0x')
          ) {
            const arrayName = path.node.object.name;
            const index = path.node.property.value;
            const stringArray = self.stringArrays.get(arrayName);

            if (stringArray && index >= 0 && index < stringArray.length) {
              const value = stringArray[index];
              if (value !== undefined) {
                path.replaceWith(t.stringLiteral(value));
                replaced++;
              }
            }
          }
        },
      });

      if (replaced > 0) {
        const output = generate(ast, { comments: true, compact: false });
        transformations.push({
          type: 'decrypt-arrays',
          description: `Replaced ${replaced} array references`,
          success: true,
        });
        return output.code;
      }

      return code;
    } catch (error) {
      logger.warn('Array decryption failed', error);
      transformations.push({
        type: 'decrypt-arrays',
        description: 'Failed to decrypt arrays',
        success: false,
      });
      return code;
    }
  }

  private async unflattenControlFlow(
    code: string,
    transformations: Array<{ type: string; description: string; success: boolean }>
  ): Promise<string> {
    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let unflattened = 0;

      traverse(ast, {
        WhileStatement(path) {
          if (
            t.isSwitchStatement(path.node.body) ||
            (t.isBlockStatement(path.node.body) &&
              path.node.body.body.length === 1 &&
              t.isSwitchStatement(path.node.body.body[0]))
          ) {
            logger.debug('Found control flow flattening pattern');
            unflattened++;
          }
        },
      });

      if (unflattened > 0) {
        transformations.push({
          type: 'unflatten-control-flow',
          description: `Unflattened ${unflattened} control flow patterns`,
          success: true,
        });
      }

      return code;
    } catch (error) {
      logger.warn('Control flow unflattening failed', error);
      transformations.push({
        type: 'unflatten-control-flow',
        description: 'Failed to unflatten control flow',
        success: false,
      });
      return code;
    }
  }

  private async simplifyExpressions(
    code: string,
    transformations: Array<{ type: string; description: string; success: boolean }>
  ): Promise<string> {
    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let simplified = 0;

      traverse(ast, {
        UnaryExpression(path) {
          if (
            path.node.operator === '!' &&
            t.isUnaryExpression(path.node.argument) &&
            path.node.argument.operator === '!'
          ) {
            path.replaceWith(path.node.argument.argument);
            simplified++;
          } else if (
            path.node.operator === 'void' &&
            t.isNumericLiteral(path.node.argument, { value: 0 })
          ) {
            path.replaceWith(t.identifier('undefined'));
            simplified++;
          }
        },
      });

      if (simplified > 0) {
        const output = generate(ast, { comments: true, compact: false });
        transformations.push({
          type: 'simplify-expressions',
          description: `Simplified ${simplified} expressions`,
          success: true,
        });
        return output.code;
      }

      return code;
    } catch (error) {
      logger.warn('Expression simplification failed', error);
      transformations.push({
        type: 'simplify-expressions',
        description: 'Failed to simplify expressions',
        success: false,
      });
      return code;
    }
  }

  private async renameVariables(
    code: string,
    transformations: Array<{ type: string; description: string; success: boolean }>
  ): Promise<string> {
    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let renamed = 0;
      const renameMap = new Map<string, string>();

      traverse(ast, {
        VariableDeclarator(path) {
          if (t.isIdentifier(path.node.id) && path.node.id.name.startsWith('_0x')) {
            const oldName = path.node.id.name;
            const newName = `var_${renamed}`;
            renameMap.set(oldName, newName);
            path.node.id.name = newName;
            renamed++;
          }
        },
        Identifier(path) {
          if (renameMap.has(path.node.name)) {
            path.node.name = renameMap.get(path.node.name)!;
          }
        },
      });

      if (renamed > 0) {
        const output = generate(ast, { comments: true, compact: false });
        transformations.push({
          type: 'rename-variables',
          description: `Renamed ${renamed} variables`,
          success: true,
        });
        return output.code;
      }

      return code;
    } catch (error) {
      logger.warn('Variable renaming failed', error);
      transformations.push({
        type: 'rename-variables',
        description: 'Failed to rename variables',
        success: false,
      });
      return code;
    }
  }

  private calculateReadabilityScore(code: string): number {
    return calculateReadabilityScoreUtil(code);
  }
}
