/**
 * Process Manager Module - Cross-platform process management
 *
 * Supports: Windows, Linux, macOS
 */

import { ProcessManager as WindowsProcessManager } from './ProcessManager.js';
import { LinuxProcessManager } from './LinuxProcessManager.js';
import { MacProcessManager } from './MacProcessManager.js';
import { logger } from '../../utils/logger.js';

// Re-export types
export type {
  ProcessInfo,
  WindowInfo,
  ChromiumProcess,
  TargetAppConfig,
} from './ProcessManager.js';
export { DEFAULT_CHROMIUM_CONFIG } from './ProcessManager.js';
export type { ChromeProcess as LinuxChromeProcess } from './LinuxProcessManager.js';
export type { ChromeProcess as MacChromeProcess } from './MacProcessManager.js';

// Export platform-specific implementations
export { WindowsProcessManager };
export { LinuxProcessManager };
export { MacProcessManager };

// Export Memory Manager
export {
  MemoryManager,
  type MemoryReadResult,
  type MemoryWriteResult,
  type MemoryScanResult,
} from './MemoryManager.js';

// Export utility functions for advanced memory operations
export {
  scanMemory,
  dumpMemory,
  listMemoryRegions,
  checkProtection,
  scanFiltered,
  batchWrite,
  startMonitor,
  stopMonitor,
  injectDll,
  injectShellcode,
  checkDebugPort,
  enumerateModules,
} from './memoryUtils.js';

export type Platform = 'win32' | 'linux' | 'darwin' | 'unknown';

/**
 * Detect current platform
 */
export function detectPlatform(): Platform {
  const platform = process.platform;

  switch (platform) {
    case 'win32':
      return 'win32';
    case 'linux':
      return 'linux';
    case 'darwin':
      return 'darwin';
    default:
      logger.warn(`Unsupported platform: ${platform}`);
      return 'unknown';
  }
}

/**
 * Create appropriate ProcessManager for current platform
 */
export function createProcessManager(): WindowsProcessManager | LinuxProcessManager | MacProcessManager {
  const platform = detectPlatform();

  logger.info(`Creating ProcessManager for platform: ${platform}`);

  switch (platform) {
    case 'win32':
      return new WindowsProcessManager();
    case 'linux':
      return new LinuxProcessManager();
    case 'darwin':
      return new MacProcessManager();
    default:
      throw new Error(`Unsupported platform: ${platform}. ProcessManager requires Windows, Linux, or macOS.`);
  }
}

/**
 * Check if process management is supported on current platform
 */
export function isProcessManagementSupported(): boolean {
  return detectPlatform() !== 'unknown';
}

/**
 * Unified interface for cross-platform process operations
 * This provides a common API regardless of the underlying platform
 */
export class UnifiedProcessManager {
  private manager: WindowsProcessManager | LinuxProcessManager | MacProcessManager;
  private platform: Platform;

  constructor() {
    this.platform = detectPlatform();
    this.manager = createProcessManager();
  }

  /**
   * Get current platform
   */
  getPlatform(): Platform {
    return this.platform;
  }

  /**
   * Find processes by name pattern
   */
  async findProcesses(pattern: string) {
    return this.manager.findProcesses(pattern);
  }

  /**
   * Get process by PID
   */
  async getProcessByPid(pid: number) {
    return this.manager.getProcessByPid(pid);
  }

  /**
   * Get windows for a process
   */
  async getProcessWindows(pid: number) {
    return this.manager.getProcessWindows(pid);
  }

  /**
   * Check debug port
   */
  async checkDebugPort(pid: number) {
    return this.manager.checkDebugPort(pid);
  }

  /**
   * Launch process with debug port
   */
  async launchWithDebug(executablePath: string, debugPort?: number, args?: string[]) {
    return this.manager.launchWithDebug(executablePath, debugPort, args);
  }

  /**
   * Kill process
   */
  async killProcess(pid: number) {
    return this.manager.killProcess(pid);
  }

  /**
   * Get process command line
   */
  async getProcessCommandLine(pid: number) {
    return this.manager.getProcessCommandLine(pid);
  }

  /**
   * Platform-specific: Find Chromium-based browser processes
   */
  async findBrowserProcesses(config?: { processNamePattern?: string; windowClassPattern?: string }) {
    if (this.platform === 'win32') {
      if (config?.processNamePattern || config?.windowClassPattern) {
        return (this.manager as WindowsProcessManager).findChromiumProcesses({
          processNamePattern: config.processNamePattern,
          windowClassPattern: config.windowClassPattern,
        });
      }
      return (this.manager as WindowsProcessManager).findChromiumAppProcesses();
    } else if (this.platform === 'linux') {
      return (this.manager as LinuxProcessManager).findChromeProcesses();
    } else if (this.platform === 'darwin') {
      return (this.manager as MacProcessManager).findChromeProcesses();
    }
    return null;
  }
}
