import type { NetworkRequest, NetworkResponse } from '@modules/monitor/ConsoleMonitor';
import type { ConsoleMessage, ExceptionInfo } from '@modules/monitor/ConsoleMonitor';
import { logger } from '@utils/logger';
import type { LLMService } from '@services/LLMService';
import {
  generateRequestAnalysisMessages,
  generateLogAnalysisMessages,
  generateKeywordExpansionMessages,
} from '@services/prompts/intelligence';

import {
  filterCriticalRequests,
  filterCriticalResponses,
  filterCriticalLogs,
  detectEncryptionPatterns,
  detectSignaturePatterns,
  detectTokenPatterns,
  detectAntiDebugPatterns,
  extractSuspiciousAPIs,
  extractKeyFunctions,
} from '@modules/analyzer/PatternDetector';

export interface AnalysisResult {
  criticalRequests: NetworkRequest[];

  criticalResponses: NetworkResponse[];

  criticalLogs: ConsoleMessage[];

  exceptions: ExceptionInfo[];

  patterns: {
    encryption?: EncryptionPattern[];
    signature?: SignaturePattern[];
    token?: TokenPattern[];
    antiDebug?: AntiDebugPattern[];
  };

  summary: {
    totalRequests: number;
    filteredRequests: number;
    totalLogs: number;
    filteredLogs: number;
    suspiciousAPIs: string[];
    keyFunctions: string[];
  };
}

export interface EncryptionPattern {
  type: 'AES' | 'RSA' | 'MD5' | 'SHA' | 'Base64' | 'Custom';
  location: string;
  confidence: number;
  evidence: string[];
}

export interface SignaturePattern {
  type: 'HMAC' | 'JWT' | 'Custom';
  location: string;
  parameters: string[];
  confidence: number;
}

export interface TokenPattern {
  type: 'OAuth' | 'JWT' | 'Custom';
  location: string;
  format: string;
  confidence: number;
}

export interface AntiDebugPattern {
  type: 'debugger' | 'console.log' | 'devtools-detect' | 'timing-check';
  location: string;
  code: string;
}

export class IntelligentAnalyzer {
  private llmService?: LLMService;

  constructor(llmService?: LLMService) {
    this.llmService = llmService;
    if (llmService) {
      logger.info('IntelligentAnalyzer initialized with LLM support');
    } else {
      logger.warn('IntelligentAnalyzer initialized without LLM (using rule-based analysis only)');
    }
  }

  analyze(data: {
    requests: NetworkRequest[];
    responses: NetworkResponse[];
    logs: ConsoleMessage[];
    exceptions: ExceptionInfo[];
  }): AnalysisResult {
    logger.info('Starting intelligent analysis...', {
      requests: data.requests.length,
      responses: data.responses.length,
      logs: data.logs.length,
      exceptions: data.exceptions.length,
    });

    const criticalRequests = filterCriticalRequests(data.requests);
    const criticalResponses = filterCriticalResponses(data.responses);

    const criticalLogs = filterCriticalLogs(data.logs);

    const patterns = {
      encryption: detectEncryptionPatterns(data.requests, data.logs),
      signature: detectSignaturePatterns(data.requests, data.logs),
      token: detectTokenPatterns(data.requests, data.logs),
      antiDebug: detectAntiDebugPatterns(data.logs),
    };

    const suspiciousAPIs = extractSuspiciousAPIs(criticalRequests);
    const keyFunctions = extractKeyFunctions(criticalLogs);

    const result: AnalysisResult = {
      criticalRequests,
      criticalResponses,
      criticalLogs,
      exceptions: data.exceptions,
      patterns,
      summary: {
        totalRequests: data.requests.length,
        filteredRequests: criticalRequests.length,
        totalLogs: data.logs.length,
        filteredLogs: criticalLogs.length,
        suspiciousAPIs,
        keyFunctions,
      },
    };

    logger.success('Analysis completed', {
      criticalRequests: criticalRequests.length,
      criticalLogs: criticalLogs.length,
      patterns: Object.keys(patterns).length,
    });

    return result;
  }

  aggregateSimilarRequests(requests: NetworkRequest[]): Map<string, NetworkRequest[]> {
    const groups = new Map<string, NetworkRequest[]>();

    for (const req of requests) {
      try {
        const url = new URL(req.url);
        const baseUrl = `${url.origin}${url.pathname}`;

        if (!groups.has(baseUrl)) {
          groups.set(baseUrl, []);
        }
        groups.get(baseUrl)!.push(req);
      } catch {
        /* URL parse failed — skip non-standard URLs during request grouping */
      }
    }

    return groups;
  }

  generateAIFriendlySummary(result: AnalysisResult): string {
    const lines: string[] = [];

    lines.push('=== Analysis Summary ===');
    lines.push('');

    lines.push(`Statistics:`);
    lines.push(
      `  - Requests: ${result.summary.totalRequests} -> Filtered: ${result.summary.filteredRequests}`
    );
    lines.push(`  - Logs: ${result.summary.totalLogs} -> Filtered: ${result.summary.filteredLogs}`);
    lines.push(`  - Exceptions: ${result.exceptions.length}`);
    lines.push('');

    if (result.summary.suspiciousAPIs.length > 0) {
      lines.push(`Suspicious APIs (${result.summary.suspiciousAPIs.length}):`);
      result.summary.suspiciousAPIs.slice(0, 10).forEach((api) => {
        lines.push(`  - ${api}`);
      });
      lines.push('');
    }

    if (result.patterns.encryption && result.patterns.encryption.length > 0) {
      lines.push(`Encryption Patterns (${result.patterns.encryption.length}):`);
      result.patterns.encryption.slice(0, 5).forEach((pattern) => {
        const evidence = Array.isArray(pattern.evidence)
          ? pattern.evidence.join(', ')
          : String(pattern.evidence ?? '');
        lines.push(`  - ${pattern.type} (confidence: ${(pattern.confidence * 100).toFixed(0)}%)`);
        lines.push(`    location: ${pattern.location}`);
        lines.push(`    evidence: ${evidence}`);
      });
      lines.push('');
    }

    if (result.patterns.signature && result.patterns.signature.length > 0) {
      lines.push(`Signature Patterns (${result.patterns.signature.length}):`);
      result.patterns.signature.slice(0, 5).forEach((pattern) => {
        const parameters = Array.isArray(pattern.parameters)
          ? pattern.parameters.join(', ')
          : String(pattern.parameters ?? '');
        lines.push(`  - ${pattern.type}`);
        lines.push(`    parameters: ${parameters}`);
      });
      lines.push('');
    }

    if (result.patterns.antiDebug && result.patterns.antiDebug.length > 0) {
      lines.push(`Anti-Debug Patterns (${result.patterns.antiDebug.length}):`);
      result.patterns.antiDebug.slice(0, 3).forEach((pattern) => {
        lines.push(`  - ${pattern.type}`);
      });
      lines.push('');
    }

    if (result.summary.keyFunctions.length > 0) {
      lines.push(`Key Functions (${result.summary.keyFunctions.length}):`);
      lines.push(`  ${result.summary.keyFunctions.slice(0, 15).join(', ')}`);
      lines.push('');
    }

    lines.push('=== Analysis Summary ===');

    return lines.join('\n');
  }

  async analyzeCriticalRequestsWithLLM(requests: NetworkRequest[]): Promise<{
    encryption: EncryptionPattern[];
    signature: SignaturePattern[];
    token: TokenPattern[];
    customPatterns: Array<{
      type: string;
      description: string;
      location: string;
      confidence: number;
    }>;
  }> {
    if (!this.llmService) {
      logger.warn('LLM service not available, skipping LLM analysis');
      return { encryption: [], signature: [], token: [], customPatterns: [] };
    }

    logger.info('Starting LLM-enhanced request analysis...');

    const requestSummary = requests.slice(0, 20).map((req) => {
      const urlObj = new URL(req.url, 'http://localhost');
      const params = Object.fromEntries(urlObj.searchParams.entries());

      return {
        url: req.url,
        method: req.method,
        urlParams: params,
        headers: req.headers,
        postData: req.postData?.substring(0, 500),
      };
    });

    try {
      const response = await this.llmService.chat(generateRequestAnalysisMessages(requestSummary), {
        temperature: 0.2,
        maxTokens: 3000,
      });

      const result = JSON.parse(response.content);

      logger.success('LLM request analysis completed', {
        encryption: result.encryption?.length || 0,
        signature: result.signature?.length || 0,
        token: result.token?.length || 0,
        custom: result.customPatterns?.length || 0,
      });

      return result;
    } catch (error) {
      logger.error('LLM request analysis failed:', error);
      return { encryption: [], signature: [], token: [], customPatterns: [] };
    }
  }

  async analyzeCriticalLogsWithLLM(logs: ConsoleMessage[]): Promise<{
    keyFunctions: Array<{
      name: string;
      purpose: string;
      confidence: number;
    }>;
    dataFlow: string;
    suspiciousPatterns: Array<{
      type: string;
      description: string;
      location: string;
    }>;
  }> {
    if (!this.llmService) {
      logger.warn('LLM service not available, skipping LLM log analysis');
      return { keyFunctions: [], dataFlow: '', suspiciousPatterns: [] };
    }

    logger.info('Starting LLM-enhanced log analysis...');

    const logSummary = logs.slice(0, 50).map((log, index) => ({
      index,
      type: log.type,
      text: log.text.substring(0, 300),
      url: log.url,
      lineNumber: log.lineNumber,
      stackTrace: log.stackTrace?.slice(0, 3),
    }));

    try {
      const response = await this.llmService.chat(generateLogAnalysisMessages(logSummary), {
        temperature: 0.2,
        maxTokens: 2500,
      });

      const result = JSON.parse(response.content);

      logger.success('LLM log analysis completed', {
        keyFunctions: result.keyFunctions?.length || 0,
        suspiciousPatterns: result.suspiciousPatterns?.length || 0,
      });

      return result;
    } catch (error) {
      logger.error('LLM log analysis failed:', error);
      return { keyFunctions: [], dataFlow: '', suspiciousPatterns: [] };
    }
  }

  async expandKeywordsWithLLM(context: {
    domain: string;
    requests: NetworkRequest[];
    logs: ConsoleMessage[];
  }): Promise<{
    apiKeywords: string[];
    cryptoKeywords: string[];
    frameworkKeywords: string[];
    businessKeywords: string[];
  }> {
    if (!this.llmService) {
      return { apiKeywords: [], cryptoKeywords: [], frameworkKeywords: [], businessKeywords: [] };
    }

    logger.info('Expanding keywords with LLM...');

    const urlPatterns = context.requests.slice(0, 15).map((r) => {
      try {
        const url = new URL(r.url);
        return {
          path: url.pathname,
          params: Array.from(url.searchParams.keys()),
          method: r.method,
        };
      } catch {
        /* URL parse failed — fallback to raw url as path */
        return { path: r.url, params: [], method: r.method };
      }
    });

    const logKeywords = context.logs.slice(0, 20).map((l) => l.text.substring(0, 150));

    try {
      const response = await this.llmService.chat(
        generateKeywordExpansionMessages(context.domain, urlPatterns, logKeywords),
        { temperature: 0.4, maxTokens: 800 }
      );

      const result = JSON.parse(response.content);

      logger.success('Keywords expanded', {
        api: result.apiKeywords?.length || 0,
        crypto: result.cryptoKeywords?.length || 0,
        framework: result.frameworkKeywords?.length || 0,
      });

      return result;
    } catch (error) {
      logger.error('Keyword expansion failed:', error);
      return { apiKeywords: [], cryptoKeywords: [], frameworkKeywords: [], businessKeywords: [] };
    }
  }

  async analyzeWithLLM(data: {
    requests: NetworkRequest[];
    responses: NetworkResponse[];
    logs: ConsoleMessage[];
    exceptions: ExceptionInfo[];
  }): Promise<AnalysisResult> {
    logger.info('Starting hybrid analysis (rules + LLM)...');

    const ruleBasedResult = this.analyze(data);

    if (this.llmService) {
      try {
        const llmRequestAnalysis = await this.analyzeCriticalRequestsWithLLM(
          ruleBasedResult.criticalRequests
        );

        const llmLogAnalysis = await this.analyzeCriticalLogsWithLLM(ruleBasedResult.criticalLogs);

        ruleBasedResult.patterns.encryption = [
          ...(ruleBasedResult.patterns.encryption || []),
          ...llmRequestAnalysis.encryption,
        ];

        ruleBasedResult.patterns.signature = [
          ...(ruleBasedResult.patterns.signature || []),
          ...llmRequestAnalysis.signature,
        ];

        ruleBasedResult.patterns.token = [
          ...(ruleBasedResult.patterns.token || []),
          ...llmRequestAnalysis.token,
        ];

        ruleBasedResult.summary.keyFunctions = [
          ...ruleBasedResult.summary.keyFunctions,
          ...llmLogAnalysis.keyFunctions.map((f) => f.name),
        ];

        logger.success('Hybrid analysis completed with LLM enhancement');
      } catch (error) {
        logger.error('LLM enhancement failed, using rule-based results only:', error);
      }
    }

    return ruleBasedResult;
  }
}
