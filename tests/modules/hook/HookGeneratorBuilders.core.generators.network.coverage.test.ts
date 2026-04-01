/**
 * Additional coverage tests for HookGeneratorBuilders.core.generators.network.
 *
 * Focuses on branches not yet tested: log action (no block/custom), edge cases.
 */
import { describe, expect, it } from 'vitest';

import {
  generateFetchHook,
  generateWebSocketHook,
  generateXHRHook,
} from '@modules/hook/HookGeneratorBuilders.core.generators.network';

describe('HookGeneratorBuilders.core.generators.network — additional coverage', () => {
  // ── generateXHRHook ──────────────────────────────────────────

  describe('generateXHRHook — additional branches', () => {
    it('generates XHR hook with log action and no customCode', () => {
      const script = generateXHRHook('log');

      // No block directive should appear
      expect(script).not.toContain("${action === 'block' ? 'return;' : ''}");
      expect(script).toContain("console.log('[Hook] XHR hooked successfully');");
      expect(script).toContain("console.log('[XHR Hook] response:', {");
    });

    it('includes onreadystatechange wrapping', () => {
      const script = generateXHRHook('log');

      expect(script).toContain('xhr.onreadystatechange = function()');
      expect(script).toContain('if (originalOnReadyStateChange)');
    });

    it('includes addEventListener wrapping for load/error/abort events', () => {
      const script = generateXHRHook('log');

      expect(script).toContain('xhr.addEventListener = function(event, listener, ...args)');
      expect(script).toContain("event === 'load' || event === 'error' || event === 'abort'");
    });

    it('captures response type branches: text, json, and other', () => {
      const script = generateXHRHook('log');

      expect(script).toContain("xhr.responseType === '' || xhr.responseType === 'text'");
      expect(script).toContain("xhr.responseType === 'json'");
      expect(script).toContain("console.log('[XHR Hook] response:', typeof xhr.response)");
    });

    it('includes try-catch around response logging', () => {
      const script = generateXHRHook('log');

      expect(script).toContain("console.warn('[XHR Hook] Failed to log response:', e)");
    });
  });

  // ── generateFetchHook ────────────────────────────────────────

  describe('generateFetchHook — additional branches', () => {
    it('generates fetch hook with log action and no customCode', () => {
      const script = generateFetchHook('log');

      expect(script).not.toContain('Fetch blocked by hook');
      expect(script).toContain("console.log('[Fetch Hook] request:', hookContext);");
    });

    it('handles Request object detection branch', () => {
      const script = generateFetchHook('log');

      expect(script).toContain('if (resource instanceof Request)');
      expect(script).toContain('url = resource.url;');
      expect(script).toContain('method = resource.method;');
      expect(script).toContain('headers = Object.fromEntries(resource.headers.entries());');
      expect(script).toContain('body = resource.body;');
    });

    it('handles non-Request resource branch', () => {
      const script = generateFetchHook('log');

      expect(script).toContain('url = resource;');
      expect(script).toContain("method = config?.method || 'GET';");
      expect(script).toContain('headers = config?.headers || {};');
      expect(script).toContain('body = config?.body;');
    });

    it('includes response type parsing branches', () => {
      const script = generateFetchHook('log');

      expect(script).toContain("contentType.includes('application/json')");
      expect(script).toContain('const json = await clonedResponse.json()');
      expect(script).toContain("contentType.includes('text/')");
      expect(script).toContain('const text = await clonedResponse.text()');
      expect(script).toContain("console.log('[Fetch Hook] response type:', contentType)");
    });

    it('includes error catch in response chain', () => {
      const script = generateFetchHook('log');

      expect(script).toContain("console.warn('[Fetch Hook] Failed to parse response:', e.message)");
      expect(script).toContain("console.error('[Fetch Hook] error:', {");
    });

    it('includes response cloning for non-destructive body reading', () => {
      const script = generateFetchHook('log');

      expect(script).toContain('const clonedResponse = response.clone()');
    });
  });

  // ── generateWebSocketHook ────────────────────────────────────

  describe('generateWebSocketHook — additional branches', () => {
    it('generates websocket hook with log action and no customCode', () => {
      const script = generateWebSocketHook('log');

      expect(script).not.toContain('WebSocket blocked by hook');
      expect(script).toContain('const OriginalWebSocket = window.WebSocket;');
    });

    it('includes data type detection branches in send wrapper', () => {
      const script = generateWebSocketHook('log');

      expect(script).toContain("if (typeof data === 'string')");
      expect(script).toContain('if (data instanceof ArrayBuffer)');
      expect(script).toContain('if (data instanceof Blob)');
    });

    it('includes message event data type detection branches', () => {
      const script = generateWebSocketHook('log');

      expect(script).toContain("if (typeof event.data === 'string')");
      expect(script).toContain('if (event.data instanceof ArrayBuffer)');
      expect(script).toContain('if (event.data instanceof Blob)');
    });

    it('includes open event listener', () => {
      const script = generateWebSocketHook('log');

      expect(script).toContain("ws.addEventListener('open', function(event)");
      expect(script).toContain('protocol: ws.protocol');
      expect(script).toContain('extensions: ws.extensions');
    });

    it('includes error event listener', () => {
      const script = generateWebSocketHook('log');

      expect(script).toContain("ws.addEventListener('error', function(event)");
    });

    it('includes close event with code and reason', () => {
      const script = generateWebSocketHook('log');

      expect(script).toContain("ws.addEventListener('close', function(event)");
      expect(script).toContain('code: event.code');
      expect(script).toContain('reason: event.reason');
      expect(script).toContain('wasClean: event.wasClean');
    });

    it('preserves WebSocket static constants', () => {
      const script = generateWebSocketHook('log');

      expect(script).toContain('window.WebSocket.CONNECTING');
      expect(script).toContain('window.WebSocket.OPEN');
      expect(script).toContain('window.WebSocket.CLOSING');
      expect(script).toContain('window.WebSocket.CLOSED');
    });
  });
});
