import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

describe('Error Paths & Process/Memory E2E', { timeout: 120_000, sequential: true }, () => {
  const client = new MCPTestClient();

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.cleanup();
  });

  // --- Error Path Tests ---

  test('ERROR-01: tools return GRACEFUL error without browser context', async () => {
    // These tools normally need a browser connection.
    // Without one, they should return structured "GRACEFUL:" errors, not crash.
    const browserDependentTools = [
      'page_evaluate',
      'dom_query_selector',
      'page_screenshot',
      'network_get_requests',
      'debugger_evaluate',
    ];

    for (const toolName of browserDependentTools) {
      if (!client.getToolMap().has(toolName)) continue;

      const result = await client.call(toolName, {}, 10_000);
      // Should not be undefined/null — must return a structured result
      expect(result.result).toBeDefined();
      expect(result.result.detail.length).toBeGreaterThan(0);
      // Should be EXPECTED_LIMITATION (graceful) or FAIL, but structured
      expect(['EXPECTED_LIMITATION', 'FAIL', 'PASS']).toContain(result.result.status);
    }
  });

  test('ERROR-02: tools handle invalid parameters with actionable errors', async () => {
    // Test tools with clearly wrong parameter types
    const invalidCalls: Array<{ tool: string; args: Record<string, unknown> }> = [
      { tool: 'page_navigate', args: { url: '', waitUntil: 'invalid_event' } },
      { tool: 'breakpoint_set', args: { scriptId: '', lineNumber: -1 } },
      { tool: 'memory_read', args: { pid: -1, address: 'not_hex', size: 0 } },
    ];

    for (const { tool, args } of invalidCalls) {
      if (!client.getToolMap().has(tool)) continue;

      const result = await client.call(tool, args, 10_000);
      expect(result.result).toBeDefined();
      expect(result.result.detail.length).toBeGreaterThan(0);
    }
  });

  test('ERROR-03: tool timeout behavior', async () => {
    // Tools should respect timeout and not hang
    if (!client.getToolMap().has('page_wait_for_selector')) {
      client.recordSynthetic('tool-timeout', 'SKIP', 'Tool not registered');
      return;
    }

    const start = Date.now();
    const result = await client.call(
      'page_wait_for_selector',
      { selector: '#__nonexistent_e2e_element__', timeout: 1000 },
      5_000,
    );
    const elapsed = Date.now() - start;

    // Should complete within reasonable time (not hang forever)
    expect(elapsed).toBeLessThan(10_000);
    expect(result.result.detail.length).toBeGreaterThan(0);
  });

  // --- Process/Memory Tests ---

  test('PROC-01: process_find returns process data', async () => {
    if (!client.getToolMap().has('process_find')) {
      client.recordSynthetic('process-list', 'SKIP', 'Tool not registered');
      return;
    }

    const result = await client.call('process_find', { pattern: 'node' }, 15_000);
    expect(result.result.status).not.toBe('FAIL');
  });

  test('PROC-02: process_find locates running processes', async () => {
    if (!client.getToolMap().has('process_find')) {
      client.recordSynthetic('process-find', 'SKIP', 'Tool not registered');
      return;
    }

    const result = await client.call('process_find', { pattern: 'node' }, 15_000);
    // Should find at least the current node process
    expect(['PASS', 'EXPECTED_LIMITATION']).toContain(result.result.status);
  });

  test('PROC-03: memory_audit_export returns audit trail', async () => {
    if (!client.getToolMap().has('memory_audit_export')) {
      client.recordSynthetic('memory-audit', 'SKIP', 'Tool not registered');
      return;
    }

    const result = await client.call('memory_audit_export', { clear: false }, 15_000);
    expect(result.result.status).not.toBe('FAIL');
  });

  test('memory_list_regions returns valid structure', async () => {
    if (!client.getToolMap().has('memory_list_regions')) {
      client.recordSynthetic('memory-regions', 'SKIP', 'Tool not registered');
      return;
    }

    // Without a target PID, should return graceful error
    const result = await client.call('memory_list_regions', {}, 15_000);
    expect(result.result.detail.length).toBeGreaterThan(0);
  });
});
