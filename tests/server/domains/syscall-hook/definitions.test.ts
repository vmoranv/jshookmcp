import { describe, expect, it } from 'vitest';
import { syscallHookToolDefinitions } from '@server/domains/syscall-hook/definitions';

describe('syscall-hook definitions', () => {
  it('declares the simulate flag for syscall_start_monitor', async () => {
    const tool = syscallHookToolDefinitions.find(
      (candidate) => candidate.name === 'syscall_start_monitor',
    );

    expect(tool).toBeDefined();
    expect(tool?.inputSchema.properties).toHaveProperty('simulate');
    expect(tool?.inputSchema.properties?.['simulate']).toMatchObject({
      type: 'boolean',
      default: false,
    });
  });
});
