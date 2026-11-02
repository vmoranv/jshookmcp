import type { E2EConfig } from '@tests/e2e/helpers/types';

type SchemaBuilderConfig = Pick<E2EConfig, 'targetUrl' | 'artifactDir'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * One entry of the name → value heuristic table. Entries are evaluated in
 * order, first match wins, which is exactly the precedence the original chain
 * of `if` statements encoded.
 */
interface StringValueRule {
  test: (lowerName: string) => boolean;
  value: (name: string, config: SchemaBuilderConfig) => unknown;
}

const contains =
  (...needles: string[]) =>
  (n: string): boolean =>
    needles.some((needle) => n.includes(needle));

const exact =
  (...names: string[]) =>
  (n: string): boolean =>
    names.includes(n);

const fixed = (value: unknown) => (): unknown => value;

const PLACEHOLDER = '__placeholder__';

/**
 * Ordered heuristics for string (and untyped) parameters.
 *
 * Order is load-bearing and mirrors the original if-chain exactly. Two spots
 * that look reorderable but are not:
 *   - `selector` is matched before `path`/`file`, so `fileSelector` → 'body'
 *   - `key`/`value` are matched BEFORE the `xId` placeholder rules, so
 *     `requestId` (contains neither) still reaches its placeholder, while a
 *     hypothetical `valueId` would resolve as 'test_value'
 * `apikey` is deliberately excluded from the `key` rule so it falls through to
 * the generic 'test' fallback.
 */
const STRING_VALUE_RULES: readonly StringValueRule[] = [
  // Semantic: real URL from config
  {
    test: contains('url', 'endpoint', 'baseurl', 'registerurl'),
    value: (_name, config) => config.targetUrl,
  },
  // Semantic: realistic selector
  { test: contains('selector'), value: fixed('body') },
  // Semantic: realistic file path
  {
    test: contains('path', 'file', 'artifactpath'),
    value: (name, config) => `${config.artifactDir}/${name}.txt`,
  },
  // Smoke: GraphQL query keyword test value
  { test: contains('query'), value: fixed('{ __typename }') },
  // Semantic: realistic operation name
  { test: contains('operationname'), value: fixed('TestOp') },
  // Semantic: realistic event name
  { test: contains('eventname'), value: fixed('click') },
  // Semantic: realistic category
  { test: exact('category'), value: fixed('mouse') },
  // Semantic: realistic state value
  { test: exact('state'), value: fixed('none') },
  // Semantic: realistic HTTP method
  { test: exact('method'), value: fixed('GET') },
  // Semantic: realistic device
  { test: exact('device'), value: fixed('iPhone 14') },
  // Semantic: realistic action
  { test: exact('action'), value: fixed('list') },
  // Smoke: test expression
  { test: contains('expression'), value: fixed('1+1') },
  // Semantic: code snippet
  { test: contains('code'), value: fixed('return 1;') },
  // Smoke: test pattern/keyword
  { test: contains('pattern', 'keyword'), value: fixed('test') },
  // Smoke: test key — `apikey` is deliberately excluded so it falls through
  { test: (n) => n.includes('key') && !n.includes('apikey'), value: fixed('test_key') },
  // Smoke: test value
  { test: contains('value'), value: fixed('test_value') },
  // Semantic: placeholder IDs (should be replaced with real IDs)
  { test: contains('hookid'), value: fixed(PLACEHOLDER) },
  { test: contains('scriptid'), value: fixed(PLACEHOLDER) },
  { test: contains('breakpointid'), value: fixed(PLACEHOLDER) },
  { test: contains('requestid'), value: fixed(PLACEHOLDER) },
  { test: contains('objectid'), value: fixed(PLACEHOLDER) },
  { test: contains('callframeid'), value: fixed(PLACEHOLDER) },
];

/** Value for a numeric/integer schema, honouring the declared bounds. */
function numericFromSchema(schema: Record<string, unknown> | undefined, type: string): number {
  if (typeof schema?.minimum === 'number') return schema.minimum;
  if (typeof schema?.exclusiveMinimum === 'number') return (schema.exclusiveMinimum as number) + 1;
  return type === 'integer' ? 1 : 1.0;
}

/** Value for a string/untyped schema, via the ordered rule table. */
function stringFromSchema(name: string, config: SchemaBuilderConfig): unknown {
  const lowerName = name.toLowerCase();
  for (const rule of STRING_VALUE_RULES) {
    if (rule.test(lowerName)) {
      return rule.value(name, config);
    }
  }
  // Smoke: default fallback
  return 'test';
}

function scalarFromSchema(
  name: string,
  schema: Record<string, unknown> | undefined,
  config: SchemaBuilderConfig,
): unknown {
  if (schema?.const !== undefined) return schema.const;
  const enumValues = schema?.enum;
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];

  const type = typeof schema?.type === 'string' ? schema.type : undefined;

  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') return numericFromSchema(schema, type);
  if (type === 'string' || !type) return stringFromSchema(name, config);
  return null;
}

function valueFromSchema(
  name: string,
  schema: Record<string, unknown> | undefined,
  config: SchemaBuilderConfig,
  depth = 0,
): unknown {
  if (!schema || depth > 4) return scalarFromSchema(name, schema, config);
  if (schema.const !== undefined || schema.enum !== undefined)
    return scalarFromSchema(name, schema, config);

  const oneOf = schema.oneOf;
  if (Array.isArray(oneOf) && oneOf.length > 0 && isRecord(oneOf[0])) {
    return valueFromSchema(name, oneOf[0], config, depth + 1);
  }

  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf) && anyOf.length > 0 && isRecord(anyOf[0])) {
    return valueFromSchema(name, anyOf[0], config, depth + 1);
  }

  const type = typeof schema.type === 'string' ? schema.type : undefined;
  if (type === 'object' || isRecord(schema.properties)) {
    const props = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === 'string')
      : [];
    const out: Record<string, unknown> = {};
    for (const key of required) {
      const propSchema = isRecord(props[key]) ? props[key] : undefined;
      out[key] = valueFromSchema(key, propSchema, config, depth + 1);
    }
    return out;
  }

  if (type === 'array') {
    const itemSchema = isRecord(schema.items) ? schema.items : undefined;
    const minItems = typeof schema.minItems === 'number' ? schema.minItems : 0;
    return Array.from({ length: Math.max(1, minItems) }, () =>
      valueFromSchema(name, itemSchema, config, depth + 1),
    );
  }

  return scalarFromSchema(name, schema, config);
}

export function buildArgs(
  inputSchema: Record<string, unknown> | undefined,
  config: SchemaBuilderConfig,
): Record<string, unknown> {
  const props = isRecord(inputSchema?.properties) ? inputSchema!.properties : {};
  const required = Array.isArray(inputSchema?.required)
    ? inputSchema!.required.filter((key): key is string => typeof key === 'string')
    : [];
  const args: Record<string, unknown> = {};
  for (const key of required)
    args[key] = valueFromSchema(key, isRecord(props[key]) ? props[key] : undefined, config, 0);
  return args;
}
