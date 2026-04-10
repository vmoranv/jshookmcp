import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const patternState = vi.hoisted(() => ({
  filterCriticalRequests: vi.fn((input: any[]) => input.slice(0, 1)),
  filterCriticalResponses: vi.fn((input: any[]) => input.slice(0, 1)),
  filterCriticalLogs: vi.fn((input: any[]) => input.slice(0, 1)),
  detectEncryptionPatterns: vi.fn<
    () => Array<{
      type: 'AES' | 'RSA' | 'MD5' | 'SHA' | 'Base64' | 'Custom';
      location: string;
      confidence: number;
      evidence: string[];
    }>
  >(() => []),
  detectSignaturePatterns: vi.fn<
    () => Array<{
      type: 'HMAC' | 'JWT' | 'Custom';
      location: string;
      parameters: string[];
      confidence: number;
    }>
  >(() => []),
  detectTokenPatterns: vi.fn<
    () => Array<{
      type: 'OAuth' | 'JWT' | 'Custom';
      location: string;
      format: string;
      confidence: number;
    }>
  >(() => []),
  detectAntiDebugPatterns: vi.fn<
    () => Array<{
      type: 'debugger' | 'console.log' | 'devtools-detect' | 'timing-check';
      location: string;
      code: string;
    }>
  >(() => []),
  extractSuspiciousAPIs: vi.fn(() => ['api.sign']),
  extractKeyFunctions: vi.fn(() => ['fnA']),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@src/modules/analyzer/PatternDetector', () => ({
  filterCriticalRequests: patternState.filterCriticalRequests,
  filterCriticalResponses: patternState.filterCriticalResponses,
  filterCriticalLogs: patternState.filterCriticalLogs,
  detectEncryptionPatterns: patternState.detectEncryptionPatterns,
  detectSignaturePatterns: patternState.detectSignaturePatterns,
  detectTokenPatterns: patternState.detectTokenPatterns,
  detectAntiDebugPatterns: patternState.detectAntiDebugPatterns,
  extractSuspiciousAPIs: patternState.extractSuspiciousAPIs,
  extractKeyFunctions: patternState.extractKeyFunctions,
}));

import { IntelligentAnalyzer } from '@modules/analyzer/IntelligentAnalyzer';

function makeData() {
  return {
    requests: [
      {
        url: 'https://vmoranv.github.io/jshookmcp/a/api/x?sig=1',
        method: 'GET',
        headers: {},
        timestamp: 1,
      },
      {
        url: 'https://vmoranv.github.io/jshookmcp/a/api/x?sig=2',
        method: 'GET',
        headers: {},
        timestamp: 2,
      },
    ] as any[],
    responses: [
      { url: 'https://vmoranv.github.io/jshookmcp/a/api/x', status: 200, timestamp: 3 },
    ] as any[],
    logs: [{ type: 'log', text: 'fnA', timestamp: 4 }] as any[],
    exceptions: [{ message: 'boom' }] as any[],
  };
}

describe('IntelligentAnalyzer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(patternState).forEach((fn) => (fn as any).mockClear?.());
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  it('builds analysis result from rule-based detector outputs', () => {
    patternState.detectEncryptionPatterns.mockReturnValue([
      { type: 'AES', location: 'req', confidence: 0.9, evidence: ['aes'] },
    ]);
    const analyzer = new IntelligentAnalyzer();

    const result = analyzer.analyze(makeData() as any);

    expect(result.criticalRequests).toHaveLength(1);
    expect(result.criticalResponses).toHaveLength(1);
    expect(result.summary.totalRequests).toBe(2);
    expect(result.summary.suspiciousAPIs).toEqual(['api.sign']);
    expect(result.patterns.encryption).toHaveLength(1);
  });

  it('aggregates similar requests by origin+pathname and skips invalid URLs', () => {
    const analyzer = new IntelligentAnalyzer();
    const grouped = analyzer.aggregateSimilarRequests([
      { url: 'https://vmoranv.github.io/jshookmcp/a/path?a=1' },
      { url: 'https://vmoranv.github.io/jshookmcp/a/path?a=2' },
      { url: 'invalid-url' },
    ] as any);

    expect(grouped.size).toBe(1);
    expect(grouped.get('https://vmoranv.github.io/jshookmcp/a/path')).toHaveLength(2);
  });

  it('generates readable summary text with key sections', () => {
    patternState.detectAntiDebugPatterns.mockReturnValue([
      { type: 'debugger', location: 'source.js', code: 'debugger;' },
    ]);
    const analyzer = new IntelligentAnalyzer();
    const result = analyzer.analyze(makeData() as any);
    const text = analyzer.generateAIFriendlySummary(result);

    expect(text).toContain('Requests: 2');
    expect(text).toContain('api.sign');
    expect(text).toContain('fnA');
    expect(text).toContain('Anti-Debug Patterns (1):');
    expect(text).toContain('debugger');
  });

  it('handles empty arrays and scalar values in generateAIFriendlySummary', () => {
    const analyzer = new IntelligentAnalyzer();
    const text = analyzer.generateAIFriendlySummary({
      summary: {
        totalRequests: 0,
        filteredRequests: 0,
        totalLogs: 0,
        filteredLogs: 0,
        suspiciousAPIs: [],
        keyFunctions: [],
      },
      patterns: {
        encryption: [
          { type: 'Custom', confidence: 0.9, location: 'test', evidence: 'scalar evidence' as any },
          { type: 'AES', confidence: 0.5, location: 'test', evidence: undefined as any },
          { type: 'RSA', confidence: 0.5, location: 'test', evidence: null as any },
        ],
        signature: [
          {
            type: 'Custom',
            confidence: 0.8,
            parameters: 'scalar parameter' as any,
            location: 'test',
          },
          { type: 'JWT', confidence: 0.4, parameters: undefined as any, location: 'test' },
          { type: 'HMAC', confidence: 0.4, parameters: null as any, location: 'test' },
        ],
        antiDebug: [],
      },
      exceptions: [],
      metadata: { analysisTimeMs: 1 },
    } as any);
    expect(text).toContain('Statistics:');
    expect(text).toContain('scalar evidence');
    expect(text).toContain('scalar parameter');
    expect(text).not.toContain('Suspicious APIs');
    expect(text).not.toContain('Key Functions');
  });

  it('analyzeWithLLM delegates to rule-based analysis and ignores legacy dependencies', async () => {
    const legacy = { chat: vi.fn() } as any;
    const analyzer = new IntelligentAnalyzer(legacy);
    const analyzeSpy = vi.spyOn(analyzer, 'analyze');

    const result = await analyzer.analyzeWithLLM(makeData() as any);

    expect(analyzeSpy).toHaveBeenCalledTimes(1);
    expect(legacy.chat).not.toHaveBeenCalled();
    expect(result.summary.totalRequests).toBe(2);
    expect(result.summary.suspiciousAPIs).toEqual(['api.sign']);
  });

  it('generateAIFriendlySummary handles non-array evidence gracefully', () => {
    const analyzer = new IntelligentAnalyzer();
    const result = analyzer.analyze(makeData() as any);
    result.patterns.encryption = [
      { type: 'AES', location: 'test', confidence: 0.9, evidence: 'not-an-array' as any },
    ];

    expect(() => analyzer.generateAIFriendlySummary(result)).not.toThrow();
    const summary = analyzer.generateAIFriendlySummary(result);
    expect(summary).toContain('AES');
    expect(summary).toContain('not-an-array');
  });

  it('generateAIFriendlySummary handles non-array parameters gracefully', () => {
    const analyzer = new IntelligentAnalyzer();
    const result = analyzer.analyze(makeData() as any);
    result.patterns.signature = [
      { type: 'HMAC', location: 'test', confidence: 0.9, parameters: 'not-an-array' as any },
    ];

    expect(() => analyzer.generateAIFriendlySummary(result)).not.toThrow();
    const summary = analyzer.generateAIFriendlySummary(result);
    expect(summary).toContain('HMAC');
    expect(summary).toContain('not-an-array');
  });

  it('generateAIFriendlySummary handles undefined evidence and parameters gracefully', () => {
    const analyzer = new IntelligentAnalyzer();
    const result = analyzer.analyze(makeData() as any);
    result.patterns.encryption = [
      { type: 'AES', location: 'test', confidence: 0.9, evidence: undefined as any },
    ];
    result.patterns.signature = [
      { type: 'HMAC', location: 'test', confidence: 0.9, parameters: undefined as any },
    ];

    expect(() => analyzer.generateAIFriendlySummary(result)).not.toThrow();
    const summary = analyzer.generateAIFriendlySummary(result);
    expect(summary).toContain('AES');
    expect(summary).toContain('HMAC');
  });
});
