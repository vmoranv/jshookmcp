import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import type { CodeStructure, SecurityRisk } from '@internal-types/index';
import { logger } from '@utils/logger';

export function calculateQualityScore(
  structure: CodeStructure,
  securityRisks: SecurityRisk[],
  aiAnalysis: Record<string, unknown>,
  complexityMetrics?: {
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    maintainabilityIndex: number;
  },
  antiPatterns?: Array<{ severity: string }>
): number {
  let score = 100;

  let securityScore = 100;
  securityRisks.forEach((risk) => {
    if (risk.severity === 'critical') securityScore -= 20;
    else if (risk.severity === 'high') securityScore -= 10;
    else if (risk.severity === 'medium') securityScore -= 5;
    else securityScore -= 2;
  });
  securityScore = Math.max(0, securityScore);

  let complexityScore = 100;
  if (complexityMetrics) {
    if (complexityMetrics.cyclomaticComplexity > 20) complexityScore -= 30;
    else if (complexityMetrics.cyclomaticComplexity > 10) complexityScore -= 15;
    else if (complexityMetrics.cyclomaticComplexity > 5) complexityScore -= 5;

    if (complexityMetrics.cognitiveComplexity > 15) complexityScore -= 20;
    else if (complexityMetrics.cognitiveComplexity > 10) complexityScore -= 10;
  } else {
    const avgComplexity =
      structure.functions.reduce((sum, fn) => sum + fn.complexity, 0) /
      (structure.functions.length || 1);
    if (avgComplexity > 10) complexityScore -= 20;
    else if (avgComplexity > 5) complexityScore -= 10;
  }
  complexityScore = Math.max(0, complexityScore);

  const maintainabilityScore = complexityMetrics?.maintainabilityIndex || 70;

  let codeSmellScore = 100;
  if (antiPatterns) {
    antiPatterns.forEach((pattern) => {
      if (pattern.severity === 'high') codeSmellScore -= 10;
      else if (pattern.severity === 'medium') codeSmellScore -= 5;
      else codeSmellScore -= 2;
    });
  }
  codeSmellScore = Math.max(0, codeSmellScore);

  let aiScore = 70;
  if (typeof aiAnalysis.qualityScore === 'number') {
    aiScore = aiAnalysis.qualityScore;
  }

  score =
    securityScore * 0.4 +
    complexityScore * 0.25 +
    maintainabilityScore * 0.2 +
    codeSmellScore * 0.15;

  if (typeof aiAnalysis.qualityScore === 'number') {
    score = (score + aiScore) / 2;
  }

  return Math.round(Math.max(0, Math.min(100, score)));
}

export function detectCodePatterns(code: string): {
  patterns: Array<{ name: string; location: number; description: string }>;
  antiPatterns: Array<{ name: string; location: number; severity: string; recommendation: string }>;
} {
  const patterns: Array<{ name: string; location: number; description: string }> = [];
  const antiPatterns: Array<{
    name: string;
    location: number;
    severity: string;
    recommendation: string;
  }> = [];

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    traverse(ast, {
      VariableDeclarator(path) {
        const init = path.node.init;
        if (
          t.isCallExpression(init) &&
          t.isFunctionExpression(init.callee) &&
          init.callee.body.body.some(
            (stmt) => t.isReturnStatement(stmt) && t.isObjectExpression(stmt.argument)
          )
        ) {
          patterns.push({
            name: 'Singleton Pattern',
            location: path.node.loc?.start.line || 0,
            description: 'IIFE returning object (Singleton pattern)',
          });
        }
      },

      ClassDeclaration(path) {
        const methods = path.node.body.body.filter((m) => t.isClassMethod(m));
        const methodNames = methods.map((m) =>
          t.isClassMethod(m) && t.isIdentifier(m.key) ? m.key.name : ''
        );

        if (
          methodNames.includes('subscribe') &&
          methodNames.includes('unsubscribe') &&
          methodNames.includes('notify')
        ) {
          patterns.push({
            name: 'Observer Pattern',
            location: path.node.loc?.start.line || 0,
            description: 'Class with subscribe/unsubscribe/notify methods',
          });
        }
      },

      FunctionDeclaration(path) {
        const loc = path.node.loc;
        if (loc) {
          const lines = loc.end.line - loc.start.line;
          if (lines > 50) {
            antiPatterns.push({
              name: 'Long Function',
              location: loc.start.line,
              severity: 'medium',
              recommendation: `Function is ${lines} lines long. Consider breaking it into smaller functions (max 50 lines)`,
            });
          }
        }
      },

      IfStatement(path) {
        let depth = 0;
        let current: typeof path.parentPath | null = path.parentPath;

        while (current) {
          if (current.isIfStatement() || current.isForStatement() || current.isWhileStatement()) {
            depth++;
          }
          current = current.parentPath;
        }

        if (depth > 3) {
          antiPatterns.push({
            name: 'Deep Nesting',
            location: path.node.loc?.start.line || 0,
            severity: 'medium',
            recommendation: `Nesting depth is ${depth}. Consider extracting to separate functions or using early returns`,
          });
        }
      },

      NumericLiteral(path) {
        const value = path.node.value;
        const parent = path.parent;

        const commonNumbers = [0, 1, -1, 2, 10, 100, 1000];
        if (commonNumbers.includes(value)) return;

        if (t.isMemberExpression(parent) && parent.property === path.node) return;

        if (t.isAssignmentPattern(parent)) return;

        antiPatterns.push({
          name: 'Magic Number',
          location: path.node.loc?.start.line || 0,
          severity: 'low',
          recommendation: `Replace magic number ${value} with a named constant`,
        });
      },

      CatchClause(path) {
        const body = path.node.body.body;
        if (body.length === 0) {
          antiPatterns.push({
            name: 'Empty Catch Block',
            location: path.node.loc?.start.line || 0,
            severity: 'high',
            recommendation:
              'Empty catch block swallows errors. Add proper error handling or logging',
          });
        }
      },

      VariableDeclaration(path) {
        if (path.node.kind === 'var') {
          antiPatterns.push({
            name: 'Use of var',
            location: path.node.loc?.start.line || 0,
            severity: 'low',
            recommendation: 'Use let or const instead of var for better scoping',
          });
        }
      },
    });

    const duplicates = detectDuplicateCode(ast);
    duplicates.forEach((dup) => {
      antiPatterns.push({
        name: 'Duplicate Code',
        location: dup.location,
        severity: 'medium',
        recommendation: `Duplicate code found at lines ${dup.location} and ${dup.duplicateLocation}. Extract into a reusable function.`,
      });
    });
  } catch (error) {
    logger.warn('Code pattern detection failed', error);
  }

  return { patterns, antiPatterns };
}

export function analyzeComplexityMetrics(code: string): {
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  maintainabilityIndex: number;
  halsteadMetrics: {
    vocabulary: number;
    length: number;
    difficulty: number;
    effort: number;
  };
} {
  let cyclomaticComplexity = 1;
  let cognitiveComplexity = 0;
  let operators = 0;
  let operands = 0;
  const uniqueOperators = new Set<string>();
  const uniqueOperands = new Set<string>();

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    let nestingLevel = 0;

    traverse(ast, {
      IfStatement() {
        cyclomaticComplexity++;
      },
      SwitchCase() {
        cyclomaticComplexity++;
      },
      ForStatement() {
        cyclomaticComplexity++;
      },
      WhileStatement() {
        cyclomaticComplexity++;
      },
      DoWhileStatement() {
        cyclomaticComplexity++;
      },
      ConditionalExpression() {
        cyclomaticComplexity++;
      },
      LogicalExpression(path) {
        if (path.node.operator === '&&' || path.node.operator === '||') {
          cyclomaticComplexity++;
        }
      },
      CatchClause() {
        cyclomaticComplexity++;
      },

      'IfStatement|ForStatement|WhileStatement|DoWhileStatement': {
        enter() {
          nestingLevel++;
          cognitiveComplexity += nestingLevel;
        },
        exit() {
          nestingLevel--;
        },
      },

      BinaryExpression(path) {
        operators++;
        uniqueOperators.add(path.node.operator);
      },
      UnaryExpression(path) {
        operators++;
        uniqueOperators.add(path.node.operator);
      },
      Identifier(path) {
        operands++;
        uniqueOperands.add(path.node.name);
      },
      NumericLiteral(path) {
        operands++;
        uniqueOperands.add(String(path.node.value));
      },
      StringLiteral(path) {
        operands++;
        uniqueOperands.add(path.node.value);
      },
    });
  } catch (error) {
    logger.warn('Complexity metrics calculation failed', error);
  }

  const n1 = uniqueOperators.size;
  const n2 = uniqueOperands.size;
  const N1 = operators;
  const N2 = operands;

  const vocabulary = n1 + n2;
  const length = N1 + N2;
  const difficulty = (n1 / 2) * (N2 / (n2 || 1));
  const effort = difficulty * length;

  const volume = length * Math.log2(vocabulary || 1);
  const loc = code.split('\n').length;
  const maintainabilityIndex = Math.max(
    0,
    171 - 5.2 * Math.log(volume || 1) - 0.23 * cyclomaticComplexity - 16.2 * Math.log(loc)
  );

  return {
    cyclomaticComplexity,
    cognitiveComplexity,
    maintainabilityIndex: Math.round(maintainabilityIndex),
    halsteadMetrics: {
      vocabulary,
      length,
      difficulty: Math.round(difficulty * 100) / 100,
      effort: Math.round(effort),
    },
  };
}

export function detectDuplicateCode(ast: t.File): Array<{
  location: number;
  duplicateLocation: number;
  similarity: number;
}> {
  const duplicates: Array<{ location: number; duplicateLocation: number; similarity: number }> = [];
  const codeBlocks: Array<{
    node: t.Node;
    hash: string;
    location: number;
    normalizedCode: string;
  }> = [];

  try {
    traverse(ast, {
      FunctionDeclaration(path) {
        const hash = computeASTHash(path.node);
        const normalized = normalizeCode(path.node);
        codeBlocks.push({
          node: path.node,
          hash,
          location: path.node.loc?.start.line || 0,
          normalizedCode: normalized,
        });
      },

      FunctionExpression(path) {
        const hash = computeASTHash(path.node);
        const normalized = normalizeCode(path.node);
        codeBlocks.push({
          node: path.node,
          hash,
          location: path.node.loc?.start.line || 0,
          normalizedCode: normalized,
        });
      },

      ArrowFunctionExpression(path) {
        const hash = computeASTHash(path.node);
        const normalized = normalizeCode(path.node);
        codeBlocks.push({
          node: path.node,
          hash,
          location: path.node.loc?.start.line || 0,
          normalizedCode: normalized,
        });
      },

      ClassMethod(path) {
        const hash = computeASTHash(path.node);
        const normalized = normalizeCode(path.node);
        codeBlocks.push({
          node: path.node,
          hash,
          location: path.node.loc?.start.line || 0,
          normalizedCode: normalized,
        });
      },
    });

    for (let i = 0; i < codeBlocks.length; i++) {
      for (let j = i + 1; j < codeBlocks.length; j++) {
        const block1 = codeBlocks[i]!;
        const block2 = codeBlocks[j]!;

        if (block1.hash === block2.hash) {
          duplicates.push({
            location: block1.location,
            duplicateLocation: block2.location,
            similarity: 1.0,
          });
          continue;
        }

        const similarity = calculateCodeSimilarity(block1.normalizedCode, block2.normalizedCode);

        if (similarity >= 0.85) {
          duplicates.push({
            location: block1.location,
            duplicateLocation: block2.location,
            similarity,
          });
        }
      }
    }
  } catch (error) {
    logger.debug('Duplicate code detection failed', error);
  }

  return duplicates;
}

export function computeASTHash(node: t.Node): string {
  const normalized = JSON.stringify(node, (key, value) => {
    if (['loc', 'start', 'end', 'range'].includes(key)) {
      return undefined;
    }
    if (key === 'comments' || key === 'leadingComments' || key === 'trailingComments') {
      return undefined;
    }
    return value;
  });

  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

export function normalizeCode(node: t.Node): string {
  let identifierCounter = 0;
  const identifierMap = new Map<string, string>();

  const clonedNode = t.cloneNode(node, true, false);

  traverse(t.file(t.program([clonedNode as t.Statement])), {
    Identifier(path) {
      const name = path.node.name;

      const reserved = [
        'console',
        'window',
        'document',
        'Math',
        'JSON',
        'Array',
        'Object',
        'String',
        'Number',
      ];
      if (reserved.includes(name)) return;

      if (!identifierMap.has(name)) {
        identifierMap.set(name, `VAR_${identifierCounter++}`);
      }
      path.node.name = identifierMap.get(name)!;
    },

    StringLiteral(path) {
      path.node.value = 'STRING';
    },

    NumericLiteral(path) {
      path.node.value = 0;
    },
  });

  return JSON.stringify(clonedNode);
}

export function calculateCodeSimilarity(code1: string, code2: string): number {
  const len1 = code1.length;
  const len2 = code2.length;

  if (Math.abs(len1 - len2) > Math.max(len1, len2) * 0.3) {
    return 0;
  }

  const matrix: number[][] = Array.from({ length: len1 + 1 }, () =>
    Array.from({ length: len2 + 1 }, () => 0)
  );

  for (let i = 0; i <= len1; i++) {
    matrix[i]![0] = i;
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = code1[i - 1] === code2[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost
      );
    }
  }

  const distance = matrix[len1]![len2]!;
  const maxLen = Math.max(len1, len2);

  return 1 - distance / maxLen;
}
