/**
 * Platform factory — unit tests.
 *
 * Tests createPlatformProvider() and getCurrentPlatform()
 * with mocked process.platform values.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { MockWin32Provider, MockDarwinProvider, MockLinuxProvider } = vi.hoisted(() => {
  return {
    MockWin32Provider: class {
      mock = true;
    },
    MockDarwinProvider: class {
      mock = true;
    },
    MockLinuxProvider: class {
      mock = true;
    },
  };
});

vi.mock('@src/native/platform/win32/Win32MemoryProvider.js', () => ({
  Win32MemoryProvider: MockWin32Provider,
}));

vi.mock('@src/native/platform/darwin/DarwinMemoryProvider.js', () => ({
  DarwinMemoryProvider: MockDarwinProvider,
}));

vi.mock('@src/native/platform/linux/LinuxMemoryProvider.impl.js', () => ({
  LinuxMemoryProvider: MockLinuxProvider,
}));

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

    it('returns "linux" on Linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const { getCurrentPlatform } = await import('@src/native/platform/factory.js');
      expect(getCurrentPlatform()).toBe('linux');
    });
  });

  describe('createPlatformProvider', () => {
    it('creates and caches the win32 provider', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const { createPlatformProvider } = await import('@src/native/platform/factory.js');

      const first = createPlatformProvider();
      const second = createPlatformProvider();

      expect(first).toBeInstanceOf(MockWin32Provider);
      expect(second).toBe(first);
    });

    it('creates and caches the darwin provider', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const { createPlatformProvider } = await import('@src/native/platform/factory.js');

      const first = createPlatformProvider();
      const second = createPlatformProvider();

      expect(first).toBeInstanceOf(MockDarwinProvider);
      expect(second).toBe(first);
    });

    it('creates and caches the linux provider', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const { createPlatformProvider } = await import('@src/native/platform/factory.js');

      const first = createPlatformProvider();
      const second = createPlatformProvider();

      expect(first).toBeInstanceOf(MockLinuxProvider);
      expect(second).toBe(first);
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

    it('error message mentions supported platforms', async () => {
      Object.defineProperty(process, 'platform', { value: 'openbsd' });
      const { createPlatformProvider } = await import('@src/native/platform/factory.js');
      expect(() => createPlatformProvider()).toThrow('Windows, macOS, or Linux');
    });
  });
});
