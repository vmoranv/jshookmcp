import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  generateFetchHook,
  generateWebSocketHook,
  generateXHRHook,
} from '@modules/hook/HookGeneratorBuilders.core.generators.network';

describe('HookGeneratorBuilders.core.generators.network', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generates XHR hooks that wrap open, headers, send and response instrumentation', () => {
    const script = generateXHRHook('log', 'window.__xhrPatched = true;');

    expect(script).toContain('const XHR = XMLHttpRequest.prototype;');
    expect(script).toContain('XHR.open = function(method, url, async, user, password)');
    expect(script).toContain('XHR.setRequestHeader = function(header, value)');
    expect(script).toContain('XHR.send = function(data)');
    expect(script).toContain("console.log('[XHR Hook] open:', {");
    expect(script).toContain("console.log('[XHR Hook] setRequestHeader:', { header, value });");
    expect(script).toContain("console.log('[XHR Hook] send:', {");
    expect(script).toContain('if (xhr.readyState === 4) {');
    expect(script).toContain(
      "console.log('[XHR Hook] responseText:', xhr.responseText?.substring(0, 500));"
    );
    expect(script).toContain("console.log('[XHR Hook] responseJSON:', xhr.response);");
    expect(script).toContain("if (event === 'load' || event === 'error' || event === 'abort') {");
    expect(script).toContain('window.__xhrPatched = true;');
  });

  it('supports blocking XHR open calls', () => {
    const script = generateXHRHook('block');

    expect(script).toContain('return;');
    expect(script).toContain("console.log('[Hook] XHR hooked successfully');");
  });

  it('generates fetch hooks with request inspection and response parsing branches', () => {
    const script = generateFetchHook('log', 'window.__fetchPatched = true;');

    expect(script).toContain('window.fetch = new Proxy(originalFetch');
    expect(script).toContain('if (resource instanceof Request) {');
    expect(script).toContain("method = config?.method || 'GET';");
    expect(script).toContain("console.log('[Fetch Hook] request:', hookContext);");
    expect(script).toContain('window.__fetchPatched = true;');
    expect(script).toContain('const startTime = performance.now();');
    expect(script).toContain('const clonedResponse = response.clone();');
    expect(script).toContain("if (contentType.includes('application/json')) {");
    expect(script).toContain("} else if (contentType.includes('text/')) {");
    expect(script).toContain("console.error('[Fetch Hook] error:', {");
  });

  it('supports blocking fetch requests', () => {
    const script = generateFetchHook('block');

    expect(script).toContain('return Promise.reject(new Error("Fetch blocked by hook"));');
  });

  it('generates websocket hooks that mirror static constants and wrap send and events', () => {
    const script = generateWebSocketHook('log', 'window.__wsPatched = true;');

    expect(script).toContain('const OriginalWebSocket = window.WebSocket;');
    expect(script).toContain('[WebSocket Hook #${wsId}] connecting:');
    expect(script).toContain('ws.send = function(data)');
    expect(script).toContain('[WebSocket Hook #${wsId}] send:');
    expect(script).toContain("ws.addEventListener('message', function(event)");
    expect(script).toContain("ws.addEventListener('close', function(event)");
    expect(script).toContain('window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;');
    expect(script).toContain('window.__wsPatched = true;');
  });

  it('supports blocking websocket construction', () => {
    const script = generateWebSocketHook('block');

    expect(script).toContain('throw new Error("WebSocket blocked by hook");');
  });
});
