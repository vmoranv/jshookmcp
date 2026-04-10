import type { ToolResponse } from '@server/types';

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
