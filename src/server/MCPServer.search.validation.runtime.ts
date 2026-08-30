import { z, ZodError } from 'zod';
import type { Tool } from '@modelcontextprotocol/server';
import { buildZodShape } from '@server/MCPServer.schema';

function normalizeMessage(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export function validateToolArgsAgainstSchema(
  toolName: string,
  schema: Tool['inputSchema'] | undefined,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') {
    return args;
  }

  const shape = buildZodShape(schema as Record<string, unknown>);
  if (Object.keys(shape).length === 0) {
    return args;
  }

  try {
    return z.object(shape).parse(args) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Invalid arguments for "${toolName}": ${normalizeMessage(error)}`, {
        cause: error,
      });
    }
    throw error;
  }
}
