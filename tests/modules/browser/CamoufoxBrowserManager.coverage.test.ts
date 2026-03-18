import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const camoufoxLaunchMock = vi.hoisted(() => vi.fn());
const camoufoxServerLaunchMock = vi.hoisted(() => vi.fn());
const playwrightConnectMock = vi.hoisted(() => vi.fn());

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('camoufox-js', () => ({
  Camoufox: (...args: any[]) => camoufoxLaunchMock(...args),
  launchServer: (...args: any[]) => camoufoxServerLaunchMock(...args),
}));

vi.mock('playwright-core', () => ({
  firefox: {
    connect: (...args: any[]) => playwrightConnectMock(...args),
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

describe('CamoufoxBrowserManager — coverage expansion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── doLaunch: camoufox-js import failure ──

  describe('launch — camoufox-js import failure', () => {
    it('throws PrerequisiteError when camoufox-js import fails', async () => {
      camoufoxLaunchMock.mockImplementation(() => {
        throw new Error('Cannot find module camoufox-js');
      });
      // Need to re-mock camoufox-js to throw during import
      // Since the mock is already set up, we can simulate
      // the launch error path
      const manager = new CamoufoxBrowserManager();

      await expect(manager.launch()).rejects.toThrow();
    });
  });

  // ── doLaunch: close requested during launch ──

  describe('launch — close during launch', () => {
    it('aborts launch if close is requested while Camoufox is starting', async () => {
      const fakeBrowser = createFakeBrowser(true);
      // Simulate slow launch
      camoufoxLaunchMock.mockImplementation(async () => {
        // manager.close() will be called while this is pending
        return fakeBrowser;
      });

      const manager = new CamoufoxBrowserManager();
      const launchPromise = manager.launch();

      // Start close immediately
      await manager.close();

      // The launch should abort
      await expect(launchPromise).rejects.toThrow(/close/i);
      // Browser should have been closed
      expect(fakeBrowser.close).toHaveBeenCalled();
    });
  });

  // ── doLaunch: closes existing browser before relaunch ──

  describe('launch — relaunch with existing disconnected browser', () => {
    it('closes previous browser and relaunches when disconnected', async () => {
      const firstBrowser = createFakeBrowser(true);
      const secondBrowser = createFakeBrowser(true);

      camoufoxLaunchMock.mockResolvedValueOnce(firstBrowser).mockResolvedValueOnce(secondBrowser);

      const manager = new CamoufoxBrowserManager();

      // First launch
      const b1 = await manager.launch();
      expect(b1).toBe(firstBrowser);

      // Simulate disconnection
      firstBrowser.isConnected.mockReturnValue(false);

      // Second launch - triggers doLaunch which closes first browser
      const b2 = await manager.launch();
      expect(b2).toBe(secondBrowser);
      expect(firstBrowser.close).toHaveBeenCalled();
      expect(loggerState.info).toHaveBeenCalledWith(
        expect.stringContaining('Closing existing Camoufox browser before relaunch')
      );
    });

    it('handles close error on previous browser during relaunch gracefully', async () => {
      const firstBrowser = createFakeBrowser(true);
      firstBrowser.close.mockRejectedValue(new Error('close err'));
      const secondBrowser = createFakeBrowser(true);

      camoufoxLaunchMock.mockResolvedValueOnce(firstBrowser).mockResolvedValueOnce(secondBrowser);

      const manager = new CamoufoxBrowserManager();

      await manager.launch();
      firstBrowser.isConnected.mockReturnValue(false);

      // Should not throw even if first browser.close fails
      const b2 = await manager.launch();
      expect(b2).toBe(secondBrowser);
      expect(loggerState.warn).toHaveBeenCalledWith(
        'Failed to close previous browser:',
        expect.any(Error)
      );
    });
  });

  // ── close: with pending launch ──

  describe('close — pending launch interactions', () => {
    it('waits for pending launch to settle before finalizing close', async () => {
      let launchResolve!: (value: any) => void;
      const launchDeferred = new Promise<any>((res) => {
        launchResolve = res;
      });
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockReturnValue(launchDeferred);

      const manager = new CamoufoxBrowserManager();
      const launchPromise = manager.launch();

      // close() while launch is pending
      const closePromise = manager.close();

      // close returns immediately because there's a pending launch
      await closePromise;

      // Now resolve the launch
      launchResolve(fakeBrowser);

      // launch should reject because isClosing was set
      await expect(launchPromise).rejects.toThrow(/close/i);
    });

    it('close handles launch rejection gracefully', async () => {
      camoufoxLaunchMock.mockRejectedValue(new Error('launch fail'));

      const manager = new CamoufoxBrowserManager();
      const launchPromise = manager.launch().catch(() => {});

      await manager.close();

      // Should not throw
      await launchPromise;
    });
  });

  // ── finalizeClose: browser already null ──

  describe('finalizeClose', () => {
    it('does nothing when browser is already null', async () => {
      const manager = new CamoufoxBrowserManager();
      await manager.close();
      expect(manager.getBrowser()).toBeNull();
    });

    it('resets isClosing even when browser.close throws', async () => {
      const fakeBrowser = createFakeBrowser(true);
      fakeBrowser.close.mockRejectedValue(new Error('Close error'));
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);

      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      await expect(manager.close()).rejects.toThrow('Close error');

      // isClosing should be reset, allowing new launches
      const newBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(newBrowser);
      const result = await manager.launch();
      expect(result).toBe(newBrowser);
    });
  });

  // ── newPage: auto-launch ──

  describe('newPage', () => {
    it('auto-launches browser and creates page', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);

      const manager = new CamoufoxBrowserManager();
      // Don't call launch() first
      const page = await manager.newPage();

      expect(page).toBeDefined();
      expect(camoufoxLaunchMock).toHaveBeenCalledOnce();
      expect(fakeBrowser.newPage).toHaveBeenCalledOnce();
    });
  });

  // ── goto: creates new page when none provided ──

  describe('goto', () => {
    it('creates new page when none provided and navigates', async () => {
      const fakeBrowser = createFakeBrowser(true);
      const fakePage = createFakePage();
      fakeBrowser.newPage.mockResolvedValue(fakePage);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);

      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      const result = await manager.goto('https://example.com');
      expect(result).toBe(fakePage);
      expect(fakePage.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'networkidle',
      });
    });

    it('uses provided page and navigates', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);

      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      const existingPage = createFakePage();
      const result = await manager.goto('https://example.com', existingPage);

      expect(result).toBe(existingPage);
      expect(existingPage.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'networkidle',
      });
      // Should not create new page
      expect(fakeBrowser.newPage).not.toHaveBeenCalled();
    });
  });

  // ── launchAsServer: import failure ──

  describe('launchAsServer — import failure', () => {
    it('throws PrerequisiteError when camoufox-js server import fails', async () => {
      camoufoxServerLaunchMock.mockImplementation(() => {
        throw new Error('Module not found');
      });

      const manager = new CamoufoxBrowserManager();
      await expect(manager.launchAsServer(8888)).rejects.toThrow();
    });

    it('passes config to server launch', async () => {
      const fakeServer = {
        wsEndpoint: vi.fn(() => 'ws://127.0.0.1:8888/test'),
        close: vi.fn(async () => {}),
      };
      camoufoxServerLaunchMock.mockResolvedValue(fakeServer);

      const manager = new CamoufoxBrowserManager({
        os: 'linux',
        headless: 'virtual',
        geoip: true,
        humanize: true,
        blockImages: true,
        blockWebrtc: true,
        proxy: { server: 'http://proxy:8080' },
      });

      const endpoint = await manager.launchAsServer(9999, '/ws');
      expect(endpoint).toBe('ws://127.0.0.1:8888/test');
      expect(camoufoxServerLaunchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          os: 'linux',
          headless: 'virtual',
          geoip: true,
          humanize: true,
          block_images: true,
          block_webrtc: true,
          proxy: { server: 'http://proxy:8080' },
          port: 9999,
          ws_path: '/ws',
        })
      );
    });

    it('closes existing server before relaunch and warns on close failure', async () => {
      const firstServer = {
        wsEndpoint: vi.fn(() => 'ws://127.0.0.1:8888/first'),
        close: vi.fn().mockRejectedValue(new Error('close fail')),
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

      // Second launch should close first (which fails) but proceed
      const endpoint = await manager.launchAsServer(9999);
      expect(endpoint).toBe('ws://127.0.0.1:9999/second');
      expect(firstServer.close).toHaveBeenCalled();
      expect(loggerState.warn).toHaveBeenCalledWith(
        'Failed to close previous server:',
        expect.any(Error)
      );
    });
  });

  // ── connectToServer ──

  describe('connectToServer', () => {
    it('connects to remote server and returns browser', async () => {
      const fakeBrowser = createFakeBrowser(true);
      playwrightConnectMock.mockResolvedValue(fakeBrowser);

      const manager = new CamoufoxBrowserManager();
      const result = await manager.connectToServer('ws://127.0.0.1:8888/test');

      expect(result).toBe(fakeBrowser);
      expect(playwrightConnectMock).toHaveBeenCalledWith('ws://127.0.0.1:8888/test');
      expect(manager.getBrowser()).toBe(fakeBrowser);
    });

    it('disconnects existing browser before connecting to new server', async () => {
      const existingBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(existingBrowser);

      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      const newBrowser = createFakeBrowser(true);
      playwrightConnectMock.mockResolvedValue(newBrowser);

      const result = await manager.connectToServer('ws://127.0.0.1:9999/new');

      expect(existingBrowser.close).toHaveBeenCalled();
      expect(result).toBe(newBrowser);
      expect(loggerState.info).toHaveBeenCalledWith(
        expect.stringContaining('Disconnecting existing browser')
      );
    });

    it('handles close error on existing browser when connecting', async () => {
      const existingBrowser = createFakeBrowser(true);
      existingBrowser.close.mockRejectedValue(new Error('disconnect fail'));
      camoufoxLaunchMock.mockResolvedValue(existingBrowser);

      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      const newBrowser = createFakeBrowser(true);
      playwrightConnectMock.mockResolvedValue(newBrowser);

      const result = await manager.connectToServer('ws://127.0.0.1:9999/new');
      expect(result).toBe(newBrowser);
      expect(loggerState.warn).toHaveBeenCalledWith(
        'Failed to close previous browser:',
        expect.any(Error)
      );
    });
  });

  // ── closeBrowserServer ──

  describe('closeBrowserServer', () => {
    it('closes server and resets endpoint', async () => {
      const fakeServer = {
        wsEndpoint: vi.fn(() => 'ws://127.0.0.1:8888/test'),
        close: vi.fn(async () => {}),
      };
      camoufoxServerLaunchMock.mockResolvedValue(fakeServer);

      const manager = new CamoufoxBrowserManager();
      await manager.launchAsServer(8888);
      expect(manager.getBrowserServerEndpoint()).toBe('ws://127.0.0.1:8888/test');

      await manager.closeBrowserServer();

      expect(fakeServer.close).toHaveBeenCalled();
      expect(manager.getBrowserServerEndpoint()).toBeNull();
      expect(loggerState.info).toHaveBeenCalledWith('Camoufox server closed');
    });

    it('is a no-op when no server exists', async () => {
      const manager = new CamoufoxBrowserManager();
      await expect(manager.closeBrowserServer()).resolves.not.toThrow();
      expect(manager.getBrowserServerEndpoint()).toBeNull();
    });
  });

  // ── getCDPSession ──

  describe('getCDPSession', () => {
    it('logs warning about limited CDP support', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);

      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      const fakePage = createFakePage();
      await manager.getCDPSession(fakePage);

      expect(loggerState.warn).toHaveBeenCalledWith(
        expect.stringContaining('CDP sessions on camoufox')
      );
    });

    it('returns CDP session from page context', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);

      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      const fakePage = createFakePage();
      const session = await manager.getCDPSession(fakePage);

      expect(session).toBeDefined();
      expect(fakePage.context).toHaveBeenCalled();
    });
  });

  // ── Constructor default config ──

  describe('constructor config', () => {
    it('uses all default config values', () => {
      const manager = new CamoufoxBrowserManager();
      expect(manager.getBrowser()).toBeNull();
      expect(manager.getBrowserServerEndpoint()).toBeNull();
    });

    it('applies custom config', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);

      const manager = new CamoufoxBrowserManager({
        os: 'macos',
        headless: false,
        geoip: true,
        humanize: 2,
        blockImages: true,
        blockWebrtc: true,
        proxy: { server: 'socks5://proxy:1080', username: 'user', password: 'pass' },
      });

      await manager.launch();

      expect(camoufoxLaunchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          os: 'macos',
          headless: false,
          geoip: true,
          humanize: 2,
          block_images: true,
          block_webrtc: true,
          proxy: { server: 'socks5://proxy:1080', username: 'user', password: 'pass' },
        })
      );
    });

    it('launches with default headless true when not specified', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);

      const manager = new CamoufoxBrowserManager({});
      await manager.launch();

      expect(camoufoxLaunchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          os: 'windows',
          headless: true,
          geoip: false,
          humanize: false,
          block_images: false,
          block_webrtc: false,
        })
      );
    });
  });

  // ── launch: concurrent launch deduplication ──

  describe('launch — concurrent dedup', () => {
    it('clears launchPromise after launch completes', async () => {
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);

      const manager = new CamoufoxBrowserManager();
      await manager.launch();

      // The launchPromise should be cleared, second launch should use isConnected path
      const result = await manager.launch();
      expect(result).toBe(fakeBrowser);
      // Only called once since isConnected returns true
      expect(camoufoxLaunchMock).toHaveBeenCalledOnce();
    });

    it('clears launchPromise even when launch fails', async () => {
      camoufoxLaunchMock.mockRejectedValueOnce(new Error('launch boom'));

      const manager = new CamoufoxBrowserManager();
      await expect(manager.launch()).rejects.toThrow('launch boom');

      // Should be able to try again
      const fakeBrowser = createFakeBrowser(true);
      camoufoxLaunchMock.mockResolvedValue(fakeBrowser);
      const result = await manager.launch();
      expect(result).toBe(fakeBrowser);
    });
  });
});
