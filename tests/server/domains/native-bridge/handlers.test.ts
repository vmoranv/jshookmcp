import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NativeBridgeHandlers } from '@server/domains/native-bridge/index';
import {
  ghidraBridgePing,
  GhidraBridgeTcpError,
} from '@server/domains/native-bridge/ghidra-bridge-tcp';
import {
  dispatchTcpAction,
  tcpStatus,
} from '@server/domains/native-bridge/ghidra-bridge-tcp-actions';

// Partial mocks: keep the real GhidraBridgeTcpError class (the handler's
// instanceof check distinguishes transport from argument errors) while
// letting backend-routing tests script the TCP reachability and dispatch.
vi.mock('@server/domains/native-bridge/ghidra-bridge-tcp', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ghidraBridgePing: vi.fn(),
}));
vi.mock('@server/domains/native-bridge/ghidra-bridge-tcp-actions', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dispatchTcpAction: vi.fn(),
  tcpStatus: vi.fn(),
}));

// File-level defaults: every test starts with "no TCP bridge running" —
// the same world the pre-TCP tests were written against. Individual tests
// override these to script reachability.
beforeEach(() => {
  vi.mocked(ghidraBridgePing).mockRejectedValue(
    new GhidraBridgeTcpError('bridge connection failed: ECONNREFUSED', 'connect'),
  );
  vi.mocked(tcpStatus).mockRejectedValue(
    new GhidraBridgeTcpError('bridge connection failed: ECONNREFUSED', 'connect'),
  );
  vi.mocked(dispatchTcpAction).mockRejectedValue(
    new Error('dispatchTcpAction not configured for this test'),
  );
});

describe('NativeBridgeHandlers', () => {
  /* ── Constructor SSRF protection ──────────────────────────────────── */

  describe('constructor - SSRF loopback validation', () => {
    it('accepts loopback endpoints', async () => {
      expect(
        () => new NativeBridgeHandlers('http://127.0.0.1:18080', 'http://127.0.0.1:18081'),
      ).not.toThrow();
    });

    it('accepts localhost endpoints', async () => {
      expect(
        () => new NativeBridgeHandlers('http://localhost:18080', 'http://localhost:18081'),
      ).not.toThrow();
    });

    it('accepts [::1] IPv6 loopback', async () => {
      expect(
        () => new NativeBridgeHandlers('http://[::1]:18080', 'http://[::1]:18081'),
      ).not.toThrow();
    });

    it('accepts explicit Rizin and Binary Ninja loopback endpoints', async () => {
      expect(
        () =>
          new NativeBridgeHandlers(
            'http://127.0.0.1:18080',
            'http://127.0.0.1:18081',
            'http://127.0.0.1:18082',
            'http://127.0.0.1:18083',
          ),
      ).not.toThrow();
    });

    it('rejects external Ghidra endpoint', async () => {
      expect(
        () => new NativeBridgeHandlers('http://evil.com:18080', 'http://127.0.0.1:18081'),
      ).toThrow(/Ghidra.*loopback/);
    });

    it('rejects external IDA endpoint', async () => {
      expect(
        () => new NativeBridgeHandlers('http://127.0.0.1:18080', 'http://10.0.0.1:18081'),
      ).toThrow(/IDA.*loopback/);
    });

    it('rejects non-http protocol', async () => {
      expect(() => new NativeBridgeHandlers('ftp://127.0.0.1:18080')).toThrow(/http\/https/);
    });

    it('rejects external Rizin and Binary Ninja endpoints', async () => {
      expect(
        () =>
          new NativeBridgeHandlers(
            'http://127.0.0.1:18080',
            'http://127.0.0.1:18081',
            'http://192.168.1.10:18082',
            'http://127.0.0.1:18083',
          ),
      ).toThrow(/Rizin.*loopback/);

      expect(
        () =>
          new NativeBridgeHandlers(
            'http://127.0.0.1:18080',
            'http://127.0.0.1:18081',
            'http://127.0.0.1:18082',
            'http://example.com:18083',
          ),
      ).toThrow(/Binary Ninja.*loopback/);
    });

    it('uses defaults when no args provided', async () => {
      const h = new NativeBridgeHandlers();
      expect(h).toBeInstanceOf(NativeBridgeHandlers);
    });
  });

  /* ── Handler validation ───────────────────────────────────────────── */

  describe('handler input validation', () => {
    let handlers: NativeBridgeHandlers;

    beforeEach(() => {
      handlers = new NativeBridgeHandlers();
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled')));
    });

    it('handleGhidraBridge requires action', async () => {
      const result = parseJson<any>(await handlers.handleGhidraBridge({}));
      expect(result.success).toBe(false);
      expect(result.error).toContain('action');
    });

    it('handleIdaBridge requires action', async () => {
      const result = parseJson<any>(await handlers.handleIdaBridge({}));
      expect(result.success).toBe(false);
      expect(result.error).toContain('action');
    });

    it('handleNativeSymbolSync requires valid source', async () => {
      const result = parseJson<any>(await handlers.handleNativeSymbolSync({ source: 'invalid' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('ghidra');
    });

    it('handleNativeSymbolSync rejects missing source', async () => {
      const result = parseJson<any>(await handlers.handleNativeSymbolSync({}));
      expect(result.success).toBe(false);
    });

    it('new bridge handlers require action', async () => {
      const rizin = parseJson<any>(await handlers.handleRizinBridge({}));
      const binaryNinja = parseJson<any>(await handlers.handleBinaryNinjaBridge({}));

      expect(rizin.error).toContain('action');
      expect(binaryNinja.error).toContain('action');
    });
  });

  /* ── Ghidra action routing ────────────────────────────────────────── */

  describe('ghidra action routing', () => {
    let handlers: NativeBridgeHandlers;

    beforeEach(() => {
      handlers = new NativeBridgeHandlers();
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled')));
    });

    it('open_project requires binaryPath', async () => {
      const result = parseJson<any>(await handlers.handleGhidraBridge({ action: 'open_project' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('binaryPath');
    });

    it('decompile_function requires functionName', async () => {
      const result = parseJson<any>(
        await handlers.handleGhidraBridge({ action: 'decompile_function' }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('functionName');
    });

    it('run_script requires scriptPath', async () => {
      const result = parseJson<any>(await handlers.handleGhidraBridge({ action: 'run_script' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('scriptPath');
    });

    it('get_xrefs requires functionName', async () => {
      const result = parseJson<any>(await handlers.handleGhidraBridge({ action: 'get_xrefs' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('functionName');
    });

    it('unknown action returns guide and reports failure', async () => {
      // The guide is still emitted so the caller can see the real action
      // list, but `success` must be false: auto mode routes every action the
      // TCP backend does not map into this branch, and a `success: true` with
      // no result would look like a completed call.
      const result = parseJson<any>(await handlers.handleGhidraBridge({ action: 'help' }));
      expect(result.success).toBe(false);
      expect(result.backend).toBe('http');
      expect(result.reason).toContain('"help"');
      expect(result.guide).toBeDefined();
      expect(result.guide.actions).toBeInstanceOf(Array);
    });

    it('blames only http when the backend was pinned explicitly', async () => {
      // Pinned to http, the TCP backend was never tried, so the error must not
      // claim it was. Otherwise a caller who pinned the wrong backend is told
      // to give up instead of switching.
      const result = parseJson<any>(
        await handlers.handleGhidraBridge({ action: 'help', backend: 'http' }),
      );
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Ghidra REST (http) backend');
      expect(result.triedBackends).toBeUndefined();
    });
  });

  /* ── IDA action routing ───────────────────────────────────────────── */

  describe('ida action routing', () => {
    let handlers: NativeBridgeHandlers;

    beforeEach(() => {
      handlers = new NativeBridgeHandlers();
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled')));
    });

    it('open_binary requires binaryPath', async () => {
      const result = parseJson<any>(await handlers.handleIdaBridge({ action: 'open_binary' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('binaryPath');
    });

    it('decompile_function requires functionName', async () => {
      const result = parseJson<any>(
        await handlers.handleIdaBridge({ action: 'decompile_function' }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('functionName');
    });

    it('unknown action returns guide', async () => {
      const result = parseJson<any>(await handlers.handleIdaBridge({ action: 'help' }));
      expect(result.guide).toBeDefined();
      expect(result.guide.actions).toBeInstanceOf(Array);
    });
  });

  /* ── Endpoint immutability ────────────────────────────────────────── */

  describe('endpoint immutability', () => {
    it('ignores endpoint override in status args', async () => {
      const handlers = new NativeBridgeHandlers();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 200,
          json: () => Promise.resolve({ version: '1.0' }),
        }),
      );

      const result = parseJson<any>(
        await handlers.handleNativeBridgeStatus({
          backend: 'ghidra',
          ghidraEndpoint: 'http://evil.com:9999',
        }),
      );

      // Should use the constructor endpoint, not the args override
      expect(result.success).toBe(true);
      const ghidraResult = result.backends[0];
      expect(ghidraResult.endpoint).toBe('http://127.0.0.1:18080');
    });

    it('ignores endpoint override for Rizin status args', async () => {
      const handlers = new NativeBridgeHandlers();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 200,
          json: () => Promise.resolve({ version: 'rizin-bridge' }),
        }),
      );

      const result = parseJson<any>(await handlers.handleNativeBridgeStatus({ backend: 'rizin' }));
      expect(result.success).toBe(true);
      expect(result.backends[0].available).toBe(true);
    });

    it('reports a 200 with non-JSON body as unavailable (misconfigured sidecar)', async () => {
      const handlers = new NativeBridgeHandlers();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 200,
          json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
        }),
      );

      const result = parseJson<any>(await handlers.handleNativeBridgeStatus({ backend: 'ghidra' }));
      expect(result.success).toBe(true);
      expect(result.backends[0].available).toBe(false);
    });
  });

  /* ── Capability advertisement ───────────────────────────────────── */

  describe('capability advertisement', () => {
    it('reports remote capabilities when the bridge exposes /capabilities', async () => {
      const handlers = new NativeBridgeHandlers();
      const fetchMock = vi.fn((url: string) => {
        if (url.endsWith('/health')) {
          return Promise.resolve({
            status: 200,
            json: () => Promise.resolve({ version: '1.0' }),
          });
        }
        if (url.endsWith('/capabilities')) {
          return Promise.resolve({
            status: 200,
            json: () => Promise.resolve({ actions: ['status', 'decompile_function'] }),
          });
        }
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = parseJson<any>(await handlers.handleNativeBridgeStatus({ backend: 'ghidra' }));

      expect(result.success).toBe(true);
      expect(result.backends[0]).toMatchObject({
        backend: 'ghidra',
        capabilitySource: 'remote',
        capabilities: ['status', 'decompile_function'],
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:18080/capabilities',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('falls back to static capabilities when /capabilities is unavailable', async () => {
      const handlers = new NativeBridgeHandlers();
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.endsWith('/health')) {
            return Promise.resolve({
              status: 200,
              json: () => Promise.resolve({ version: '1.0' }),
            });
          }
          return Promise.reject(new Error('not implemented'));
        }),
      );

      const result = parseJson<any>(await handlers.handleNativeBridgeStatus({ backend: 'ida' }));

      expect(result.backends[0].capabilitySource).toBe('static');
      expect(result.backends[0].capabilities).toEqual(
        expect.arrayContaining(['search_strings', 'get_segments']),
      );
    });
  });

  /* ── Backend parity actions ─────────────────────────────────────── */

  describe('backend parity actions', () => {
    it('routes ida search_strings to the filtered strings endpoint', async () => {
      const handlers = new NativeBridgeHandlers();
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        json: () => Promise.resolve([{ value: 'needle' }]),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = parseJson<any>(
        await handlers.handleIdaBridge({
          action: 'search_strings',
          searchPattern: 'needle',
        }),
      );

      expect(result).toMatchObject({
        success: true,
        action: 'search_strings',
        strings: [{ value: 'needle' }],
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:18081/strings',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ pattern: 'needle' }),
        }),
      );
    });

    it('routes segment listing for both Ghidra and IDA bridges', async () => {
      const handlers = new NativeBridgeHandlers();
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        json: () => Promise.resolve([{ name: '.text' }]),
      });
      vi.stubGlobal('fetch', fetchMock);

      const ghidra = parseJson<any>(await handlers.handleGhidraBridge({ action: 'get_segments' }));
      const ida = parseJson<any>(await handlers.handleIdaBridge({ action: 'get_segments' }));

      expect(ghidra.segments).toEqual([{ name: '.text' }]);
      expect(ida.segments).toEqual([{ name: '.text' }]);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:18080/segments',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:18081/segments',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  /* ── Rizin and Binary Ninja bridge actions ─────────────────────── */

  describe('additional backend actions', () => {
    it('routes Rizin run_command to the command endpoint', async () => {
      const handlers = new NativeBridgeHandlers();
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ stdout: 'entry0' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = parseJson<any>(
        await handlers.handleRizinBridge({
          action: 'run_command',
          command: 'aflj',
        }),
      );

      expect(result).toMatchObject({ success: true, action: 'run_command' });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:18082/commands/run',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ command: 'aflj' }),
        }),
      );
    });

    it('routes Rizin disassembly requests by function name', async () => {
      const handlers = new NativeBridgeHandlers();
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        json: () => Promise.resolve('push rbp'),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = parseJson<any>(
        await handlers.handleRizinBridge({
          action: 'disassemble_function',
          functionName: 'sym.main',
        }),
      );

      expect(result.disassembly).toBe('push rbp');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:18082/functions/sym.main/disassemble',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('routes Binary Ninja decompile and type queries', async () => {
      const handlers = new NativeBridgeHandlers();
      const fetchMock = vi.fn((url: string) => {
        if (url.endsWith('/decompile')) {
          return Promise.resolve({
            status: 200,
            json: () => Promise.resolve('int main() { return 0; }'),
          });
        }
        if (url.endsWith('/types')) {
          return Promise.resolve({
            status: 200,
            json: () => Promise.resolve([{ name: 'MyStruct' }]),
          });
        }
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });
      vi.stubGlobal('fetch', fetchMock);

      const decompiled = parseJson<any>(
        await handlers.handleBinaryNinjaBridge({
          action: 'decompile_function',
          functionName: 'main',
        }),
      );
      const types = parseJson<any>(
        await handlers.handleBinaryNinjaBridge({
          action: 'get_types',
        }),
      );

      expect(decompiled.decompiled).toContain('main');
      expect(types.types).toEqual([{ name: 'MyStruct' }]);
    });

    it('exports symbols from Rizin and Binary Ninja endpoints', async () => {
      const handlers = new NativeBridgeHandlers();
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        json: () => Promise.resolve([{ name: 'main' }]),
      });
      vi.stubGlobal('fetch', fetchMock);

      const rizin = parseJson<any>(await handlers.handleNativeSymbolSync({ source: 'rizin' }));
      const binaryNinja = parseJson<any>(
        await handlers.handleNativeSymbolSync({ source: 'binaryninja' }),
      );

      expect(rizin.success).toBe(true);
      expect(binaryNinja.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:18082/symbols/export',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:18083/symbols/export',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('forwards sinceHash and sqlite format to the export endpoint', async () => {
      const handlers = new NativeBridgeHandlers();
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ symbols: [{ name: 'main' }], nextSinceHash: 'abc123' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = parseJson<any>(
        await handlers.handleNativeSymbolSync({
          source: 'ghidra',
          exportFormat: 'sqlite',
          sinceHash: 'prev-hash',
        }),
      );

      expect(result.success).toBe(true);
      expect(result.format).toBe('sqlite');
      expect(result.sinceHash).toBe('prev-hash');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:18080/symbols/export',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ filter: '', format: 'sqlite', sinceHash: 'prev-hash' }),
        }),
      );
    });

    it('omits sinceHash from the body when not provided', async () => {
      const handlers = new NativeBridgeHandlers();
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        json: () => Promise.resolve([{ name: 'main' }]),
      });
      vi.stubGlobal('fetch', fetchMock);

      await handlers.handleNativeSymbolSync({ source: 'ghidra' });

      const call = fetchMock.mock.calls[0];
      const init = call?.[1] as { body?: string } | undefined;
      const body = JSON.parse(init?.body ?? '{}');
      expect(body).not.toHaveProperty('sinceHash');
      expect(body.format).toBe('json');
    });
  });

  /* ── ToolResponse wrappers ──────────────────────────────────────── */

  describe('ToolResponse wrappers', () => {
    it('preserves native status ToolResponse results without double wrapping', async () => {
      const handlers = new NativeBridgeHandlers();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 200,
          json: () => Promise.resolve({ version: '1.0' }),
        }),
      );

      const body = parseJson<any>(
        await handlers.handleNativeBridgeStatusTool({ backend: 'ghidra' }),
      );

      expect(body.success).toBe(true);
      expect(body.backends).toHaveLength(1);
      expect(body.content).toBeUndefined();
    });

    it('converts thrown bridge handler errors into structured ToolResponse failures', async () => {
      const handlers = new NativeBridgeHandlers();
      vi.spyOn(handlers, 'handleGhidraBridge').mockRejectedValueOnce(new Error('bridge failed'));

      const body = parseJson<any>(await handlers.handleGhidraBridgeTool({ action: 'status' }));

      expect(body.success).toBe(false);
      expect(body.error).toBe('bridge failed');
      expect(body.message).toBe('bridge failed');
    });
  });

  /* ── Ghidra backend routing & TCP per-action fallback ─────────────── */

  describe('ghidra backend routing & TCP per-action fallback', () => {
    let handlers: NativeBridgeHandlers;

    beforeEach(() => {
      handlers = new NativeBridgeHandlers();
      vi.mocked(ghidraBridgePing).mockReset();
      vi.mocked(dispatchTcpAction).mockReset();
      vi.mocked(tcpStatus).mockReset();
    });

    it('auto mode falls back to HTTP when the TCP backend does not map the action', async () => {
      vi.mocked(ghidraBridgePing).mockResolvedValue(true);
      vi.mocked(dispatchTcpAction).mockResolvedValue(undefined); // open_project: no TCP mapping
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ opened: true }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const body = parseJson<any>(
        await handlers.handleGhidraBridge({
          action: 'open_project',
          binaryPath: 'C:/bin/target.exe',
        }),
      );

      expect(body.success).toBe(true);
      expect(body.action).toBe('open_project');
      // The REST bridge actually served the HTTP-only action.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/project/open');
    });

    it('auto mode names both backends when neither maps the action', async () => {
      // Reachable TCP bridge declined the action, then the REST bridge hit its
      // default branch too. The caller must not read this as "the other
      // backend might work" — both were tried.
      vi.mocked(ghidraBridgePing).mockResolvedValue(true);
      vi.mocked(dispatchTcpAction).mockResolvedValue(undefined);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve({}) }),
      );

      const body = parseJson<any>(await handlers.handleGhidraBridge({ action: 'help' }));

      expect(body.success).toBe(false);
      expect(body.triedBackends).toEqual(['ghidra-bridge-py', 'http']);
      expect(body.reason).toContain('either Ghidra backend');
    });

    it('explicit ghidra-bridge-py reports unsupported for HTTP-only actions (no silent fallback)', async () => {
      vi.mocked(dispatchTcpAction).mockResolvedValue(undefined);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const body = parseJson<any>(
        await handlers.handleGhidraBridge({
          action: 'open_project',
          binaryPath: 'C:/bin/target.exe',
          backend: 'ghidra-bridge-py',
        }),
      );

      expect(body.success).toBe(false);
      expect(body.reason).toContain('not available on the pip ghidra_bridge TCP backend');
      expect(body.fix).toContain('Ghidra GUI');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('argument errors on the TCP path carry no pip install fix (nothing to install)', async () => {
      vi.mocked(dispatchTcpAction).mockRejectedValue(
        new Error('functionName is required for decompile_function'),
      );
      vi.stubGlobal('fetch', vi.fn());

      const body = parseJson<any>(
        await handlers.handleGhidraBridge({
          action: 'decompile_function',
          backend: 'ghidra-bridge-py',
        }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('functionName');
      expect(body.fix).toBeUndefined();
    });

    it('transport failures on the TCP path do carry the pip install fix', async () => {
      vi.mocked(dispatchTcpAction).mockRejectedValue(
        new GhidraBridgeTcpError('bridge connection failed: ECONNREFUSED', 'connect'),
      );

      const body = parseJson<any>(
        await handlers.handleGhidraBridge({
          action: 'list_functions',
          backend: 'ghidra-bridge-py',
        }),
      );

      expect(body.success).toBe(false);
      expect(body.fix).toContain('pip install ghidra_bridge');
    });

    it('auto status reports both bridges in one call', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 200,
          json: () => Promise.resolve({ ok: true }),
        }),
      );
      vi.mocked(tcpStatus).mockResolvedValue({
        success: true,
        action: 'status',
        backend: 'ghidra-bridge-py',
        reachable: true,
      });

      const body = parseJson<any>(await handlers.handleGhidraBridge({ action: 'status' }));

      expect(body.backend).toBe('ghidra');
      expect(body.available).toBe(true);
      expect(body.tcpBackend).toMatchObject({ backend: 'ghidra-bridge-py', reachable: true });
    });

    it('auto status keeps reporting when the HTTP bridge throws and the TCP probe fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('http bridge down')));
      vi.mocked(tcpStatus).mockRejectedValue(
        new GhidraBridgeTcpError('bridge connection failed: ECONNREFUSED', 'connect'),
      );

      const body = parseJson<any>(await handlers.handleGhidraBridge({ action: 'status' }));

      expect(body.available).toBe(false);
      expect(body.tcpBackend).toMatchObject({ reachable: false });
      expect(String(body.tcpBackend.reason)).toContain('ECONNREFUSED');
    });

    it('explicit http status stays HTTP-only (no TCP probe attached)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 200,
          json: () => Promise.resolve({ ok: true }),
        }),
      );
      vi.mocked(tcpStatus).mockResolvedValue({
        success: true,
        action: 'status',
        backend: 'ghidra-bridge-py',
        reachable: true,
      });

      const body = parseJson<any>(
        await handlers.handleGhidraBridge({ action: 'status', backend: 'http' }),
      );

      expect(body.available).toBe(true);
      expect(body.tcpBackend).toBeUndefined();
      expect(vi.mocked(tcpStatus)).not.toHaveBeenCalled();
    });
  });
});
