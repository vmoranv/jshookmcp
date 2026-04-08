import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

const BINARY_TARGET = process.env.E2E_BINARY_TARGET;
const GHIDRA_HOME = process.env.GHIDRA_INSTALL_DIR ?? process.env.GHIDRA_HOME;

describe.skipIf(!BINARY_TARGET || !GHIDRA_HOME)(
  'Binary Instrument E2E',
  { timeout: 180_000, sequential: true },
  () => {
    const client = new MCPTestClient();

    beforeAll(async () => {
      await client.connect();
    });

    afterAll(async () => {
      await client.cleanup();
    });

    test('Ghidra headless analysis, Frida attachment', async () => {
      const ghidraTool =
        client.getToolMap().has('binary_ghidra_headless_analyze') ||
        client.getToolMap().has('ghidra_headless_analyze');
      const fridaTool =
        client.getToolMap().has('binary_frida_attach') || client.getToolMap().has('frida_attach');

      if (!ghidraTool && !fridaTool) {
        client.recordSynthetic(
          'binary-instrument-suite',
          'SKIP',
          'Neither Ghidra nor Frida E2E tools are registered in the current build',
        );
        return;
      }

      if (client.getToolMap().has('binary_ghidra_headless_analyze')) {
        const ghidra = await client.call(
          'binary_ghidra_headless_analyze',
          { targetPath: BINARY_TARGET, ghidraHome: GHIDRA_HOME },
          90_000,
        );
        expect(ghidra.result.status).not.toBe('FAIL');
      } else if (client.getToolMap().has('ghidra_headless_analyze')) {
        const ghidra = await client.call(
          'ghidra_headless_analyze',
          { targetPath: BINARY_TARGET, ghidraHome: GHIDRA_HOME },
          90_000,
        );
        expect(ghidra.result.status).not.toBe('FAIL');
      }

      if (client.getToolMap().has('binary_frida_attach')) {
        const frida = await client.call(
          'binary_frida_attach',
          {
            targetPath: BINARY_TARGET,
            deviceId: process.env.FRIDA_DEVICE_ID ?? 'local',
          },
          60_000,
        );
        expect(frida.result.status).not.toBe('FAIL');
      } else if (client.getToolMap().has('frida_attach')) {
        const frida = await client.call(
          'frida_attach',
          {
            targetPath: BINARY_TARGET,
            deviceId: process.env.FRIDA_DEVICE_ID ?? 'local',
          },
          60_000,
        );
        expect(frida.result.status).not.toBe('FAIL');
      }
    });
  },
);
