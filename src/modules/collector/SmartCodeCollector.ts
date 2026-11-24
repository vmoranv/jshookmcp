import type { Page } from 'rebrowser-puppeteer-core';
import { logger } from '@utils/logger';
import type { CodeFile } from '@internal-types/index';
import { truncateUtf16Safe } from '@modules/collector/collector-utils';
import { SMART_COLLECTOR_MAX_EXTRACTED_FUNCTIONS } from '@src/constants/browser';

/** Priority score weights by file characteristic. */
const PRIORITY_INLINE_SCORE = 10;
const PRIORITY_EXTERNAL_SCORE = 5;
const PRIORITY_MATCH_WEIGHT = 20;
const PRIORITY_ENCRYPTION_SCORE = 50;
const PRIORITY_API_SCORE = 30;
const PRIORITY_OBFUSCATION_SCORE = 20;
const PRIORITY_SMALL_FILE_SCORE = 10;
const PRIORITY_HUGE_FILE_PENALTY = 20;
/** File size tiers for priority scoring (bytes). */
const SMALL_FILE_BYTES = 10 * 1024;
const HUGE_FILE_BYTES = 500 * 1024;
/** avgLineLength above this marks a file as obfuscated. */
const OBFUSCATION_AVG_LINE_LENGTH = 200;
/** Cap on extracted function names per file. */
const MAX_EXTRACTED_FUNCTIONS = SMART_COLLECTOR_MAX_EXTRACTED_FUNCTIONS;

export interface SmartCollectOptions {
  mode: 'summary' | 'priority' | 'incremental' | 'full';
  maxTotalSize?: number;
  maxFileSize?: number;
  priorities?: string[];
  includePatterns?: string[];
  excludePatterns?: string[];
}

export interface CodeSummary {
  url: string;
  size: number;
  type: string;
  hasEncryption: boolean;
  hasAPI: boolean;
  hasObfuscation: boolean;
  functions: string[];
  imports: string[];
  preview: string;
}

export class SmartCodeCollector {
  private readonly DEFAULT_MAX_TOTAL_SIZE = 512 * 1024;
  private readonly DEFAULT_MAX_FILE_SIZE = 100 * 1024;
  private readonly PREVIEW_LINES = 50;

  async smartCollect(
    _page: Page,
    files: CodeFile[],
    options: SmartCollectOptions,
  ): Promise<CodeFile[] | CodeSummary[]> {
    logger.info(`Smart code collection mode: ${options.mode}`);

    // Normalize once: null/undefined content (unreliable page captures) must
    // not crash split()/substring() further down the pipeline.
    const normalized: CodeFile[] = files.map((file) => ({
      ...file,
      content: file.content ?? '',
    }));

    switch (options.mode) {
      case 'summary':
        return this.collectSummaries(normalized);

      case 'priority':
        return this.collectByPriority(normalized, options);

      case 'incremental':
        return this.collectIncremental(normalized, options);

      case 'full':
      default:
        return this.collectWithLimit(normalized, options);
    }
  }

  private async collectSummaries(files: CodeFile[]): Promise<CodeSummary[]> {
    logger.info('Generating code summaries...');

    return files.map((file) => {
      const lines = file.content.split('\n');
      const preview = lines.slice(0, this.PREVIEW_LINES).join('\n');

      return {
        url: file.url,
        size: file.size,
        type: file.type,
        hasEncryption: this.detectEncryption(file.content),
        hasAPI: this.detectAPI(file.content),
        hasObfuscation: this.detectObfuscation(file.content),
        functions: this.extractFunctions(file.content),
        imports: this.extractImports(file.content),
        preview,
      };
    });
  }

  private compilePatterns(patterns: string[], context: string): RegExp[] {
    const compiled: RegExp[] = [];
    for (const pattern of patterns) {
      try {
        compiled.push(new RegExp(pattern));
      } catch (error) {
        logger.warn(
          `[SmartCodeCollector] Ignoring invalid ${context} pattern "${pattern}": ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return compiled;
  }

  private collectByPriority(files: CodeFile[], options: SmartCollectOptions): CodeFile[] {
    const maxTotalSize = options.maxTotalSize || this.DEFAULT_MAX_TOTAL_SIZE;
    const maxFileSize = options.maxFileSize || this.DEFAULT_MAX_FILE_SIZE;
    const priorityRegexes = this.compilePatterns(options.priorities || [], 'priority');

    const scoredFiles = files.map((file) => ({
      file,
      score: this.calculatePriority(file, priorityRegexes),
    }));

    scoredFiles.sort((a, b) => b.score - a.score);

    const result: CodeFile[] = [];
    let currentSize = 0;

    for (const { file, score } of scoredFiles) {
      let content = file.content;
      let truncated = false;

      if (file.size > maxFileSize) {
        content = truncateUtf16Safe(content, maxFileSize);
        truncated = true;
      }

      if (currentSize + content.length > maxTotalSize) {
        logger.warn(`Reached max total size limit (${maxTotalSize} bytes), stopping collection`);
        break;
      }

      result.push({
        ...file,
        content,
        size: content.length,
        metadata: {
          ...file.metadata,
          truncated,
          originalSize: file.size,
          // Reuse the pre-computed score — re-running calculatePriority here
          // would duplicate the identical computation for every file.
          priorityScore: score,
        },
      });

      currentSize += content.length;
    }

    logger.info(
      `Collected ${result.length}/${files.length} files by priority (${(currentSize / 1024).toFixed(2)} KB)`,
    );
    return result;
  }

  private collectIncremental(files: CodeFile[], options: SmartCollectOptions): CodeFile[] {
    const excludeRegexes = this.compilePatterns(options.excludePatterns || [], 'exclude');
    const includeRegexes = this.compilePatterns(options.includePatterns || [], 'include');

    const filtered = files.filter((file) => {
      if (excludeRegexes.some((pattern) => pattern.test(file.url))) {
        return false;
      }

      if (includeRegexes.length === 0) {
        return true;
      }

      return includeRegexes.some((pattern) => pattern.test(file.url));
    });

    logger.info(`Incremental collection: ${filtered.length}/${files.length} files matched`);
    return this.collectWithLimit(filtered, options);
  }

  private collectWithLimit(files: CodeFile[], options: SmartCollectOptions): CodeFile[] {
    const maxTotalSize = options.maxTotalSize || this.DEFAULT_MAX_TOTAL_SIZE;
    const maxFileSize = options.maxFileSize || this.DEFAULT_MAX_FILE_SIZE;

    const result: CodeFile[] = [];
    let currentSize = 0;

    for (const file of files) {
      let content = file.content;
      let truncated = false;

      if (file.size > maxFileSize) {
        content = truncateUtf16Safe(content, maxFileSize);
        truncated = true;
      }

      if (currentSize + content.length > maxTotalSize) {
        logger.warn(
          `Reached max total size limit, collected ${result.length}/${files.length} files`,
        );
        break;
      }

      result.push({
        ...file,
        content,
        size: content.length,
        metadata: {
          ...file.metadata,
          truncated,
          originalSize: file.size,
        },
      });

      currentSize += content.length;
    }

    return result;
  }

  private calculatePriority(file: CodeFile, priorities: readonly RegExp[]): number {
    let score = 0;

    if (file.type === 'inline') score += PRIORITY_INLINE_SCORE;
    if (file.type === 'external') score += PRIORITY_EXTERNAL_SCORE;

    for (let i = 0; i < priorities.length; i++) {
      const pattern = priorities[i];
      if (pattern?.test(file.url)) {
        score += (priorities.length - i) * PRIORITY_MATCH_WEIGHT;
      }
    }

    if (this.detectEncryption(file.content)) score += PRIORITY_ENCRYPTION_SCORE;
    if (this.detectAPI(file.content)) score += PRIORITY_API_SCORE;
    if (this.detectObfuscation(file.content)) score += PRIORITY_OBFUSCATION_SCORE;

    if (file.size < SMALL_FILE_BYTES) score += PRIORITY_SMALL_FILE_SCORE;
    else if (file.size > HUGE_FILE_BYTES) score -= PRIORITY_HUGE_FILE_PENALTY;

    return score;
  }

  private detectEncryption(content: string): boolean {
    const patterns = [
      /crypto|encrypt|decrypt|cipher|aes|rsa|md5|sha/i,
      /CryptoJS|forge|sjcl/i,
      /btoa|atob/i,
    ];

    return patterns.some((pattern) => pattern.test(content));
  }

  private detectAPI(content: string): boolean {
    const patterns = [/fetch\s*\(/, /XMLHttpRequest/, /axios|request|ajax/i, /\.get\(|\.post\(/];

    return patterns.some((pattern) => pattern.test(content));
  }

  private detectObfuscation(content: string): boolean {
    const lines = content.split('\n');
    const avgLineLength = content.length / lines.length;

    if (avgLineLength > OBFUSCATION_AVG_LINE_LENGTH) return true;

    if (/\\x[0-9a-f]{2}/i.test(content)) return true;
    if (/\\u[0-9a-f]{4}/i.test(content)) return true;
    if (/eval\s*\(/i.test(content)) return true;

    return false;
  }

  private extractFunctions(content: string): string[] {
    const functions: string[] = [];
    const patterns = [
      /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
      /const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*function/g,
      /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*function/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1] && !functions.includes(match[1])) {
          functions.push(match[1]);
        }
      }
    }

    return functions.slice(0, MAX_EXTRACTED_FUNCTIONS);
  }

  private extractImports(content: string): string[] {
    const imports: string[] = [];
    const patterns = [
      /import\s+.*?from\s+['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1] && !imports.includes(match[1])) {
          imports.push(match[1]);
        }
      }
    }

    return imports;
  }
}
