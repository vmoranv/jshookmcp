import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  WindowsProcessManager: vi.fn(),
  LinuxProcessManager: vi.fn(),
  MacProcessManager: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@modules/process/ProcessManager', () => ({
  ProcessManager: mocks.WindowsProcessManager,
  DEFAULT_CHROMIUM_CONFIG: { processNamePattern: 'chrome' },
}));

vi.mock('@modules/process/LinuxProcessManager', () => ({
  LinuxProcessManager: mocks.LinuxProcessManager,
}));

vi.mock('@modules/process/MacProcessManager', () => ({
  MacProcessManager: mocks.MacProcessManager,
}));

vi.mock('@modules/process/MemoryManager', () => ({
  MemoryManager: vi.fn(),
}));

vi.mock('@modules/process/memoryUtils', () => ({
  scanMemory: vi.fn(),
  dumpMemory: vi.fn(),
  listMemoryRegions: vi.fn(),
  checkProtection: vi.fn(),
  scanFiltered: vi.fn(),
  batchWrite: vi.fn(),
  startMonitor: vi.fn(),
  stopMonitor: vi.fn(),
  injectDll: vi.fn(),
  injectShellcode: vi.fn(),
  checkDebugPort: vi.fn(),
  enumerateModules: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: mocks.logger,
}));

describe('modules/process/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('detectPlatform', () => {
    it('returns win32 on Windows', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const { detectPlatform } = await import('@modules/process/index');
      expect(detectPlatform()).toBe('win32');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('returns linux on Linux', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const { detectPlatform } = await import('@modules/process/index');
      expect(detectPlatform()).toBe('linux');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('returns darwin on macOS', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      const { detectPlatform } = await import('@modules/process/index');
      expect(detectPlatform()).toBe('darwin');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('returns unknown for unsupported platforms', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });

      const { detectPlatform } = await import('@modules/process/index');
      expect(detectPlatform()).toBe('unknown');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });

  describe('createProcessManager', () => {
    it('creates WindowsProcessManager on win32', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const { createProcessManager } = await import('@modules/process/index');
      const manager = createProcessManager();
      expect(mocks.WindowsProcessManager).toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('creates LinuxProcessManager on linux', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      mocks.LinuxProcessManager.mockImplementation(function () {});

      const { createProcessManager } = await import('@modules/process/index');
      createProcessManager();
      expect(mocks.LinuxProcessManager).toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('creates MacProcessManager on darwin', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      mocks.MacProcessManager.mockImplementation(function () {});

      const { createProcessManager } = await import('@modules/process/index');
      createProcessManager();
      expect(mocks.MacProcessManager).toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('throws on unsupported platform', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });

      const { createProcessManager } = await import('@modules/process/index');
      expect(() => createProcessManager()).toThrow('Unsupported platform');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });

  describe('isProcessManagementSupported', () => {
    it('returns true on supported platforms', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const { isProcessManagementSupported } = await import('@modules/process/index');
      expect(isProcessManagementSupported()).toBe(true);

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('returns false on unsupported platforms', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });

      const { isProcessManagementSupported } = await import('@modules/process/index');
      expect(isProcessManagementSupported()).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });

  describe('UnifiedProcessManager', () => {
    it('initializes with current platform manager', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const mockFindProcesses = vi.fn().mockResolvedValue([]);
      const mockGetProcessByPid = vi.fn().mockResolvedValue(null);
      const mockGetProcessWindows = vi.fn().mockResolvedValue([]);
      const mockCheckDebugPort = vi.fn().mockResolvedValue(null);
      const mockLaunchWithDebug = vi.fn().mockResolvedValue({});
      const mockKillProcess = vi.fn().mockResolvedValue(true);
      const mockGetProcessCommandLine = vi.fn().mockResolvedValue('');
      const mockFindChromiumAppProcesses = vi.fn().mockResolvedValue([]);
      const mockFindChromiumProcesses = vi.fn().mockResolvedValue([]);

      mocks.WindowsProcessManager.mockImplementation(function (this: Record<string, unknown>) {
        this.findProcesses = mockFindProcesses;
        this.getProcessByPid = mockGetProcessByPid;
        this.getProcessWindows = mockGetProcessWindows;
        this.checkDebugPort = mockCheckDebugPort;
        this.launchWithDebug = mockLaunchWithDebug;
        this.killProcess = mockKillProcess;
        this.getProcessCommandLine = mockGetProcessCommandLine;
        this.findChromiumAppProcesses = mockFindChromiumAppProcesses;
        this.findChromiumProcesses = mockFindChromiumProcesses;
      });

      const { UnifiedProcessManager } = await import('@modules/process/index');
      const upm = new UnifiedProcessManager();

      expect(upm.getPlatform()).toBe('win32');

      await upm.findProcesses('test');
      expect(mockFindProcesses).toHaveBeenCalledWith('test');

      await upm.getProcessByPid(1234);
      expect(mockGetProcessByPid).toHaveBeenCalledWith(1234);

      await upm.getProcessWindows(1234);
      expect(mockGetProcessWindows).toHaveBeenCalledWith(1234);

      await upm.checkDebugPort(1234, { commandLine: 'test' });
      expect(mockCheckDebugPort).toHaveBeenCalledWith(1234, { commandLine: 'test' });

      await upm.launchWithDebug('/path/to/exe', 9222, ['--arg']);
      expect(mockLaunchWithDebug).toHaveBeenCalledWith('/path/to/exe', 9222, ['--arg']);

      await upm.killProcess(1234);
      expect(mockKillProcess).toHaveBeenCalledWith(1234);

      await upm.getProcessCommandLine(1234);
      expect(mockGetProcessCommandLine).toHaveBeenCalledWith(1234);

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('findBrowserProcesses uses Windows-specific methods on win32', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const mockFindChromiumAppProcesses = vi.fn().mockResolvedValue([{ pid: 1 }]);
      const mockFindChromiumProcesses = vi.fn().mockResolvedValue([{ pid: 2 }]);

      mocks.WindowsProcessManager.mockImplementation(function (this: Record<string, unknown>) {
        this.findProcesses = vi.fn();
        this.getProcessByPid = vi.fn();
        this.getProcessWindows = vi.fn();
        this.checkDebugPort = vi.fn();
        this.launchWithDebug = vi.fn();
        this.killProcess = vi.fn();
        this.getProcessCommandLine = vi.fn();
        this.findChromiumAppProcesses = mockFindChromiumAppProcesses;
        this.findChromiumProcesses = mockFindChromiumProcesses;
      });

      const { UnifiedProcessManager } = await import('@modules/process/index');
      const upm = new UnifiedProcessManager();

      // Without config, uses findChromiumAppProcesses
      const result1 = await upm.findBrowserProcesses();
      expect(mockFindChromiumAppProcesses).toHaveBeenCalled();

      // With config, uses findChromiumProcesses
      const result2 = await upm.findBrowserProcesses({ processNamePattern: 'chrome' });
      expect(mockFindChromiumProcesses).toHaveBeenCalledWith({
        processNamePattern: 'chrome',
        windowClassPattern: undefined,
      });

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('findBrowserProcesses uses Linux-specific methods on linux', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const mockFindChromeProcesses = vi.fn().mockResolvedValue([]);

      mocks.LinuxProcessManager.mockImplementation(function (this: Record<string, unknown>) {
        this.findProcesses = vi.fn();
        this.getProcessByPid = vi.fn();
        this.getProcessWindows = vi.fn();
        this.checkDebugPort = vi.fn();
        this.launchWithDebug = vi.fn();
        this.killProcess = vi.fn();
        this.getProcessCommandLine = vi.fn();
        this.findChromeProcesses = mockFindChromeProcesses;
      });

      const { UnifiedProcessManager } = await import('@modules/process/index');
      const upm = new UnifiedProcessManager();

      await upm.findBrowserProcesses();
      expect(mockFindChromeProcesses).toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });

  describe('exports', () => {
    it('re-exports all expected symbols', async () => {
      const mod = await import('@modules/process/index');
      expect(mod.WindowsProcessManager).toBeDefined();
      expect(mod.LinuxProcessManager).toBeDefined();
      expect(mod.MacProcessManager).toBeDefined();
      expect(mod.MemoryManager).toBeDefined();
      expect(mod.DEFAULT_CHROMIUM_CONFIG).toBeDefined();
      expect(mod.detectPlatform).toBeTypeOf('function');
      expect(mod.createProcessManager).toBeTypeOf('function');
      expect(mod.isProcessManagementSupported).toBeTypeOf('function');
      expect(mod.UnifiedProcessManager).toBeTypeOf('function');
      // Memory utility exports
      expect(mod.scanMemory).toBeDefined();
      expect(mod.dumpMemory).toBeDefined();
      expect(mod.listMemoryRegions).toBeDefined();
      expect(mod.checkProtection).toBeDefined();
      expect(mod.scanFiltered).toBeDefined();
      expect(mod.batchWrite).toBeDefined();
      expect(mod.startMonitor).toBeDefined();
      expect(mod.stopMonitor).toBeDefined();
      expect(mod.injectDll).toBeDefined();
      expect(mod.injectShellcode).toBeDefined();
      expect(mod.checkDebugPort).toBeDefined();
      expect(mod.enumerateModules).toBeDefined();
    });
  });
});
