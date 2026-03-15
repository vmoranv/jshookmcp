import { beforeEach, describe, expect, it, vi } from 'vitest';

const { injectAllMock, setRealisticUserAgentMock } = vi.hoisted(() => ({
  injectAllMock: vi.fn(),
  setRealisticUserAgentMock: vi.fn(),
}));

vi.mock('@server/domains/shared/modules', () => ({
  StealthScripts: {
    injectAll: (...args: any[]) => injectAllMock(...args),
    setRealisticUserAgent: (...args: any[]) => setRealisticUserAgentMock(...args),
  },
}));

import { StealthInjectionHandlers } from '@server/domains/browser/handlers/stealth-injection';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('StealthInjectionHandlers', () => {
  const page = { id: 'page-1' } as any;
  const pageController = {
    getPage: vi.fn(),
  } as any;
  const getActiveDriver = vi.fn();

  let handlers: StealthInjectionHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController.getPage.mockResolvedValue(page);
    getActiveDriver.mockReturnValue('chrome');
    handlers = new StealthInjectionHandlers({ pageController, getActiveDriver });
  });

  it('skips JS stealth injection for camoufox', async () => {
    getActiveDriver.mockReturnValue('camoufox');

    const body = parseJson(await handlers.handleStealthInject({}));

    expect(pageController.getPage).not.toHaveBeenCalled();
    expect(injectAllMock).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
    expect(body.message).toContain('fingerprint spoofing');
  });

  it('injects stealth scripts for non-camoufox drivers', async () => {
    injectAllMock.mockResolvedValue(undefined);

    const body = parseJson(await handlers.handleStealthInject({}));

    expect(pageController.getPage).toHaveBeenCalledOnce();
    expect(injectAllMock).toHaveBeenCalledWith(page);
    expect(body).toEqual({
      success: true,
      message: 'Stealth scripts injected successfully',
    });
  });

  it('sets a realistic user agent and defaults platform to windows', async () => {
    setRealisticUserAgentMock.mockResolvedValue(undefined);

    const body = parseJson(await handlers.handleStealthSetUserAgent({}));

    expect(pageController.getPage).toHaveBeenCalledOnce();
    expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'windows');
    expect(body).toEqual({
      success: true,
      platform: 'windows',
      message: 'User-Agent set for windows',
    });
  });

  it('passes through the requested platform', async () => {
    setRealisticUserAgentMock.mockResolvedValue(undefined);

    const body = parseJson(await handlers.handleStealthSetUserAgent({ platform: 'linux' }));

    expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'linux');
    expect(body.platform).toBe('linux');
  });
});
