/**
 * Input validation utilities for search meta-tool handlers.
 */

export function validateToolNameArray(args: Record<string, unknown>): { names: string[]; error?: string } {
  const raw = args.names;
  if (!Array.isArray(raw)) {
    return { names: [], error: 'names must be an array' };
  }
  const names: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0) {
      return { names: [], error: 'invalid tool name: expected non-empty string' };
    }
    names.push(item);
  }
  return { names };
}
