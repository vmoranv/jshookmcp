import type { E2EConfig } from '@tests/e2e/helpers/types';

type SchemaBuilderConfig = Pick<E2EConfig, 'targetUrl' | 'artifactDir'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function scalarFromSchema(
  name: string,
  schema: Record<string, unknown> | undefined,
  config: SchemaBuilderConfig
): unknown {
  if (schema?.const !== undefined) return schema.const;
  const enumValues = schema?.enum;
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];

  const type = typeof schema?.type === 'string' ? schema.type : undefined;
  const n = name.toLowerCase();

  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') {
    if (typeof schema?.minimum === 'number') return schema.minimum;
    if (typeof schema?.exclusiveMinimum === 'number')
      return (schema.exclusiveMinimum as number) + 1;
    return type === 'integer' ? 1 : 1.0;
  }
  if (type === 'string' || !type) {
    // Semantic: real URL from config
    if (
      n.includes('url') ||
      n.includes('endpoint') ||
      n.includes('baseurl') ||
      n.includes('registerurl')
    )
      return config.targetUrl;
    // Semantic: realistic selector
    if (n.includes('selector')) return 'body';
    // Semantic: realistic file path
    if (n.includes('path') || n.includes('file') || n.includes('artifactpath'))
      return `${config.artifactDir}/${name}.txt`;
    // Smoke: GraphQL query keyword test value
    if (n.includes('query')) return '{ __typename }';
    // Semantic: realistic operation name
    if (n.includes('operationname')) return 'TestOp';
    // Semantic: realistic event name
    if (n.includes('eventname')) return 'click';
    // Semantic: realistic category
    if (n === 'category') return 'mouse';
    // Semantic: realistic state value
    if (n === 'state') return 'none';
    // Semantic: realistic HTTP method
    if (n === 'method') return 'GET';
    // Semantic: realistic device
    if (n === 'device') return 'iPhone 14';
    // Semantic: realistic action
    if (n === 'action') return 'list';
    // Smoke: test expression
    if (n.includes('expression')) return '1+1';
    // Semantic: code snippet
    if (n.includes('code')) return 'return 1;';
    // Smoke: test pattern/keyword
    if (n.includes('pattern') || n.includes('keyword')) return 'test';
    // Smoke: test key
    if (n.includes('key') && !n.includes('apikey')) return 'test_key';
    // Smoke: test value
    if (n.includes('value')) return 'test_value';
    // Semantic: placeholder IDs (should be replaced with real IDs)
    if (n.includes('hookid')) return '__placeholder__';
    if (n.includes('scriptid')) return '__placeholder__';
    if (n.includes('breakpointid')) return '__placeholder__';
    if (n.includes('requestid')) return '__placeholder__';
    if (n.includes('objectid')) return '__placeholder__';
    if (n.includes('callframeid')) return '__placeholder__';
    // Smoke: default fallback
    return 'test';
  }
  return null;
}

export function valueFromSchema(
  name: string,
  schema: Record<string, unknown> | undefined,
  config: SchemaBuilderConfig,
  depth = 0
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
      valueFromSchema(name, itemSchema, config, depth + 1)
    );
  }

  return scalarFromSchema(name, schema, config);
}

export function buildArgs(
  inputSchema: Record<string, unknown> | undefined,
  config: SchemaBuilderConfig
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
