import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  injectDll: vi.fn(),
  injectShellcode: vi.fn(),
  checkDebugPort: vi.fn(),
  enumerateModules: vi.fn(),
  recordMemoryAudit: vi.fn(),
  connect: vi.fn(),
  browserPages: vi.fn(),
  browserDisconnect: vi.fn(),
  pageEvaluate: vi.fn(),
}));

vi.mock(import('@server/domains/shared/modules'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    UnifiedProcessManager: class {
      getPlatform() {
        return 'win32';
      }
    } as unknown as typeof actual.UnifiedProcessManager,
    MemoryManager: class {
      injectDll = state.injectDll;
      injectShellcode = state.injectShellcode;
      checkDebugPort = state.checkDebugPort;
      enumerateModules = state.enumerateModules;
    } as unknown as typeof actual.MemoryManager,
  };
});

vi.mock(import('@src/modules/process/memory/AuditTrail'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    MemoryAuditTrail: class {
      record(entry: unknown) {
        state.recordMemoryAudit(entry);
      }

      exportJson() {
        return '[]';
      }

      clear() {}

      size() {
        return 0;
      }
    } as unknown as typeof actual.MemoryAuditTrail,
  };
});

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    connect: (...args: any[]) => state.connect(...args),
  },
}));

// Mock constants module with configurable ENABLE_INJECTION_TOOLS
const mockEnableInjectionTools = { value: false };
vi.mock(import('@src/constants'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    get ENABLE_INJECTION_TOOLS() {
      return mockEnableInjectionTools.value;
    },
  };
});

import { ProcessToolHandlersRuntime } from '@server/domains/process/handlers.impl.core.runtime.inject';

const originalFetch = global.fetch;

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: vi.fn().mockResolvedValue(body),
  };
}

function createBrowserPage(url: string) {
  return {
    url: () => url,
    evaluate: (...args: any[]) => state.pageEvaluate(...args),
  };
}

describe('handlers.impl.core.runtime.inject', () => {
  let handler: ProcessToolHandlersRuntime;

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new ProcessToolHandlersRuntime();
    mockEnableInjectionTools.value = false;
    global.fetch = vi.fn() as typeof fetch;
    state.connect.mockResolvedValue({
      pages: state.browserPages,
      disconnect: state.browserDisconnect,
    });
    state.browserPages.mockResolvedValue([]);
    state.browserDisconnect.mockResolvedValue(undefined);
    state.pageEvaluate.mockReset();
  });

  describe('ENABLE_INJECTION_TOOLS=false branch', () => {
    it('handleInjectDll returns disabled error when injection tools disabled', async () => {
      const result = await handler.handleInjectDll({ pid: 1234, dllPath: 'C:\\test.dll' });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Injection tools are disabled by configuration');
      expect(response.howToEnable).toContain('ENABLE_INJECTION_TOOLS=true');
      expect(response.securityNotice).toBeDefined();

      expect(state.injectDll).not.toHaveBeenCalled();
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inject_dll',
          pid: 1234,
          address: 'C:\\test.dll',
          result: 'failure',
        })
      );
    });

    it('handleInjectShellcode returns disabled error when injection tools disabled', async () => {
      const result = await handler.handleInjectShellcode({ pid: 1234, shellcode: '909090', encoding: 'hex' });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Injection tools are disabled by configuration');
      expect(response.howToEnable).toContain('ENABLE_INJECTION_TOOLS=true');

      expect(state.injectShellcode).not.toHaveBeenCalled();
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inject_shellcode',
          pid: 1234,
          size: 3, // 3 bytes from '909090'
          result: 'failure',
        })
      );
    });

    it('handleInjectShellcode calculates base64 size correctly when disabled', async () => {
      // 'AAAA' base64 = 3 bytes
      const shellcode = Buffer.from([0x41, 0x41, 0x41]).toString('base64');
      const result = await handler.handleInjectShellcode({ pid: 1234, shellcode, encoding: 'base64' });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          size: 3,
        })
      );
    });

    it('handleInjectDll handles missing pid gracefully when disabled', async () => {
      const result = await handler.handleInjectDll({ dllPath: 'C:\\test.dll' });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: null,
          address: 'C:\\test.dll',
        })
      );
    });

    it('handleInjectShellcode handles missing shellcode gracefully when disabled', async () => {
      const result = await handler.handleInjectShellcode({ pid: 1234 });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 1234,
          size: null,
        })
      );
    });
  });

  describe('ENABLE_INJECTION_TOOLS=true branch', () => {
    beforeEach(() => {
      mockEnableInjectionTools.value = true;
    });

    it('handleInjectDll delegates to memoryManager when enabled', async () => {
      state.injectDll.mockResolvedValue({ success: true, remoteThreadId: 42 });

      const result = await handler.handleInjectDll({ pid: 1234, dllPath: 'C:\\test.dll' });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(true);
      expect(response.remoteThreadId).toBe(42);
      expect(state.injectDll).toHaveBeenCalledWith(1234, 'C:\\test.dll');
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inject_dll',
          pid: 1234,
          address: 'C:\\test.dll',
          result: 'success',
        })
      );
    });

    it('handleInjectDll records failure when injection fails', async () => {
      state.injectDll.mockResolvedValue({ success: false, error: 'Access denied' });

      const result = await handler.handleInjectDll({ pid: 1234, dllPath: 'C:\\test.dll' });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Access denied');
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'failure',
          error: 'Access denied',
        })
      );
    });

    it('handleInjectDll handles exceptions and records audit', async () => {
      state.injectDll.mockRejectedValue(new Error('Unexpected error'));

      const result = await handler.handleInjectDll({ pid: 1234, dllPath: 'C:\\test.dll' });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Unexpected error');
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'failure',
          error: 'Unexpected error',
        })
      );
    });

    it('handleInjectShellcode delegates to memoryManager when enabled', async () => {
      state.injectShellcode.mockResolvedValue({ success: true, remoteThreadId: 100 });

      const result = await handler.handleInjectShellcode({ pid: 1234, shellcode: '9090', encoding: 'hex' });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(true);
      expect(response.remoteThreadId).toBe(100);
      expect(state.injectShellcode).toHaveBeenCalledWith(1234, '9090', 'hex');
      expect(state.recordMemoryAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'inject_shellcode',
          size: 2,
          result: 'success',
        })
      );
    });

    it('handleInjectShellcode defaults to hex encoding', async () => {
      state.injectShellcode.mockResolvedValue({ success: true, remoteThreadId: 100 });

      await handler.handleInjectShellcode({ pid: 1234, shellcode: '9090' });

      expect(state.injectShellcode).toHaveBeenCalledWith(1234, '9090', 'hex');
    });
  });

  describe('checkDebugPort', () => {
    it('returns result from memoryManager', async () => {
      state.checkDebugPort.mockResolvedValue({ success: true, isDebugged: false });

      const result = await handler.handleCheckDebugPort({ pid: 1234 });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(true);
      expect(response.isDebugged).toBe(false);
    });

    it('handles errors', async () => {
      state.checkDebugPort.mockRejectedValue(new Error('Check failed'));

      const result = await handler.handleCheckDebugPort({ pid: 1234 });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Check failed');
    });
  });

  describe('enumerateModules', () => {
    it('returns modules from memoryManager', async () => {
      state.enumerateModules.mockResolvedValue({
        success: true,
        modules: [{ name: 'kernel32.dll', baseAddress: '0x7FFE0000', size: 0x1000 }],
      });

      const result = await handler.handleEnumerateModules({ pid: 1234 });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(true);
      expect(response.modules).toHaveLength(1);
      expect(response.modules[0].name).toBe('kernel32.dll');
    });

    it('handles errors', async () => {
      state.enumerateModules.mockRejectedValue(new Error('Enumeration failed'));

      const result = await handler.handleEnumerateModules({ pid: 1234 });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Enumeration failed');
    });
  });

  describe('electronAttach', () => {
    it('returns a validation error for invalid ports', async () => {
      const result = await handler.handleElectronAttach({ port: 'abc' });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid port');
      expect(state.connect).not.toHaveBeenCalled();
    });

    it('falls back from /json/list to /json and returns filtered pages when evaluate is omitted', async () => {
      const fetchMock = vi.fn();
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
          {
            id: 'page-1',
            title: 'Home',
            url: 'https://app.local/home',
            type: 'page',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9229/devtools/page/page-1',
          },
          {
            id: 'page-2',
            title: 'Settings',
            url: 'https://app.local/settings',
            type: 'page',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9229/devtools/page/page-2',
          },
        ])
      );
      global.fetch = fetchMock as typeof fetch;

      const result = await handler.handleElectronAttach({ port: 9229, pageUrl: 'settings' });
      const response = JSON.parse(result.content[0]!.text);

      expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:9229/json/list');
      expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:9229/json');
      expect(response.total).toBe(2);
      expect(response.filtered).toBe(1);
      expect(response.pages[0]).toEqual(
        expect.objectContaining({
          title: 'Settings',
          url: 'https://app.local/settings',
        })
      );
      expect(state.connect).not.toHaveBeenCalled();
    });

    it('returns a structured connection failure when both CDP endpoints fail', async () => {
      const fetchMock = vi.fn();
      fetchMock.mockResolvedValueOnce(jsonResponse(null, { ok: false, status: 500 }));
      fetchMock.mockResolvedValueOnce(jsonResponse(null, { ok: false, status: 503 }));
      global.fetch = fetchMock as typeof fetch;

      const result = await handler.handleElectronAttach({ port: 9229, evaluate: '1 + 1' });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Cannot connect to Electron CDP at http://127.0.0.1:9229');
      expect(response.error).toContain('CDP fallback endpoint returned HTTP 503');
    });

    it('fails when the CDP target payload is not an array', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ invalid: true })) as typeof fetch;

      const result = await handler.handleElectronAttach({ port: 9229, evaluate: '1 + 1' });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toBe('CDP target list is not an array');
    });

    it('returns available targets when no matching page or websocket url is found', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        jsonResponse([
          {
            id: 'page-1',
            title: 'Home',
            url: 'https://app.local/home',
            type: 'page',
          },
        ])
      ) as typeof fetch;

      const result = await handler.handleElectronAttach({
        port: 9229,
        pageUrl: 'settings',
        evaluate: 'window.location.href',
      });

      expect(result.content[0]!.text).toContain('No matching page found');
      expect(result.content[0]!.text).toContain('[page] Home — https://app.local/home');
      expect(state.connect).not.toHaveBeenCalled();
    });

    it('uses the browser websocket endpoint from /json/version for successful evaluation', async () => {
      const fetchMock = vi.fn();
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
          {
            id: 'page-1',
            title: 'Main Window',
            url: 'https://app.local/dashboard',
            type: 'page',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9229/devtools/page/page-1',
          },
        ])
      );
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          webSocketDebuggerUrl: 'ws://127.0.0.1:9229/devtools/browser/browser-id',
        })
      );
      global.fetch = fetchMock as typeof fetch;
      state.browserPages.mockResolvedValue([createBrowserPage('https://app.local/dashboard')]);
      state.pageEvaluate.mockResolvedValue({ ok: true, result: { value: 2 } });

      const result = await handler.handleElectronAttach({ port: 9229, evaluate: '1 + 1' });
      const response = JSON.parse(result.content[0]!.text);

      expect(state.connect).toHaveBeenCalledWith({
        browserWSEndpoint: 'ws://127.0.0.1:9229/devtools/browser/browser-id',
        defaultViewport: null,
      });
      expect(state.pageEvaluate).toHaveBeenCalledWith(expect.any(Function), '1 + 1');
      expect(state.browserDisconnect).toHaveBeenCalledTimes(1);
      expect(response).toEqual(
        expect.objectContaining({
          success: true,
          result: { value: 2 },
        })
      );
    });

    it('derives a websocket endpoint from the page target and reports evaluate failures', async () => {
      const fetchMock = vi.fn();
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
          {
            id: 'page-1',
            title: 'Main Window',
            url: 'https://app.local/dashboard',
            type: 'page',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9229/devtools/page/page-1',
          },
        ])
      );
      fetchMock.mockRejectedValueOnce(new Error('version endpoint unavailable'));
      global.fetch = fetchMock as typeof fetch;
      state.browserPages.mockResolvedValue([createBrowserPage('https://app.local/other')]);
      state.pageEvaluate.mockResolvedValue({
        ok: false,
        error: { name: 'TypeError', message: 'boom' },
      });

      const result = await handler.handleElectronAttach({ port: 9229, evaluate: 'throw new Error("boom")' });
      const response = JSON.parse(result.content[0]!.text);

      expect(state.connect).toHaveBeenCalledWith({
        browserWSEndpoint: 'ws://127.0.0.1:9229',
        defaultViewport: null,
      });
      expect(response.success).toBe(false);
      expect(response.error).toBe('Evaluation failed: TypeError: boom');
      expect(response.target).toEqual({
        title: 'Main Window',
        url: 'https://app.local/dashboard',
      });
      expect(state.browserDisconnect).toHaveBeenCalledTimes(1);
    });

    it('fails when the connected browser exposes no pages', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        jsonResponse([
          {
            id: 'page-1',
            title: 'Main Window',
            url: 'https://app.local/dashboard',
            type: 'page',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9229/devtools/page/page-1',
          },
        ])
      ) as typeof fetch;
      state.browserPages.mockResolvedValue([]);

      const result = await handler.handleElectronAttach({
        port: 9229,
        wsEndpoint: 'ws://127.0.0.1:9229/devtools/browser/from-arg',
        evaluate: '1 + 1',
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Could not get page from connected browser');
      expect(state.browserDisconnect).toHaveBeenCalledTimes(1);
    });

    it('formats non-Error failures from connect through the outer catch handler', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        jsonResponse([
          {
            id: 'page-1',
            title: 'Main Window',
            url: 'https://app.local/dashboard',
            type: 'page',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9229/devtools/page/page-1',
          },
        ])
      ) as typeof fetch;
      state.connect.mockRejectedValue({ code: 'E_BROKEN' });

      const result = await handler.handleElectronAttach({
        port: 9229,
        wsEndpoint: 'ws://127.0.0.1:9229/devtools/browser/from-arg',
        evaluate: '1 + 1',
      });
      const response = JSON.parse(result.content[0]!.text);

      expect(response.success).toBe(false);
      expect(response.error).toContain('"code": "E_BROKEN"');
    });
  });
});
