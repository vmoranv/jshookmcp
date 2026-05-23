import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

interface TabWorkflowBody {
  success?: boolean;
  value?: unknown;
  found?: boolean;
}

describe('Browser session isolation E2E', { timeout: 120_000, sequential: true }, () => {
  const client = new MCPTestClient();

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.cleanup();
  });

  test('tab_workflow shared context is isolated by logical sessionId', async () => {
    if (!client.getToolMap().has('tab_workflow')) {
      client.recordSynthetic('browser-session-isolation', 'SKIP', 'Missing tab_workflow tool');
      return;
    }

    const sessionA = { sessionId: 'e2e-session-a' };
    const sessionB = { sessionId: 'e2e-session-b' };

    const setA = await client.callWithMeta(
      'tab_workflow',
      { action: 'context_set', key: 'owner', value: 'A' },
      sessionA,
      30_000,
    );
    expect(setA.result.status).not.toBe('FAIL');

    const setB = await client.callWithMeta(
      'tab_workflow',
      { action: 'context_set', key: 'owner', value: 'B' },
      sessionB,
      30_000,
    );
    expect(setB.result.status).not.toBe('FAIL');

    const getA = await client.callWithMeta(
      'tab_workflow',
      { action: 'context_get', key: 'owner' },
      sessionA,
      30_000,
    );
    const getABody = getA.parsed as TabWorkflowBody;
    expect(getABody.found).toBe(true);
    expect(getABody.value).toBe('A');

    const getB = await client.callWithMeta(
      'tab_workflow',
      { action: 'context_get', key: 'owner' },
      sessionB,
      30_000,
    );
    const getBBody = getB.parsed as TabWorkflowBody;
    expect(getBBody.found).toBe(true);
    expect(getBBody.value).toBe('B');
  });
});
