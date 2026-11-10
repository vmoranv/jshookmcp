import { afterAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

describe('Runtime restore E2E', { timeout: 120_000 }, () => {
  const clients: MCPTestClient[] = [];

  afterAll(async () => {
    for (const client of clients) {
      await client.cleanup();
    }
  });

  test('activated domains are restored after process restart', async () => {
    const stateDir = `.jshookmcp/state-restore-${Date.now()}`;
    const envOverrides = {
      MCP_TOOL_PROFILE: 'search',
      JSHOOK_STATE_DIR: stateDir,
    };

    const first = new MCPTestClient({ envOverrides });
    clients.push(first);
    await first.connect();
    expect(first.getToolMap().has('activate_domain')).toBe(true);

    const activate = await first.call('activate_domain', { domain: 'browser' }, 30_000);
    expect(activate.result.status).not.toBe('FAIL');

    await first.cleanup();

    const second = new MCPTestClient({ envOverrides });
    clients.push(second);
    await second.connect();

    const browserStatus = await second.call(
      'call_tool',
      { name: 'browser_status', args: {} },
      30_000,
    );
    expect(browserStatus.result.status).not.toBe('FAIL');
    const body = browserStatus.parsed as {
      success?: boolean;
      wasAutoActivated?: boolean;
      activatedTools?: string[];
    };
    expect(body.success).toBe(true);
    expect(body.wasAutoActivated).toBe(false);
  });
});
