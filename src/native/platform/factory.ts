/**
 * Platform factory — auto-selects the correct PlatformMemoryAPI implementation
 * based on the current operating system.
 *
 * Uses createRequire for lazy-loading platform providers in ESM context.
 * This prevents loading Win32 DLLs on macOS and vice versa.
 *
 * Usage:
 *   const provider = createPlatformProvider();
 *   const handle = provider.openProcess(pid, false);
 *
 * @module platform/factory
 */

import { createRequire } from 'module';
import type { PlatformMemoryAPI } from './PlatformMemoryAPI.js';

const esmRequire = createRequire(import.meta.url);

let cachedProvider: PlatformMemoryAPI | null = null;

/**
 * Create and cache the platform-appropriate memory provider.
 * Returns Win32MemoryProvider on Windows, DarwinMemoryProvider on macOS.
 * Throws on unsupported platforms.
 */
export function createPlatformProvider(): PlatformMemoryAPI {
  if (cachedProvider) return cachedProvider;

  switch (process.platform) {
    case 'win32': {
      // Lazy import to avoid loading Win32 DLLs on macOS
      const { Win32MemoryProvider } = esmRequire('./win32/Win32MemoryProvider.js');
      cachedProvider = new Win32MemoryProvider();
      break;
    }
    case 'darwin': {
      // Lazy import to avoid loading macOS libraries on Windows
      const { DarwinMemoryProvider } = esmRequire('./darwin/DarwinMemoryProvider.js');
      cachedProvider = new DarwinMemoryProvider();
      break;
    }
    default:
      throw new Error(
        `Unsupported platform: ${process.platform}. Memory operations require Windows or macOS.`
      );
  }

  if (!cachedProvider) throw new Error('Failed to create memory provider');
  return cachedProvider;
}

/** Get the current platform name */
export function getCurrentPlatform(): 'win32' | 'darwin' | 'unsupported' {
  if (process.platform === 'win32') return 'win32';
  if (process.platform === 'darwin') return 'darwin';
  return 'unsupported';
}

