import type { CallToolResult } from '@modelcontextprotocol/server';

export type ToolArgs = Record<string, unknown>;
export type ToolResponse = CallToolResult;
export type ToolHandler = (args: ToolArgs) => Promise<ToolResponse>;
