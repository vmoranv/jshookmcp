/**
 * RedactionService — Sensitive data redaction for logs, tool outputs, and artifacts.
 *
 * Patterns covered:
 * - Bearer/JWT tokens
 * - API keys (sk-*, key-*, etc.)
 * - Cookies (full cookie strings)
 * - Email addresses
 * - Absolute file paths (configurable)
 */

import { logger } from '../../utils/logger.js';

export type RedactionLevel = 'standard' | 'strict' | 'none';

interface RedactionPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
  levels: RedactionLevel[];
}

const PATTERNS: RedactionPattern[] = [
  {
    name: 'bearer_token',
    pattern: /Bearer\s+[A-Za-z0-9_\-.~+/]+=*/g,
    replacement: 'Bearer [REDACTED]',
    levels: ['standard', 'strict'],
  },
  {
    name: 'jwt',
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    replacement: '[REDACTED_JWT]',
    levels: ['standard', 'strict'],
  },
  {
    name: 'api_key_sk',
    pattern: /sk[_-][A-Za-z0-9]{20,}/g,
    replacement: '[REDACTED_API_KEY]',
    levels: ['standard', 'strict'],
  },
  {
    name: 'api_key_generic',
    pattern: /(?:api[_-]?key|apikey|access[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}["']?/gi,
    replacement: '[REDACTED_API_KEY]',
    levels: ['standard', 'strict'],
  },
  {
    name: 'long_hex_secret',
    pattern: /(?:secret|token|password|passwd|credential)\s*[:=]\s*["']?[A-Fa-f0-9]{32,}["']?/gi,
    replacement: '[REDACTED_SECRET]',
    levels: ['standard', 'strict'],
  },
  {
    name: 'cookie_header',
    pattern: /(?:Cookie|Set-Cookie)\s*:\s*[^\r\n]{10,}/gi,
    replacement: '[REDACTED_COOKIE]',
    levels: ['standard', 'strict'],
  },
  {
    name: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[REDACTED_EMAIL]',
    levels: ['strict'],
  },
  {
    name: 'windows_absolute_path',
    pattern: /[A-Z]:\\(?:Users|Documents and Settings)\\[^\s"'<>|]{3,}/gi,
    replacement: '[REDACTED_PATH]',
    levels: ['strict'],
  },
  {
    name: 'unix_home_path',
    pattern: /\/(?:home|Users)\/[a-zA-Z0-9._-]+(?:\/[^\s"'<>|]+)*/g,
    replacement: '[REDACTED_PATH]',
    levels: ['strict'],
  },
];

export class RedactionService {
  private level: RedactionLevel;
  private activePatterns: RedactionPattern[];

  constructor(level?: RedactionLevel) {
    this.level = level ?? (process.env.JSHHOOK_REDACTION_LEVEL as RedactionLevel) ?? 'standard';
    this.activePatterns = PATTERNS.filter((p) => p.levels.includes(this.level));
  }

  /**
   * Redact sensitive data from a string.
   */
  redactString(input: string): string {
    if (this.level === 'none') return input;

    let result = input;
    for (const pattern of this.activePatterns) {
      result = result.replace(pattern.pattern, pattern.replacement);
    }
    return result;
  }

  /**
   * Deep-redact an object (returns a new object, does not mutate).
   */
  redactObject<T>(obj: T): T {
    if (this.level === 'none') return obj;

    try {
      const json = JSON.stringify(obj);
      const redacted = this.redactString(json);
      return JSON.parse(redacted);
    } catch {
      // If serialization fails, return as-is
      return obj;
    }
  }

  /**
   * Set the redaction level at runtime.
   */
  setLevel(level: RedactionLevel): void {
    this.level = level;
    this.activePatterns = PATTERNS.filter((p) => p.levels.includes(level));
    logger.info(`[RedactionService] Level set to: ${level} (${this.activePatterns.length} patterns active)`);
  }

  /**
   * Get the current redaction level.
   */
  getLevel(): RedactionLevel {
    return this.level;
  }

  /**
   * Get stats about active patterns.
   */
  getStats(): { level: RedactionLevel; activePatterns: number; patternNames: string[] } {
    return {
      level: this.level,
      activePatterns: this.activePatterns.length,
      patternNames: this.activePatterns.map((p) => p.name),
    };
  }
}
