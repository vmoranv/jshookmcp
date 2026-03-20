import type { ToolArgs, ToolHandler, ToolResponse } from '@server/types';
import { ToolError } from '@errors/ToolError';

export class ToolExecutionRouter {
  private readonly handlers: Map<string, ToolHandler>;

  constructor(handlers: Record<string, ToolHandler>) {
    this.handlers = new Map(Object.entries(handlers));
  }

  has(toolName: string): boolean {
    return this.handlers.has(toolName);
  }

  listToolNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  addHandlers(handlers: Record<string, ToolHandler>): void {
    for (const [name, handler] of Object.entries(handlers)) {
      this.handlers.set(name, handler);
    }
  }

  removeHandler(toolName: string): void {
    this.handlers.delete(toolName);
  }

  async execute(toolName: string, args: ToolArgs): Promise<ToolResponse> {
    const handler = this.handlers.get(toolName);
    if (!handler) {
      throw new ToolError('NOT_FOUND', `Unknown tool: ${toolName}`, { toolName });
    }
    return handler(args);
  }
}
