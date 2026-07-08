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

  it('declares bounded capture options for syscall_capture_events', async () => {
    const tool = syscallHookToolDefinitions.find(
      (candidate) => candidate.name === 'syscall_capture_events',
    );

    expect(tool).toBeDefined();
    expect(tool?.inputSchema.properties).toHaveProperty('minTimestamp');
    expect(tool?.inputSchema.properties).toHaveProperty('maxTimestamp');
    expect(tool?.inputSchema.properties).toHaveProperty('limit');
    expect(tool?.inputSchema.properties).toHaveProperty('includeSummary');
    expect(tool?.inputSchema.properties?.['includeSummary']).toMatchObject({
      type: 'boolean',
      default: true,
    });
  });

  it('declares the etwProviders option for syscall_start_monitor', async () => {
    const tool = syscallHookToolDefinitions.find(
      (candidate) => candidate.name === 'syscall_start_monitor',
    );

    expect(tool).toBeDefined();
    expect(tool?.inputSchema.properties).toHaveProperty('etwProviders');
    expect(tool?.inputSchema.properties?.['etwProviders']).toMatchObject({
      type: 'array',
      items: { type: 'string' },
    });
  });
});
