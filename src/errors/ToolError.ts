/**
 * Classified tool error with structured error codes.
 *
 * Replaces raw `throw new Error(...)` with categorized errors that the
 * MCP server layer can convert into structured responses.
 *
 * The classification allows the server to:
 *  - Return non-`isError` responses for user-correctable issues (PREREQUISITE, VALIDATION)
 *  - Return `isError: true` for internal failures (RUNTIME, CONNECTION, TIMEOUT)
 *  - Include machine-readable error codes in responses
 */

export type ToolErrorCode =
  | 'PREREQUISITE'   // tool prerequisite not met (e.g. debugger not enabled)
  | 'VALIDATION'     // invalid input arguments
  | 'NOT_FOUND'      // resource or tool not found
  | 'TIMEOUT'        // operation timed out
  | 'CONNECTION'     // CDP / browser connection failure
  | 'RUNTIME'        // unexpected runtime error
  | 'PERMISSION';    // security or permission denied

/** Set of error codes that represent user-correctable issues (non-fatal). */
export const USER_CORRECTABLE_CODES: ReadonlySet<ToolErrorCode> = new Set([
  'PREREQUISITE',
  'VALIDATION',
  'NOT_FOUND',
]);

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly toolName?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ToolErrorCode,
    message: string,
    options?: {
      toolName?: string;
      details?: Record<string, unknown>;
      cause?: Error;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'ToolError';
    this.code = code;
    this.toolName = options?.toolName;
    this.details = options?.details;
  }
}
