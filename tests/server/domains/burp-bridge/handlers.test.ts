import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BurpBridgeHandlers } from '../../../../src/server/domains/burp-bridge/index.js';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('BurpBridgeHandlers', () => {
  /* ── Constructor SSRF protection ──────────────────────────────────── */

  describe('constructor - SSRF loopback validation', () => {
    it('accepts 127.0.0.1 endpoint', () => {
      expect(() => new BurpBridgeHandlers('http://127.0.0.1:18443')).not.toThrow();
    });

    it('accepts localhost endpoint', () => {
      expect(() => new BurpBridgeHandlers('http://localhost:18443')).not.toThrow();
    });

    it('accepts [::1] IPv6 loopback endpoint', () => {
      expect(() => new BurpBridgeHandlers('http://[::1]:18443')).not.toThrow();
    });

    it('accepts https protocol', () => {
      expect(() => new BurpBridgeHandlers('https://127.0.0.1:18443')).not.toThrow();
    });

    it('rejects external IP', () => {
      expect(() => new BurpBridgeHandlers('http://192.168.1.1:18443')).toThrow(/loopback/);
    });

    it('rejects external hostname', () => {
      expect(() => new BurpBridgeHandlers('http://evil.com:18443')).toThrow(/loopback/);
    });

    it('rejects ftp protocol', () => {
      expect(() => new BurpBridgeHandlers('ftp://127.0.0.1:18443')).toThrow(/http\/https/);
    });

    it('uses default endpoint when none provided', () => {
      const h = new BurpBridgeHandlers();
      expect(h).toBeInstanceOf(BurpBridgeHandlers);
    });
  });

  /* ── Endpoint immutability ────────────────────────────────────────── */

  describe('endpoint immutability', () => {
    let handlers: BurpBridgeHandlers;

    beforeEach(() => {
      handlers = new BurpBridgeHandlers('http://127.0.0.1:18443');
      // Mock global fetch to prevent actual network calls
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled')));
    });

    it('ignores endpoint override in args for handleBurpProxyStatus', async () => {
      const result = parseJson(
        await handlers.handleBurpProxyStatus({ endpoint: 'http://evil.com:1234' }),
      );
      // Should still use 127.0.0.1, and fail because fetch is mocked
      expect(result.endpoint).toBe('http://127.0.0.1:18443');
    });

    it('ignores endpoint override in args for handleBurpSendToRepeater', async () => {
      const result = parseJson(
        await handlers.handleBurpSendToRepeater({ url: 'http://test.com', endpoint: 'http://evil.com' }),
      );
      expect(result.endpoint).toBe('http://127.0.0.1:18443');
    });
  });

  /* ── Handler validation ───────────────────────────────────────────── */

  describe('handler input validation', () => {
    let handlers: BurpBridgeHandlers;

    beforeEach(() => {
      handlers = new BurpBridgeHandlers('http://127.0.0.1:18443');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled')));
    });

    it('handleInterceptAndReplayToBurp requires requestId', async () => {
      const result = parseJson(await handlers.handleInterceptAndReplayToBurp({}));
      expect(result.success).toBe(false);
      expect(result.error).toContain('requestId');
    });

    it('handleImportHarFromBurp requires harPath', async () => {
      const result = parseJson(await handlers.handleImportHarFromBurp({}));
      expect(result.success).toBe(false);
      expect(result.error).toContain('harPath');
    });

    it('handleDiffHar requires both har paths', async () => {
      const result = parseJson(await handlers.handleDiffHar({}));
      expect(result.success).toBe(false);
      expect(result.error).toContain('baseHarPath');
    });

    it('handleBurpSendToRepeater requires url', async () => {
      const result = parseJson(await handlers.handleBurpSendToRepeater({}));
      expect(result.success).toBe(false);
      expect(result.error).toContain('url');
    });
  });
});
