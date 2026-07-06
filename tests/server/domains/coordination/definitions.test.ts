import { describe, expect, it } from 'vitest';
import { coordinationTools } from '@server/domains/coordination/definitions';

describe('coordination domain definitions', () => {
  const getTool = (name: string) => coordinationTools.find((tool) => tool.name === name);

  it('should define tools array', async () => {
    expect(Array.isArray(coordinationTools)).toBe(true);
  });
  it('should have valid tool shapes', async () => {
    for (const tool of coordinationTools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('should expose description for create_task_handoff', async () => {
    const tool = getTool('create_task_handoff');
    expect(tool?.inputSchema.properties).toHaveProperty('description');
  });

  it('should expose optional taskId for get_task_context', async () => {
    const tool = getTool('get_task_context');
    expect(tool?.inputSchema.properties).toHaveProperty('taskId');
    expect(tool?.inputSchema.properties).toHaveProperty('category');
    expect(tool?.inputSchema.properties).toHaveProperty('tag');
    expect(tool?.inputSchema.properties).toHaveProperty('severity');
    expect((tool?.inputSchema.properties?.severity as any)?.enum).toEqual([
      'info',
      'low',
      'medium',
      'high',
      'critical',
    ]);
    expect(tool?.inputSchema.properties).toHaveProperty('minConfidence');
  });

  it('should expose update_task_handoff status transitions', async () => {
    const tool = getTool('update_task_handoff');
    expect(tool?.inputSchema.required).toContain('taskId');
    expect(tool?.inputSchema.properties).toHaveProperty('status');
    expect((tool?.inputSchema.properties?.status as any)?.enum).toEqual([
      'pending',
      'in_progress',
      'failed',
    ]);
  });

  it('should expose session insight retrieval metadata', async () => {
    const tool = getTool('append_session_insight');
    expect(tool?.inputSchema.properties).toHaveProperty('tags');
    expect(tool?.inputSchema.properties).toHaveProperty('severity');
    expect((tool?.inputSchema.properties?.severity as any)?.enum).toEqual([
      'info',
      'low',
      'medium',
      'high',
      'critical',
    ]);
    expect(tool?.inputSchema.properties).toHaveProperty('toolSource');
  });
});
