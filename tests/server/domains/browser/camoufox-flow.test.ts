import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  BrowserLaunchResponse,
  PageInteractionResponse,
} from '@tests/shared/common-test-types';

const mockManager = vi.hoisted(() => ({
  launch: vi.fn(),
  connectToServer: vi.fn(),
  constructorArgs: [] as any[],
}));

vi.mock('@server/domains/shared/modules', () => ({
  CamoufoxBrowserManager: class MockCamoufoxBrowserManager {
    constructor(config: any) {
      mockManager.constructorArgs.push(config);
    }

    launch = mockManager.launch;
    connectToServer = mockManager.connectToServer;
  },
}));

import {
  handleCamoufoxLaunchFlow,
  handleCamoufoxNavigateFlow,
} from '@server/domains/browser/handlers/camoufox-flow';

describe('camoufox-flow', () => {
  beforeEach(() => {
    mockManager.launch.mockResolvedValue(undefined);
    mockManager.connectToServer.mockResolvedValue(undefined);
    mockManager.constructorArgs = [];
  });

  describe('handleCamoufoxLaunchFlow', () => {
    function makeContext() {
      return {
        setCamoufoxManager: vi.fn(),
        setActiveDriver: vi.fn(),
        clearCamoufoxPage: vi.fn(),
      };
    }

    it('launches in default mode', async () => {
      const ctx = makeContext();
      const result = await handleCamoufoxLaunchFlow(ctx, {});
      const body = parseJson<BrowserLaunchResponse>(result);
      expect(body.success).toBe(true);
      expect(body.mode).toBe('launch');
      expect(body.driver).toBe('camoufox');
      expect(ctx.setCamoufoxManager).toHaveBeenCalled();
      expect(ctx.setActiveDriver).toHaveBeenCalledWith('camoufox');
      expect(ctx.clearCamoufoxPage).toHaveBeenCalled();
    });

    it('connects in connect mode with wsEndpoint', async () => {
      const ctx = makeContext();
      const result = await handleCamoufoxLaunchFlow(ctx, {
        mode: 'connect',
        wsEndpoint: 'ws://localhost:1234',
      });
      const body = parseJson<BrowserLaunchResponse>(result);
      expect(body.success).toBe(true);
      expect(body.mode).toBe('connect');
      expect(body.wsEndpoint).toBe('ws://localhost:1234');
      expect(ctx.setCamoufoxManager).toHaveBeenCalled();
    });

    it('returns error when connect mode missing wsEndpoint', async () => {
      const ctx = makeContext();
      const result = await handleCamoufoxLaunchFlow(ctx, { mode: 'connect' });
      const body = parseJson<BrowserLaunchResponse>(result);
      expect(body.success).toBe(false);
      expect(body.error).toContain('wsEndpoint is required');
    });

    it('passes headless and os options', async () => {
      const ctx = makeContext();
      await handleCamoufoxLaunchFlow(ctx, { headless: false, os: 'linux' });
      expect(ctx.setCamoufoxManager).toHaveBeenCalled();
    });

    it('passes camoufox 0.10.2 config fields to CamoufoxBrowserManager', async () => {
      const ctx = makeContext();
      const result = await handleCamoufoxLaunchFlow(ctx, {
        headless: false,
        os: 'macos',
        geoip: true,
        humanize: true,
        proxy: 'socks5://127.0.0.1:1080',
        blockImages: true,
        blockWebrtc: true,
        blockWebgl: true,
        locale: 'zh-CN',
        addons: ['uBlock'],
        excludeAddons: ['Default Addon'],
        fonts: ['Arial'],
        customFontsOnly: true,
        screen: { width: 1920, height: 1080 },
        window: { width: 1280, height: 720 },
        fingerprint: { vendor: 'Intel', renderer: 'HD 630' },
        webglConfig: { vendor: 'Intel Inc.' },
        firefoxUserPrefs: { 'dom.webdriver.enabled': false },
        mainWorldEval: true,
        enableCache: true,
      });
      const body = parseJson<any>(result);
      const config = mockManager.constructorArgs.at(-1);
      expect(body.success).toBe(true);
      expect(body.config.os).toBe('macos');
      expect(body.config.locale).toBe('zh-CN');
      expect(body.config.blockWebgl).toBe(true);
      expect(body.config.geoip).toBe(true);
      expect(body.config.blockImages).toBe(true);
      expect(body.config.blockWebrtc).toBe(true);
      expect(config.excludeAddons).toEqual(['Default Addon']);
      expect(config.customFontsOnly).toBe(true);
      expect(config.fingerprint).toEqual({ vendor: 'Intel', renderer: 'HD 630' });
      expect(config.webglConfig).toEqual({ vendor: 'Intel Inc.' });
      expect(config.firefoxUserPrefs).toEqual({ 'dom.webdriver.enabled': false });
      expect(config.mainWorldEval).toBe(true);
    });
  });

  describe('handleCamoufoxNavigateFlow', () => {
    function makeContext() {
      const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        url: vi.fn().mockReturnValue('https://example.com'),
        title: vi.fn().mockResolvedValue('Example'),
      };
      return {
        context: {
          getCamoufoxPage: vi.fn().mockResolvedValue(page),
          setConsoleMonitorPage: vi.fn(),
        },
        page,
      };
    }

    it('navigates to URL with default waitUntil', async () => {
      const { context, page } = makeContext();
      const result = await handleCamoufoxNavigateFlow(context, { url: 'https://test.com' });
      const body = parseJson<PageInteractionResponse & { url: string; title: string }>(result);
      expect(body.success).toBe(true);
      expect(body.driver).toBe('camoufox');
      expect(body.url).toBe('https://example.com');
      expect(body.title).toBe('Example');
      expect(page.goto).toHaveBeenCalledWith('https://test.com', {
        waitUntil: 'networkidle',
        timeout: undefined,
      });
    });

    it('normalizes networkidle2 to networkidle', async () => {
      const { context, page } = makeContext();
      await handleCamoufoxNavigateFlow(context, {
        url: 'https://test.com',
        waitUntil: 'networkidle2',
      });
      expect(page.goto).toHaveBeenCalledWith(
        'https://test.com',
        expect.objectContaining({ waitUntil: 'networkidle' }),
      );
    });

    it('passes load waitUntil unchanged', async () => {
      const { context, page } = makeContext();
      await handleCamoufoxNavigateFlow(context, { url: 'https://test.com', waitUntil: 'load' });
      expect(page.goto).toHaveBeenCalledWith(
        'https://test.com',
        expect.objectContaining({ waitUntil: 'load' }),
      );
    });

    it('passes domcontentloaded waitUntil', async () => {
      const { context, page } = makeContext();
      await handleCamoufoxNavigateFlow(context, {
        url: 'https://test.com',
        waitUntil: 'domcontentloaded',
      });
      expect(page.goto).toHaveBeenCalledWith(
        'https://test.com',
        expect.objectContaining({ waitUntil: 'domcontentloaded' }),
      );
    });

    it('passes commit waitUntil', async () => {
      const { context, page } = makeContext();
      await handleCamoufoxNavigateFlow(context, { url: 'https://test.com', waitUntil: 'commit' });
      expect(page.goto).toHaveBeenCalledWith(
        'https://test.com',
        expect.objectContaining({ waitUntil: 'commit' }),
      );
    });

    it('normalizes unknown waitUntil to networkidle', async () => {
      const { context, page } = makeContext();
      await handleCamoufoxNavigateFlow(context, { url: 'https://test.com', waitUntil: 'unknown' });
      expect(page.goto).toHaveBeenCalledWith(
        'https://test.com',
        expect.objectContaining({ waitUntil: 'networkidle' }),
      );
    });

    it('passes timeout option', async () => {
      const { context, page } = makeContext();
      await handleCamoufoxNavigateFlow(context, { url: 'https://test.com', timeout: 5000 });
      expect(page.goto).toHaveBeenCalledWith(
        'https://test.com',
        expect.objectContaining({ timeout: 5000 }),
      );
    });

    it('sets console monitor page after navigation', async () => {
      const { context, page } = makeContext();
      await handleCamoufoxNavigateFlow(context, { url: 'https://test.com' });
      expect(context.setConsoleMonitorPage).toHaveBeenCalledWith(page);
    });
  });
});
