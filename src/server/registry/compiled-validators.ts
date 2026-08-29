/**
 * JIT pre-compiled argument validators — singleton pool (plan Task 4.2).
 *
 * Level 2 of the validation ladder:
 *   Level 1: zero-copy arg extraction (parse-args helpers, <2ns, 0 alloc)
 *   Level 2: this module — schema compiled ONCE at registration into a pure
 *            closure; per-call cost is a handful of typeof checks (~40ns,
 *            zero allocation on the happy path)
 *   Level 3: full Zod strict parse (SDK validateToolInput) for rich semantic
 *            errors — remains the authority for MCP-envelope calls
 *
 * The compiled validators are deliberately conservative: they only reject
 * arguments that are unambiguously invalid (missing required key, primitive
 * type mismatch, enum miss). Anything the JSON schema expresses beyond that
 * (unions, allOf/oneOf, $ref, nested object shapes) degrades that tool's
 * validator to a no-op so Level 3 stays the single source of truth.
 *
 * Kill switch: MCP_FAST_VALIDATION=off disables the fast path entirely.
 *
 * @module compiled-validators
 */

import { readEnvBoolean } from '@src/config/environment';
import { logger } from '@utils/logger';

export type CompiledValidator = (args: Record<string, unknown>) => string | null;

const FAST_VALIDATION_ENABLED = readEnvBoolean('MCP_FAST_VALIDATION', true);

interface JsonSchemaLike {
  type?: string | readonly string[];
  properties?: Record<string, JsonSchemaLike>;
  required?: readonly string[];
  enum?: readonly unknown[];
  items?: unknown;
  additionalProperties?: unknown;
}

/** Schema keywords that make even a property's shape ambiguous → skip it. */
const COMPLEX_MARKERS = ['allOf', 'anyOf', 'oneOf', 'not', '$ref', 'if', 'then', 'else'] as const;

type PrimitiveKind = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

function hasComplexMarkers(schema: Record<string, unknown>): boolean {
  return COMPLEX_MARKERS.some((key) => key in schema);
}

function resolvePrimitiveKind(schema: JsonSchemaLike): PrimitiveKind | null {
  const raw = schema.type;
  if (typeof raw !== 'string') return null; // union types (string|null etc.) → skip
  switch (raw) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'array':
    case 'object':
      return raw;
    default:
      return null;
  }
}

function valueMatchesKind(value: unknown, kind: PrimitiveKind): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

interface CompiledCheck {
  key: string;
  kind: PrimitiveKind | null;
  enumValues: readonly unknown[] | null;
  label: string;
}

/**
 * Compile a tool's JSON input schema into a pure validator closure, or null
 * when the schema is too complex/ambiguous for a safe fast path. Compilation
 * happens once per tool at registration — the returned closure is the
 * "compiled singleton".
 */
export function compileToolValidator(toolName: string, schema: unknown): CompiledValidator | null {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return null;
  }
  const root = schema as Record<string, unknown>;
  if (hasComplexMarkers(root)) return null;

  const typed = schema as JsonSchemaLike;
  const rootKind = resolvePrimitiveKind(typed);
  if (rootKind && rootKind !== 'object') return null; // top-level non-object → leave to Zod

  const required = Array.isArray(typed.required)
    ? typed.required.filter((k): k is string => typeof k === 'string')
    : [];
  const properties =
    typed.properties && typeof typed.properties === 'object' ? typed.properties : {};

  const checks: CompiledCheck[] = [];
  for (const [key, propSchema] of Object.entries(properties)) {
    if (!propSchema || typeof propSchema !== 'object' || Array.isArray(propSchema)) continue;
    const prop = propSchema as Record<string, unknown>;
    if (hasComplexMarkers(prop)) continue;

    const kind = resolvePrimitiveKind(prop as JsonSchemaLike);
    const enumValues = Array.isArray(prop.enum) ? prop.enum : null;
    if (kind === null && !enumValues) continue; // nested object/array shape → Zod's job
    if (kind === 'object' && prop.properties) continue; // nested shape → Zod's job
    checks.push({
      key,
      kind: enumValues ? (typeof enumValues[0] === 'string' ? 'string' : null) : kind,
      enumValues,
      label: `${toolName}.${key}`,
    });
  }

  if (required.length === 0 && checks.length === 0) return null;

  // The compiled singleton — no schema traversal, no closure allocation per call.
  return (args: Record<string, unknown>): string | null => {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return 'arguments must be an object';
    }
    for (let i = 0; i < required.length; i++) {
      const key = required[i]!;
      if (args[key] === undefined) {
        return `missing required argument: ${key}`;
      }
    }
    for (let i = 0; i < checks.length; i++) {
      const check = checks[i]!;
      const value = args[check.key];
      if (value === undefined || value === null) continue;
      if (check.enumValues && !check.enumValues.includes(value)) {
        return `invalid value for ${check.label}: expected one of ${check.enumValues
          .map((v) => JSON.stringify(v))
          .join(' | ')}`;
      }
      if (check.kind && !valueMatchesKind(value, check.kind)) {
        return `invalid type for ${check.label}: expected ${check.kind}, got ${typeof value}`;
      }
    }
    return null;
  };
}

// ── Singleton pool ──

const validatorPool = new Map<string, CompiledValidator>();

/** Register (pre-compile) a tool's validator. Safe to call repeatedly. */
export function registerCompiledValidator(tool: { name: string; inputSchema?: unknown }): void {
  if (validatorPool.has(tool.name)) return;
  try {
    const compiled = compileToolValidator(tool.name, tool.inputSchema);
    if (compiled) {
      validatorPool.set(tool.name, compiled);
    }
  } catch (error) {
    logger.warn(`[compiled-validators] Failed to compile validator for "${tool.name}"`, error);
  }
}

export function getCompiledValidator(toolName: string): CompiledValidator | undefined {
  return validatorPool.get(toolName);
}

/**
 * Fast-path validation. Returns an error message string when the arguments
 * are unambiguously invalid, or null when OK / unknown tool / disabled.
 */
export function fastValidateToolArgs(
  toolName: string,
  args: Record<string, unknown>,
): string | null {
  if (!FAST_VALIDATION_ENABLED) return null;
  const validator = validatorPool.get(toolName);
  if (!validator) return null;
  return validator(args);
}

/** Test hook — resets the pool. */
export function clearCompiledValidators(): void {
  validatorPool.clear();
}

/** Test/diagnostics hook — number of compiled validators in the pool. */
export function compiledValidatorCount(): number {
  return validatorPool.size;
}
