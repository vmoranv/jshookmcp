import type { ToolResponse } from '../../types.js';
import { ToolError, USER_CORRECTABLE_CODES } from '../../../errors/ToolError.js';

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function asTextResponse(text: string, isError = false): ToolResponse {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

export function asJsonResponse(payload: unknown): ToolResponse {
  return asTextResponse(JSON.stringify(payload, null, 2));
}

export function asErrorResponse(error: unknown): ToolResponse {
  return asTextResponse(`Error: ${toErrorMessage(error)}`, true);
}

export function serializeError(error: unknown): { success: false; error: string } {
  return {
    success: false,
    error: toErrorMessage(error),
  };
}

/**
 * Unified error→response adapter.
 *
 * For classified ToolErrors: produces a structured JSON response with
 * error code, message, and optional details. User-correctable errors
 * (PREREQUISITE, VALIDATION, NOT_FOUND) return without `isError: true`
 * so the LLM can self-correct.
 *
 * For unclassified errors: falls back to `asErrorResponse`.
 */
export function toolErrorToResponse(error: unknown): ToolResponse {
  if (error instanceof ToolError) {
    const isUserCorrectable = USER_CORRECTABLE_CODES.has(error.code);
    const payload: Record<string, unknown> = {
      success: false,
      code: error.code,
      message: error.message,
    };
    if (error.toolName) payload.tool = error.toolName;
    if (error.details) payload.details = error.details;

    return asTextResponse(JSON.stringify(payload, null, 2), !isUserCorrectable);
  }

  return asErrorResponse(error);
}
