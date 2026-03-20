/**
 * CDPErrorMapper — translates raw CDP/Puppeteer errors into user-friendly ToolError instances.
 *
 * Common CDP errors like "Session not found", "Target closed", and protocol errors
 * are mapped to specific ToolError codes with actionable recovery hints.
 */
import { ToolError, type ToolErrorCode } from '@errors/ToolError';

interface CDPErrorMapping {
  pattern: RegExp;
  code: ToolErrorCode;
  hint: string;
}

const CDP_ERROR_MAPPINGS: CDPErrorMapping[] = [
  {
    pattern: /Session.*not found|session closed|Session.*closed/i,
    code: 'CONNECTION',
    hint: 'The browser session has been destroyed. Re-launch the browser or open a new tab.',
  },
  {
    pattern: /Target closed|target.*has.*been.*closed/i,
    code: 'CONNECTION',
    hint: 'The target page/tab was closed. Open a new tab before re-running this tool.',
  },
  {
    pattern: /Protocol error.*Target\.sendMessageToTarget/i,
    code: 'CONNECTION',
    hint: 'CDP protocol communication failed. The browser may have crashed — try page_navigate to restore.',
  },
  {
    pattern: /Execution context was destroyed/i,
    code: 'RUNTIME',
    hint: 'The page navigated while a script was running. Re-run the tool after navigation completes.',
  },
  {
    pattern: /Cannot find context with specified id/i,
    code: 'RUNTIME',
    hint: 'An iframe or context was removed during execution. Retry after the page settles.',
  },
  {
    pattern: /Node.*not found|Could not find node/i,
    code: 'NOT_FOUND',
    hint: 'The referenced DOM node no longer exists. The page may have re-rendered.',
  },
  {
    pattern: /Evaluation failed.*timeout|Navigation timeout|TimeoutError/i,
    code: 'TIMEOUT',
    hint: 'The operation timed out. Increase the timeout or check if the page is responding.',
  },
  {
    pattern: /net::ERR_|Failed to navigate|net::ERR_NAME_NOT_RESOLVED/i,
    code: 'CONNECTION',
    hint: 'Network error while loading the page. Check the URL and network connectivity.',
  },
  {
    pattern: /Debugger.*not.*enabled|Debugger\.enable.*must.*be.*called/i,
    code: 'PREREQUISITE',
    hint: 'The CDP Debugger domain is not enabled. Enable it before using debugger tools.',
  },
  {
    pattern: /Permission denied|Not allowed/i,
    code: 'PERMISSION',
    hint: 'The browser denied this operation. Check browser security policies.',
  },
];

/**
 * Translate a raw CDP/Puppeteer error into a structured ToolError.
 * Returns the original error unchanged if no mapping matches.
 */
export function mapCDPError(error: unknown, toolName?: string): ToolError | Error {
  const message = error instanceof Error ? error.message : String(error);

  for (const mapping of CDP_ERROR_MAPPINGS) {
    if (mapping.pattern.test(message)) {
      return new ToolError(mapping.code, `${message}\n\nHint: ${mapping.hint}`, {
        toolName,
        cause: error instanceof Error ? error : undefined,
        details: { originalMessage: message, cdpMapping: true },
      });
    }
  }

  // Fallback: wrap unknown errors as RUNTIME
  if (error instanceof ToolError) return error;
  if (error instanceof Error) return error;
  return new Error(String(error));
}

/**
 * Wrap an async CDP call with automatic error translation.
 *
 * Usage:
 * ```ts
 * const result = await wrapCDPCall(() => page.evaluate(...), 'page_evaluate');
 * ```
 */
export async function wrapCDPCall<T>(
  fn: () => Promise<T>,
  toolName?: string
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw mapCDPError(error, toolName);
  }
}

/**
 * Check whether an error looks like a CDP connection/session error
 * (i.e., the browser or tab is gone and retrying won't help without re-launch).
 */
export function isCDPSessionGone(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Session.*not found|Target closed|session closed/i.test(message);
}
