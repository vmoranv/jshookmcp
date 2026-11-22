import * as parser from '@babel/parser';
import { BABEL_PARSE_PLUGINS } from '@utils/babel-plugins';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import type {
  DetectCryptoOptions,
  DetectCryptoResult,
  CryptoAlgorithm,
  CryptoLibrary,
} from '@internal-types/index';
import { logger } from '@utils/logger';
import { CryptoRulesManager } from '@modules/crypto/CryptoRules';

/** Score penalty applied per security issue, keyed by severity. */
const SEVERITY_WEIGHTS: Record<SecurityIssue['severity'], number> = {
  critical: 40,
  high: 25,
  medium: 15,
  low: 5,
};

/** Minimum total score for each overall strength label (inclusive). */
const STRENGTH_THRESHOLDS = {
  strong: 80,
  moderate: 60,
  weak: 40,
} as const;

/** An array literal of this many elements is treated as an S-box (AES: 256). */
const SBOX_ARRAY_SIZE = 256;
/** Big-number operations that imply asymmetric crypto. */
const BIGINT_OPERATION_METHODS = ['modPow', 'modInverse', 'gcd', 'isProbablePrime'];
/** Function-name hints for custom hash detection. */
const HASH_FUNCTION_NAME_HINTS = ['hash', 'digest', 'checksum'];
/** Confidence assigned to heuristic AST detections. */
const SBOX_DETECT_CONFIDENCE = 0.8;
const BIGINT_OP_CONFIDENCE = 0.75;
const HASH_FUNCTION_CONFIDENCE = 0.7;

export interface SecurityIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  algorithm?: string;
  /** Structured rule identifier (e.g. "weak-rc4", "ecb-mode") — the reliable
   *  classification key; message text is user-visible only. */
  ruleName?: string;
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
  private rulesManager: CryptoRulesManager;

  constructor(_llm?: any, customRules?: CryptoRulesManager) {
    this.rulesManager = customRules || new CryptoRulesManager();
  }

  loadCustomRules(json: string): void {
    this.rulesManager.loadFromJSON(json);
  }

  exportRules(): string {
    return this.rulesManager.exportToJSON();
  }

  async detect(
    options: DetectCryptoOptions,
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
        `Crypto detection completed in ${Date.now() - startTime}ms, found ${mergedAlgorithms.length} algorithms`,
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
            usage:
              `Found ${matches.length} occurrence(s) of ${keyword}` +
              `${rule.description ? ` (${rule.description})` : ''}`,
          });
        }
      });
    });

    return algorithms;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        plugins: BABEL_PARSE_PLUGINS,
        errorRecovery: true,
      });

      const constantRules = this.rulesManager.getConstantRules();

      traverse(ast, {
        VariableDeclarator(path) {
          const node = path.node;
          if (
            node.init?.type === 'ArrayExpression' &&
            node.init.elements.length === SBOX_ARRAY_SIZE &&
            node.id.type === 'Identifier' &&
            (node.id.name.toLowerCase().includes('sbox') ||
              node.id.name.toLowerCase().includes('box') ||
              node.id.name.toLowerCase().includes('table'))
          ) {
            algorithms.push({
              name: 'Custom Symmetric Cipher',
              type: 'symmetric',
              confidence: SBOX_DETECT_CONFIDENCE,
              location: { file: 'current', line: node.loc?.start.line || 0 },
              usage: `S-box array detected (${node.id.name})`,
            });
          }
        },

        CallExpression(path) {
          const node = path.node;
          if (t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.property)) {
            const methodName = node.callee.property.name;

            if (BIGINT_OPERATION_METHODS.includes(methodName)) {
              algorithms.push({
                name: 'Asymmetric Encryption',
                type: 'asymmetric',
                confidence: BIGINT_OP_CONFIDENCE,
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

          if (HASH_FUNCTION_NAME_HINTS.some((hint) => funcName.includes(hint))) {
            const bodyCode = code.substring(node.start || 0, node.end || 0);
            const hasLoop = bodyCode.includes('for') || bodyCode.includes('while');
            const hasBitOps = />>>|<<|&|\||\^/.test(bodyCode);

            if (hasLoop && hasBitOps) {
              algorithms.push({
                name: 'Custom Hash Function',
                type: 'hash',
                confidence: HASH_FUNCTION_CONFIDENCE,
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
    parameters: Map<string, Record<string, unknown>>,
  ): void {
    algorithms.forEach((algo) => {
      const params = parameters.get(algo.name);
      if (params) {
        algo.parameters = { ...algo.parameters, ...params };
      }
    });
  }

  private evaluateSecurity(algorithms: CryptoAlgorithm[], _exitCodeValue: string): SecurityIssue[] {
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
            ruleName: rule.name,
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
    securityIssues: SecurityIssue[],
  ): CryptoStrength {
    let algorithmScore = 100;
    let keySizeScore = 100;
    let modeScore = 100;
    let implementationScore = 100;

    securityIssues.forEach((issue) => {
      const penalty = SEVERITY_WEIGHTS[issue.severity];

      switch (this.classifyIssue(issue)) {
        case 'algorithm':
          algorithmScore -= penalty;
          break;
        case 'keySize':
          keySizeScore -= penalty;
          break;
        case 'mode':
          modeScore -= penalty;
          break;
        default:
          implementationScore -= penalty;
          break;
      }
    });

    algorithmScore = Math.max(0, algorithmScore);
    keySizeScore = Math.max(0, keySizeScore);
    modeScore = Math.max(0, modeScore);
    implementationScore = Math.max(0, implementationScore);

    const totalScore = (algorithmScore + keySizeScore + modeScore + implementationScore) / 4;

    let overall: CryptoStrength['overall'];
    if (totalScore >= STRENGTH_THRESHOLDS.strong) overall = 'strong';
    else if (totalScore >= STRENGTH_THRESHOLDS.moderate) overall = 'moderate';
    else if (totalScore >= STRENGTH_THRESHOLDS.weak) overall = 'weak';
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

  /**
   * Classify a security issue into a strength bucket. Prefers the structured
   * rule name (which custom JSON rules carry too); falls back to message text
   * so legacy callers that construct issues manually still behave sensibly.
   */
  private classifyIssue(issue: SecurityIssue): 'algorithm' | 'keySize' | 'mode' | 'implementation' {
    const name = (issue.ruleName ?? '').toLowerCase();
    const text = name + ' ' + issue.issue.toLowerCase();

    // Padding first: its message often mentions modes ("non-streaming modes"),
    // which would misroute it into the mode bucket.
    if (name.includes('padding') || text.includes('padding')) {
      return 'implementation';
    }
    if (name.includes('key') || text.includes('key size')) {
      return 'keySize';
    }
    if (name.includes('mode') || text.includes('mode')) {
      return 'mode';
    }
    if (
      name.includes('weak') ||
      name.includes('broken') ||
      text.includes('broken') ||
      text.includes('algorithm')
    ) {
      return 'algorithm';
    }
    return 'implementation';
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

    return Array.from(merged.values()).toSorted((a, b) => b.confidence - a.confidence);
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
  parameters: Map<string, Record<string, unknown>>,
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

  const traverseNode = (n: t.Expression | t.V8IntrinsicIdentifier | t.Super): void => {
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
