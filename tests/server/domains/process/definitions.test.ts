import { describe, expect, it } from 'vitest';
import { processToolDefinitions } from '@server/domains/process/definitions';

describe('process domain definitions', () => {
  it('declares the electron_attach CDP parameters it accepts at runtime', async () => {
    const tool = processToolDefinitions.find((candidate) => candidate.name === 'electron_attach');

    expect(tool).toBeDefined();
    expect(tool?.inputSchema.properties).toHaveProperty('port');
    expect(tool?.inputSchema.properties).toHaveProperty('pageUrl');
    expect(tool?.inputSchema.properties).toHaveProperty('evaluate');
    expect(tool?.inputSchema.properties).toHaveProperty('wsEndpoint');
  });

  it('keeps pid optional for memory tools that support runtime auto-discovery', async () => {
    for (const name of [
      'memory_read',
      'memory_write',
      'memory_scan',
      'memory_check_protection',
      'memory_scan_filtered',
      'memory_batch_write',
      'memory_dump_region',
      'memory_list_regions',
    ]) {
      const tool = processToolDefinitions.find((candidate) => candidate.name === name);
      expect(tool, `Missing tool definition: ${name}`).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('pid');
      expect(tool?.inputSchema.required ?? []).not.toContain('pid');
    }
  });

  it('keeps pid required for process and injection tools that cannot auto-discover a target', async () => {
    for (const name of ['inject_dll', 'inject_shellcode']) {
      const tool = processToolDefinitions.find((candidate) => candidate.name === name);
      expect(tool, `Missing tool definition: ${name}`).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('pid');
      expect(tool?.inputSchema.required).toContain('pid');
    }
  });

  it('declares optional thread details for process_enum_threads', async () => {
    const tool = processToolDefinitions.find(
      (candidate) => candidate.name === 'process_enum_threads',
    );

    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toContain('pid');
    expect(tool?.inputSchema.properties).toHaveProperty('includeDetails');
    expect(tool?.inputSchema.properties?.['includeDetails']).toMatchObject({
      type: 'boolean',
      default: false,
    });
  });
});
