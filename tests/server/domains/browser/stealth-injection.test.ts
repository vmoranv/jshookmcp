import { parseJson, BrowserStatusResponse } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { injectAllMock, setRealisticUserAgentMock } = vi.hoisted(() => ({
  injectAllMock: vi.fn(),
  setRealisticUserAgentMock: vi.fn(),
}));

vi.mock('@server/domains/shared/modules', () => ({
  StealthScripts: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    injectAll: (...args: any[]) => injectAllMock(...args),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    setRealisticUserAgent: (...args: any[]) => setRealisticUserAgentMock(...args),
  },
}));

import { StealthInjectionHandlers } from '@server/domains/browser/handlers/stealth-injection';



describe('StealthInjectionHandlers', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const page = { id: 'page-1' } as any;
  const pageController = {
    getPage: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;
  const getActiveDriver = vi.fn();

  let handlers: StealthInjectionHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pageController.getPage.mockResolvedValue(page);
    getActiveDriver.mockReturnValue('chrome');
    handlers = new StealthInjectionHandlers({ pageController, getActiveDriver });
  });

  it('skips JS stealth injection for camoufox', async () => {
    getActiveDriver.mockReturnValue('camoufox');

    const body = parseJson<BrowserStatusResponse>(await handlers.handleStealthInject({}));

    expect(pageController.getPage).not.toHaveBeenCalled();
    expect(injectAllMock).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.driver).toBe('camoufox');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('fingerprint spoofing');
  });

  it('injects stealth scripts for non-camoufox drivers', async () => {
    injectAllMock.mockResolvedValue(undefined);

    const body = parseJson<BrowserStatusResponse>(await handlers.handleStealthInject({}));

    expect(pageController.getPage).toHaveBeenCalledOnce();
    expect(injectAllMock).toHaveBeenCalledWith(page);
    expect(body).toMatchObject({
      success: true,
      message: 'Stealth scripts injected successfully',
      fingerprintApplied: false,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body._nextStepHint).toBeDefined();
  });

  it('sets a realistic user agent and defaults platform to windows', async () => {
    setRealisticUserAgentMock.mockResolvedValue(undefined);

    const body = parseJson<BrowserStatusResponse>(await handlers.handleStealthSetUserAgent({}));

    expect(pageController.getPage).toHaveBeenCalledOnce();
    expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'windows');
    expect(body).toMatchObject({
      success: true,
      platform: 'windows',
      message: 'User-Agent set for windows',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body._nextStepHint).toBeDefined();
  });

  it('passes through the requested platform', async () => {
    setRealisticUserAgentMock.mockResolvedValue(undefined);

    const body = parseJson<BrowserStatusResponse>(await handlers.handleStealthSetUserAgent({ platform: 'linux' }));

    expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'linux');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.platform).toBe('linux');
  });
});
