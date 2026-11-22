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

/**
 * Wrap a JSON payload in MCP text content.
 *
 * When the payload already carries a boolean `success`, mirror it on the
 * envelope too. This keeps `asJsonResponse` compatible with the canonical
 * `R.ok()/R.fail()` contract without changing the text payload, and lets the
 * execution pipeline read the outcome without re-parsing the JSON string.
 */
export function asJsonResponse(payload: unknown): ToolResponse {
  const response = asTextResponse(JSON.stringify(payload, null, 2));
  const success =
    payload !== null &&
    typeof payload === 'object' &&
    typeof (payload as { success?: unknown }).success === 'boolean'
      ? (payload as { success: boolean }).success
      : undefined;
  return success === undefined ? response : ({ ...response, success } as ToolResponse);
}

export function isToolResponse(value: unknown): value is ToolResponse {
  return (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

export function asToolResponse(payload: unknown): ToolResponse {
  if (isToolResponse(payload)) return payload;
  if (payload === undefined) {
    return asTextResponse(JSON.stringify({ success: false, error: 'Tool returned no result' }));
  }
  const isError =
    payload !== null &&
    typeof payload === 'object' &&
    (payload as { isError?: unknown }).isError === true;
  return asTextResponse(JSON.stringify(payload, null, 2), isError);
}

export function asErrorResponse(error: unknown): ToolResponse {
  return {
    ...asTextResponse(`Error: ${toErrorMessage(error)}`, true),
    success: false,
  } as ToolResponse;
}

export function serializeError(error: unknown): { success: false; error: string } {
  return {
    success: false,
    error: toErrorMessage(error),
  };
}
