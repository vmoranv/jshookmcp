import { z } from 'zod';

function jsonSchemaToZod(prop: Record<string, unknown>): z.ZodTypeAny {
  const schemaType = prop.type as string | undefined;
  const description = typeof prop.description === 'string' ? prop.description : undefined;

  let zodType: z.ZodTypeAny;

  switch (schemaType) {
    case 'string':
      if (Array.isArray(prop.enum)) {
        const vals = prop.enum as [string, ...string[]];
        zodType = z.enum(vals);
      } else {
        let str = z.string();
        if (typeof prop.pattern === 'string') {
          str = str.regex(new RegExp(prop.pattern));
        }
        zodType = str;
      }
      break;
    case 'number':
    case 'integer': {
      let num = z.number();
      if (typeof prop.minimum === 'number') num = num.min(prop.minimum);
      if (typeof prop.maximum === 'number') num = num.max(prop.maximum);
      if (schemaType === 'integer') num = num.int();
      zodType = num;
      break;
    }
    case 'boolean':
      zodType = z.boolean();
      break;
    case 'array':
      if (prop.items && typeof prop.items === 'object') {
        zodType = z.array(jsonSchemaToZod(prop.items as Record<string, unknown>));
      } else {
        zodType = z.array(z.unknown());
      }
      break;
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
        zodType = z.object(nested);
      } else {
        zodType = z.record(z.string(), z.unknown());
      }
      break;
    default:
      zodType = z.unknown();
  }

  if (description) {
    zodType = zodType.describe(description);
  }

  return zodType;
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
