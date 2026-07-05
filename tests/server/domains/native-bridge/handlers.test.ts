import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NativeBridgeHandlers } from '@server/domains/native-bridge/index';

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

    it('unknown action returns guide', async () => {
      const result = parseJson<any>(await handlers.handleGhidraBridge({ action: 'help' }));
      expect(result.guide).toBeDefined();
      expect(result.guide.actions).toBeInstanceOf(Array);
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
});
