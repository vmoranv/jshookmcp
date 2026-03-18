/**
 * Input validation and tool-name normalization utilities for search meta-tool handlers.
 */

export function normalizeToolName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed.startsWith('mcp__')) {
    return trimmed;
  }

  const parts = trimmed.split('__');
  if (parts.length < 3) {
    return trimmed;
  }

  return parts.slice(2).join('__');
}

export function validateToolNameArray(args: Record<string, unknown>): {
  names: string[];
  error?: string;
} {
  const raw = args.names;
  if (!Array.isArray(raw)) {
    return { names: [], error: 'names must be an array' };
  }

  const names: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      return { names: [], error: 'invalid tool name: expected non-empty string' };
    }
    names.push(normalizeToolName(item));
  }

  return { names };
}
