/**
 * Configuration constants for JSHook MCP deobfuscator
 * Centralized configuration to avoid magic numbers
 */

export const DEOBFUSCATION_CONFIG = {
  // Input validation
  MAX_INPUT_SIZE_BYTES: 5 * 1024 * 1024, // 5MB
  MAX_PATTERN_MATCHES: 100,
  PATTERN_TIMEOUT_MS: 1000,

  // API configuration
  PRO_API_TIMEOUT_MS: 300000, // 5 minutes
  MIN_API_TOKEN_LENGTH: 10,

  // Performance limits
  MAX_ITERATIONS: 50,
  MAX_BUNDLE_MODULES: 100,
  CACHE_TTL_SECONDS: 30,
  CACHE_MAX_ENTRIES: 100,

  // Security limits
  MAX_IDENTIFIER_LENGTH: 100,
  MAX_MATCHES_PER_PATTERN: 50,
} as const;

// Pattern compilation cache to avoid recompilation
export const COMPILED_PATTERNS = {
  OBFUSCATOR_IO_STRING_ARRAY: /\.split\(['"]([^'"]+)['"]\)/,
  OBFUSCATOR_IO_VAR: /(?:var|function|const)\s+_0x[a-f0-9]{4,}\b/g,
  UNICODE_ESCAPE: /(?:\\u[0-9a-fA-F]{4}){4,}/,
  JSFUCK: /^\s*[\[\]()+!]{20,}\s*$/m,
} as const;

// Cache for regex patterns
export const REGEX_CACHE = new Map<string, RegExp>();

/**
 * Get cached regex pattern or create and cache new one
 */
export function getCachedPattern(pattern: string): RegExp {
  if (!REGEX_CACHE.has(pattern)) {
    REGEX_CACHE.set(pattern, new RegExp(pattern));
  }
  return REGEX_CACHE.get(pattern)!;
}

/**
 * Validate input size before processing
 */
export function validateInputSize(
  code: string,
  maxSize: number = DEOBFUSCATION_CONFIG.MAX_INPUT_SIZE_BYTES,
): void {
  if (code.length > maxSize) {
    throw new Error(`Input code too large: ${code.length} bytes (max: ${maxSize})`);
  }
}

/**
 * Create a timeout wrapper for async operations
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out',
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Escape regex special characters for safe pattern building
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
