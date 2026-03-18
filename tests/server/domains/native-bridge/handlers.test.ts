import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NativeBridgeHandlers } from '@server/domains/native-bridge/index';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('NativeBridgeHandlers', () => {
  /* ── Constructor SSRF protection ──────────────────────────────────── */

  describe('constructor - SSRF loopback validation', () => {
    it('accepts loopback endpoints', () => {
      expect(
        () => new NativeBridgeHandlers('http://127.0.0.1:18080', 'http://127.0.0.1:18081')
      ).not.toThrow();
    });

    it('accepts localhost endpoints', () => {
      expect(
        () => new NativeBridgeHandlers('http://localhost:18080', 'http://localhost:18081')
      ).not.toThrow();
    });

    it('accepts [::1] IPv6 loopback', () => {
      expect(
        () => new NativeBridgeHandlers('http://[::1]:18080', 'http://[::1]:18081')
      ).not.toThrow();
    });

    it('rejects external Ghidra endpoint', () => {
      expect(
        () => new NativeBridgeHandlers('http://evil.com:18080', 'http://127.0.0.1:18081')
      ).toThrow(/Ghidra.*loopback/);
    });

    it('rejects external IDA endpoint', () => {
      expect(
        () => new NativeBridgeHandlers('http://127.0.0.1:18080', 'http://10.0.0.1:18081')
      ).toThrow(/IDA.*loopback/);
    });

    it('rejects non-http protocol', () => {
      expect(() => new NativeBridgeHandlers('ftp://127.0.0.1:18080')).toThrow(/http\/https/);
    });

    it('uses defaults when no args provided', () => {
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
      const result = parseJson(await handlers.handleGhidraBridge({}));
      expect(result.success).toBe(false);
      expect(result.error).toContain('action');
    });

    it('handleIdaBridge requires action', async () => {
      const result = parseJson(await handlers.handleIdaBridge({}));
      expect(result.success).toBe(false);
      expect(result.error).toContain('action');
    });

    it('handleNativeSymbolSync requires valid source', async () => {
      const result = parseJson(await handlers.handleNativeSymbolSync({ source: 'invalid' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('ghidra');
    });

    it('handleNativeSymbolSync rejects missing source', async () => {
      const result = parseJson(await handlers.handleNativeSymbolSync({}));
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
      const result = parseJson(await handlers.handleGhidraBridge({ action: 'open_project' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('binaryPath');
    });

    it('decompile_function requires functionName', async () => {
      const result = parseJson(await handlers.handleGhidraBridge({ action: 'decompile_function' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('functionName');
    });

    it('run_script requires scriptPath', async () => {
      const result = parseJson(await handlers.handleGhidraBridge({ action: 'run_script' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('scriptPath');
    });

    it('get_xrefs requires functionName', async () => {
      const result = parseJson(await handlers.handleGhidraBridge({ action: 'get_xrefs' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('functionName');
    });

    it('unknown action returns guide', async () => {
      const result = parseJson(await handlers.handleGhidraBridge({ action: 'help' }));
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
      const result = parseJson(await handlers.handleIdaBridge({ action: 'open_binary' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('binaryPath');
    });

    it('decompile_function requires functionName', async () => {
      const result = parseJson(await handlers.handleIdaBridge({ action: 'decompile_function' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('functionName');
    });

    it('unknown action returns guide', async () => {
      const result = parseJson(await handlers.handleIdaBridge({ action: 'help' }));
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
        })
      );

      const result = parseJson(
        await handlers.handleNativeBridgeStatus({
          backend: 'ghidra',
          ghidraEndpoint: 'http://evil.com:9999',
        })
      );

      // Should use the constructor endpoint, not the args override
      expect(result.success).toBe(true);
      const ghidraResult = result.backends[0];
      expect(ghidraResult.endpoint).toBe('http://127.0.0.1:18080');
    });
  });
});
