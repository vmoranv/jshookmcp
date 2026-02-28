import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StealthScripts } from '../../../src/modules/stealth/StealthScripts.js';

function createPageMock() {
  return {
    evaluateOnNewDocument: vi.fn(async () => undefined),
    setUserAgent: vi.fn(async () => undefined),
  } as any;
}

describe('StealthScripts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('injectAll invokes all stealth patch methods', async () => {
    const page = createPageMock();
    const spies = [
      vi.spyOn(StealthScripts, 'hideWebDriver').mockResolvedValue(undefined),
      vi.spyOn(StealthScripts, 'mockChrome').mockResolvedValue(undefined),
      vi.spyOn(StealthScripts, 'mockPlugins').mockResolvedValue(undefined),
      vi.spyOn(StealthScripts, 'fixPermissions').mockResolvedValue(undefined),
      vi.spyOn(StealthScripts, 'mockCanvas').mockResolvedValue(undefined),
      vi.spyOn(StealthScripts, 'mockWebGL').mockResolvedValue(undefined),
      vi.spyOn(StealthScripts, 'fixLanguages').mockResolvedValue(undefined),
      vi.spyOn(StealthScripts, 'mockBattery').mockResolvedValue(undefined),
      vi.spyOn(StealthScripts, 'fixMediaDevices').mockResolvedValue(undefined),
      vi.spyOn(StealthScripts, 'mockNotifications').mockResolvedValue(undefined),
    ];

    await StealthScripts.injectAll(page);
    spies.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
  });

  it('hideWebDriver injects a preload script', async () => {
    const page = createPageMock();
    await StealthScripts.hideWebDriver(page);

    expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
    const [script] = page.evaluateOnNewDocument.mock.calls[0]!;
    expect(typeof script).toBe('function');
  });

  it('setRealisticUserAgent uses platform-specific UA and navigator overrides', async () => {
    const page = createPageMock();
    await StealthScripts.setRealisticUserAgent(page, 'mac');

    expect(page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Macintosh'));
    const [script, platformValue] = page.evaluateOnNewDocument.mock.calls[0]!;
    expect(typeof script).toBe('function');
    expect(platformValue).toBe('MacIntel');
  });

  it('setRealisticUserAgent defaults to windows platform', async () => {
    const page = createPageMock();
    await StealthScripts.setRealisticUserAgent(page);

    expect(page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Windows NT 10.0'));
    expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(expect.any(Function), 'Win32');
  });

  it('exposes hardened browser launch arguments', () => {
    const args = StealthScripts.getRecommendedLaunchArgs();

    expect(args).toContain('--disable-blink-features=AutomationControlled');
    expect(args).toContain('--no-sandbox');
    expect(args).toContain('--window-size=1920,1080');
    expect(new Set(args).size).toBe(args.length);
  });

  it('fixPermissions and fixMediaDevices both inject scripts', async () => {
    const page = createPageMock();

    await StealthScripts.fixPermissions(page);
    await StealthScripts.fixMediaDevices(page);

    expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(2);
  });
});
