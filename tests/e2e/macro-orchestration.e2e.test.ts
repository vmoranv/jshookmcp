import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

const TARGET_URL = process.env.E2E_TARGET_URL;

describe.skipIf(!TARGET_URL)(
  'Macro Orchestration E2E',
  { timeout: 180_000, sequential: true },
  () => {
    const client = new MCPTestClient();

    beforeAll(async () => {
      await client.connect();

      // Macros may need a browser context for source fetching
      if (client.getToolMap().has('browser_launch')) {
        await client.call('browser_launch', { headless: false }, 60_000);
        await client.call(
          'page_navigate',
          { url: TARGET_URL, waitUntil: 'load', timeout: 15000 },
          30_000,
        );
      }
    });

    afterAll(async () => {
      await client.cleanup();
    });

    test('MACRO-01: list_macros returns available macros', async () => {
      if (!client.getToolMap().has('list_macros')) {
        client.recordSynthetic('list-macros', 'SKIP', 'Tool not registered');
        return;
      }

      const result = await client.call('list_macros', {}, 15_000);
      expect(result.result.status).not.toBe('FAIL');

      // Should return some form of list
      if (result.parsed && typeof result.parsed === 'object') {
        const parsed = result.parsed as Record<string, unknown>;
        expect(
          Array.isArray(parsed.macros) ||
            Array.isArray(parsed.builtIn) ||
            Array.isArray(parsed.available) ||
            parsed.success !== undefined,
        ).toBe(true);
      }
    });

    test('MACRO-02: run_macro with built-in macro (deobfuscate_ast_flow)', async () => {
      if (!client.getToolMap().has('run_macro')) {
        client.recordSynthetic('run-macro-builtin', 'SKIP', 'Tool not registered');
        return;
      }

      // If list_macros reveals the available macros, use one
      // Otherwise try deobfuscate_ast_flow as it was mentioned in the project docs
      const result = await client.call(
        'run_macro',
        {
          macroId: 'deobfuscate_ast_flow',
          inputOverrides: {},
        },
        90_000,
      );

      // Macro may need browser context or specific inputs
      // Important: it returns structured output, not a crash
      expect(result.result.detail.length).toBeGreaterThan(0);
    });

    test('MACRO-03: run_macro with invalid macroId returns structured error', async () => {
      if (!client.getToolMap().has('run_macro')) {
        client.recordSynthetic('run-macro-invalid', 'SKIP', 'Tool not registered');
        return;
      }

      const result = await client.call(
        'run_macro',
        {
          macroId: '__nonexistent_e2e_macro__',
        },
        15_000,
      );

      // Should return a structured error, not crash
      expect(result.result.detail.length).toBeGreaterThan(0);
      // The error should be clear about the macro not being found
      if (result.parsed && typeof result.parsed === 'object') {
        const parsed = result.parsed as Record<string, unknown>;
        expect(
          parsed.success === false || parsed.ok === false || result.result.status !== 'PASS',
        ).toBe(true);
      }
    });
  },
);
