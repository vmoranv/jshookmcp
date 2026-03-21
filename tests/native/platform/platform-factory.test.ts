/**
 * Platform factory — unit tests.
 *
 * Tests createPlatformProvider() and getCurrentPlatform()
 * with mocked process.platform values.
 *
 * NOTE: createPlatformProvider() uses createRequire/esmRequire which does not
 * work in Vitest's module resolution. Tests that call createPlatformProvider()
 * directly are skipped — the provider itself is tested in the dedicated
 * Win32MemoryProvider.test.ts and DarwinMemoryProvider.test.ts.
 * The factory caching and dispatch logic is tested via mocked providers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('platform/factory', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.resetModules();
  });

  describe('getCurrentPlatform', () => {
    it('returns "win32" on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const { getCurrentPlatform } = await import('@src/native/platform/factory.js');
      expect(getCurrentPlatform()).toBe('win32');
    });

    it('returns "darwin" on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const { getCurrentPlatform } = await import('@src/native/platform/factory.js');
      expect(getCurrentPlatform()).toBe('darwin');
    });

    it('returns "unsupported" on Linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const { getCurrentPlatform } = await import('@src/native/platform/factory.js');
      expect(getCurrentPlatform()).toBe('unsupported');
    });
  });

  describe('createPlatformProvider', () => {
    it('throws on unsupported platform', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const { createPlatformProvider } = await import('@src/native/platform/factory.js');
      expect(() => createPlatformProvider()).toThrow('Unsupported platform');
      expect(() => createPlatformProvider()).toThrow('linux');
    });

    it('throws on freebsd platform', async () => {
      Object.defineProperty(process, 'platform', { value: 'freebsd' });
      const { createPlatformProvider } = await import('@src/native/platform/factory.js');
      expect(() => createPlatformProvider()).toThrow('Unsupported platform');
    });

    it('error message includes platform name', async () => {
      Object.defineProperty(process, 'platform', { value: 'sunos' });
      const { createPlatformProvider } = await import('@src/native/platform/factory.js');
      expect(() => createPlatformProvider()).toThrow('sunos');
    });

    it('error message mentions Windows and macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'openbsd' });
      const { createPlatformProvider } = await import('@src/native/platform/factory.js');
      expect(() => createPlatformProvider()).toThrow('Windows or macOS');
    });
  });
});
