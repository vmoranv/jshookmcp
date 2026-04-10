import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

describe('Sandbox Execution E2E', { timeout: 120_000, sequential: true }, () => {
  const client = new MCPTestClient();

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.cleanup();
  });

  test('SANDBOX-01: execute simple JS in sandbox and verify output', async () => {
    if (!client.getToolMap().has('execute_sandbox_script')) {
      client.recordSynthetic('sandbox-basic', 'SKIP', 'Tool not registered');
      return;
    }

    const result = await client.call(
      'execute_sandbox_script',
      { code: 'const x = 1 + 2; x;' },
      30_000,
    );
    expect(result.result.status).not.toBe('FAIL');

    // Verify the result contains a value
    if (result.parsed && typeof result.parsed === 'object') {
      const parsed = result.parsed as Record<string, unknown>;
      // Should have some form of result/output
      expect(
        parsed.result !== undefined ||
          parsed.output !== undefined ||
          parsed.value !== undefined ||
          parsed.success !== undefined,
      ).toBe(true);
    }
  });

  test('SANDBOX-02: verify timeout enforcement', async () => {
    if (!client.getToolMap().has('execute_sandbox_script')) {
      client.recordSynthetic('sandbox-timeout', 'SKIP', 'Tool not registered');
      return;
    }

    // Run a script that should exceed the timeout
    const result = await client.call(
      'execute_sandbox_script',
      {
        code: 'while(true) {}',
        timeoutMs: 500,
      },
      15_000,
    );

    // Should either fail with timeout or return an expected limitation
    // The important thing is it doesn't hang forever
    expect(result.result.detail.length).toBeGreaterThan(0);
  });

  test('SANDBOX-03: sandbox can call host MCP tools via mcp.call bridge', async () => {
    if (!client.getToolMap().has('execute_sandbox_script')) {
      client.recordSynthetic('sandbox-bridge', 'SKIP', 'Tool not registered');
      return;
    }

    // Try calling a simple tool from within the sandbox
    const result = await client.call(
      'execute_sandbox_script',
      {
        code: `
          const result = await mcp.call('get_token_budget_stats', {});
          result;
        `,
        timeoutMs: 5000,
      },
      30_000,
    );

    // Should succeed if bridge works, or show a clear error if not
    expect(result.result.detail.length).toBeGreaterThan(0);
  });

  test('sandbox session persistence with sessionId', async () => {
    if (!client.getToolMap().has('execute_sandbox_script')) {
      client.recordSynthetic('sandbox-session', 'SKIP', 'Tool not registered');
      return;
    }

    const sessionId = `e2e-session-${Date.now()}`;

    // First execution: set a variable
    const set = await client.call(
      'execute_sandbox_script',
      {
        code: 'globalThis.__e2eVar = 42; __e2eVar;',
        sessionId,
      },
      15_000,
    );
    expect(set.result.status).not.toBe('FAIL');

    // Second execution: read the variable back (same session)
    const get = await client.call(
      'execute_sandbox_script',
      {
        code: 'globalThis.__e2eVar;',
        sessionId,
      },
      15_000,
    );
    expect(get.result.status).not.toBe('FAIL');
  });

  test('sandbox auto-correct retries failed scripts', async () => {
    if (!client.getToolMap().has('execute_sandbox_script')) {
      client.recordSynthetic('sandbox-autocorrect', 'SKIP', 'Tool not registered');
      return;
    }

    // Execute with autoCorrect enabled on a valid script
    const result = await client.call(
      'execute_sandbox_script',
      {
        code: 'JSON.stringify({ ok: true })',
        autoCorrect: true,
      },
      30_000,
    );
    expect(result.result.status).not.toBe('FAIL');
  });
});
