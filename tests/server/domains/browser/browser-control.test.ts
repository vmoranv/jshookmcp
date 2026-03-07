import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { BrowserControlHandlers } from '@server/domains/browser/handlers/browser-control';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('BrowserControlHandlers monitoring refresh', () => {
  const collector = {
    connect: vi.fn(async () => {}),
    listPages: vi.fn(async () => []),
    selectPage: vi.fn(async () => {}),
    getStatus: vi.fn(async () => ({ connected: true })),
  } as any;

  const consoleMonitor = {
    disable: vi.fn(async () => {}),
    enable: vi.fn(async () => {}),
  } as any;

  const tabRegistry = {
    setCurrentByIndex: vi.fn((index: number) => ({ pageId: `page-${index}` })),
  } as any;

  const deps = {
    collector,
    pageController: {} as any,
    consoleMonitor,
    getActiveDriver: () => 'chrome' as const,
    getCamoufoxManager: () => null,
    getCamoufoxPage: async () => null,
    getTabRegistry: () => tabRegistry,
  };

  let handlers: BrowserControlHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new BrowserControlHandlers(deps);
  });

  it('refreshes monitoring after selecting a tab', async () => {
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: 'https://a.example', title: 'A' },
      { index: 1, url: 'https://b.example', title: 'B' },
    ]);

    const body = parseJson(await handlers.handleBrowserSelectTab({ index: 1 }));

    expect(collector.selectPage).toHaveBeenCalledWith(1);
    expect(consoleMonitor.disable).toHaveBeenCalledTimes(1);
    expect(consoleMonitor.enable).toHaveBeenCalledWith({
      enableNetwork: true,
      enableExceptions: true,
    });
    expect(body.selectedIndex).toBe(1);
    expect(body.networkMonitoringEnabled).toBe(true);
    expect(body.consoleMonitoringEnabled).toBe(true);
  });

  it('resets and re-enables monitoring after browser attach', async () => {
    collector.listPages.mockResolvedValueOnce([
      { index: 0, url: 'https://chat.qwen.ai', title: 'Qwen' },
    ]);

    const body = parseJson(
      await handlers.handleBrowserAttach({ browserURL: 'http://127.0.0.1:9222', pageIndex: 0 })
    );

    expect(collector.connect).toHaveBeenCalledWith('http://127.0.0.1:9222');
    expect(collector.selectPage).toHaveBeenCalledWith(0);
    expect(consoleMonitor.disable).toHaveBeenCalledTimes(1);
    expect(consoleMonitor.enable).toHaveBeenCalledWith({
      enableNetwork: true,
      enableExceptions: true,
    });
    expect(body.networkMonitoringEnabled).toBe(true);
    expect(body.consoleMonitoringEnabled).toBe(true);
    expect(body.currentUrl).toBe('https://chat.qwen.ai');
  });
});
