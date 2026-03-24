import type { LLMService } from '@services/LLMService';
import { logger } from '@utils/logger';
import type { CodeFile } from '@internal-types/index';
import {
  generateProjectSummaryMessages,
  generateFileSummaryMessages,
} from '@services/prompts/analysis';

export interface CodeSummary {
  url: string;
  type: string;
  size: number;

  summary: string;
  purpose: string;
  keyFunctions: string[];
  dependencies: string[];

  hasEncryption: boolean;
  encryptionMethods?: string[];
  hasAPI: boolean;
  apiEndpoints?: string[];
  hasObfuscation: boolean;
  obfuscationType?: string;

  securityIssues?: string[];
  suspiciousPatterns?: string[];

  complexity: 'low' | 'medium' | 'high';
  linesOfCode: number;

  recommendations?: string[];
}

export class AISummarizer {
  constructor(private llmService: LLMService) {}

  async summarizeFile(file: CodeFile): Promise<CodeSummary> {
    logger.info(`Generating AI summary for: ${file.url}`);

    const maxLength = 10000;
    const codeSnippet =
      file.content.length > maxLength
        ? file.content.substring(0, maxLength) + '\n\n... (truncated)'
        : file.content;

    try {
      const response = await this.llmService.chat(
        generateFileSummaryMessages(file.url, codeSnippet),
      );

      const responseText = typeof response === 'string' ? response : response.content;
      const summary = this.parseSummaryResponse(responseText, file);
      logger.debug(`AI summary generated for: ${file.url}`);

      return summary;
    } catch (error) {
      logger.error(`Failed to generate AI summary for ${file.url}:`, error);

      return this.basicAnalysis(file);
    }
  }

  async summarizeBatch(files: CodeFile[], maxConcurrent: number = 3): Promise<CodeSummary[]> {
    logger.info(`Generating AI summaries for ${files.length} files...`);

    const results: CodeSummary[] = [];

    for (let i = 0; i < files.length; i += maxConcurrent) {
      const batch = files.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(batch.map((file) => this.summarizeFile(file)));
      results.push(...batchResults);

      logger.debug(
        `Processed batch ${Math.floor(i / maxConcurrent) + 1}/${Math.ceil(files.length / maxConcurrent)}`,
      );
    }

    return results;
  }

  async summarizeProject(files: CodeFile[]): Promise<{
    totalFiles: number;
    totalSize: number;
    mainPurpose: string;
    architecture: string;
    technologies: string[];
    securityConcerns: string[];
    recommendations: string[];
  }> {
    logger.info('Generating project-level AI summary...');

    try {
      const response = await this.llmService.chat(generateProjectSummaryMessages(files));
      const responseText = typeof response === 'string' ? response : response.content;
      const parsed = JSON.parse(responseText);

      return {
        totalFiles: files.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0),
        mainPurpose: parsed.mainPurpose || 'Unknown',
        architecture: parsed.architecture || 'Unknown',
        technologies: parsed.technologies || [],
        securityConcerns: parsed.securityConcerns || [],
        recommendations: parsed.recommendations || [],
      };
    } catch (error) {
      logger.error('Failed to generate project summary:', error);

      return {
        totalFiles: files.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0),
        mainPurpose: 'Analysis failed',
        architecture: 'Unknown',
        technologies: [],
        securityConcerns: [],
        recommendations: [],
      };
    }
  }

  private parseSummaryResponse(response: string, file: CodeFile): CodeSummary {
    try {
      const parsed = JSON.parse(response);

      return {
        url: file.url,
        type: file.type,
        size: file.size,
        summary: parsed.summary || '',
        purpose: parsed.purpose || '',
        keyFunctions: parsed.keyFunctions || [],
        dependencies: parsed.dependencies || [],
        hasEncryption: parsed.hasEncryption || false,
        encryptionMethods: parsed.encryptionMethods,
        hasAPI: parsed.hasAPI || false,
        apiEndpoints: parsed.apiEndpoints,
        hasObfuscation: parsed.hasObfuscation || false,
        obfuscationType: parsed.obfuscationType,
        securityIssues: parsed.securityIssues,
        suspiciousPatterns: parsed.suspiciousPatterns,
        complexity: parsed.complexity || 'medium',
        linesOfCode: file.content.split('\n').length,
        recommendations: parsed.recommendations,
      };
    } catch {
      logger.warn('Failed to parse AI response, using basic analysis');
      return this.basicAnalysis(file);
    }
  }

  private basicAnalysis(file: CodeFile): CodeSummary {
    const content = file.content;
    const lines = content.split('\n');

    const hasEncryption = /encrypt|decrypt|crypto|cipher|aes|rsa/i.test(content);
    const hasAPI = /fetch|xhr|ajax|axios|request/i.test(content);
    const hasObfuscation = /eval\(|\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/i.test(content);

    const functionMatches = content.matchAll(/function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
    const keyFunctions = Array.from(functionMatches, (m) => m[1])
      .filter((name): name is string => !!name)
      .slice(0, 10);

    const avgLineLength = content.length / lines.length;
    const complexity: 'low' | 'medium' | 'high' =
      avgLineLength > 100 ? 'high' : avgLineLength > 50 ? 'medium' : 'low';

    return {
      url: file.url,
      type: file.type,
      size: file.size,
      summary: 'Basic analysis (AI unavailable)',
      purpose: 'Unknown',
      keyFunctions,
      dependencies: [],
      hasEncryption,
      hasAPI,
      hasObfuscation,
      complexity,
      linesOfCode: lines.length,
    };
  }
}
