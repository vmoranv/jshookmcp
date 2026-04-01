import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import type { CodeFile, PuppeteerConfig } from '@internal-types/index';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  connect: vi.fn(),
  findBrowserExecutable: vi.fn(),
  collectInnerImpl: vi.fn(),
  shouldCollectUrlImpl: vi.fn(),
  navigateWithRetryImpl: vi.fn(),
  getPerformanceMetricsImpl: vi.fn(),
  collectPageMetadataImpl: vi.fn(),
  calculatePriorityScore: vi.fn(),
  existsSync: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
}));

vi.mock('fs/promises', () => ({
  readFile: mocks.readFile,
}));

vi.mock('os', () => ({
  homedir: vi.fn(() => 'C:\\Users\\tester'),
}));

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    launch: mocks.launch,
    connect: mocks.connect,
  },
  launch: mocks.launch,
  connect: mocks.connect,
}));

vi.mock('@utils/browserExecutable', () => ({
  findBrowserExecutable: mocks.findBrowserExecutable,
}));

vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@modules/collector/CodeCollectorCollectInternal', () => ({
  collectInnerImpl: mocks.collectInnerImpl,
}));

vi.mock('@modules/collector/CodeCollectorUtilsInternal', () => ({
  shouldCollectUrlImpl: mocks.shouldCollectUrlImpl,
  navigateWithRetryImpl: mocks.navigateWithRetryImpl,
  getPerformanceMetricsImpl: mocks.getPerformanceMetricsImpl,
  collectPageMetadataImpl: mocks.collectPageMetadataImpl,
}));

vi.mock('@modules/collector/PageScriptCollectors', () => ({
  calculatePriorityScore: mocks.calculatePriorityScore,
}));

import { CodeCollector } from '@modules/collector/CodeCollector';

class TestCodeCollector extends CodeCollector {
  getUrls() {
    return this.collectedUrls;
  }

  getFiles() {
    return this.collectedFilesCache;
  }
}

function createBrowserMock(overrides: Record<string, any> = {}) {
  return {
    on: vi.fn(),
    targets: vi.fn().mockReturnValue([]),
    newPage: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    version: vi.fn().mockResolvedValue('Chrome/123'),
    process: vi.fn().mockReturnValue({ pid: 12345 }),
    ...overrides,
  } as any;
}

const defaultConfig: PuppeteerConfig = {
  headless: true,
  timeout: 1000,
};

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalLocalAppData = process.env.LOCALAPPDATA;
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform });
}

function seedFiles() {
  return new Map<string, CodeFile>([
    [
      'https://example.com/a.js',
      {
        url: 'https://example.com/a.js',
        size: 12,
        type: 'script',
        metadata: { truncated: true, originalSize: 24 },
      } as CodeFile,
    ],
    [
      'https://example.com/b.css',
      {
        url: 'https://example.com/b.css',
        size: 8,
        type: 'stylesheet',
      } as CodeFile,
    ],
    [
      'https://example.com/c.json',
      {
        url: 'https://example.com/c.json',
        size: 20,
        type: 'json',
      } as CodeFile,
    ],
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findBrowserExecutable.mockReturnValue(undefined);
  mocks.existsSync.mockReturnValue(false);
  delete process.env.LOCALAPPDATA;
  delete process.env.XDG_CONFIG_HOME;
});

afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
  if (originalLocalAppData === undefined) {
    delete process.env.LOCALAPPDATA;
  } else {
    process.env.LOCALAPPDATA = originalLocalAppData;
  }
  if (originalXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  }
});

describe('CodeCollector extra coverage', () => {
  it('covers collection state helpers and cache aggregation', async () => {
    const collector = new TestCodeCollector({
      ...defaultConfig,
      maxCollectedUrls: 4,
      maxResponseSize: 15,
    });

    collector.setCacheEnabled(false);
    expect(collector.cacheEnabled).toBe(false);

    const urls = collector.getUrls();
    ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].forEach((url) => urls.add(url));
    collector.getFiles().clear();
    for (const [url, file] of seedFiles()) {
      collector.getFiles().set(url, file);
    }

    mocks.calculatePriorityScore.mockImplementation((file: CodeFile) => {
      if (file.url.endsWith('c.json')) return 30;
      if (file.url.endsWith('a.js')) return 20;
      return 10;
    });

    collector.cleanupCollectedUrls();

    expect(Array.from(urls)).toEqual(['u5', 'u6']);
    expect(collector.getCollectionStats()).toEqual({
      totalCollected: 2,
      uniqueUrls: 2,
    });
    expect(collector.getCollectedFilesSummary()).toEqual([
      {
        url: 'https://example.com/a.js',
        size: 12,
        type: 'script',
        truncated: true,
        originalSize: 24,
      },
      {
        url: 'https://example.com/b.css',
        size: 8,
        type: 'stylesheet',
        truncated: undefined,
        originalSize: undefined,
      },
      {
        url: 'https://example.com/c.json',
        size: 20,
        type: 'json',
        truncated: undefined,
        originalSize: undefined,
      },
    ]);
    expect(collector.getFileByUrl('https://example.com/b.css')).toMatchObject({
      url: 'https://example.com/b.css',
      size: 8,
    });
    expect(collector.getFileByUrl('missing')).toBeNull();

    const matched = collector.getFilesByPattern('https://example\\.com', 2, 15);
    expect(matched).toMatchObject({
      matched: 3,
      returned: 1,
      truncated: true,
      totalSize: 12,
    });

    const top = collector.getTopPriorityFiles(2, 100);
    expect(top.totalFiles).toBe(3);
    expect(top.files.map((file) => file.url)).toEqual([
      'https://example.com/c.json',
      'https://example.com/a.js',
    ]);

    collector.clearCache();
    expect(Array.from(urls)).toEqual([]);

    collector.clearCollectedFilesCache();
    expect(collector.getFiles().size).toBe(0);
  });

  it('clears all data and reports cache/compressor stats', async () => {
    const collector = new TestCodeCollector({
      ...defaultConfig,
      maxCollectedUrls: 4,
    });

    collector.getUrls().add('https://example.com');
    collector
      .getFiles()
      .set('https://example.com/a.js', seedFiles().get('https://example.com/a.js')!);

    const cacheClearSpy = vi.spyOn(collector.getCache(), 'clear').mockResolvedValue(undefined);
    const cacheStatsSpy = vi.spyOn(collector.getCache(), 'getStats').mockResolvedValue({
      memoryEntries: 1,
      diskEntries: 2,
      totalSize: 3,
    });
    const compressor = collector.getCompressor();
    const compressorClearSpy = vi.spyOn(compressor, 'clearCache');
    const compressorResetSpy = vi.spyOn(compressor, 'resetStats');
    vi.spyOn(compressor, 'getStats').mockReturnValue({
      totalCompressed: 4,
      totalOriginalSize: 5,
      totalCompressedSize: 6,
      averageRatio: 7,
      cacheHits: 8,
      cacheMisses: 9,
      totalTime: 10,
    });
    vi.spyOn(compressor, 'getCacheSize').mockReturnValue(11);

    expect(await collector.getFileCacheStats()).toEqual({
      memoryEntries: 1,
      diskEntries: 2,
      totalSize: 3,
    });
    expect(cacheStatsSpy).toHaveBeenCalledTimes(1);

    const stats = await collector.getAllStats();
    expect(stats).toEqual({
      cache: {
        memoryEntries: 1,
        diskEntries: 2,
        totalSize: 3,
      },
      compression: {
        totalCompressed: 4,
        totalOriginalSize: 5,
        totalCompressedSize: 6,
        averageRatio: 7,
        cacheHits: 8,
        cacheMisses: 9,
        totalTime: 10,
        cacheSize: 11,
      },
      collector: {
        collectedUrls: 1,
        maxCollectedUrls: 4,
      },
    });

    await collector.clearFileCache();
    expect(cacheClearSpy).toHaveBeenCalledTimes(1);

    await collector.clearAllData();
    expect(compressorClearSpy).toHaveBeenCalledTimes(1);
    expect(compressorResetSpy).toHaveBeenCalledTimes(1);
    expect(collector.getUrls().size).toBe(0);
    expect(collector.getFiles().size).toBe(0);
  });

  it('resolves browser user data dirs, connect options, and error normalization branches', async () => {
    const collector = new CodeCollector(defaultConfig);
    const anyCollector = collector as any;

    setPlatform('win32');
    process.env.LOCALAPPDATA = 'C:\\Users\\tester\\AppData\\Local';
    expect(anyCollector.resolveDefaultChromeUserDataDir('stable')).toBe(
      join('C:\\Users\\tester\\AppData\\Local', 'Google', 'Chrome', 'User Data'),
    );
    expect(anyCollector.resolveDefaultChromeUserDataDir('beta')).toBe(
      join('C:\\Users\\tester\\AppData\\Local', 'Google', 'Chrome Beta', 'User Data'),
    );
    expect(anyCollector.resolveDefaultChromeUserDataDir('dev')).toBe(
      join('C:\\Users\\tester\\AppData\\Local', 'Google', 'Chrome Dev', 'User Data'),
    );
    expect(anyCollector.resolveDefaultChromeUserDataDir('canary')).toBe(
      join('C:\\Users\\tester\\AppData\\Local', 'Google', 'Chrome SxS', 'User Data'),
    );

    setPlatform('darwin');
    expect(anyCollector.resolveDefaultChromeUserDataDir('stable')).toBe(
      join('C:\\Users\\tester', 'Library', 'Application Support', 'Google', 'Chrome'),
    );
    expect(anyCollector.resolveDefaultChromeUserDataDir('beta')).toBe(
      join('C:\\Users\\tester', 'Library', 'Application Support', 'Google', 'Chrome Beta'),
    );
    expect(anyCollector.resolveDefaultChromeUserDataDir('dev')).toBe(
      join('C:\\Users\\tester', 'Library', 'Application Support', 'Google', 'Chrome Dev'),
    );
    expect(anyCollector.resolveDefaultChromeUserDataDir('canary')).toBe(
      join('C:\\Users\\tester', 'Library', 'Application Support', 'Google', 'Chrome Canary'),
    );

    setPlatform('linux');
    process.env.XDG_CONFIG_HOME = 'C:\\Users\\tester\\.config';
    expect(anyCollector.resolveDefaultChromeUserDataDir('stable')).toBe(
      join('C:\\Users\\tester\\.config', 'google-chrome'),
    );
    expect(anyCollector.resolveDefaultChromeUserDataDir('beta')).toBe(
      join('C:\\Users\\tester\\.config', 'google-chrome-beta'),
    );
    expect(anyCollector.resolveDefaultChromeUserDataDir('dev')).toBe(
      join('C:\\Users\\tester\\.config', 'google-chrome-unstable'),
    );
    expect(anyCollector.resolveDefaultChromeUserDataDir('canary')).toBe(
      join('C:\\Users\\tester\\.config', 'google-chrome-canary'),
    );

    mocks.readFile.mockResolvedValueOnce('9222\n/devtools/browser/abc\n');
    await expect(
      anyCollector.resolveAutoConnectWsEndpoint({ userDataDir: 'C:\\profiles\\chrome' }),
    ).resolves.toBe('ws://127.0.0.1:9222/devtools/browser/abc');

    mocks.readFile.mockResolvedValueOnce('9222\n');
    await expect(
      anyCollector.resolveAutoConnectWsEndpoint({ userDataDir: 'C:\\profiles\\chrome' }),
    ).rejects.toThrow('Invalid DevToolsActivePort contents');

    mocks.readFile.mockResolvedValueOnce('70000\n/devtools/browser/abc\n');
    await expect(
      anyCollector.resolveAutoConnectWsEndpoint({ userDataDir: 'C:\\profiles\\chrome' }),
    ).rejects.toThrow('Invalid remote debugging port');

    mocks.readFile.mockRejectedValueOnce(new Error('ENOENT'));
    await expect(
      anyCollector.resolveAutoConnectWsEndpoint({ userDataDir: 'C:\\profiles\\chrome' }),
    ).rejects.toThrow('Could not read DevToolsActivePort');

    mocks.readFile.mockResolvedValueOnce('9222\n/devtools/browser/abc\n');
    await expect(
      anyCollector.resolveConnectOptions('ws://127.0.0.1:9222/devtools/browser/abc'),
    ).resolves.toEqual({
      browserWSEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
    });
    await expect(anyCollector.resolveConnectOptions('http://127.0.0.1:9222')).resolves.toEqual({
      browserURL: 'http://127.0.0.1:9222',
    });
    await expect(
      anyCollector.resolveConnectOptions({ browserURL: 'http://127.0.0.1:9222' }),
    ).resolves.toEqual({
      browserURL: 'http://127.0.0.1:9222',
    });
    await expect(
      anyCollector.resolveConnectOptions({
        wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
      }),
    ).resolves.toEqual({
      browserWSEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
    });
    await expect(anyCollector.resolveConnectOptions('   ')).rejects.toThrow(
      'Connection endpoint cannot be empty.',
    );
    await expect(
      anyCollector.resolveConnectOptions({
        autoConnect: true,
        userDataDir: 'C:\\profiles\\chrome',
      }),
    ).resolves.toEqual({
      browserWSEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
    });
    mocks.readFile.mockResolvedValueOnce('9222\n/devtools/browser/abc\n');
    await expect(
      anyCollector.resolveConnectOptions({ channel: 'beta', userDataDir: 'C:\\profiles\\chrome' }),
    ).resolves.toEqual({
      browserWSEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
    });

    expect(anyCollector.getUnknownErrorMessage({ message: '  trimmed  ' })).toBe('trimmed');
    expect(anyCollector.getUnknownErrorMessage({ error: new Error('nested error') })).toBe(
      'nested error',
    );
    expect(anyCollector.getUnknownErrorMessage({ error: { message: ' nested message ' } })).toBe(
      'nested message',
    );
    expect(anyCollector.getUnknownErrorMessage({ data: 'value' })).toContain('"data":"value"');
    expect(anyCollector.getUnknownErrorMessage(null)).toBe('null');

    const friendly = anyCollector.normalizeConnectError(
      { message: 'connect ECONNREFUSED' },
      'auto-detected Chrome debugging endpoint',
      { userDataDir: 'C:\\profiles\\chrome' },
    );
    expect(friendly.message).toContain('Chrome is not currently listening');

    const timeoutAuto = anyCollector.buildConnectTimeoutError(
      'auto-detected Chrome debugging endpoint',
      { autoConnect: true },
    );
    expect(timeoutAuto.message).toContain('click Allow');

    const timeoutManual = anyCollector.buildConnectTimeoutError('ws://127.0.0.1:9222', {
      wsEndpoint: 'ws://127.0.0.1:9222',
    });
    expect(timeoutManual.message).toContain(
      'Verify that the browser debugging endpoint is reachable',
    );
  });

  it('rejects invalid configured executable paths and disconnects stale connect results', async () => {
    mocks.existsSync.mockReturnValue(false);
    const missingPathCollector = new CodeCollector({
      ...defaultConfig,
      executablePath: 'C:\\missing\\chrome.exe',
    });
    await expect(missingPathCollector.init()).rejects.toThrow(
      'Configured browser executable was not found',
    );
    expect(mocks.launch).not.toHaveBeenCalled();

    mocks.existsSync.mockReturnValue(true);
    const browser = createBrowserMock();
    mocks.launch.mockResolvedValue(browser);
    const configuredPathCollector = new CodeCollector({
      ...defaultConfig,
      executablePath: 'C:\\Chrome\\chrome.exe',
    });
    await configuredPathCollector.init();
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath: 'C:\\Chrome\\chrome.exe',
      }),
    );

    let resolveConnect!: (browser: any) => void;
    const lateBrowser = createBrowserMock();
    mocks.connect.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConnect = resolve;
        }),
    );

    const timedCollector = new CodeCollector(defaultConfig);
    (timedCollector as any).CONNECT_TIMEOUT_MS = 10;
    const connectPromise = timedCollector.connect({
      wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/test',
    });

    await expect(connectPromise).rejects.toThrow(/Timed out after 10ms/);
    resolveConnect(lateBrowser);
    await vi.waitFor(() => {
      expect(lateBrowser.disconnect).toHaveBeenCalledTimes(1);
    });
    expect(timedCollector.getBrowser()).toBeNull();
  });

  it('returns disconnected status when browser.version fails', async () => {
    const browser = createBrowserMock({
      version: vi.fn().mockRejectedValue(new Error('version failed')),
    });
    mocks.launch.mockResolvedValue(browser);

    const collector = new CodeCollector(defaultConfig);
    await collector.init();

    expect(await collector.getStatus()).toEqual({
      running: false,
      pagesCount: 0,
    });
  });
});
