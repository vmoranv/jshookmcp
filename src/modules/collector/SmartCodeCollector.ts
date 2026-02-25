import type { Page } from 'rebrowser-puppeteer-core';
import { logger } from '../../utils/logger.js';
import type { CodeFile } from '../../types/index.js';

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
    options: SmartCollectOptions
  ): Promise<CodeFile[] | CodeSummary[]> {
    logger.info(`Smart code collection mode: ${options.mode}`);

    switch (options.mode) {
      case 'summary':
        return this.collectSummaries(files);

      case 'priority':
        return this.collectByPriority(files, options);

      case 'incremental':
        return this.collectIncremental(files, options);

      case 'full':
      default:
        return this.collectWithLimit(files, options);
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

  private collectByPriority(files: CodeFile[], options: SmartCollectOptions): CodeFile[] {
    const maxTotalSize = options.maxTotalSize || this.DEFAULT_MAX_TOTAL_SIZE;
    const maxFileSize = options.maxFileSize || this.DEFAULT_MAX_FILE_SIZE;

    const scoredFiles = files.map((file) => ({
      file,
      score: this.calculatePriority(file, options.priorities || []),
    }));

    scoredFiles.sort((a, b) => b.score - a.score);

    const result: CodeFile[] = [];
    let currentSize = 0;

    for (const { file } of scoredFiles) {
      let content = file.content;
      let truncated = false;

      if (file.size > maxFileSize) {
        content = content.substring(0, maxFileSize);
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
          priorityScore: this.calculatePriority(file, options.priorities || []),
        },
      });

      currentSize += content.length;
    }

    logger.info(
      `Collected ${result.length}/${files.length} files by priority (${(currentSize / 1024).toFixed(2)} KB)`
    );
    return result;
  }

  private collectIncremental(files: CodeFile[], options: SmartCollectOptions): CodeFile[] {
    const includePatterns = options.includePatterns || [];
    const excludePatterns = options.excludePatterns || [];

    const filtered = files.filter((file) => {
      if (excludePatterns.some((pattern) => new RegExp(pattern).test(file.url))) {
        return false;
      }

      if (includePatterns.length === 0) {
        return true;
      }

      return includePatterns.some((pattern) => new RegExp(pattern).test(file.url));
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
        content = content.substring(0, maxFileSize);
        truncated = true;
      }

      if (currentSize + content.length > maxTotalSize) {
        logger.warn(
          `Reached max total size limit, collected ${result.length}/${files.length} files`
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

  private calculatePriority(file: CodeFile, priorities: string[]): number {
    let score = 0;

    if (file.type === 'inline') score += 10;
    if (file.type === 'external') score += 5;

    for (let i = 0; i < priorities.length; i++) {
      const pattern = priorities[i];
      if (pattern && new RegExp(pattern).test(file.url)) {
        score += (priorities.length - i) * 20;
      }
    }

    if (this.detectEncryption(file.content)) score += 50;
    if (this.detectAPI(file.content)) score += 30;
    if (this.detectObfuscation(file.content)) score += 20;

    if (file.size < 10 * 1024) score += 10;
    else if (file.size > 500 * 1024) score -= 20;

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

    if (avgLineLength > 200) return true;

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

    return functions.slice(0, 20);
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
