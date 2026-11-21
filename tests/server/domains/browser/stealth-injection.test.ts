import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { injectAllMock, setRealisticUserAgentMock } = vi.hoisted(() => ({
  injectAllMock: vi.fn(),
  setRealisticUserAgentMock: vi.fn(),
}));

vi.mock('@modules/stealth/StealthScripts', () => ({
  StealthScripts: {
    injectAll: (...args: any[]) => injectAllMock(...args),
    setRealisticUserAgent: (...args: any[]) => setRealisticUserAgentMock(...args),
  },
}));

import { StealthInjectionHandlers } from '@server/domains/browser/handlers/stealth-injection';

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

    const body = parseJson<BrowserStatusResponse>(await handlers.handleStealthInject({}));

    expect(pageController.getPage).not.toHaveBeenCalled();
    expect(injectAllMock).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
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
    expect(body._nextStepHint).toBeDefined();
  });

  it('returns patchManifest listing all injected APIs', async () => {
    injectAllMock.mockResolvedValue(undefined);

    const body = parseJson<Record<string, unknown>>(await handlers.handleStealthInject({})) as any;

    expect(body.patchManifest).toBeDefined();
    expect(Array.isArray(body.patchManifest)).toBe(true);
    expect(body.patchManifest.length).toBeGreaterThanOrEqual(10);
    expect(body.patchManifest[0]).toMatchObject({
      api: expect.any(String),
      method: expect.any(String),
    });
    // Verify known critical patches are present
    const apis = body.patchManifest.map((p: any) => p.api);
    expect(apis).toContain('navigator.webdriver');
    expect(apis).toContain('window.chrome');
    expect(apis).toContain('performance.now / Date.now');
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
    expect(body._nextStepHint).toBeDefined();
  });

  it('passes through the requested platform', async () => {
    setRealisticUserAgentMock.mockResolvedValue(undefined);

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleStealthSetUserAgent({ platform: 'linux' }),
    );

    expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'linux');
    expect(body.platform).toBe('linux');
  });
});
