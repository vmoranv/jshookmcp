import { parseJson } from '@tests/server/domains/shared/mock-factories';

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// Mock dependencies
vi.mock('@utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Use vi.hoisted so mocks survive clearAllMocks
const mocks = vi.hoisted(() => ({
  mockLaunchAsServer: vi.fn(),
  mockCloseBrowserServer: vi.fn(),
  mockGetBrowserServerEndpoint: vi.fn(),
}));

vi.mock('@server/domains/shared/modules', () => ({
  CamoufoxBrowserManager: function CamoufoxBrowserManagerMock() {
    return {
      launchAsServer: mocks.mockLaunchAsServer,
      closeBrowserServer: mocks.mockCloseBrowserServer,
      getBrowserServerEndpoint: mocks.mockGetBrowserServerEndpoint,
    };
  },
}));

vi.mock('@utils/betterSqlite3', () => ({
  isBetterSqlite3RelatedError: vi.fn().mockReturnValue(false),
  formatBetterSqlite3Error: vi.fn().mockReturnValue('SQLite error formatted'),
}));

// Mock camoufox-js as available by default
vi.mock('camoufox-js', () => ({}));

import { CamoufoxBrowserHandlers } from '@server/domains/browser/handlers/camoufox-browser';

interface CamoufoxServerLaunchResponse {
  success: boolean;
  error?: string;
  hint?: string;
  wsEndpoint?: string;
  message?: string;
}

interface CamoufoxServerCloseResponse {
  success: boolean;
  error?: string;
  message?: string;
}

interface CamoufoxServerStatusResponse {
  running: boolean;
  wsEndpoint: string | null;
}

type GetCamoufoxManagerFn = () => any | null;
type SetCamoufoxManagerFn = (manager: any) => void;
type CloseCamoufoxFn = () => Promise<void>;

describe('CamoufoxBrowserHandlers', () => {
  let getCamoufoxManager: Mock<GetCamoufoxManagerFn>;
  let setCamoufoxManager: Mock<SetCamoufoxManagerFn>;
  let closeCamoufox: Mock<CloseCamoufoxFn>;
  let handlers: CamoufoxBrowserHandlers;

  function makeDeps() {
    getCamoufoxManager = vi.fn<GetCamoufoxManagerFn>().mockReturnValue(null);
    setCamoufoxManager = vi.fn<SetCamoufoxManagerFn>();
    closeCamoufox = vi.fn<CloseCamoufoxFn>().mockResolvedValue(undefined);
    return { getCamoufoxManager, setCamoufoxManager, closeCamoufox };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockLaunchAsServer.mockResolvedValue('ws://localhost:9222');
    mocks.mockCloseBrowserServer.mockResolvedValue(undefined);
    mocks.mockGetBrowserServerEndpoint.mockReturnValue(null);
  });

  describe('handleCamoufoxServerLaunch', () => {
    describe('successful launch — creates new manager', () => {
      it('creates new CamoufoxBrowserManager when none exists', async () => {
        const deps = makeDeps();
        handlers = new CamoufoxBrowserHandlers(deps);

        const body = parseJson<CamoufoxServerLaunchResponse>(
          await handlers.handleCamoufoxServerLaunch({}),
        );

        expect(body.success).toBe(true);
        expect(body.wsEndpoint).toBe('ws://localhost:9222');
        expect(body.message).toContain('Camoufox server launched');
        expect(deps.setCamoufoxManager).toHaveBeenCalledOnce();
      });

      it('passes port and ws_path parameters', async () => {
        const deps = makeDeps();
        handlers = new CamoufoxBrowserHandlers(deps);

        await handlers.handleCamoufoxServerLaunch({
          port: 5000,
          ws_path: '/custom',
        });

        expect(mocks.mockLaunchAsServer).toHaveBeenCalledWith(5000, '/custom');
      });

      it('passes undefined port and ws_path when not provided', async () => {
        const deps = makeDeps();
        handlers = new CamoufoxBrowserHandlers(deps);

        await handlers.handleCamoufoxServerLaunch({});

        expect(mocks.mockLaunchAsServer).toHaveBeenCalledWith(undefined, undefined);
      });

      it('returns success with wsEndpoint and connect instructions', async () => {
        mocks.mockLaunchAsServer.mockResolvedValue('ws://localhost:5555/browser');
        const deps = makeDeps();
        handlers = new CamoufoxBrowserHandlers(deps);

        const body = parseJson<CamoufoxServerLaunchResponse>(
          await handlers.handleCamoufoxServerLaunch({}),
        );

        expect(body.success).toBe(true);
        expect(body.wsEndpoint).toBe('ws://localhost:5555/browser');
        expect(body.message).toContain('browser_launch');
        expect(body.message).toContain('camoufox');
        expect(body.message).toContain('connect');
      });
    });

    describe('successful launch — reuses existing manager', () => {
      it('reuses existing CamoufoxBrowserManager', async () => {
        const existingManager = {
          launchAsServer: vi.fn().mockResolvedValue('ws://localhost:1234'),
        };
        const deps = makeDeps();
        deps.getCamoufoxManager.mockReturnValue(existingManager);
        handlers = new CamoufoxBrowserHandlers(deps);

        const body = parseJson<CamoufoxServerLaunchResponse>(
          await handlers.handleCamoufoxServerLaunch({}),
        );

        expect(body.success).toBe(true);
        expect(body.wsEndpoint).toBe('ws://localhost:1234');
        expect(deps.setCamoufoxManager).not.toHaveBeenCalled();
      });
    });

    describe('launch failures', () => {
      it('returns error when launchAsServer throws Error', async () => {
        mocks.mockLaunchAsServer.mockRejectedValue(new Error('Browser binaries not found'));
        const deps = makeDeps();
        handlers = new CamoufoxBrowserHandlers(deps);

        const body = parseJson<CamoufoxServerLaunchResponse>(
          await handlers.handleCamoufoxServerLaunch({}),
        );

        expect(body.success).toBe(false);
        expect(body.error).toBe('Browser binaries not found');
        expect(body.hint).toContain('npx camoufox-js fetch');
      });

      it('returns error when launchAsServer throws non-Error string', async () => {
        mocks.mockLaunchAsServer.mockRejectedValue('string error');
        const deps = makeDeps();
        handlers = new CamoufoxBrowserHandlers(deps);

        const body = parseJson<CamoufoxServerLaunchResponse>(
          await handlers.handleCamoufoxServerLaunch({}),
        );

        expect(body.success).toBe(false);
        expect(body.error).toBe('string error');
      });

      it('returns error when launchAsServer throws null', async () => {
        mocks.mockLaunchAsServer.mockRejectedValue(null);
        const deps = makeDeps();
        handlers = new CamoufoxBrowserHandlers(deps);

        const body = parseJson<CamoufoxServerLaunchResponse>(
          await handlers.handleCamoufoxServerLaunch({}),
        );

        expect(body.success).toBe(false);
        expect(body.error).toBe('null');
      });

      it('includes hint about downloading browser binaries', async () => {
        mocks.mockLaunchAsServer.mockRejectedValue(new Error('any error'));
        const deps = makeDeps();
        handlers = new CamoufoxBrowserHandlers(deps);

        const body = parseJson<CamoufoxServerLaunchResponse>(
          await handlers.handleCamoufoxServerLaunch({}),
        );

        expect(body.hint).toBe('Try running: npx camoufox-js fetch to download browser binaries');
      });
    });
  });

  describe('handleCamoufoxServerClose', () => {
    it('returns error when no camoufox manager exists', async () => {
      const deps = makeDeps();
      deps.getCamoufoxManager.mockReturnValue(null);
      handlers = new CamoufoxBrowserHandlers(deps);

      const body = parseJson<CamoufoxServerCloseResponse>(
        await handlers.handleCamoufoxServerClose({}),
      );

      expect(body.success).toBe(false);
      expect(body.error).toBe('No camoufox server is running.');
    });

    it('closes the browser server successfully', async () => {
      const mockManager = {
        closeBrowserServer: vi.fn().mockResolvedValue(undefined),
      };
      const deps = makeDeps();
      deps.getCamoufoxManager.mockReturnValue(mockManager);
      handlers = new CamoufoxBrowserHandlers(deps);

      const body = parseJson<CamoufoxServerCloseResponse>(
        await handlers.handleCamoufoxServerClose({}),
      );

      expect(body.success).toBe(true);
      expect(body.message).toBe('Camoufox server closed.');
      expect(mockManager.closeBrowserServer).toHaveBeenCalledOnce();
    });

    it('ignores args parameter', async () => {
      const mockManager = {
        closeBrowserServer: vi.fn().mockResolvedValue(undefined),
      };
      const deps = makeDeps();
      deps.getCamoufoxManager.mockReturnValue(mockManager);
      handlers = new CamoufoxBrowserHandlers(deps);

      const body = parseJson<CamoufoxServerCloseResponse>(
        await handlers.handleCamoufoxServerClose({ someArg: 'ignored' }),
      );

      expect(body.success).toBe(true);
    });
  });

  describe('handleCamoufoxServerStatus', () => {
    it('returns not running when no manager exists', async () => {
      const deps = makeDeps();
      deps.getCamoufoxManager.mockReturnValue(null);
      handlers = new CamoufoxBrowserHandlers(deps);

      const body = parseJson<CamoufoxServerStatusResponse>(
        await handlers.handleCamoufoxServerStatus({}),
      );

      expect(body.running).toBe(false);
      expect(body.wsEndpoint).toBe(null);
    });

    it('returns not running when manager returns null endpoint', async () => {
      const mockManager = {
        getBrowserServerEndpoint: vi.fn().mockReturnValue(null),
      };
      const deps = makeDeps();
      deps.getCamoufoxManager.mockReturnValue(mockManager);
      handlers = new CamoufoxBrowserHandlers(deps);

      const body = parseJson<CamoufoxServerStatusResponse>(
        await handlers.handleCamoufoxServerStatus({}),
      );

      expect(body.running).toBe(false);
      expect(body.wsEndpoint).toBe(null);
    });

    it('returns not running when manager returns undefined endpoint', async () => {
      const mockManager = {
        getBrowserServerEndpoint: vi.fn().mockReturnValue(undefined),
      };
      const deps = makeDeps();
      deps.getCamoufoxManager.mockReturnValue(mockManager);
      handlers = new CamoufoxBrowserHandlers(deps);

      const body = parseJson<CamoufoxServerStatusResponse>(
        await handlers.handleCamoufoxServerStatus({}),
      );

      expect(body.running).toBe(false);
      expect(body.wsEndpoint).toBe(null);
    });

    it('returns running with wsEndpoint when server is active', async () => {
      const mockManager = {
        getBrowserServerEndpoint: vi.fn().mockReturnValue('ws://localhost:9222/browser'),
      };
      const deps = makeDeps();
      deps.getCamoufoxManager.mockReturnValue(mockManager);
      handlers = new CamoufoxBrowserHandlers(deps);

      const body = parseJson<CamoufoxServerStatusResponse>(
        await handlers.handleCamoufoxServerStatus({}),
      );

      expect(body.running).toBe(true);
      expect(body.wsEndpoint).toBe('ws://localhost:9222/browser');
    });

    it('ignores args parameter', async () => {
      const deps = makeDeps();
      deps.getCamoufoxManager.mockReturnValue(null);
      handlers = new CamoufoxBrowserHandlers(deps);

      const body = parseJson<CamoufoxServerStatusResponse>(
        await handlers.handleCamoufoxServerStatus({ ignored: true }),
      );

      expect(body.running).toBe(false);
    });
  });

  describe('response structure', () => {
    it('wraps close response in content array with type text', async () => {
      const deps = makeDeps();
      deps.getCamoufoxManager.mockReturnValue(null);
      handlers = new CamoufoxBrowserHandlers(deps);

      const response = await handlers.handleCamoufoxServerClose({});
      expect(response.content).toHaveLength(1);
      expect(response.content[0]?.type).toBe('text');
      expect(() => JSON.parse(response.content[0]!.text)).not.toThrow();
    });

    it('wraps status response in content array with type text', async () => {
      const deps = makeDeps();
      deps.getCamoufoxManager.mockReturnValue(null);
      handlers = new CamoufoxBrowserHandlers(deps);

      const response = await handlers.handleCamoufoxServerStatus({});
      expect(response.content).toHaveLength(1);
      expect(response.content[0]?.type).toBe('text');
      expect(() => JSON.parse(response.content[0]!.text)).not.toThrow();
    });

    it('wraps launch response in content array with type text', async () => {
      const deps = makeDeps();
      handlers = new CamoufoxBrowserHandlers(deps);

      const response = await handlers.handleCamoufoxServerLaunch({});
      expect(response.content).toHaveLength(1);
      expect(response.content[0]?.type).toBe('text');
      expect(() => JSON.parse(response.content[0]!.text)).not.toThrow();
    });

    it('formats JSON with 2-space indentation', async () => {
      const deps = makeDeps();
      deps.getCamoufoxManager.mockReturnValue(null);
      handlers = new CamoufoxBrowserHandlers(deps);

      const response = await handlers.handleCamoufoxServerStatus({});
      const text = response.content[0]!.text;

      expect(text).toContain('\n  ');
    });
  });
});
