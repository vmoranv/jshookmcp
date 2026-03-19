/**
 * Type-safe argument parsing utilities for MCP tool handlers.
 *
 * Replaces the pervasive `(args.x as string | undefined) ?? 'default'` pattern
 * with type-guarded functions that eliminate `as` assertions.
 */

type Args = Record<string, unknown>;

// ── Primitives ──

/** Extract a string arg, returning `fallback` when absent or wrong type. */
export function argString(args: Args, key: string, fallback: string): string;
export function argString(args: Args, key: string): string | undefined;
export function argString(args: Args, key: string, fallback?: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : fallback;
}

/** Extract a number arg, returning `fallback` when absent or wrong type. */
export function argNumber(args: Args, key: string, fallback: number): number;
export function argNumber(args: Args, key: string): number | undefined;
export function argNumber(args: Args, key: string, fallback?: number): number | undefined {
  const v = args[key];
  return typeof v === 'number' ? v : fallback;
}

/** Extract a boolean arg, returning `fallback` when absent or wrong type. */
export function argBool(args: Args, key: string, fallback: boolean): boolean;
export function argBool(args: Args, key: string): boolean | undefined;
export function argBool(args: Args, key: string, fallback?: boolean): boolean | undefined {
  const v = args[key];
  return typeof v === 'boolean' ? v : fallback;
}

// ── Enum / Set-constrained strings ──

/**
 * Extract a string arg that must belong to a known set.
 * Returns `fallback` if absent, throws if present but invalid.
 *
 * @example
 * ```ts
 * const SOURCES = new Set(['raw', 'file', 'request'] as const);
 * type Source = typeof SOURCES extends Set<infer T> ? T : never;
 * const source = argEnum(args, 'source', SOURCES, 'raw');
 * //    ^? 'raw' | 'file' | 'request'
 * ```
 */
export function argEnum<T extends string>(
  args: Args,
  key: string,
  allowed: ReadonlySet<T>,
  fallback: T
): T;
export function argEnum<T extends string>(
  args: Args,
  key: string,
  allowed: ReadonlySet<T>
): T | undefined;
export function argEnum<T extends string>(
  args: Args,
  key: string,
  allowed: ReadonlySet<T>,
  fallback?: T
): T | undefined {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string') return fallback;
  if (!allowed.has(v as T)) {
    throw new Error(`Invalid ${key}: "${v}". Expected one of: ${[...allowed].join(', ')}`);
  }
  return v as T;
}

// ── Required variants ──

/** Extract a required string arg. Throws if absent. */
export function argStringRequired(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== 'string') {
    throw new Error(`Missing required string argument: "${key}"`);
  }
  return v;
}

/** Extract a required number arg. Throws if absent. */
export function argNumberRequired(args: Args, key: string): number {
  const v = args[key];
  if (typeof v !== 'number') {
    throw new Error(`Missing required number argument: "${key}"`);
  }
  return v;
}

// ── Complex types ──

/** Extract a string array arg. */
export function argStringArray(args: Args, key: string): string[] {
  const v = args[key];
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === 'string');
}

/** Extract an object arg, returning `undefined` when absent or wrong type. */
export function argObject(args: Args, key: string): Record<string, unknown> | undefined {
  const v = args[key];
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}
