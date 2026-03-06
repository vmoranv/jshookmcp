import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ExtensionManagementHandlers } from '@server/domains/maintenance/handlers.extensions';

describe('ExtensionManagementHandlers', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    global.fetch = vi.fn(async (url: string | URL | Request) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ plugins: [], workflows: [] }),
      url: String(url),
    })) as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it('reads EXTENSION_REGISTRY_BASE_URL at call time instead of import time', async () => {
    delete process.env.EXTENSION_REGISTRY_BASE_URL;
    const handlers = new ExtensionManagementHandlers({} as any);

    process.env.EXTENSION_REGISTRY_BASE_URL = 'https://example.com/registry';
    const response = await handlers.handleBrowseExtensionRegistry('plugin');

    expect(global.fetch).toHaveBeenCalledWith('https://example.com/registry/plugins.index.json');
    expect(response.content[0].type).toBe('text');
    expect(response.content[0].text).toContain('"success": true');
  });
});
