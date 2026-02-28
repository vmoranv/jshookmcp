import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as parser from '@babel/parser';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

import {
  analyzeComplexityMetrics,
  calculateCodeSimilarity,
  calculateQualityScore,
  detectCodePatterns,
  detectDuplicateCode,
} from '../../../src/modules/analyzer/QualityAnalyzer.js';

describe('QualityAnalyzer helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  it('calculates weighted quality score with security/complexity penalties', () => {
    const score = calculateQualityScore(
      { functions: [{ complexity: 12 }], classes: [], modules: [], callGraph: { nodes: [], edges: [] } } as any,
      [
        { severity: 'critical' },
        { severity: 'high' },
      ] as any,
      { qualityScore: 80 },
      { cyclomaticComplexity: 15, cognitiveComplexity: 12, maintainabilityIndex: 60 },
      [{ severity: 'high' }]
    );

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(80);
  });

  it('clamps quality score to valid range', () => {
    const score = calculateQualityScore(
      { functions: [], classes: [], modules: [], callGraph: { nodes: [], edges: [] } } as any,
      Array.from({ length: 30 }, () => ({ severity: 'critical' })) as any,
      { qualityScore: -50 },
      { cyclomaticComplexity: 100, cognitiveComplexity: 100, maintainabilityIndex: -10 },
      Array.from({ length: 20 }, () => ({ severity: 'high' })) as any
    );

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('detects design patterns and anti-patterns from code', () => {
    const code = `
      class Subject {
        subscribe() {}
        unsubscribe() {}
        notify() {}
      }
      var magic = 42;
      try { throw new Error('x'); } catch (e) {}
    `;
    const result = detectCodePatterns(code);

    expect(result.patterns.some((p) => p.name === 'Observer Pattern')).toBe(true);
    expect(result.antiPatterns.some((p) => p.name === 'Use of var')).toBe(true);
    expect(result.antiPatterns.some((p) => p.name === 'Magic Number')).toBe(true);
    expect(result.antiPatterns.some((p) => p.name === 'Empty Catch Block')).toBe(true);
  });

  it('computes complexity and halstead metrics for nested code', () => {
    const code = `
      function x(a, b) {
        if (a > 1 && b > 2) {
          for (let i = 0; i < 3; i++) {
            if (i % 2 === 0) return i + a;
          }
        }
        return 0;
      }
    `;
    const metrics = analyzeComplexityMetrics(code);

    expect(metrics.cyclomaticComplexity).toBeGreaterThan(1);
    expect(metrics.cognitiveComplexity).toBeGreaterThan(0);
    expect(metrics.halsteadMetrics.vocabulary).toBeGreaterThan(0);
  });

  it('detects duplicate functions from AST', () => {
    const code = `
      function alpha(x){ return x + 1; }
      function beta(y){ return y + 1; }
    `;
    const ast = parser.parse(code, { sourceType: 'module' });
    const duplicates = detectDuplicateCode(ast as any);

    expect(duplicates.length).toBeGreaterThan(0);
    expect(duplicates[0]!.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('measures similarity and rejects drastically different lengths', () => {
    const close = calculateCodeSimilarity('abc123', 'abc124');
    const far = calculateCodeSimilarity('short', 'x'.repeat(200));

    expect(close).toBeGreaterThan(0.7);
    expect(far).toBe(0);
  });

  it('returns empty pattern sets for invalid source code', () => {
    const result = detectCodePatterns('function broken( {');

    expect(result.patterns).toEqual([]);
    expect(result.antiPatterns).toEqual([]);
    expect(loggerState.warn).toHaveBeenCalled();
  });
});

