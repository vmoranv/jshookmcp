/**
 * ToolRouter.renderer - Recommendation text rendering, command building,
 * and example argument generation.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPServerContext } from '@server/MCPServer.context';
import { normalizeToolName } from '@server/MCPServer.search.validation';
import { getToolInputSchema, getToolDescription } from '@server/ToolRouter.probe';

// ── Example Args Generator ──

export function generateExampleArgs(schema: Tool['inputSchema']): Record<string, unknown> {
  if (schema?.type !== 'object' || !schema.properties) {
    return {};
  }

  const example: Record<string, unknown> = {};
  const required = new Set<string>(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );

  for (const [key, prop] of Object.entries(schema.properties as Record<string, unknown>)) {
    const propSchema = prop as Record<string, unknown>;
    if (!required.has(key) && propSchema.default === undefined) {
      continue;
    }

    if (propSchema.default !== undefined) {
      example[key] = propSchema.default;
    } else if (propSchema.enum && Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
      example[key] = propSchema.enum[0];
    } else if (propSchema.type === 'string') {
      example[key] = `<${key}>`;
    } else if (propSchema.type === 'number' || propSchema.type === 'integer') {
      example[key] = 0;
    } else if (propSchema.type === 'boolean') {
      example[key] = false;
    } else if (propSchema.type === 'array') {
      example[key] = [];
    } else if (propSchema.type === 'object') {
      example[key] = {};
    }
  }

  return example;
}

// ── Call Tool Command Builder ──

export function buildCallToolCommand(toolName: string, schema: Tool['inputSchema']): string {
  return `call_tool({ name: "${toolName}", args: ${JSON.stringify(generateExampleArgs(schema))} })`;
}

// ── Describe Tool Utility ──

export function describeTool(
  toolName: string,
  ctx: MCPServerContext,
): { name: string; description: string; inputSchema: Tool['inputSchema'] } | null {
  const canonicalName = normalizeToolName(toolName);
  const schema = getToolInputSchema(canonicalName, ctx);
  if (!schema) {
    return null;
  }

  return {
    name: canonicalName,
    description: getToolDescription(canonicalName, ctx),
    inputSchema: schema,
  };
}
