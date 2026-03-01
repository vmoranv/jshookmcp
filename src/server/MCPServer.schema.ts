import { z } from 'zod';

function jsonSchemaToZod(prop: Record<string, unknown>): z.ZodTypeAny {
  const schemaType = prop.type as string | undefined;
  switch (schemaType) {
    case 'string':
      if (Array.isArray(prop.enum)) {
        const vals = prop.enum as [string, ...string[]];
        return z.enum(vals);
      }
      return z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      if (prop.items && typeof prop.items === 'object') {
        return z.array(jsonSchemaToZod(prop.items as Record<string, unknown>));
      }
      return z.array(z.unknown());
    case 'object':
      if (prop.properties && typeof prop.properties === 'object') {
        const nested: Record<string, z.ZodTypeAny> = {};
        const nestedRequired = new Set(
          Array.isArray(prop.required) ? (prop.required as string[]) : []
        );
        for (const [k, v] of Object.entries(prop.properties as Record<string, unknown>)) {
          const field = jsonSchemaToZod(v as Record<string, unknown>);
          nested[k] = nestedRequired.has(k) ? field : field.optional();
        }
        return z.object(nested);
      }
      return z.record(z.string(), z.unknown());
    default:
      return z.unknown();
  }
}

export function buildZodShape(inputSchema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const props = (inputSchema.properties as Record<string, unknown>) ?? {};
  const requiredKeys = new Set(
    Array.isArray(inputSchema.required) ? (inputSchema.required as string[]) : []
  );
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, descriptor] of Object.entries(props)) {
    const zodType = jsonSchemaToZod(
      descriptor && typeof descriptor === 'object' ? (descriptor as Record<string, unknown>) : {}
    );
    shape[key] = requiredKeys.has(key) ? zodType : zodType.optional();
  }
  return shape;
}
