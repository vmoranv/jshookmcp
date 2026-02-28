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
  detectEncryptionPatterns: vi.fn(() => []),
  detectSignaturePatterns: vi.fn(() => []),
  detectTokenPatterns: vi.fn(() => []),
  detectAntiDebugPatterns: vi.fn(() => []),
  extractSuspiciousAPIs: vi.fn(() => ['api.sign']),
  extractKeyFunctions: vi.fn(() => ['fnA']),
}));

const promptState = vi.hoisted(() => ({
  generateRequestAnalysisMessages: vi.fn(() => [{ role: 'user', content: 'req' }]),
  generateLogAnalysisMessages: vi.fn(() => [{ role: 'user', content: 'log' }]),
  generateKeywordExpansionMessages: vi.fn(() => [{ role: 'user', content: 'kw' }]),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

vi.mock('../../../src/modules/analyzer/PatternDetector.js', () => ({
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

vi.mock('../../../src/services/prompts/intelligence.js', () => ({
  generateRequestAnalysisMessages: promptState.generateRequestAnalysisMessages,
  generateLogAnalysisMessages: promptState.generateLogAnalysisMessages,
  generateKeywordExpansionMessages: promptState.generateKeywordExpansionMessages,
}));

import { IntelligentAnalyzer } from '../../../src/modules/analyzer/IntelligentAnalyzer.js';

function makeData() {
  return {
    requests: [
      { url: 'https://a.test/api/x?sig=1', method: 'GET', headers: {}, timestamp: 1 },
      { url: 'https://a.test/api/x?sig=2', method: 'GET', headers: {}, timestamp: 2 },
    ] as any[],
    responses: [{ url: 'https://a.test/api/x', status: 200, timestamp: 3 }] as any[],
    logs: [{ type: 'log', text: 'fnA', timestamp: 4 }] as any[],
    exceptions: [{ message: 'boom' }] as any[],
  };
}

describe('IntelligentAnalyzer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(patternState).forEach((fn) => (fn as any).mockClear?.());
    Object.values(promptState).forEach((fn) => (fn as any).mockClear?.());
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
      { url: 'https://a.test/path?a=1' },
      { url: 'https://a.test/path?a=2' },
      { url: 'invalid-url' },
    ] as any);

    expect(grouped.size).toBe(1);
    expect(grouped.get('https://a.test/path')).toHaveLength(2);
  });

  it('generates readable summary text with key sections', () => {
    const analyzer = new IntelligentAnalyzer();
    const result = analyzer.analyze(makeData() as any);
    const text = analyzer.generateAIFriendlySummary(result);

    expect(text).toContain('Requests: 2');
    expect(text).toContain('api.sign');
    expect(text).toContain('fnA');
  });

  it('returns empty request-analysis result when LLM is unavailable', async () => {
    const analyzer = new IntelligentAnalyzer();
    const result = await analyzer.analyzeCriticalRequestsWithLLM(makeData().requests as any);

    expect(result).toEqual({ encryption: [], signature: [], token: [], customPatterns: [] });
    expect(loggerState.warn).toHaveBeenCalled();
  });

  it('parses request-analysis JSON from LLM response', async () => {
    const llm = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          encryption: [{ type: 'AES', location: 'u', confidence: 0.8, evidence: ['k'] }],
          signature: [],
          token: [],
          customPatterns: [],
        }),
      })),
    } as any;
    const analyzer = new IntelligentAnalyzer(llm);

    const result = await analyzer.analyzeCriticalRequestsWithLLM(makeData().requests as any);

    expect(result.encryption[0]!.type).toBe('AES');
    expect(promptState.generateRequestAnalysisMessages).toHaveBeenCalledTimes(1);
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it('falls back when log-analysis LLM response is invalid JSON', async () => {
    const llm = { chat: vi.fn(async () => ({ content: 'oops' })) } as any;
    const analyzer = new IntelligentAnalyzer(llm);

    const result = await analyzer.analyzeCriticalLogsWithLLM(makeData().logs as any);

    expect(result).toEqual({ keyFunctions: [], dataFlow: '', suspiciousPatterns: [] });
    expect(loggerState.error).toHaveBeenCalled();
  });

  it('merges LLM enhancements into rule-based result', async () => {
    const analyzer = new IntelligentAnalyzer({ chat: vi.fn() } as any);
    vi.spyOn(analyzer, 'analyzeCriticalRequestsWithLLM').mockResolvedValue({
      encryption: [{ type: 'AES', location: 'x', confidence: 1, evidence: ['e'] }] as any,
      signature: [{ type: 'JWT', location: 'y', confidence: 1, parameters: ['p'] }] as any,
      token: [{ type: 'JWT', location: 'z', confidence: 1, format: 'jwt' }] as any,
      customPatterns: [],
    });
    vi.spyOn(analyzer, 'analyzeCriticalLogsWithLLM').mockResolvedValue({
      keyFunctions: [{ name: 'llmFunc', purpose: 'x', confidence: 0.9 }],
      dataFlow: 'df',
      suspiciousPatterns: [],
    });

    const result = await analyzer.analyzeWithLLM(makeData() as any);

    expect(result.patterns.encryption?.some((p) => p.type === 'AES')).toBe(true);
    expect(result.patterns.signature?.some((p) => p.type === 'JWT')).toBe(true);
    expect(result.summary.keyFunctions).toContain('llmFunc');
  });
});

