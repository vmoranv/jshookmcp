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

  it('declares pid for process memory and injection tools that require it', async () => {
    for (const name of [
      'memory_read',
      'memory_write',
      'memory_scan',
      'memory_check_protection',
      'memory_scan_filtered',
      'inject_dll',
      'inject_shellcode',
    ]) {
      const tool = processToolDefinitions.find((candidate) => candidate.name === name);
      expect(tool, `Missing tool definition: ${name}`).toBeDefined();
      expect(tool?.inputSchema.properties).toHaveProperty('pid');
      expect(tool?.inputSchema.required).toContain('pid');
    }
  });
});
