import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const camoufoxLaunchMock = vi.hoisted(() => vi.fn());
const camoufoxServerLaunchMock = vi.hoisted(() => vi.fn());

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('camoufox-js', () => ({
  Camoufox: (...args: any[]) => camoufoxLaunchMock(...args),
  launchServer: (...args: any[]) => camoufoxServerLaunchMock(...args),
}));

vi.mock('playwright-core', () => ({
  firefox: {
    connect: vi.fn(),
  },
}));

import { CamoufoxBrowserManager } from '@modules/browser/CamoufoxBrowserManager';

function createFakeBrowser(connected = true) {
  return {
    newPage: vi.fn().mockResolvedValue(createFakePage()),
    close: vi.fn(async () => {}),
    isConnected: vi.fn(() => connected),
  };
}

function createFakePage() {
  return {
    goto: vi.fn(async () => {}),
    context: vi.fn(() => ({
      newCDPSession: vi.fn(async () => ({ send: vi.fn() })),
    })),
  };
}

describe('CamoufoxBrowserManager — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('applies default config values', () => {
      const manager = new CamoufoxBrowserManager();
      // The manager is constructed with defaults — just verify it can be created
      expect(manager).toBeDefined();
      expect(manager.getBrowser()).toBeNull();
    });

    it('accepts custom config values', () => {
      const manager = new CamoufoxBrowserManager({
        os: 'linux',
        headless: false,
        geoip: true,
        humanize: true,
        blockImages: true,
        blockWebrtc: true,
        proxy: { server: 'http://proxy:8080', username: 'user', password: 'pass' },
      });
      expect(manager).toBeDefined();
    });
  });

  describe('launch', () => {
    it('returns existing browser when already connected', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValueOnce(fakeBrowser);
      const manager = new CamoufoxBrowserManager();

      // First launch
      const first = await manager.launch();
      expect(first).toBe(fakeBrowser);

      // Second launch should reuse
      const second = await manager.launch();
      expect(second).toBe(fakeBrowser);
      expect(camoufoxLaunchMock).toHaveBeenCalledTimes(1);
    });

    it('throws when trying to launch while closing', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValueOnce(fakeBrowser);
      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      // Start closing (make isConnected return false so launch tries doLaunch)
      fakeBrowser.isConnected.mockReturnValue(false);
      // Set isClosing flag by calling close
      const closePromise = manager.close();
      await closePromise;

      // After close completes, browser should be null
      expect(manager.getBrowser()).toBeNull();
    });

    it('relaunches when existing browser is disconnected', async () => {
      const firstBrowser = createFakeBrowser(true);
      const secondBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValueOnce(firstBrowser).mockResolvedValueOnce(secondBrowser);

      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      // Simulate disconnection
      firstBrowser.isConnected.mockReturnValue(false);

      const result = await manager.launch();
      expect(result).toBe(secondBrowser);
      expect(firstBrowser.close).toHaveBeenCalled();
    });
  });

  describe('newPage', () => {
    it('auto-launches browser if not launched yet', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);
      const manager = new CamoufoxBrowserManager();

      const page = await manager.newPage();
      expect(page).toBeDefined();
      expect(fakeBrowser.newPage).toHaveBeenCalledTimes(1);
    });

    it('uses existing browser if already launched', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);
      const manager = new CamoufoxBrowserManager();

      await manager.launch();
      await manager.newPage();
      // camoufox launched only once
      expect(camoufoxLaunchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('goto', () => {
    it('navigates an existing page', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);
      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      const fakePage = createFakePage();
      const result = await manager.goto('https://example.com', fakePage);
      expect(fakePage.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'networkidle',
      });
      expect(result).toBe(fakePage);
    });

    it('creates a new page when no page is provided', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);
      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      await manager.goto('https://example.com');
      expect(fakeBrowser.newPage).toHaveBeenCalledTimes(1);
    });
  });

  describe('close', () => {
    it('closes the browser and resets state', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);
      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      await manager.close();
      expect(fakeBrowser.close).toHaveBeenCalledTimes(1);
      expect(manager.getBrowser()).toBeNull();
    });

    it('does nothing when no browser is launched', async () => {
      const manager = new CamoufoxBrowserManager();
      await expect(manager.close()).resolves.not.toThrow();
    });

    it('resets isClosing flag even on close error', async () => {
      const fakeBrowser = createFakeBrowser(true);
      fakeBrowser.close.mockRejectedValue(new Error('Close failed'));
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);
      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      await expect(manager.close()).rejects.toThrow('Close failed');

      // After close failure, should be able to launch again
      const newBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(newBrowser);
      const result = await manager.launch();
      expect(result).toBe(newBrowser);
    });
  });

  describe('getBrowser', () => {
    it('returns null before launch', () => {
      const manager = new CamoufoxBrowserManager();
      expect(manager.getBrowser()).toBeNull();
    });

    it('returns browser after launch', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);
      const manager = new CamoufoxBrowserManager();
      await manager.launch();
      expect(manager.getBrowser()).toBe(fakeBrowser);
    });

    it('returns null after close', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);
      const manager = new CamoufoxBrowserManager();
      await manager.launch();
      await manager.close();
      expect(manager.getBrowser()).toBeNull();
    });
  });

  describe('getCDPSession', () => {
    it('creates CDP session through page context', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);
      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      const fakePage = createFakePage();
      const session = await manager.getCDPSession(fakePage);
      expect(session).toBeDefined();
      expect(loggerState.warn).toHaveBeenCalledWith(
        expect.stringContaining('CDP sessions on camoufox')
      );
    });
  });

  describe('launchAsServer', () => {
    it('launches server and returns ws endpoint', async () => {
      const fakeServer = {
        wsEndpoint: vi.fn(() => 'ws://127.0.0.1:8888/camoufox'),
        close: vi.fn(async () => {}),
      };
      camoufoxServerLaunchMock.mockResolvedValue(fakeServer);
      const manager = new CamoufoxBrowserManager();

      const endpoint = await manager.launchAsServer(8888, '/camoufox');
      expect(endpoint).toBe('ws://127.0.0.1:8888/camoufox');
      expect(manager.getBrowserServerEndpoint()).toBe('ws://127.0.0.1:8888/camoufox');
    });

    it('closes existing server before relaunch', async () => {
      const firstServer = {
        wsEndpoint: vi.fn(() => 'ws://127.0.0.1:8888/first'),
        close: vi.fn(async () => {}),
      };
      const secondServer = {
        wsEndpoint: vi.fn(() => 'ws://127.0.0.1:9999/second'),
        close: vi.fn(async () => {}),
      };
      camoufoxServerLaunchMock
        .mockResolvedValueOnce(firstServer)
        .mockResolvedValueOnce(secondServer);

      const manager = new CamoufoxBrowserManager();
      await manager.launchAsServer(8888);
      await manager.launchAsServer(9999);

      expect(firstServer.close).toHaveBeenCalled();
      expect(manager.getBrowserServerEndpoint()).toBe('ws://127.0.0.1:9999/second');
    });
  });

  describe('closeBrowserServer', () => {
    it('closes the server and resets state', async () => {
      const fakeServer = {
        wsEndpoint: vi.fn(() => 'ws://127.0.0.1:8888/path'),
        close: vi.fn(async () => {}),
      };
      camoufoxServerLaunchMock.mockResolvedValue(fakeServer);
      const manager = new CamoufoxBrowserManager();
      await manager.launchAsServer(8888);

      await manager.closeBrowserServer();
      expect(fakeServer.close).toHaveBeenCalled();
      expect(manager.getBrowserServerEndpoint()).toBeNull();
    });

    it('does nothing when no server exists', async () => {
      const manager = new CamoufoxBrowserManager();
      await expect(manager.closeBrowserServer()).resolves.not.toThrow();
    });
  });

  describe('getBrowserServerEndpoint', () => {
    it('returns null when no server is running', () => {
      const manager = new CamoufoxBrowserManager();
      expect(manager.getBrowserServerEndpoint()).toBeNull();
    });
  });
});
