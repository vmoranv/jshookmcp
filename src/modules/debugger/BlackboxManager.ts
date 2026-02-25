import type { CDPSession } from 'rebrowser-puppeteer-core';
import { logger } from '../../utils/logger.js';

export class BlackboxManager {
  private blackboxedPatterns: Set<string> = new Set();

  static readonly COMMON_LIBRARY_PATTERNS = [
    '*jquery*.js',
    '*react*.js',
    '*react-dom*.js',
    '*vue*.js',
    '*angular*.js',
    '*lodash*.js',
    '*underscore*.js',
    '*moment*.js',
    '*axios*.js',
    '*node_modules/*',
    '*webpack*',
    '*bundle*.js',
    '*vendor*.js',
  ];

  constructor(private cdpSession: CDPSession) {
    logger.info('BlackboxManager initialized with shared CDP session');
  }

  private normalizePattern(pattern: string): string {
    const input = String(pattern || '').trim();
    if (!input) {
      throw new Error('Pattern cannot be empty');
    }

    // Convert shell-style wildcard patterns (e.g. "*jquery*.js") to valid regex.
    if (input.includes('*') || input.includes('?')) {
      const escaped = input.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      return escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
    }

    // If it's already a valid regex, keep it.
    try {
      // eslint-disable-next-line no-new
      new RegExp(input);
      return input;
    } catch {
      // Fallback: treat as literal substring match.
      return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }

  async blackboxByPattern(urlPattern: string): Promise<void> {
    const normalized = this.normalizePattern(urlPattern);
    this.blackboxedPatterns.add(normalized);

    try {
      await this.cdpSession.send('Debugger.setBlackboxPatterns', {
        patterns: Array.from(this.blackboxedPatterns),
      });

      logger.info(`Blackboxed pattern: ${urlPattern} -> ${normalized}`);
    } catch (error) {
      logger.error('Failed to set blackbox pattern:', error);
      this.blackboxedPatterns.delete(normalized);
      throw error;
    }
  }

  async unblackboxByPattern(urlPattern: string): Promise<boolean> {
    const normalized = this.normalizePattern(urlPattern);
    const deleted = this.blackboxedPatterns.delete(normalized);
    if (!deleted) {
      return false;
    }

    try {
      await this.cdpSession.send('Debugger.setBlackboxPatterns', {
        patterns: Array.from(this.blackboxedPatterns),
      });

      logger.info(`Unblackboxed pattern: ${urlPattern} -> ${normalized}`);
      return true;
    } catch (error) {
      logger.error('Failed to remove blackbox pattern:', error);
      this.blackboxedPatterns.add(normalized);
      throw error;
    }
  }

  async blackboxCommonLibraries(): Promise<void> {
    for (const pattern of BlackboxManager.COMMON_LIBRARY_PATTERNS) {
      this.blackboxedPatterns.add(this.normalizePattern(pattern));
    }

    try {
      await this.cdpSession.send('Debugger.setBlackboxPatterns', {
        patterns: Array.from(this.blackboxedPatterns),
      });

      logger.info(
        `Blackboxed ${BlackboxManager.COMMON_LIBRARY_PATTERNS.length} common library patterns`
      );
    } catch (error) {
      logger.error('Failed to blackbox common libraries:', error);
      throw error;
    }
  }

  getAllBlackboxedPatterns(): string[] {
    return Array.from(this.blackboxedPatterns);
  }

  async clearAllBlackboxedPatterns(): Promise<void> {
    this.blackboxedPatterns.clear();

    try {
      await this.cdpSession.send('Debugger.setBlackboxPatterns', {
        patterns: [],
      });

      logger.info('All blackbox patterns cleared');
    } catch (error) {
      logger.error('Failed to clear blackbox patterns:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      await this.clearAllBlackboxedPatterns();
      logger.info('BlackboxManager closed');
    } catch (error) {
      logger.error('Failed to close BlackboxManager:', error);
      throw error;
    }
  }
}
