import type { JSONValue, Tool } from '@modelcontextprotocol/server';

export const TLS_VERSION_VALUES = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'] as const;

export function objectTool(
  name: string,
  description: string,
  properties: Record<string, JSONValue> = {},
  required: string[] = [],
): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      required,
    },
  };
}
