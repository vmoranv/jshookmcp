import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

interface TabWorkflowBody {
  success?: boolean;
  value?: unknown;
  found?: boolean;
}

describe('Browser session isolation E2E', { timeout: 120_000 }, () => {
  const client = new MCPTestClient();

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.cleanup();
  });

  test('tab_workflow shared context is isolated across ten logical sessions', async () => {
    if (!client.getToolMap().has('tab_workflow')) {
      client.recordSynthetic('browser-session-isolation', 'SKIP', 'Missing tab_workflow tool');
      return;
    }

    const sessions = Array.from({ length: 10 }, (_, index) => ({
      sessionId: `e2e-session-${index}`,
      value: `owner-${index}`,
    }));

    const setResults = await Promise.all(
      sessions.map(
        async ({ sessionId, value }) =>
          await client.callWithMeta(
            'tab_workflow',
            { action: 'context_set', key: 'owner', value },
            { sessionId },
            30_000,
          ),
      ),
    );
    expect(setResults.every((result) => result.result.status !== 'FAIL')).toBe(true);

    const getResults = await Promise.all(
      sessions.map(
        async ({ sessionId }) =>
          await client.callWithMeta(
            'tab_workflow',
            { action: 'context_get', key: 'owner' },
            { sessionId },
            30_000,
          ),
      ),
    );
    for (const [index, result] of getResults.entries()) {
      const body = result.parsed as TabWorkflowBody;
      expect(body.found).toBe(true);
      expect(body.value).toBe(`owner-${index}`);
    }
  });
});
