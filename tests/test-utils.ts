import type { ToolResponse } from '@server/types';

/**
 * Extract text content from the first MCP content block of a tool response.
 * Throws if the response has no text content, which helps surface test failures early.
 */
export function getResponseText(response: ToolResponse): string {
  const first = response.content[0];
  if (!first || first.type !== 'text') {
    throw new Error('Expected first content block to be text');
  }
  return first.text;
}

/**
 * Utility to parse JSON in tests with type safety.
 * Replaces direct JSON.parse() calls to avoid 'any' and 'no-unsafe-member-access' warnings.
 */
export function parseJson<T>(data: string | null | undefined): T {
  if (data === null || data === undefined || data === '') {
    return [] as unknown as T;
  }
  try {
    return JSON.parse(data) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Type-safe mock helper for EventEmitter and other objects often cast to 'any'
 */
export function mockAs<T>(obj: unknown): T {
  return obj as T;
}
