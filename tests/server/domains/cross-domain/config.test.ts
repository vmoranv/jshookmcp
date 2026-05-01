import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { getCrossDomainConfig, resetConfigCache } from '@server/domains/cross-domain/config';

describe('CrossDomainConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetConfigCache();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return default config with sensible values', async () => {
    const config = getCrossDomainConfig();

    expect(config.fridaEnabled).toBe(true);
    expect(config.fridaServerHost).toBe('127.0.0.1');
    expect(config.fridaServerPort).toBe(27042);
    expect(config.ghidraEnabled).toBe(false);
    expect(config.ghidraHeadlessPath).toBeNull();
    expect(config.unidbgEnabled).toBe(false);
    expect(config.unidbgJarPath).toBeNull();
    expect(config.mojoEnabled).toBe(true);
    expect(config.boringsslEnabled).toBe(true);
    expect(['win32', 'linux', 'darwin']).toContain(config.platform);
  });

  it('should read Frida config from environment', async () => {
    process.env.FRIDA_ENABLED = 'false';
    process.env.FRIDA_SERVER_HOST = '192.168.1.100';
    process.env.FRIDA_SERVER_PORT = '27043';

    resetConfigCache();
    const config = getCrossDomainConfig();

    expect(config.fridaEnabled).toBe(false);
    expect(config.fridaServerHost).toBe('192.168.1.100');
    expect(config.fridaServerPort).toBe(27043);
  });

  it('should enable Ghidra when path is set', async () => {
    process.env.GHIDRA_HEADLESS_PATH = '/opt/ghidra/support/analyzeHeadless';

    resetConfigCache();
    const config = getCrossDomainConfig();

    expect(config.ghidraEnabled).toBe(true);
    expect(config.ghidraHeadlessPath).toBe('/opt/ghidra/support/analyzeHeadless');
  });

  it('should enable Unidbg when JAR path is set', async () => {
    process.env.UNIDBG_JAR_PATH = '/opt/unidbg/unidbg-android.jar';

    resetConfigCache();
    const config = getCrossDomainConfig();

    expect(config.unidbgEnabled).toBe(true);
    expect(config.unidbgJarPath).toBe('/opt/unidbg/unidbg-android.jar');
  });

  it('should cache config for repeated calls', async () => {
    const first = getCrossDomainConfig();
    const second = getCrossDomainConfig();
    expect(first).toBe(second); // Same reference
  });

  it('should disable ETW on non-Windows platforms', async () => {
    // Platform is read-only from process.platform, so this test just documents behavior
    const config = getCrossDomainConfig();
    if (process.platform !== 'win32') {
      expect(config.etwEnabled).toBe(false);
    }
  });
});
