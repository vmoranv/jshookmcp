import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Platform, StealthInjectResponse, StealthSetUserAgentResponse } from './stealth-test-utils';
import { expectNextStepHint, parseJson } from './stealth-test-utils';

import { StealthInjectionHandlers } from '@server/domains/browser/handlers/stealth-injection';

type StealthDeps = ConstructorParameters<typeof StealthInjectionHandlers>[0];
type PageControllerStub = Pick<StealthDeps['pageController'], 'getPage'>;
type TestPage = Awaited<ReturnType<PageControllerStub['getPage']>>;
type InjectAllFn = (page: TestPage) => Promise<void>;
type SetRealisticUserAgentFn = (page: TestPage, platform: Platform) => Promise<void>;

const { injectAllMock, setRealisticUserAgentMock } = vi.hoisted(() => ({
  injectAllMock: vi.fn<InjectAllFn>(),
  setRealisticUserAgentMock: vi.fn<SetRealisticUserAgentFn>(),
}));

vi.mock('@server/domains/shared/modules', () => ({
  StealthScripts: {
    injectAll: (page: TestPage) => injectAllMock(page),
    setRealisticUserAgent: (page: TestPage, platform: Platform) =>
      setRealisticUserAgentMock(page, platform),
  },
}));

describe('StealthInjectionHandlers', () => {
  const page = { id: 'page-1' } as unknown as TestPage;
  const getPageMock = vi.fn<PageControllerStub['getPage']>();
  const pageController = {
    getPage: getPageMock,
  } satisfies PageControllerStub;
  const getActiveDriver = vi.fn<StealthDeps['getActiveDriver']>();

  let handlers: StealthInjectionHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    getPageMock.mockResolvedValue(page);
    getActiveDriver.mockReturnValue('chrome');
    handlers = new StealthInjectionHandlers({
      pageController: pageController as unknown as StealthDeps['pageController'],
      getActiveDriver,
    });
  });

  it('skips JS stealth injection for camoufox', async () => {
    getActiveDriver.mockReturnValue('camoufox');

    const body = parseJson<StealthInjectResponse>(await handlers.handleStealthInject({}));

    expect(pageController.getPage).not.toHaveBeenCalled();
    expect(injectAllMock).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
    expect(body.message).toContain('fingerprint spoofing');
  });

  it('injects stealth scripts for non-camoufox drivers', async () => {
    injectAllMock.mockResolvedValue(undefined);

    const body = parseJson<StealthInjectResponse>(await handlers.handleStealthInject({}));

    expect(pageController.getPage).toHaveBeenCalledOnce();
    expect(injectAllMock).toHaveBeenCalledWith(page);
    expect(body).toMatchObject({
      success: true,
      message: 'Stealth scripts injected successfully',
      fingerprintApplied: false,
    });
    expectNextStepHint(body, 'page_navigate');
  });

  it('sets a realistic user agent and defaults platform to windows', async () => {
    setRealisticUserAgentMock.mockResolvedValue(undefined);

    const body = parseJson<StealthSetUserAgentResponse>(
      await handlers.handleStealthSetUserAgent({})
    );

    expect(pageController.getPage).toHaveBeenCalledOnce();
    expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'windows');
    expect(body).toMatchObject({
      success: true,
      platform: 'windows',
      message: 'User-Agent set for windows',
    });
    expectNextStepHint(body, 'stealth_inject');
  });

  it('passes through the requested platform', async () => {
    setRealisticUserAgentMock.mockResolvedValue(undefined);

    const body = parseJson<StealthSetUserAgentResponse>(
      await handlers.handleStealthSetUserAgent({ platform: 'linux' })
    );

    expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'linux');
    expect(body.platform).toBe('linux');
  });
});
