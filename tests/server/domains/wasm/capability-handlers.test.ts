import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityHandlers } from '@server/domains/wasm/handlers/capability-handlers';

function createState(overrides: Record<string, unknown> = {}) {
  return {
    collector: {
      getActivePage: vi.fn().mockResolvedValue(null),
    },
    runner: {
      probeAll: vi.fn().mockResolvedValue({
        'wabt.wasm2wat': { available: true, path: '/usr/bin/wasm2wat', version: '1.0.0' },
        'wabt.wasm-decompile': { available: false, reason: 'missing' },
        'wabt.wasm-objdump': { available: true, path: '/usr/bin/wasm-objdump' },
        'binaryen.wasm-opt': { available: false, reason: 'missing' },
        'runtime.wasmtime': { available: false, reason: 'missing' },
        'runtime.wasmer': { available: true, path: '/usr/bin/wasmer', version: '4.0.0' },
      }),
    },
    ...overrides,
  } as any;
}

describe('CapabilityHandlers', () => {
  it('reports current page and external tool availability', async () => {
    const handlers = new CapabilityHandlers(createState());
    const parsed = parseJson<any>(await handlers.handleWasmCapabilities());

    expect(parsed.success).toBe(true);
    expect(parsed.tool).toBe('wasm_capabilities');
    expect(parsed.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'wasm_browser_capture_current_page',
          available: false,
        }),
        expect.objectContaining({
          capability: 'wabt_wasm2wat',
          available: true,
        }),
        expect.objectContaining({
          capability: 'wasm_offline_runtime',
          available: true,
        }),
      ]),
    );
  });

  it('reports browser capture as available when the current page exposes WASM state', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        url: 'https://example.test/wasm',
        hookEventCount: 4,
        instantiatedCount: 1,
        importCallCount: 2,
        memoryEventCount: 1,
        storageCount: 1,
        instanceCount: 1,
      }),
    };
    const handlers = new CapabilityHandlers(
      createState({
        collector: {
          getActivePage: vi.fn().mockResolvedValue(page),
        },
      }),
    );

    const parsed = parseJson<any>(await handlers.handleWasmCapabilities());
    const currentPage = parsed.capabilities.find(
      (entry: { capability: string }) => entry.capability === 'wasm_browser_capture_current_page',
    );

    expect(currentPage).toMatchObject({
      available: true,
      pageAttached: true,
      url: 'https://example.test/wasm',
      instantiatedCount: 1,
    });
  });
});
