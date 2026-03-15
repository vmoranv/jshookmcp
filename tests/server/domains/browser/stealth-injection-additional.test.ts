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

describe('StealthInjectionHandlers — additional coverage', () => {
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

  describe('handleStealthInject', () => {
    it('does not call pageController when driver is camoufox', async () => {
      getActiveDriver.mockReturnValue('camoufox');

      const body = parseJson(await handlers.handleStealthInject({}));

      expect(pageController.getPage).not.toHaveBeenCalled();
      expect(injectAllMock).not.toHaveBeenCalled();
      expect(body.success).toBe(true);
      expect(body.driver).toBe('camoufox');
    });

    it('includes message about C++ fingerprint spoofing for camoufox', async () => {
      getActiveDriver.mockReturnValue('camoufox');
      const body = parseJson(await handlers.handleStealthInject({}));
      expect(body.message).toContain('C++ engine-level');
    });

    it('injects all stealth scripts for chrome driver', async () => {
      injectAllMock.mockResolvedValue(undefined);

      const body = parseJson(await handlers.handleStealthInject({}));

      expect(pageController.getPage).toHaveBeenCalledOnce();
      expect(injectAllMock).toHaveBeenCalledWith(page);
      expect(body.success).toBe(true);
      expect(body.message).toContain('Stealth scripts injected');
    });

    it('propagates error when injectAll throws', async () => {
      injectAllMock.mockRejectedValue(new Error('injection failed'));

      await expect(handlers.handleStealthInject({})).rejects.toThrow('injection failed');
    });

    it('propagates error when getPage throws', async () => {
      pageController.getPage.mockRejectedValue(new Error('no page'));

      await expect(handlers.handleStealthInject({})).rejects.toThrow('no page');
    });

    it('ignores args parameter (unused)', async () => {
      injectAllMock.mockResolvedValue(undefined);

      const body = parseJson(await handlers.handleStealthInject({ some: 'param' }));
      expect(body.success).toBe(true);
    });
  });

  describe('handleStealthSetUserAgent', () => {
    it('defaults platform to windows when not specified', async () => {
      setRealisticUserAgentMock.mockResolvedValue(undefined);

      const body = parseJson(await handlers.handleStealthSetUserAgent({}));

      expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'windows');
      expect(body.platform).toBe('windows');
      expect(body.message).toContain('windows');
    });

    it('passes mac platform', async () => {
      setRealisticUserAgentMock.mockResolvedValue(undefined);

      const body = parseJson(await handlers.handleStealthSetUserAgent({ platform: 'mac' }));

      expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'mac');
      expect(body.platform).toBe('mac');
    });

    it('passes linux platform', async () => {
      setRealisticUserAgentMock.mockResolvedValue(undefined);

      const body = parseJson(await handlers.handleStealthSetUserAgent({ platform: 'linux' }));

      expect(setRealisticUserAgentMock).toHaveBeenCalledWith(page, 'linux');
      expect(body.platform).toBe('linux');
    });

    it('propagates error when setRealisticUserAgent fails', async () => {
      setRealisticUserAgentMock.mockRejectedValue(new Error('ua error'));

      await expect(
        handlers.handleStealthSetUserAgent({ platform: 'mac' }),
      ).rejects.toThrow('ua error');
    });

    it('propagates error when getPage fails', async () => {
      pageController.getPage.mockRejectedValue(new Error('page unavailable'));

      await expect(
        handlers.handleStealthSetUserAgent({}),
      ).rejects.toThrow('page unavailable');
    });

    it('response has correct structure', async () => {
      setRealisticUserAgentMock.mockResolvedValue(undefined);

      const response = await handlers.handleStealthSetUserAgent({ platform: 'windows' });

      expect(response).toHaveProperty('content');
      expect(response.content).toHaveLength(1);
      expect(response.content[0]).toHaveProperty('type', 'text');
      expect(response.content[0]).toHaveProperty('text');

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed).toEqual({
        success: true,
        platform: 'windows',
        message: 'User-Agent set for windows',
      });
    });
  });
});
