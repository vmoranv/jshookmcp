import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import type {
  DetectCryptoOptions,
  DetectCryptoResult,
  CryptoAlgorithm,
  CryptoLibrary,
} from '@internal-types/index';
import { LLMService } from '@services/LLMService';
import { generateCryptoDetectionPrompt } from '@services/prompts/crypto';
import { logger } from '@utils/logger';
import { CRYPTO_DETECT_LLM_MAX_TOKENS } from '@src/constants';
import { CryptoRulesManager } from '@modules/crypto/CryptoRules';

export interface SecurityIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  algorithm?: string;
  issue: string;
  recommendation: string;
  location?: { file: string; line: number };
}

export interface CryptoStrength {
  overall: 'strong' | 'moderate' | 'weak' | 'broken';
  score: number;
  factors: {
    algorithm: number;
    keySize: number;
    mode: number;
    implementation: number;
  };
}

export class CryptoDetector {
  private llm: LLMService;
  private rulesManager: CryptoRulesManager;

  constructor(llm: LLMService, customRules?: CryptoRulesManager) {
    this.llm = llm;
    this.rulesManager = customRules || new CryptoRulesManager();
  }

  loadCustomRules(json: string): void {
    this.rulesManager.loadFromJSON(json);
  }

  exportRules(): string {
    return this.rulesManager.exportToJSON();
  }

  async detect(
    options: DetectCryptoOptions
  ): Promise<DetectCryptoResult & { securityIssues?: SecurityIssue[]; strength?: CryptoStrength }> {
    logger.info('Starting crypto detection...');
    const startTime = Date.now();

    try {
      const { code } = options;
      const algorithms: CryptoAlgorithm[] = [];
      const libraries: CryptoLibrary[] = [];
      const securityIssues: SecurityIssue[] = [];

      const keywordResults = this.detectByKeywords(code);
      algorithms.push(...keywordResults);

      const libraryResults = this.detectLibraries(code);
      libraries.push(...libraryResults);

      const astResults = this.detectByAST(code);
      algorithms.push(...astResults.algorithms);
      if (astResults.parameters) {
        this.mergeParameters(algorithms, astResults.parameters);
      }

      const useAI = (options as unknown as { useAI?: boolean }).useAI !== false;
      if (useAI) {
        const aiResults = await this.detectByAI(code);
        algorithms.push(...aiResults);
      }

      const mergedAlgorithms = this.mergeResults(algorithms);

      const securityResults = this.evaluateSecurity(mergedAlgorithms, code);
      securityIssues.push(...securityResults);

      const strength = this.analyzeStrength(mergedAlgorithms, securityIssues);

      const confidence =
        mergedAlgorithms.length > 0
          ? mergedAlgorithms.reduce((sum, algo) => sum + algo.confidence, 0) /
            mergedAlgorithms.length
          : 0;

      logger.info(
        `Crypto detection completed in ${Date.now() - startTime}ms, found ${mergedAlgorithms.length} algorithms`
      );

      return { algorithms: mergedAlgorithms, libraries, confidence, securityIssues, strength };
    } catch (error) {
      logger.error('Crypto detection failed', error);
      throw error;
    }
  }

  private detectByKeywords(code: string): CryptoAlgorithm[] {
    const algorithms: CryptoAlgorithm[] = [];
    const keywordRules = this.rulesManager.getKeywordRules();

    keywordRules.forEach((rule) => {
      rule.keywords.forEach((keyword) => {
        const regex = new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, 'gi');
        const matches = code.match(regex);

        if (matches) {
          if (rule.category === 'mode' || rule.category === 'padding') return;

          algorithms.push({
            name: keyword,
            type: rule.category as CryptoAlgorithm['type'],
            confidence: rule.confidence,
            location: { file: 'current', line: this.findLineNumber(code, keyword) },
            usage: `Found ${matches.length} occurrence(s) of ${keyword}${rule.description ? ` (${rule.description})` : ''}`,
          });
        }
      });
    });

    return algorithms;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async detectByAI(code: string): Promise<CryptoAlgorithm[]> {
    try {
      const messages = generateCryptoDetectionPrompt(code);
      const response = await this.llm.chat(messages, {
        temperature: 0.2,
        maxTokens: CRYPTO_DETECT_LLM_MAX_TOKENS,
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const result = JSON.parse(jsonMatch[0]) as { algorithms?: unknown[] };
      if (!Array.isArray(result.algorithms)) return [];

      return result.algorithms.map((algo: unknown) => {
        const a = algo as Record<string, unknown>;
        return {
          name: (a.name as string) || 'Unknown',
          type: (a.type as CryptoAlgorithm['type']) || 'other',
          confidence: (a.confidence as number) || 0.5,
          location: { file: 'current', line: 0 },
          parameters: a.parameters as CryptoAlgorithm['parameters'],
          usage: (a.usage as string) || '',
        };
      });
    } catch (error) {
      logger.warn('AI crypto detection failed', error);
      return [];
    }
  }

  private detectLibraries(code: string): CryptoLibrary[] {
    const libraries: CryptoLibrary[] = [];
    const libraryRules = this.rulesManager.getLibraryRules();

    libraryRules.forEach((rule) => {
      const found = rule.patterns.some((pattern) => code.includes(pattern));

      if (found) {
        let version: string | undefined;
        if (rule.versionPattern) {
          const versionMatch = code.match(rule.versionPattern);
          version = versionMatch?.[1];
        }
        libraries.push({ name: rule.name, version, confidence: rule.confidence });
      }
    });

    return libraries;
  }

  private detectByAST(code: string): {
    algorithms: CryptoAlgorithm[];
    parameters: Map<string, Record<string, unknown>>;
  } {
    const algorithms: CryptoAlgorithm[] = [];
    const parameters = new Map<string, Record<string, unknown>>();

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
      });

      const constantRules = this.rulesManager.getConstantRules();

      traverse(ast, {
        VariableDeclarator(path) {
          const node = path.node;
          if (
            node.init?.type === 'ArrayExpression' &&
            node.init.elements.length === 256 &&
            node.id.type === 'Identifier' &&
            (node.id.name.toLowerCase().includes('sbox') ||
              node.id.name.toLowerCase().includes('box') ||
              node.id.name.toLowerCase().includes('table'))
          ) {
            algorithms.push({
              name: 'Custom Symmetric Cipher',
              type: 'symmetric',
              confidence: 0.8,
              location: { file: 'current', line: node.loc?.start.line || 0 },
              usage: `S-box array detected (${node.id.name})`,
            });
          }
        },

        CallExpression(path) {
          const node = path.node;
          if (t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.property)) {
            const methodName = node.callee.property.name;

            if (['modPow', 'modInverse', 'gcd', 'isProbablePrime'].includes(methodName)) {
              algorithms.push({
                name: 'Asymmetric Encryption',
                type: 'asymmetric',
                confidence: 0.75,
                location: { file: 'current', line: node.loc?.start.line || 0 },
                usage: `Big number operation detected: ${methodName}`,
              });
            }

            extractCryptoParameters(node, parameters);
          }
        },

        FunctionDeclaration(path) {
          const node = path.node;
          const funcName = node.id?.name.toLowerCase() || '';

          if (
            funcName.includes('hash') ||
            funcName.includes('digest') ||
            funcName.includes('checksum')
          ) {
            const bodyCode = code.substring(node.start || 0, node.end || 0);
            const hasLoop = bodyCode.includes('for') || bodyCode.includes('while');
            const hasBitOps = />>>|<<|&|\||\^/.test(bodyCode);

            if (hasLoop && hasBitOps) {
              algorithms.push({
                name: 'Custom Hash Function',
                type: 'hash',
                confidence: 0.7,
                location: { file: 'current', line: node.loc?.start.line || 0 },
                usage: `Hash function detected: ${funcName}`,
              });
            }
          }
        },

        ArrayExpression(path) {
          const elements = path.node.elements;
          if (elements.length < 4) return;

          const values: number[] = [];
          elements.forEach((element) => {
            if (t.isNumericLiteral(element)) values.push(element.value);
          });

          constantRules.forEach((rule) => {
            const matches = rule.values.every((c, i) => values[i] === c);
            if (matches) {
              const algoType = rule.type === 'other' ? 'encoding' : rule.type;
              algorithms.push({
                name: rule.name,
                type: algoType as CryptoAlgorithm['type'],
                confidence: rule.confidence,
                location: { file: 'current', line: path.node.loc?.start.line || 0 },
                usage: `${rule.name} initialization constants detected`,
              });
            }
          });
        },
      });
    } catch (error) {
      logger.warn('AST detection failed', error);
    }

    return { algorithms, parameters };
  }

  private mergeParameters(
    algorithms: CryptoAlgorithm[],
    parameters: Map<string, Record<string, unknown>>
  ): void {
    algorithms.forEach((algo) => {
      const params = parameters.get(algo.name);
      if (params) {
        algo.parameters = { ...algo.parameters, ...params };
      }
    });
  }

  private evaluateSecurity(algorithms: CryptoAlgorithm[], _code: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    const securityRules = this.rulesManager.getSecurityRules();

    algorithms.forEach((algo) => {
      const context = {
        algorithm: algo.name,
        mode: algo.parameters?.mode as string,
        padding: algo.parameters?.padding as string,
        keySize: (algo.parameters as unknown as { keySize?: number })?.keySize,
      };

      securityRules.forEach((rule) => {
        if (rule.check(context)) {
          issues.push({
            severity: rule.severity,
            algorithm: algo.name,
            issue: rule.message,
            recommendation: rule.recommendation || '',
            location: algo.location,
          });
        }
      });
    });

    return issues;
  }

  private analyzeStrength(
    _algorithms: CryptoAlgorithm[],
    securityIssues: SecurityIssue[]
  ): CryptoStrength {
    let algorithmScore = 100;
    let keySizeScore = 100;
    let modeScore = 100;
    let implementationScore = 100;

    securityIssues.forEach((issue) => {
      const penalty = { critical: 40, high: 25, medium: 15, low: 5 }[issue.severity];

      if (issue.issue.includes('algorithm') || issue.issue.includes('broken')) {
        algorithmScore -= penalty;
      } else if (issue.issue.includes('key')) {
        keySizeScore -= penalty;
      } else if (issue.issue.includes('mode')) {
        modeScore -= penalty;
      } else {
        implementationScore -= penalty;
      }
    });

    algorithmScore = Math.max(0, algorithmScore);
    keySizeScore = Math.max(0, keySizeScore);
    modeScore = Math.max(0, modeScore);
    implementationScore = Math.max(0, implementationScore);

    const totalScore = (algorithmScore + keySizeScore + modeScore + implementationScore) / 4;

    let overall: CryptoStrength['overall'];
    if (totalScore >= 80) overall = 'strong';
    else if (totalScore >= 60) overall = 'moderate';
    else if (totalScore >= 40) overall = 'weak';
    else overall = 'broken';

    return {
      overall,
      score: Math.round(totalScore),
      factors: {
        algorithm: Math.round(algorithmScore),
        keySize: Math.round(keySizeScore),
        mode: Math.round(modeScore),
        implementation: Math.round(implementationScore),
      },
    };
  }

  private mergeResults(algorithms: CryptoAlgorithm[]): CryptoAlgorithm[] {
    const merged = new Map<string, CryptoAlgorithm>();

    algorithms.forEach((algo) => {
      const key = `${algo.name}-${algo.type}`;
      const existing = merged.get(key);
      if (!existing || algo.confidence > existing.confidence) {
        merged.set(key, algo);
      }
    });

    return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence);
  }

  private findLineNumber(code: string, keyword: string): number {
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.includes(keyword)) return i + 1;
    }
    return 0;
  }
}

function extractCryptoParameters(
  node: t.CallExpression,
  parameters: Map<string, Record<string, unknown>>
): void {
  if (!t.isMemberExpression(node.callee)) return;

  const calleeName = getCalleeFullName(node.callee);

  if (calleeName.includes('CryptoJS')) {
    const algoMatch = calleeName.match(/CryptoJS\.(AES|DES|TripleDES|RC4|Rabbit|RabbitLegacy)/);
    if (algoMatch) {
      const algoName = algoMatch[1];
      const params: Record<string, unknown> = {};

      if (node.arguments.length >= 3 && t.isObjectExpression(node.arguments[2])) {
        const config = node.arguments[2];
        config.properties.forEach((prop) => {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
            const key = prop.key.name;
            if (t.isIdentifier(prop.value)) params[key] = prop.value.name;
            else if (t.isStringLiteral(prop.value)) params[key] = prop.value.value;
            else if (t.isNumericLiteral(prop.value)) params[key] = prop.value.value;
          }
        });
      }

      if (algoName) parameters.set(algoName, params);
    }
  }

  if (calleeName.includes('crypto.subtle')) {
    const methodMatch = calleeName.match(/\.(encrypt|decrypt|sign|verify|digest|generateKey)/);
    if (methodMatch && node.arguments.length > 0) {
      const firstArg = node.arguments[0];
      if (t.isObjectExpression(firstArg)) {
        const params: Record<string, unknown> = {};
        firstArg.properties.forEach((prop) => {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
            const key = prop.key.name;
            if (t.isStringLiteral(prop.value)) params[key] = prop.value.value;
            else if (t.isNumericLiteral(prop.value)) params[key] = prop.value.value;
          }
        });
        const algoName = (params.name as string) || 'WebCrypto';
        if (algoName) parameters.set(algoName, params);
      }
    }
  }
}

function getCalleeFullName(node: t.MemberExpression): string {
  const parts: string[] = [];

  const traverseNode = (n: t.Expression | t.V8IntrinsicIdentifier): void => {
    if (t.isMemberExpression(n)) {
      traverseNode(n.object);
      if (t.isIdentifier(n.property)) parts.push(n.property.name);
    } else if (t.isIdentifier(n)) {
      parts.push(n.name);
    }
  };

  traverseNode(node);
  return parts.join('.');
}
