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
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
type InjectAllFn = (page: any) => Promise<void>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
type SetRealisticUserAgentFn = (page: any, platform: Platform) => Promise<void>;

const { injectAllMock, setRealisticUserAgentMock } = vi.hoisted(() => ({
  injectAllMock: vi.fn<InjectAllFn>(),
  setRealisticUserAgentMock: vi.fn<SetRealisticUserAgentFn>(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/shared/modules', () => ({
  StealthScripts: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    injectAll: (page: any) => injectAllMock(page),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    getPageMock.mockResolvedValue(page);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    getActiveDriver.mockReturnValue('chrome');
    handlers = new StealthInjectionHandlers({
      pageController: pageController as unknown as StealthDeps['pageController'],
      getActiveDriver,
    });
  });

  describe('handleStealthInject', () => {
    it('does not call pageController when driver is camoufox', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getActiveDriver.mockReturnValue('camoufox');

      const body = parseJson<StealthInjectResponse>(await handlers.handleStealthInject({}));

      expect(pageController.getPage).not.toHaveBeenCalled();
      expect(injectAllMock).not.toHaveBeenCalled();
      expect(body.success).toBe(true);
      expect(body.driver).toBe('camoufox');
    });

    it('includes message about C++ fingerprint spoofing for camoufox', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getActiveDriver.mockReturnValue('camoufox');

      const body = parseJson<StealthInjectResponse>(await handlers.handleStealthInject({}));

      expect(body.message).toContain('C++ engine-level');
    });

    it('injects all stealth scripts for chrome driver', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      injectAllMock.mockResolvedValue(undefined);

      const body = parseJson<StealthInjectResponse>(await handlers.handleStealthInject({}));

      expect(pageController.getPage).toHaveBeenCalledOnce();
      expect(injectAllMock).toHaveBeenCalledWith(page);
      expect(body.success).toBe(true);
      expect(body.message).toContain('Stealth scripts injected');
    });

    it('propagates error when injectAll throws', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      injectAllMock.mockRejectedValue(new Error('injection failed'));

      await expect(handlers.handleStealthInject({})).rejects.toThrow('injection failed');
    });

    it('propagates error when getPage throws', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getPageMock.mockRejectedValue(new Error('no page'));

      await expect(handlers.handleStealthInject({})).rejects.toThrow('no page');
    });

    it('ignores args parameter (unused)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      injectAllMock.mockResolvedValue(undefined);

      const body = parseJson<StealthInjectResponse>(
        await handlers.handleStealthInject({ some: 'param' }),
      );

      expect(body.success).toBe(true);
    });
  });

  describe('handleStealthSetUserAgent', () => {
    it('defaults platform to windows when not specified', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      setRealisticUserAgentMock.mockResolvedValue(undefined);

      const body = parseJson<StealthSetUserAgentResponse>(
        await handlers.handleStealthSetUserAgent({}),
      );

      expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'windows');
      expect(body.platform).toBe('windows');
      expect(body.message).toContain('windows');
    });

    it('passes mac platform', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      setRealisticUserAgentMock.mockResolvedValue(undefined);

      const body = parseJson<StealthSetUserAgentResponse>(
        await handlers.handleStealthSetUserAgent({ platform: 'mac' }),
      );

      expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'mac');
      expect(body.platform).toBe('mac');
    });

    it('passes linux platform', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      setRealisticUserAgentMock.mockResolvedValue(undefined);

      const body = parseJson<StealthSetUserAgentResponse>(
        await handlers.handleStealthSetUserAgent({ platform: 'linux' }),
      );

      expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'linux');
      expect(body.platform).toBe('linux');
    });

    it('propagates error when setRealisticUserAgent fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      setRealisticUserAgentMock.mockRejectedValue(new Error('ua error'));

      await expect(handlers.handleStealthSetUserAgent({ platform: 'mac' })).rejects.toThrow(
        'ua error',
      );
    });

    it('propagates error when getPage fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getPageMock.mockRejectedValue(new Error('page unavailable'));

      await expect(handlers.handleStealthSetUserAgent({})).rejects.toThrow('page unavailable');
    });

    it('response has correct structure', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      setRealisticUserAgentMock.mockResolvedValue(undefined);

      const response = await handlers.handleStealthSetUserAgent({ platform: 'windows' });

      expect(response).toHaveProperty('content');
      expect(response.content).toHaveLength(1);

      const [content] = response.content;
      expect(content).toBeDefined();
      expect(content).toHaveProperty('type', 'text');
      expect(content).toHaveProperty('text');

      const parsed = JSON.parse(content!.text) as StealthSetUserAgentResponse;
      expect(parsed).toMatchObject({
        success: true,
        platform: 'windows',
        message: 'User-Agent set for windows',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((parsed as any)._nextStepHint).toBeDefined();
    });
  });
});
