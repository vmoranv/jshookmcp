/**
 * AutoCorrectionLoop — Retry sandbox execution with error context.
 *
 * When a script fails, the error message is appended as a comment
 * to the original code and re-executed.  This gives LLM-generated
 * scripts a chance to self-correct based on runtime feedback.
 */

import type { QuickJSSandbox } from '@server/sandbox/QuickJSSandbox';
import type { SandboxOptions, SandboxResult } from '@server/sandbox/types';

/** Extended result with retry metadata. */
export interface AutoCorrectedResult extends SandboxResult {
  /** Number of retries attempted (0 = first try succeeded). */
  retryCount: number;
}

/**
 * Execute code in the sandbox with automatic retry on error.
 *
 * @param sandbox - QuickJSSandbox instance
 * @param code - JavaScript source to execute
 * @param options - Sandbox execution options
 * @param maxRetries - Maximum number of retries (default 2)
 * @returns Result from the final execution attempt
 */
export async function executeWithRetry(
  sandbox: QuickJSSandbox,
  code: string,
  options: SandboxOptions = {},
  maxRetries = 2
): Promise<AutoCorrectedResult> {
  let lastResult: SandboxResult | null = null;
  let currentCode = code;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Each retry gets a fresh sandbox context (no state leakage)
    lastResult = await sandbox.execute(currentCode, options);

    if (lastResult.ok) {
      return { ...lastResult, retryCount: attempt };
    }

    // Don't retry timeouts — they'll just timeout again
    if (lastResult.timedOut) {
      return { ...lastResult, retryCount: attempt };
    }

    // Append error context for the next attempt
    if (attempt < maxRetries) {
      currentCode = `/* Previous error (attempt ${attempt + 1}): ${lastResult.error ?? 'unknown error'} */\n${code}`;
    }
  }

  return { ...lastResult!, retryCount: maxRetries };
}
