import { beforeEach, describe, expect, it, vi } from 'vitest';

const launchMock = vi.hoisted(() => vi.fn());
const connectMock = vi.hoisted(() => vi.fn());
const findBrowserExecutableMock = vi.hoisted(() => vi.fn());

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    launch: launchMock,
    connect: connectMock,
  },
}));

vi.mock('../../../src/utils/browserExecutable.js', () => ({
  findBrowserExecutable: findBrowserExecutableMock,
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { CodeCollector } from '../../../src/modules/collector/CodeCollector.js';

function createBrowserMock() {
  return {
    on: vi.fn(),
    pages: vi.fn().mockResolvedValue([]),
    newPage: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    version: vi.fn().mockResolvedValue('Chrome/123'),
  } as any;
}

describe('CodeCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findBrowserExecutableMock.mockReturnValue(undefined);
  });

  it('initializes browser and reports running status', async () => {
    const browser = createBrowserMock();
    launchMock.mockResolvedValue(browser);

    const collector = new CodeCollector({ headless: true, timeout: 1000 } as any);
    await collector.init();

    expect(launchMock).toHaveBeenCalledTimes(1);
    await expect(collector.getStatus()).resolves.toMatchObject({
      running: true,
      pagesCount: 0,
      effectiveHeadless: true,
    });
  });

  it('throws when configured executablePath does not exist', async () => {
    const collector = new CodeCollector({
      headless: true,
      timeout: 1000,
      executablePath: 'C:\\definitely-not-existing\\chrome.exe',
    } as any);

    await expect(collector.init()).rejects.toThrow('Configured browser executable was not found');
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('filters URLs against wildcard rules', () => {
    const collector = new CodeCollector({ headless: true, timeout: 1000 } as any);

    expect(collector.shouldCollectUrl('https://example.com/app.js', ['*example.com/*'])).toBe(true);
    expect(collector.shouldCollectUrl('https://cdn.other.com/lib.js', ['*example.com/*'])).toBe(
      false
    );
  });

  it('retries navigation until success', async () => {
    const collector = new CodeCollector({ headless: true, timeout: 1000 } as any);
    const page = {
      goto: vi
        .fn()
        .mockRejectedValueOnce(new Error('temporary'))
        .mockResolvedValueOnce(undefined),
    } as any;

    await expect(
      collector.navigateWithRetry(page, 'https://example.com', { waitUntil: 'load' }, 3)
    ).resolves.toBeUndefined();
    expect(page.goto).toHaveBeenCalledTimes(2);
  });

  it('throws last navigation error after max retries', async () => {
    const collector = new CodeCollector({ headless: true, timeout: 1000 } as any);
    const page = { goto: vi.fn().mockRejectedValue(new Error('fatal')) } as any;

    await expect(
      collector.navigateWithRetry(page, 'https://example.com', { waitUntil: 'load' }, 2)
    ).rejects.toThrow('fatal');
    expect(page.goto).toHaveBeenCalledTimes(2);
  });

  it('returns pattern-matched files with size limits and truncation flag', () => {
    const collector = new CodeCollector({ headless: true, timeout: 1000 } as any);
    (collector as any).collectedFilesCache = new Map([
      ['https://site/a.js', { url: 'https://site/a.js', content: 'a'.repeat(10), size: 10, type: 'external' }],
      ['https://site/b.js', { url: 'https://site/b.js', content: 'b'.repeat(10), size: 10, type: 'external' }],
      ['https://site/c.css', { url: 'https://site/c.css', content: 'c', size: 1, type: 'external' }],
    ]);

    const result = collector.getFilesByPattern('\\.js$', 3, 15);
    expect(result.matched).toBe(2);
    expect(result.returned).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.totalSize).toBe(10);
  });

  it('returns top priority files ordered by scoring helper', () => {
    const collector = new CodeCollector({ headless: true, timeout: 1000 } as any);
    (collector as any).collectedFilesCache = new Map([
      [
        'https://site/vendor.js',
        { url: 'https://site/vendor.js', content: 'noop', size: 2000, type: 'external' },
      ],
      [
        'https://site/crypto-api-main.js',
        {
          url: 'https://site/crypto-api-main.js',
          content: 'fetch("/x"); const cipher = "aes";',
          size: 800,
          type: 'inline',
        },
      ],
    ]);

    const result = collector.getTopPriorityFiles(1, 100_000);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.url).toContain('crypto-api-main.js');
  });
});

