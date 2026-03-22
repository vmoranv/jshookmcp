import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { 
  BrowserLaunchResponse, 
  PageInteractionResponse 
} from '@tests/shared/common-test-types';

const mockManager = vi.hoisted(() => ({
  launch: vi.fn(),
  connectToServer: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/shared/modules', () => ({
  CamoufoxBrowserManager: class MockCamoufoxBrowserManager {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mockManager.launch.mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    mockManager.connectToServer.mockResolvedValue(undefined);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.mode).toBe('launch');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.mode).toBe('connect');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.wsEndpoint).toBe('ws://localhost:1234');
      expect(ctx.setCamoufoxManager).toHaveBeenCalled();
    });

    it('returns error when connect mode missing wsEndpoint', async () => {
      const ctx = makeContext();
      const result = await handleCamoufoxLaunchFlow(ctx, { mode: 'connect' });
      const body = parseJson<BrowserLaunchResponse>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('wsEndpoint is required');
    });

    it('passes headless and os options', async () => {
      const ctx = makeContext();
      await handleCamoufoxLaunchFlow(ctx, { headless: false, os: 'linux' });
      expect(ctx.setCamoufoxManager).toHaveBeenCalled();
    });
  });

  describe('handleCamoufoxNavigateFlow', () => {
    function makeContext() {
      const page = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        goto: vi.fn().mockResolvedValue(undefined),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        url: vi.fn().mockReturnValue('https://example.com'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        title: vi.fn().mockResolvedValue('Example'),
      };
      return {
        context: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.driver).toBe('camoufox');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.url).toBe('https://example.com');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
        expect.objectContaining({ waitUntil: 'networkidle' })
      );
    });

    it('passes load waitUntil unchanged', async () => {
      const { context, page } = makeContext();
      await handleCamoufoxNavigateFlow(context, { url: 'https://test.com', waitUntil: 'load' });
      expect(page.goto).toHaveBeenCalledWith(
        'https://test.com',
        expect.objectContaining({ waitUntil: 'load' })
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
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    });

    it('passes commit waitUntil', async () => {
      const { context, page } = makeContext();
      await handleCamoufoxNavigateFlow(context, { url: 'https://test.com', waitUntil: 'commit' });
      expect(page.goto).toHaveBeenCalledWith(
        'https://test.com',
        expect.objectContaining({ waitUntil: 'commit' })
      );
    });

    it('normalizes unknown waitUntil to networkidle', async () => {
      const { context, page } = makeContext();
      await handleCamoufoxNavigateFlow(context, { url: 'https://test.com', waitUntil: 'unknown' });
      expect(page.goto).toHaveBeenCalledWith(
        'https://test.com',
        expect.objectContaining({ waitUntil: 'networkidle' })
      );
    });

    it('passes timeout option', async () => {
      const { context, page } = makeContext();
      await handleCamoufoxNavigateFlow(context, { url: 'https://test.com', timeout: 5000 });
      expect(page.goto).toHaveBeenCalledWith(
        'https://test.com',
        expect.objectContaining({ timeout: 5000 })
      );
    });

    it('sets console monitor page after navigation', async () => {
      const { context, page } = makeContext();
      await handleCamoufoxNavigateFlow(context, { url: 'https://test.com' });
      expect(context.setConsoleMonitorPage).toHaveBeenCalledWith(page);
    });
  });
});
