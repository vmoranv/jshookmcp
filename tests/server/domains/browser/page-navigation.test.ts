import { parseJson, BrowserStatusResponse } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageNavigationHandlers } from '@server/domains/browser/handlers/page-navigation';



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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const consoleMonitor = {
      enable: vi.fn(async () => {}),
      isNetworkEnabled: vi.fn(() => false),
      setPlaywrightPage: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const handlers = new PageNavigationHandlers({
      pageController,
      consoleMonitor,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });

    const body = parseJson<BrowserStatusResponse>(await handlers.handlePageNavigate({ url: 'https://target.example' }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const handlers = new PageNavigationHandlers({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController: {} as any,
      consoleMonitor,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => page,
    });

    const body = parseJson<BrowserStatusResponse>(await handlers.handlePageNavigate({ url: 'https://target.example' }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.driver).toBe('camoufox');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.url).toBe('https://target.example');
    expect(body).not.toHaveProperty('captcha_detected');
  });
});
