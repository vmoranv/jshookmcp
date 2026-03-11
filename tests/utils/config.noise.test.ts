import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('config env loading noise', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.DEBUG;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does not warn when .env is missing and config is loaded lazily', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { getConfig } = await import('@utils/config');
    getConfig();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
