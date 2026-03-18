import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageNavigationHandlers } from '@server/domains/browser/handlers/page-navigation';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('PageNavigationHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not claim captcha_detected for chrome navigation without running detection', async () => {
    const pageController = {
      navigate: vi.fn(async () => ({
        url: 'https://target.example',
        title: 'Target',
        loadTime: 12,
      })),
      getURL: vi.fn(async () => 'https://target.example'),
      getTitle: vi.fn(async () => 'Target'),
    } as any;

    const consoleMonitor = {
      enable: vi.fn(async () => {}),
      isNetworkEnabled: vi.fn(() => false),
      setPlaywrightPage: vi.fn(),
    } as any;

    const handlers = new PageNavigationHandlers({
      pageController,
      consoleMonitor,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });

    const body = parseJson(await handlers.handlePageNavigate({ url: 'https://target.example' }));

    expect(body.success).toBe(true);
    expect(body.url).toBe('https://target.example');
    expect(body).not.toHaveProperty('captcha_detected');
  });

  it('does not claim captcha_detected for camoufox navigation without running detection', async () => {
    const page = {
      goto: vi.fn(async () => {}),
      url: vi.fn(() => 'https://target.example'),
      title: vi.fn(async () => 'Camoufox Target'),
    };

    const consoleMonitor = {
      enable: vi.fn(async () => {}),
      isNetworkEnabled: vi.fn(() => false),
      setPlaywrightPage: vi.fn(),
    } as any;

    const handlers = new PageNavigationHandlers({
      pageController: {} as any,
      consoleMonitor,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => page,
    });

    const body = parseJson(await handlers.handlePageNavigate({ url: 'https://target.example' }));

    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
    expect(body.url).toBe('https://target.example');
    expect(body).not.toHaveProperty('captcha_detected');
  });
});
