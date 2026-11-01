import { z } from 'zod';

const TRUE_BOOLEAN_LITERALS = new Set(['true', '1', 'yes', 'on']);
const FALSE_BOOLEAN_LITERALS = new Set(['false', '0', 'no', 'off']);

function coerceBooleanInput(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (TRUE_BOOLEAN_LITERALS.has(normalized)) {
    return true;
  }
  if (FALSE_BOOLEAN_LITERALS.has(normalized)) {
    return false;
  }

  return value;
}

function coerceNumberInput(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();
  if (normalized === '') {
    return value;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : value;
}

function jsonSchemaToZod(prop: Record<string, unknown>): z.ZodTypeAny {
  const description = typeof prop.description === 'string' ? prop.description : undefined;

  // Handle anyOf / oneOf for union types (e.g., string | array fallback)
  const unionType = unionSchemaOrNull(prop);
  if (unionType) {
    return description ? unionType.describe(description) : unionType;
  }

  let zodType = primitiveSchemaOrNull(prop);
  if (zodType === null) {
    zodType = z.unknown();
  }

  if (description) {
    zodType = zodType.describe(description);
  }

  return zodType;
}

/** anyOf/oneOf union handling. Returns null when the property is not a union. */
function unionSchemaOrNull(prop: Record<string, unknown>): z.ZodTypeAny | null {
  if (prop.anyOf === undefined && prop.oneOf === undefined) return null;
  const rawVariants = (prop.anyOf ?? prop.oneOf) as unknown;
  const variantList = Array.isArray(rawVariants) ? rawVariants : [];
  if (variantList.length === 0) {
    // z.union([]) crashes with an unhelpful internal error — fail loudly with
    // a schema-level message instead so misconfigured tool definitions are
    // diagnosable at registration time.
    const kind = prop.anyOf !== undefined ? 'anyOf' : 'oneOf';
    throw new Error(
      `Invalid JSON schema: "${kind}" must contain at least one variant, got an empty array`,
    );
  }
  const variants = (variantList as Array<Record<string, unknown>>).map((v) => jsonSchemaToZod(v));
  return z.union([variants[0], ...variants.slice(1)] as [z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

/** Scalar/array/object schema construction (non-union). Returns null for the
 * unknown-type fallback. */
function primitiveSchemaOrNull(prop: Record<string, unknown>): z.ZodTypeAny | null {
  const schemaType = prop.type as string | undefined;
  switch (schemaType) {
    case 'string':
      return stringSchema(prop);
    case 'number':
    case 'integer':
      return numberSchema(prop, schemaType === 'integer');
    case 'boolean':
      return z.preprocess(coerceBooleanInput, z.boolean());
    case 'array':
      return arraySchema(prop);
    case 'object':
      return objectSchema(prop);
    default:
      return null;
  }
}

function stringSchema(prop: Record<string, unknown>): z.ZodTypeAny {
  if (Array.isArray(prop.enum)) {
    return z.enum(prop.enum as [string, ...string[]]);
  }
  let str = z.string();
  if (typeof prop.pattern === 'string') {
    str = str.regex(new RegExp(prop.pattern));
  }
  return str;
}

function numberSchema(prop: Record<string, unknown>, isInteger: boolean): z.ZodTypeAny {
  let num = z.number();
  if (typeof prop.minimum === 'number') num = num.min(prop.minimum);
  if (typeof prop.maximum === 'number') num = num.max(prop.maximum);
  if (isInteger) num = num.int();
  return z.preprocess(coerceNumberInput, num);
}

function arraySchema(prop: Record<string, unknown>): z.ZodTypeAny {
  if (prop.items && typeof prop.items === 'object') {
    return z.array(jsonSchemaToZod(prop.items as Record<string, unknown>));
  }
  return z.array(z.unknown());
}

function objectSchema(prop: Record<string, unknown>): z.ZodTypeAny {
  if (prop.properties && typeof prop.properties === 'object') {
    const nested: Record<string, z.ZodTypeAny> = {};
    const nestedRequired = new Set(Array.isArray(prop.required) ? (prop.required as string[]) : []);
    for (const [k, v] of Object.entries(prop.properties as Record<string, unknown>)) {
      const field = jsonSchemaToZod(v as Record<string, unknown>);
      nested[k] = nestedRequired.has(k) ? field : field.optional();
    }
    return z.object(nested);
  }
  return z.record(z.string(), z.unknown());
}

export function buildZodShape(inputSchema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const props = (inputSchema.properties as Record<string, unknown>) ?? {};
  const requiredKeys = new Set(
    Array.isArray(inputSchema.required) ? (inputSchema.required as string[]) : [],
  );
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, descriptor] of Object.entries(props)) {
    const zodType = jsonSchemaToZod(
      descriptor && typeof descriptor === 'object' ? (descriptor as Record<string, unknown>) : {},
    );
    shape[key] = requiredKeys.has(key) ? zodType : zodType.optional();
  }
  return shape;
}
