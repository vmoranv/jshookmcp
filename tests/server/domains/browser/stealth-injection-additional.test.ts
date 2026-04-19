import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Driver = 'chrome' | 'camoufox';
type Platform = 'windows' | 'mac' | 'linux';
type StealthInjectResponse = {
  success: boolean;
  driver?: Driver;
  message: string;
};
type StealthSetUserAgentResponse = {
  success: boolean;
  platform: Platform;
  message: string;
};
type InjectAllFn = (page: any) => Promise<void>;
type SetRealisticUserAgentFn = (page: any, platform: Platform) => Promise<void>;

const { injectAllMock, setRealisticUserAgentMock } = vi.hoisted(() => ({
  injectAllMock: vi.fn<InjectAllFn>(),
  setRealisticUserAgentMock: vi.fn<SetRealisticUserAgentFn>(),
}));

vi.mock('@server/domains/shared/modules', () => ({
  StealthScripts: {
    injectAll: (page: any) => injectAllMock(page),
    setRealisticUserAgent: (page: any, platform: Platform) =>
      setRealisticUserAgentMock(page, platform),
  },
}));

import { StealthInjectionHandlers } from '@server/domains/browser/handlers/stealth-injection';

type StealthDeps = ConstructorParameters<typeof StealthInjectionHandlers>[0];
type PageControllerStub = Pick<StealthDeps['pageController'], 'getPage'>;

describe('StealthInjectionHandlers — additional coverage', () => {
  const page = { id: 'page-1' } as unknown as Awaited<ReturnType<PageControllerStub['getPage']>>;
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

  describe('handleStealthInject', () => {
    it('does not call pageController when driver is camoufox', async () => {
      getActiveDriver.mockReturnValue('camoufox');

      const body = parseJson<StealthInjectResponse>(await handlers.handleStealthInject({}));

      expect(pageController.getPage).not.toHaveBeenCalled();
      expect(injectAllMock).not.toHaveBeenCalled();
      expect(body.success).toBe(true);
      expect(body.driver).toBe('camoufox');
    });

    it('includes message about C++ fingerprint spoofing for camoufox', async () => {
      getActiveDriver.mockReturnValue('camoufox');

      const body = parseJson<StealthInjectResponse>(await handlers.handleStealthInject({}));

      expect(body.message).toContain('C++ engine-level');
    });

    it('injects all stealth scripts for chrome driver', async () => {
      injectAllMock.mockResolvedValue(undefined);

      const body = parseJson<StealthInjectResponse>(await handlers.handleStealthInject({}));

      expect(pageController.getPage).toHaveBeenCalledOnce();
      expect(injectAllMock).toHaveBeenCalledWith(page);
      expect(body.success).toBe(true);
      expect(body.message).toContain('Stealth scripts injected');
    });

    it('returns failure response when injectAll throws', async () => {
      injectAllMock.mockRejectedValue(new Error('injection failed'));

      const response = await handlers.handleStealthInject({});
      const body = parseJson<StealthInjectResponse>(response);
      expect(body.success).toBe(false);
      expect(body.message).toContain('injection failed');
    });

    it('returns failure response when getPage throws', async () => {
      getPageMock.mockRejectedValue(new Error('no page'));

      const response = await handlers.handleStealthInject({});
      const body = parseJson<StealthInjectResponse>(response);
      expect(body.success).toBe(false);
      expect(body.message).toContain('no page');
    });

    it('ignores args parameter (unused)', async () => {
      injectAllMock.mockResolvedValue(undefined);

      const body = parseJson<StealthInjectResponse>(
        await handlers.handleStealthInject({ some: 'param' }),
      );

      expect(body.success).toBe(true);
    });
  });

  describe('handleStealthSetUserAgent', () => {
    it('defaults platform to windows when not specified', async () => {
      setRealisticUserAgentMock.mockResolvedValue(undefined);

      const body = parseJson<StealthSetUserAgentResponse>(
        await handlers.handleStealthSetUserAgent({}),
      );

      expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'windows');
      expect(body.platform).toBe('windows');
      expect(body.message).toContain('windows');
    });

    it('passes mac platform', async () => {
      setRealisticUserAgentMock.mockResolvedValue(undefined);

      const body = parseJson<StealthSetUserAgentResponse>(
        await handlers.handleStealthSetUserAgent({ platform: 'mac' }),
      );

      expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'mac');
      expect(body.platform).toBe('mac');
    });

    it('passes linux platform', async () => {
      setRealisticUserAgentMock.mockResolvedValue(undefined);

      const body = parseJson<StealthSetUserAgentResponse>(
        await handlers.handleStealthSetUserAgent({ platform: 'linux' }),
      );

      expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'linux');
      expect(body.platform).toBe('linux');
    });

    it('returns failure response when setRealisticUserAgent fails', async () => {
      setRealisticUserAgentMock.mockRejectedValue(new Error('ua error'));

      const response = await handlers.handleStealthSetUserAgent({ platform: 'mac' });
      const body = parseJson<StealthSetUserAgentResponse>(response);
      expect(body.success).toBe(false);
      expect(body.message).toContain('ua error');
    });

    it('returns failure response when getPage fails', async () => {
      getPageMock.mockRejectedValue(new Error('page unavailable'));

      const response = await handlers.handleStealthSetUserAgent({});
      const body = parseJson<StealthSetUserAgentResponse>(response);
      expect(body.success).toBe(false);
      expect(body.message).toContain('page unavailable');
    });

    it('response has correct structure', async () => {
      setRealisticUserAgentMock.mockResolvedValue(undefined);

      const response = await handlers.handleStealthSetUserAgent({ platform: 'windows' });

      expect(response).toHaveProperty('content');
      expect(response.content).toHaveLength(1);

      const [content] = response.content as any[];
      expect(content).toBeDefined();
      expect(content.type).toBe('text');
      expect(content).toHaveProperty('text');

      const parsed = JSON.parse(content.text) as StealthSetUserAgentResponse;

      expect(parsed).toMatchObject({
        success: true,
        platform: 'windows',
        message: 'User-Agent set for windows',
      });
      expect((parsed as any)._nextStepHint).toBeDefined();
    });
  });
});
